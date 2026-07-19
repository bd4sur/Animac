#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>

#include "object.h"
#include "allocator.h"
#include "lexer.h"
#include "list.h"
#include "vocab.h"
#include "heap.h"
#include "map.h"
#include "ast.h"
#include "scope.h"
#include "parser.h"
#include "macro.h"


// ===============================================================================
// 宏描述符与宏环境
// ===============================================================================

typedef struct am_macro_clause_t {
    am_value_t  pattern;
    am_value_t  template;
    am_varid_t *pvars;
    size_t      pvar_count;
} am_macro_clause_t;


typedef struct am_macro_t {
    am_varid_t          name;
    am_ast_t           *ast;
    am_value_t          literals; // handle to list of literal varids, or AM_VALUE_NULL
    am_macro_clause_t  *clauses;
    size_t              clause_count;
    size_t              expansion_counter;
} am_macro_t;


typedef struct am_macro_env_frame_t {
    am_map_t *bindings; // varid -> am_macro_t*
    struct am_macro_env_frame_t *parent;
    am_ast_t *ast;      // 拥有 bindings map 的 AST，用于销毁 map
} am_macro_env_frame_t;


typedef struct am_macro_expand_ctx_t {
    am_ast_t                *ast;
    am_macro_env_frame_t    *env;
    size_t                   expansion_id;
    am_map_t                *fresh_map; // template-bound varid -> fresh varid
    am_map_t                *subst;     // pattern varid -> matched value (or list handle for ellipsis)
    am_handle_t              parent;
    int                      error;
    int                      changed;   // 是否实际发生过宏展开或 define-syntax 消除
    wchar_t                  error_msg[256];
    am_macro_t             **allocated_macros;
    size_t                   allocated_macro_count;
    size_t                   allocated_macro_capacity;
} am_macro_expand_ctx_t;


// ===============================================================================
// 基本工具函数
// ===============================================================================

static void macro_set_error(am_macro_expand_ctx_t *ctx, const wchar_t *msg) {
    if (!ctx || ctx->error) return;
    ctx->error = 1;
    wcsncpy(ctx->error_msg, msg, 255);
    ctx->error_msg[255] = L'\0';
}


static am_list_t *macro_list_from_handle(am_ast_t *ast, am_handle_t h) {
    if (!ast || h == AM_HANDLE_NULL) return NULL;
    am_value_t v = am_ast_get_node(ast, h);
    if (!am_value_is_ptr(v)) return NULL;
    return (am_list_t *)am_value_to_ptr(v);
}


static int macro_update_list_handle(am_ast_t *ast, am_handle_t h, am_list_t *old_lst, am_list_t *new_lst) {
    if (!ast || h == AM_HANDLE_NULL || !new_lst) return -1;
    if (new_lst == old_lst) return 0;
    return am_heap_set(ast->alloc, ast->alloc, ast->nodes, h,
                       am_make_value_of_ptr((am_object_t *)new_lst));
}


static int macro_list_push(am_ast_t *ast, am_handle_t h, am_value_t item, am_list_t **out_lst) {
    am_list_t *old_lst = macro_list_from_handle(ast, h);
    if (!old_lst) return -1;
    am_list_t *lst = am_list_push(ast->alloc, old_lst, item);
    if (!lst) return -1;
    if (macro_update_list_handle(ast, h, old_lst, lst) != 0) {
        am_list_destroy(ast->alloc, lst);
        return -1;
    }
    if (out_lst) *out_lst = lst;
    return 0;
}


static int macro_lambda_add_param(am_ast_t *ast, am_handle_t h, am_varid_t param) {
    am_list_t *old_lst = macro_list_from_handle(ast, h);
    if (!old_lst) return -1;
    am_list_t *lst = am_list_lambda_add_parameter(ast->alloc, old_lst, am_make_value_of_varid(param));
    if (!lst) return -1;
    if (macro_update_list_handle(ast, h, old_lst, lst) != 0) {
        am_list_destroy(ast->alloc, lst);
        return -1;
    }
    return 0;
}


static int macro_lambda_add_body(am_ast_t *ast, am_handle_t h, am_value_t body, am_list_t **out_lst) {
    am_list_t *old_lst = macro_list_from_handle(ast, h);
    if (!old_lst) return -1;
    am_list_t *lst = am_list_lambda_add_body(ast->alloc, old_lst, body);
    if (!lst) return -1;
    if (macro_update_list_handle(ast, h, old_lst, lst) != 0) {
        am_list_destroy(ast->alloc, lst);
        return -1;
    }
    if (out_lst) *out_lst = lst;
    return 0;
}


static int macro_is_symbol_value(am_value_t v, am_value_t kw) {
    return am_value_is_symbol(v) && am_value_to_symbol(v) == am_value_to_symbol(kw);
}


static am_list_t *macro_as_list(am_ast_t *ast, am_value_t v);


// 判断 v 是否是 ellipsis 标记。
// 支持以下形式：
//   - AM_VALUE_KW_dot3（application / unquote 中的关键字 ...）
//   - symbol "'..."（quote/quasiquote 中被 parser 转换后的 ...）
//   - (unquote ...) 包装
// in_quote 为真时，不把 "'..." 当成 ellipsis，以保留 (quote ...) 中的字面 ...。
static int macro_is_ellipsis_marker(am_ast_t *ast, am_value_t v, int in_quote) {
    if (macro_is_symbol_value(v, AM_VALUE_KW_dot3)) return 1;

    if (!in_quote && am_value_is_symbol(v)) {
        am_symbol_t sym = am_value_to_symbol(v);
        wchar_t *name = am_vocab_get(ast->alloc, ast->symbol_vocab, &sym);
        if (name && wcscmp(name, L"'...") == 0) return 1;
    }

    if (am_value_is_handle(v)) {
        am_list_t *lst = macro_as_list(ast, v);
        if (lst && lst->type == AM_LIST_TYPE_UNQUOTE && lst->length == 1) {
            return macro_is_ellipsis_marker(ast, am_list_get(ast->alloc, lst, 0), 0);
        }
    }

    return 0;
}


static int macro_is_varid_in_list(am_ast_t *ast, am_value_t v, am_value_t list_handle) {
    if (!am_value_is_varid(v)) return 0;
    if (am_value_is_null(list_handle)) return 0;
    if (!am_value_is_handle(list_handle)) return 0;
    am_list_t *lst = macro_list_from_handle(ast, am_value_to_handle(list_handle));
    if (!lst) return 0;
    for (size_t i = 0; i < lst->length; i++) {
        if (am_value_equal(v, am_list_get(ast->alloc, lst, i))) return 1;
    }
    return 0;
}


// ===============================================================================
// 宏展开产生的新 lambda 作用域注册
// ===============================================================================

static int macro_register_lambda_scope(am_macro_expand_ctx_t *ctx, am_handle_t lambda_h, am_handle_t parent_h) {
    if (lambda_h == AM_HANDLE_NULL) return -1;
    am_handle_t parent_lambda = AM_HANDLE_NULL;
    am_handle_t parent_scope_h = AM_HANDLE_NULL;
    if (parent_h != AM_HANDLE_NULL && parent_h != AM_TOP_NODE_HANDLE) {
        parent_lambda = am_ast_find_nearest_lambda_handle(ctx->ast, parent_h);
        if (parent_lambda != AM_HANDLE_NULL) {
            am_value_t v = am_map_get(ctx->ast->alloc, ctx->ast->scopes,
                                      am_make_value_of_handle(parent_lambda));
            if (am_value_is_handle(v)) parent_scope_h = am_value_to_handle(v);
        }
    }

    am_scope_t *scope = am_scope_create(ctx->ast->alloc, parent_scope_h, parent_lambda, lambda_h, 16);
    if (!scope) return -1;

    am_handle_t scope_h = am_heap_alloc_handle(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes);
    if (scope_h == AM_HANDLE_NULL) {
        am_scope_destroy(ctx->ast->alloc, scope);
        return -1;
    }
    if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, scope_h,
                    am_make_value_of_ptr((am_object_t *)scope)) != 0) {
        am_scope_destroy(ctx->ast->alloc, scope);
        return -1;
    }

    am_map_t *m = am_map_set(ctx->ast->alloc, ctx->ast->scopes,
                              am_make_value_of_handle(lambda_h),
                              am_make_value_of_handle(scope_h));
    if (!m) return -1;
    ctx->ast->scopes = m;
    return 0;
}


static int macro_lambda_scope_add_var(am_macro_expand_ctx_t *ctx, am_handle_t lambda_h, am_varid_t var) {
    am_value_t scope_h_val = am_map_get(ctx->ast->alloc, ctx->ast->scopes,
                                        am_make_value_of_handle(lambda_h));
    if (!am_value_is_handle(scope_h_val)) return -1;
    am_handle_t scope_h = am_value_to_handle(scope_h_val);
    am_value_t scope_val = am_heap_get(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, scope_h);
    if (!am_value_is_ptr(scope_val)) return -1;
    am_scope_t *scope = (am_scope_t *)am_value_to_ptr(scope_val);
    am_scope_t *new_scope = am_scope_add_var(ctx->ast->alloc, scope, var, AM_VALUE_UNDEFINED);
    if (!new_scope) return -1;
    if (new_scope != scope) {
        if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, scope_h,
                        am_make_value_of_ptr((am_object_t *)new_scope)) != 0) {
            return -1;
        }
    }
    return 0;
}


// ===============================================================================
// 宏环境帧
// ===============================================================================

static am_macro_env_frame_t *macro_env_frame_create(am_ast_t *ast) {
    am_macro_env_frame_t *frame = (am_macro_env_frame_t *)malloc(sizeof(am_macro_env_frame_t));
    if (!frame) return NULL;
    frame->bindings = am_map_create(ast->alloc, 16);
    frame->parent = NULL;
    frame->ast = ast;
    if (!frame->bindings) {
        free(frame);
        return NULL;
    }
    return frame;
}


static void macro_env_frame_destroy(am_macro_env_frame_t *frame) {
    if (!frame) return;
    // bindings 中的 value（am_macro_t*）由 macro_expand 上下文统一释放，
    // 这里先将所有有效槽位的 value 置空，避免 am_map_destroy 误释放它们。
    if (frame->bindings && frame->ast) {
        am_map_t *m = frame->bindings;
        for (size_t i = 0; i < m->capacity; i++) {
            if (m->slots[i].key != AM_MAP_KEY_EMPTY && m->slots[i].key != AM_MAP_KEY_TOMBSTONE) {
                m->slots[i].value = AM_VALUE_NULL;
            }
        }
        am_map_destroy(frame->ast->alloc, frame->bindings);
    }
    free(frame);
}


static am_macro_t *macro_env_lookup(am_macro_env_frame_t *frame, am_varid_t name) {
    for (am_macro_env_frame_t *f = frame; f; f = f->parent) {
        am_value_t v = am_map_get(NULL, f->bindings, am_make_value_of_varid(name));
        if (am_value_is_ptr(v)) {
            return (am_macro_t *)am_value_to_ptr(v);
        }
    }
    return NULL;
}


static int macro_env_define(am_ast_t *ast, am_macro_env_frame_t *frame,
                            am_varid_t name, am_macro_t *macro) {
    am_map_t *m = am_map_set(ast->alloc, frame->bindings,
                              am_make_value_of_varid(name),
                              am_make_value_of_ptr((am_object_t *)macro));
    if (!m) return -1;
    frame->bindings = m;
    return 0;
}


// ===============================================================================
// 模式变量收集
// ===============================================================================

typedef struct {
    am_ast_t *ast;
    am_value_t *pvars;
    size_t count;
    size_t capacity;
    am_value_t literals;
} macro_pvar_collect_t;


static int macro_pvar_collect_add(macro_pvar_collect_t *collect, am_value_t v) {
    if (!collect || !am_value_is_varid(v)) return 0;
    // 避免重复
    for (size_t i = 0; i < collect->count; i++) {
        if (am_value_equal(collect->pvars[i], v)) return 0;
    }
    if (collect->count >= collect->capacity) {
        size_t new_cap = collect->capacity ? collect->capacity * 2 : 8;
        am_value_t *new_arr = (am_value_t *)realloc(collect->pvars, new_cap * sizeof(am_value_t));
        if (!new_arr) return -1;
        collect->pvars = new_arr;
        collect->capacity = new_cap;
    }
    collect->pvars[collect->count++] = v;
    return 0;
}


static int macro_collect_pattern_vars_recursive(macro_pvar_collect_t *collect, am_value_t pattern);


static int macro_collect_pattern_vars_list(macro_pvar_collect_t *collect, am_list_t *lst) {
    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(collect->ast->alloc, lst, i);
        // 跳过 ellipsis 标记本身
        if (macro_is_symbol_value(child, AM_VALUE_KW_dot3)) continue;
        // 如果当前 child 后面跟着 ...，则该 child 是 ellipsis 模式，仍递归收集其内部模式变量
        if (macro_collect_pattern_vars_recursive(collect, child) != 0) return -1;
    }
    return 0;
}


static int macro_collect_pattern_vars_recursive(macro_pvar_collect_t *collect, am_value_t pattern) {
    if (!collect) return 0;

    if (am_value_is_varid(pattern)) {
        // 排除 literals 与 _
        if (macro_is_symbol_value(pattern, AM_VALUE_KW_underscore)) return 0;
        if (macro_is_varid_in_list(collect->ast, pattern, collect->literals)) return 0;
        return macro_pvar_collect_add(collect, pattern);
    }

    if (am_value_is_handle(pattern)) {
        am_list_t *lst = macro_list_from_handle(collect->ast, am_value_to_handle(pattern));
        if (!lst) return 0;
        return macro_collect_pattern_vars_list(collect, lst);
    }

    return 0;
}


// ===============================================================================
// syntax-rules 解析
// ===============================================================================

static void macro_free_macro(am_macro_t *macro) {
    if (!macro) return;
    if (macro->clauses) {
        for (size_t i = 0; i < macro->clause_count; i++) {
            free(macro->clauses[i].pvars);
        }
        free(macro->clauses);
    }
    free(macro);
}


// 如果一个标识符的名字与某个模式变量相同，则把它规范化为该模式变量的 varid。
// 这是必要的，因为 ARN 可能给模板中的同名标识符分配了与模式变量不同的 varid
//（例如模板标识符恰好与外层变量同名）。
static const wchar_t *macro_var_basename(const wchar_t *name) {
    const wchar_t *p = wcsrchr(name, L'.');
    return p ? p + 1 : name;
}


static am_value_t macro_canonicalize_varid(am_ast_t *ast, am_varid_t varid,
                                            am_varid_t *pvars, wchar_t **pvar_names, size_t pvar_count) {
    wchar_t *name = am_vocab_get(ast->alloc, ast->var_vocab, &varid);
    if (!name) return am_make_value_of_varid(varid);
    const wchar_t *base = macro_var_basename(name);
    for (size_t i = 0; i < pvar_count; i++) {
        if (pvar_names[i] && wcscmp(base, macro_var_basename(pvar_names[i])) == 0) {
            return am_make_value_of_varid(pvars[i]);
        }
    }
    return am_make_value_of_varid(varid);
}


// 递归规范化模板中的模式变量标识符。quote 内部保持原样。
static int macro_canonicalize_template_vars(am_ast_t *ast, am_value_t value,
                                             am_varid_t *pvars, wchar_t **pvar_names, size_t pvar_count) {
    if (am_value_is_varid(value)) {
        return 0; // 由调用处直接替换
    }
    if (!am_value_is_handle(value)) return 0;
    am_handle_t h = am_value_to_handle(value);
    am_value_t node_val = am_ast_get_node(ast, h);
    if (!am_value_is_ptr(node_val)) return 0;
    am_object_t *obj = am_value_to_ptr(node_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return 0;
    am_list_t *lst = (am_list_t *)obj;
    if (lst->type == AM_LIST_TYPE_QUOTE) return 0;
    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(ast->alloc, lst, i);
        if (am_value_is_varid(child)) {
            lst->children[i] = macro_canonicalize_varid(ast, am_value_to_varid(child),
                                                        pvars, pvar_names, pvar_count);
        } else if (am_value_is_handle(child)) {
            if (macro_canonicalize_template_vars(ast, child, pvars, pvar_names, pvar_count) != 0) return -1;
        }
    }
    return 0;
}


static am_macro_t *macro_parse_syntax_rules(am_ast_t *ast, am_varid_t name, am_handle_t sr_handle) {
    am_list_t *sr_lst = macro_list_from_handle(ast, sr_handle);
    if (!sr_lst || sr_lst->type != AM_LIST_TYPE_APPLICATION || sr_lst->length < 3) {
        return NULL;
    }

    am_value_t first = am_list_get(ast->alloc, sr_lst, 0);
    if (!macro_is_symbol_value(first, AM_VALUE_KW_syntax_rules)) {
        return NULL;
    }

    am_value_t literals = am_list_get(ast->alloc, sr_lst, 1);
    if (!am_value_is_handle(literals) && !am_value_is_null(literals)) {
        return NULL;
    }
    if (am_value_is_handle(literals)) {
        am_list_t *lit_lst = macro_list_from_handle(ast, am_value_to_handle(literals));
        if (!lit_lst) return NULL;
        // literals 列表中的每个元素必须是 varid 或 symbol（关键字）
        for (size_t i = 0; i < lit_lst->length; i++) {
            am_value_t lit = am_list_get(ast->alloc, lit_lst, i);
            if (!am_value_is_varid(lit) && !am_value_is_symbol(lit)) {
                return NULL;
            }
        }
    }

    size_t clause_count = sr_lst->length - 2;
    if (clause_count == 0) return NULL;

    am_macro_t *macro = (am_macro_t *)calloc(1, sizeof(am_macro_t));
    if (!macro) return NULL;
    macro->name = name;
    macro->ast = ast;
    macro->literals = literals;
    macro->expansion_counter = 0;
    macro->clause_count = clause_count;
    macro->clauses = (am_macro_clause_t *)calloc(clause_count, sizeof(am_macro_clause_t));
    if (!macro->clauses) {
        free(macro);
        return NULL;
    }

    for (size_t i = 0; i < clause_count; i++) {
        am_value_t clause_val = am_list_get(ast->alloc, sr_lst, i + 2);
        if (!am_value_is_handle(clause_val)) {
            macro_free_macro(macro);
            return NULL;
        }
        am_list_t *clause_lst = macro_list_from_handle(ast, am_value_to_handle(clause_val));
        if (!clause_lst || clause_lst->type != AM_LIST_TYPE_APPLICATION || clause_lst->length != 2) {
            macro_free_macro(macro);
            return NULL;
        }

        am_macro_clause_t *clause = &macro->clauses[i];
        clause->pattern = am_list_get(ast->alloc, clause_lst, 0);
        clause->template = am_list_get(ast->alloc, clause_lst, 1);

        macro_pvar_collect_t collect = { ast, NULL, 0, 0, literals };
        if (macro_collect_pattern_vars_recursive(&collect, clause->pattern) != 0) {
            free(collect.pvars);
            macro_free_macro(macro);
            return NULL;
        }
        clause->pvar_count = collect.count;
        clause->pvars = (am_varid_t *)malloc(collect.count * sizeof(am_varid_t));
        if (!clause->pvars) {
            free(collect.pvars);
            macro_free_macro(macro);
            return NULL;
        }
        for (size_t j = 0; j < collect.count; j++) {
            clause->pvars[j] = am_value_to_varid(collect.pvars[j]);
        }
        free(collect.pvars);

        // 规范化模板中的模式变量：把与模式变量同名的标识符统一成模式变量的 varid。
        if (clause->pvar_count > 0) {
            wchar_t **pvar_names = (wchar_t **)malloc(clause->pvar_count * sizeof(wchar_t *));
            if (!pvar_names) {
                macro_free_macro(macro);
                return NULL;
            }
            for (size_t j = 0; j < clause->pvar_count; j++) {
                pvar_names[j] = am_vocab_get(ast->alloc, ast->var_vocab, &clause->pvars[j]);
            }
            if (am_value_is_varid(clause->template)) {
                clause->template = macro_canonicalize_varid(ast, am_value_to_varid(clause->template),
                                                            clause->pvars, pvar_names, clause->pvar_count);
            } else if (am_value_is_handle(clause->template)) {
                if (macro_canonicalize_template_vars(ast, clause->template, clause->pvars,
                                                     pvar_names, clause->pvar_count) != 0) {
                    free(pvar_names);
                    macro_free_macro(macro);
                    return NULL;
                }
            }
            free(pvar_names);
        }
    }

    return macro;
}


// ===============================================================================
// 模式匹配
// ===============================================================================

static int macro_is_pattern_var(am_macro_t *macro, am_macro_clause_t *clause, am_varid_t varid) {
    (void)macro;
    for (size_t i = 0; i < clause->pvar_count; i++) {
        if (clause->pvars[i] == varid) return 1;
    }
    return 0;
}


static int macro_is_literal(am_macro_t *macro, am_varid_t varid) {
    return macro_is_varid_in_list(macro->ast, am_make_value_of_varid(varid), macro->literals);
}


static am_map_t *macro_subst_clone(am_ast_t *ast, am_map_t *subst) {
    if (!subst) return am_map_create(ast->alloc, 16);
    return am_map_copy(ast->alloc, subst);
}


static am_handle_t macro_ellipsis_list_get_or_create(am_macro_expand_ctx_t *ctx, am_varid_t pvar) {
    am_value_t v = am_map_get(NULL, ctx->subst, am_make_value_of_varid(pvar));
    if (am_value_is_handle(v)) return am_value_to_handle(v);
    am_handle_t parent = ctx->parent;
    if (parent == AM_HANDLE_NULL || parent == AM_TOP_NODE_HANDLE) parent = 0;
    am_handle_t h = am_ast_make_slist_node(ctx->ast, parent, AM_LIST_TYPE_APPLICATION);
    if (h == AM_HANDLE_NULL) return AM_HANDLE_NULL;
    am_map_t *m = am_map_set(ctx->ast->alloc, ctx->subst,
                              am_make_value_of_varid(pvar), am_make_value_of_handle(h));
    if (!m) return AM_HANDLE_NULL;
    ctx->subst = m;
    return h;
}


static int macro_ellipsis_list_append(am_macro_expand_ctx_t *ctx, am_varid_t pvar, am_value_t value) {
    am_handle_t h = macro_ellipsis_list_get_or_create(ctx, pvar);
    if (h == AM_HANDLE_NULL) return -1;
    return macro_list_push(ctx->ast, h, value, NULL);
}


// 判断 value 是否是列表（任意 list 类型），返回 list 指针；不是则返回 NULL
static am_list_t *macro_as_list(am_ast_t *ast, am_value_t v) {
    if (!am_value_is_handle(v)) return NULL;
    am_list_t *lst = macro_list_from_handle(ast, am_value_to_handle(v));
    if (!lst) return NULL;
    if (lst->type != AM_LIST_TYPE_APPLICATION &&
        lst->type != AM_LIST_TYPE_LAMBDA &&
        lst->type != AM_LIST_TYPE_QUOTE &&
        lst->type != AM_LIST_TYPE_QUASIQUOTE &&
        lst->type != AM_LIST_TYPE_UNQUOTE) {
        return NULL;
    }
    return lst;
}


static int macro_match_value(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                              am_macro_clause_t *clause, am_value_t pattern, am_value_t input);


static int macro_collect_pvars_in_value(am_macro_t *macro, am_macro_clause_t *clause,
                                         am_value_t value, am_value_t **out_pvars, size_t *out_count);


static int macro_match_list(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                             am_macro_clause_t *clause, am_list_t *pat_lst, am_list_t *in_lst) {
    // 检测 ellipsis 位置：只允许列表顶层出现一个 ellipsis
    int ellipsis_pos = -1;
    for (size_t i = 0; i < pat_lst->length; i++) {
        am_value_t child = am_list_get(ctx->ast->alloc, pat_lst, i);
        if (macro_is_symbol_value(child, AM_VALUE_KW_dot3)) {
            if (ellipsis_pos >= 0) {
                macro_set_error(ctx, L"multiple ellipses in macro pattern");
                return -1;
            }
            if (i == 0) {
                macro_set_error(ctx, L"ellipsis at beginning of macro pattern");
                return -1;
            }
            ellipsis_pos = (int)(i - 1);
        }
    }

    if (ellipsis_pos < 0) {
        // 无 ellipsis，逐元素匹配
        if (pat_lst->length != in_lst->length) return -1;
        for (size_t i = 0; i < pat_lst->length; i++) {
            am_value_t p = am_list_get(ctx->ast->alloc, pat_lst, i);
            am_value_t in = am_list_get(ctx->ast->alloc, in_lst, i);
            if (macro_match_value(ctx, macro, clause, p, in) != 0) return -1;
        }
        return 0;
    }

    // 有 ellipsis
    size_t prefix_len = (size_t)ellipsis_pos;
    size_t suffix_len = pat_lst->length - prefix_len - 2;
    size_t input_len = in_lst->length;
    if (input_len < prefix_len + suffix_len) return -1;
    size_t k = input_len - prefix_len - suffix_len;

    // 匹配前缀
    for (size_t i = 0; i < prefix_len; i++) {
        am_value_t p = am_list_get(ctx->ast->alloc, pat_lst, i);
        am_value_t in = am_list_get(ctx->ast->alloc, in_lst, i);
        if (macro_match_value(ctx, macro, clause, p, in) != 0) return -1;
    }

    // 匹配 ellipsis 区域
    am_value_t ellip_pattern = am_list_get(ctx->ast->alloc, pat_lst, prefix_len);

    // 预先将 ellipsis 中的模式变量绑定到空列表，以处理匹配 0 次的情况
    am_value_t *ellip_pvars = NULL;
    size_t ellip_pvar_count = 0;
    if (macro_collect_pvars_in_value(macro, clause, ellip_pattern, &ellip_pvars, &ellip_pvar_count) != 0) {
        macro_set_error(ctx, L"out of memory collecting ellipsis pattern variables");
        return -1;
    }
    for (size_t j = 0; j < ellip_pvar_count; j++) {
        if (macro_ellipsis_list_get_or_create(ctx, am_value_to_varid(ellip_pvars[j])) == AM_HANDLE_NULL) {
            free(ellip_pvars);
            return -1;
        }
    }
    free(ellip_pvars);

    for (size_t i = 0; i < k; i++) {
        am_value_t in = am_list_get(ctx->ast->alloc, in_lst, prefix_len + i);
        // 为每次匹配创建独立的 subst，避免跨迭代污染
        am_macro_expand_ctx_t sub_ctx = *ctx;
        sub_ctx.subst = macro_subst_clone(ctx->ast, NULL);
        if (!sub_ctx.subst) {
            macro_set_error(ctx, L"out of memory in macro ellipsis match");
            return -1;
        }
        int ok = macro_match_value(&sub_ctx, macro, clause, ellip_pattern, in);
        if (ok == 0) {
            // 收集本次匹配产生的绑定到 ellipsis 列表
            size_t key_count = am_map_length(NULL, sub_ctx.subst);
            am_value_t *keys = am_map_keys(ctx->ast->alloc, sub_ctx.subst);
            for (size_t j = 0; j < key_count; j++) {
                am_value_t val = am_map_get(NULL, sub_ctx.subst, keys[j]);
                if (macro_ellipsis_list_append(ctx, am_value_to_varid(keys[j]), val) != 0) {
                    am_free(ctx->ast->alloc, keys);
                    am_map_destroy(ctx->ast->alloc, sub_ctx.subst);
                    return -1;
                }
            }
            am_free(ctx->ast->alloc, keys);
        }
        am_map_destroy(ctx->ast->alloc, sub_ctx.subst);
        if (ok != 0) return -1;
    }

    // 匹配后缀
    for (size_t i = 0; i < suffix_len; i++) {
        am_value_t p = am_list_get(ctx->ast->alloc, pat_lst, prefix_len + 2 + i);
        am_value_t in = am_list_get(ctx->ast->alloc, in_lst, prefix_len + k + i);
        if (macro_match_value(ctx, macro, clause, p, in) != 0) return -1;
    }

    return 0;
}


static int macro_match_value(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                              am_macro_clause_t *clause, am_value_t pattern, am_value_t input) {
    // _ 通配符
    if (macro_is_symbol_value(pattern, AM_VALUE_KW_underscore)) {
        return 0;
    }

    // 模式变量
    if (am_value_is_varid(pattern) && macro_is_pattern_var(macro, clause, am_value_to_varid(pattern))) {
        // am_map 用 AM_VALUE_NULL 作为“不存在”的哨兵，需用 contains 判断是否存在。
        if (am_map_contains(NULL, ctx->subst, pattern) == 0) {
            // 已绑定，要求相等
            am_value_t existing = am_map_get(NULL, ctx->subst, pattern);
            return am_value_equal(existing, input) ? 0 : -1;
        }
        // 新绑定
        am_map_t *m = am_map_set(ctx->ast->alloc, ctx->subst, pattern, input);
        if (!m) {
            macro_set_error(ctx, L"out of memory in macro match");
            return -1;
        }
        ctx->subst = m;
        return 0;
    }

    // 普通 varid：必须是 literal
    if (am_value_is_varid(pattern)) {
        am_varid_t pvid = am_value_to_varid(pattern);
        if (!macro_is_literal(macro, pvid)) {
            macro_set_error(ctx, L"unbound identifier in macro pattern");
            return -1;
        }
        return am_value_equal(pattern, input) ? 0 : -1;
    }

    // 其它立即数（symbol、number、boolean 等）按位比较
    if (!am_value_is_handle(pattern)) {
        return am_value_equal(pattern, input) ? 0 : -1;
    }

    // pattern 是 handle，input 也必须是同类型列表
    am_list_t *pat_lst = macro_as_list(ctx->ast, pattern);
    am_list_t *in_lst = macro_as_list(ctx->ast, input);
    if (!pat_lst || !in_lst) return -1;
    return macro_match_list(ctx, macro, clause, pat_lst, in_lst);
}


// ===============================================================================
// fresh varid 生成
// ===============================================================================

static am_varid_t macro_make_fresh_varid(am_ast_t *ast, am_varid_t base, size_t expansion_id) {
    if (!ast || !ast->var_vocab || !ast->var_type) return SIZE_MAX;

    wchar_t *base_str = am_vocab_get(ast->alloc, ast->var_vocab, &base);
    if (!base_str) return SIZE_MAX;

    size_t module_id_len = wcslen(ast->module_id);
    size_t base_len = wcslen(base_str);
    size_t buf_size = module_id_len + 3 + 20 + 1 + base_len + 1;

    wchar_t *new_name = (wchar_t *)am_malloc(ast->alloc, buf_size * sizeof(wchar_t));
    if (!new_name) return SIZE_MAX;

    int n = swprintf(new_name, buf_size, L"%ls.M%zu.%ls", ast->module_id, expansion_id, base_str);
    if (n <= 0 || (size_t)n >= buf_size) {
        am_free(ast->alloc, new_name);
        return SIZE_MAX;
    }

    size_t old_len = ast->var_vocab->length;
    size_t new_varid;
    ast->var_vocab = am_vocab_insert(ast->alloc, ast->var_vocab, new_name, &new_varid);
    am_free(ast->alloc, new_name);

    if (!ast->var_vocab || new_varid == SIZE_MAX) return SIZE_MAX;
    if (new_varid == old_len) {
        am_list_t *vt = am_list_push(ast->alloc, ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_NEW));
        if (!vt) return SIZE_MAX;
        ast->var_type = vt;
    }
    return (am_varid_t)new_varid;
}


// ===============================================================================
// 模板绑定收集（lambda 形参与 define 左值）
// ===============================================================================

static int macro_collect_template_bindings_recursive(am_macro_t *macro, am_macro_clause_t *clause,
                                                      am_value_t template, am_map_t **bindings_out);


static int macro_collect_template_bindings_list(am_macro_t *macro, am_macro_clause_t *clause,
                                                 am_list_t *lst, am_map_t **bindings_out) {
    if (!lst) return 0;

    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        am_uint_t n_param = 0;
        if (lst->length >= 2) {
            am_value_t n_val = am_list_get(macro->ast->alloc, lst, 1);
            if (am_value_is_uint(n_val)) n_param = am_value_to_uint(n_val);
        }
        for (size_t i = 0; i < (size_t)n_param; i++) {
            am_value_t p = am_list_get(macro->ast->alloc, lst, 2 + i);
            if (am_value_is_varid(p) && !macro_is_pattern_var(macro, clause, am_value_to_varid(p))) {
                am_map_t *m = am_map_set(macro->ast->alloc, *bindings_out, p, AM_VALUE_TRUE);
                if (!m) return -1;
                *bindings_out = m;
            }
        }
        size_t n_body = am_list_lambda_get_body_number(macro->ast->alloc, lst);
        am_value_t *bodies = am_list_lambda_get_bodies(macro->ast->alloc, lst, &n_body);
        if (bodies) {
            for (size_t i = 0; i < n_body; i++) {
                if (macro_collect_template_bindings_recursive(macro, clause, bodies[i], bindings_out) != 0) {
                    free(bodies);
                    return -1;
                }
            }
            free(bodies);
        }
        return 0;
    }

    // (define var ...) 形式
    if (lst->type == AM_LIST_TYPE_APPLICATION && lst->length >= 2) {
        am_value_t first = am_list_get(macro->ast->alloc, lst, 0);
        if (macro_is_symbol_value(first, AM_VALUE_KW_define)) {
            am_value_t second = am_list_get(macro->ast->alloc, lst, 1);
            if (am_value_is_varid(second) && !macro_is_pattern_var(macro, clause, am_value_to_varid(second))) {
                am_map_t *m = am_map_set(macro->ast->alloc, *bindings_out, second, AM_VALUE_TRUE);
                if (!m) return -1;
                *bindings_out = m;
            }
        }
    }

    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(macro->ast->alloc, lst, i);
        if (macro_collect_template_bindings_recursive(macro, clause, child, bindings_out) != 0) return -1;
    }
    return 0;
}


static int macro_collect_template_bindings_recursive(am_macro_t *macro, am_macro_clause_t *clause,
                                                      am_value_t template, am_map_t **bindings_out) {
    if (!bindings_out) return 0;
    if (am_value_is_handle(template)) {
        am_list_t *lst = macro_as_list(macro->ast, template);
        if (lst) {
            return macro_collect_template_bindings_list(macro, clause, lst, bindings_out);
        }
    }
    return 0;
}


// ===============================================================================
// 深拷贝（用于替换模式变量时拷贝使用处子树）
// ===============================================================================

static am_value_t macro_deep_copy_list(am_macro_expand_ctx_t *ctx, am_list_t *lst, am_handle_t parent);


static am_value_t macro_deep_copy_value(am_macro_expand_ctx_t *ctx, am_value_t value, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;
    if (am_value_is_handle(value)) {
        am_list_t *lst = macro_as_list(ctx->ast, value);
        if (lst) {
            return macro_deep_copy_list(ctx, lst, parent);
        }
        // WString
        am_value_t node_val = am_ast_get_node(ctx->ast, am_value_to_handle(value));
        if (am_value_is_ptr(node_val)) {
            am_object_t *obj = am_value_to_ptr(node_val);
            if (obj->type == AM_OBJECT_TYPE_WSTRING) {
                am_wstring_t *ws = am_wstring_copy(ctx->ast->alloc, (am_wstring_t *)obj);
                if (!ws) { macro_set_error(ctx, L"out of memory copying string"); return AM_VALUE_UNDEFINED; }
                am_handle_t h = am_heap_alloc_handle(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes);
                if (h == AM_HANDLE_NULL) { macro_set_error(ctx, L"out of memory allocating handle"); return AM_VALUE_UNDEFINED; }
                if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, h,
                                am_make_value_of_ptr((am_object_t *)ws)) != 0) {
                    macro_set_error(ctx, L"failed to set heap handle");
                    return AM_VALUE_UNDEFINED;
                }
                return am_make_value_of_handle(h);
            }
        }
    }
    return value;
}


static am_value_t macro_deep_copy_list(am_macro_expand_ctx_t *ctx, am_list_t *lst, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;

    am_handle_t new_h;
    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        new_h = am_ast_make_lambda_node(ctx->ast, parent);
    } else {
        new_h = am_ast_make_slist_node(ctx->ast, parent, lst->type);
    }
    if (new_h == AM_HANDLE_NULL) {
        macro_set_error(ctx, L"out of memory creating node");
        return AM_VALUE_UNDEFINED;
    }

    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        if (macro_register_lambda_scope(ctx, new_h, parent) != 0) {
            macro_set_error(ctx, L"failed to register copied lambda scope");
            return AM_VALUE_UNDEFINED;
        }
        am_uint_t n_param = 0;
        if (lst->length >= 2) {
            am_value_t n_val = am_list_get(ctx->ast->alloc, lst, 1);
            if (am_value_is_uint(n_val)) n_param = am_value_to_uint(n_val);
        }
        for (size_t i = 0; i < (size_t)n_param; i++) {
            am_value_t p = am_list_get(ctx->ast->alloc, lst, 2 + i);
            if (macro_lambda_add_param(ctx->ast, new_h, am_value_to_varid(p)) != 0) {
                macro_set_error(ctx, L"failed to copy lambda param");
                return AM_VALUE_UNDEFINED;
            }
            if (macro_lambda_scope_add_var(ctx, new_h, am_value_to_varid(p)) != 0) {
                macro_set_error(ctx, L"failed to add copied lambda param to scope");
                return AM_VALUE_UNDEFINED;
            }
        }
        size_t n_body = am_list_lambda_get_body_number(ctx->ast->alloc, lst);
        am_value_t *bodies = am_list_lambda_get_bodies(ctx->ast->alloc, lst, &n_body);
        if (bodies) {
            for (size_t i = 0; i < n_body; i++) {
                am_value_t copied = macro_deep_copy_value(ctx, bodies[i], new_h);
                if (ctx->error) { free(bodies); return AM_VALUE_UNDEFINED; }
                if (macro_lambda_add_body(ctx->ast, new_h, copied, NULL) != 0) {
                    macro_set_error(ctx, L"failed to copy lambda body");
                    free(bodies);
                    return AM_VALUE_UNDEFINED;
                }
            }
            free(bodies);
        }
    } else {
        for (size_t i = 0; i < lst->length; i++) {
            am_value_t child = am_list_get(ctx->ast->alloc, lst, i);
            am_value_t copied = macro_deep_copy_value(ctx, child, new_h);
            if (ctx->error) return AM_VALUE_UNDEFINED;
            if (macro_list_push(ctx->ast, new_h, copied, NULL) != 0) {
                macro_set_error(ctx, L"failed to copy list child");
                return AM_VALUE_UNDEFINED;
            }
        }
    }

    return am_make_value_of_handle(new_h);
}


// ===============================================================================
// 模板实例化
// ===============================================================================

static am_value_t macro_instantiate(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                                     am_macro_clause_t *clause, am_value_t template,
                                     am_map_t *template_bindings, am_handle_t parent);


static int macro_collect_pvars_in_value(am_macro_t *macro, am_macro_clause_t *clause,
                                         am_value_t value, am_value_t **out_pvars, size_t *out_count);


static int macro_collect_pvars_in_list(am_macro_t *macro, am_macro_clause_t *clause,
                                        am_list_t *lst, am_value_t **out_pvars, size_t *out_count) {
    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(macro->ast->alloc, lst, i);
        if (macro_collect_pvars_in_value(macro, clause, child, out_pvars, out_count) != 0) return -1;
    }
    return 0;
}


static int macro_collect_pvars_in_value(am_macro_t *macro, am_macro_clause_t *clause,
                                         am_value_t value, am_value_t **out_pvars, size_t *out_count) {
    if (am_value_is_varid(value) && macro_is_pattern_var(macro, clause, am_value_to_varid(value))) {
        // 去重
        for (size_t i = 0; i < *out_count; i++) {
            if (am_value_equal((*out_pvars)[i], value)) return 0;
        }
        am_value_t *new_arr = (am_value_t *)realloc(*out_pvars, (*out_count + 1) * sizeof(am_value_t));
        if (!new_arr) return -1;
        *out_pvars = new_arr;
        (*out_pvars)[(*out_count)++] = value;
        return 0;
    }
    if (am_value_is_handle(value)) {
        am_list_t *lst = macro_as_list(macro->ast, value);
        if (lst) {
            return macro_collect_pvars_in_list(macro, clause, lst, out_pvars, out_count);
        }
    }
    return 0;
}


// 计算 ellipsis 模板应重复的次数，同时收集其中的模式变量。
// 成功返回重复次数；失败返回 SIZE_MAX，并释放 *out_pvars（如果已分配）。
static size_t macro_ellipsis_length(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                                     am_macro_clause_t *clause, am_value_t ellip_template,
                                     am_value_t **out_pvars, size_t *out_pvar_count) {
    if (macro_collect_pvars_in_value(macro, clause, ellip_template, out_pvars, out_pvar_count) != 0) {
        return SIZE_MAX;
    }
    if (*out_pvar_count == 0) {
        free(*out_pvars);
        *out_pvars = NULL;
        return SIZE_MAX;
    }

    size_t n = 0;
    int first = 1;
    for (size_t j = 0; j < *out_pvar_count; j++) {
        am_value_t list_val = am_map_get(NULL, ctx->subst, (*out_pvars)[j]);
        if (!am_value_is_handle(list_val)) {
            free(*out_pvars);
            *out_pvars = NULL;
            return SIZE_MAX;
        }
        am_list_t *ellip_list = macro_list_from_handle(ctx->ast, am_value_to_handle(list_val));
        if (!ellip_list) {
            free(*out_pvars);
            *out_pvars = NULL;
            return SIZE_MAX;
        }
        if (first) {
            n = ellip_list->length;
            first = 0;
        } else if (ellip_list->length != n) {
            free(*out_pvars);
            *out_pvars = NULL;
            return SIZE_MAX;
        }
    }
    return n;
}


// 为第 j 次 ellipsis 迭代创建临时 subst：拷贝当前 subst 并覆盖 ellipsis 模式变量。
// 成功返回 0；失败返回 -1。
static int macro_ellipsis_iter_setup(am_macro_expand_ctx_t *ctx, am_macro_expand_ctx_t *iter_ctx,
                                      am_value_t *pvars, size_t pvar_count, size_t j) {
    iter_ctx->subst = am_map_copy(ctx->ast->alloc, ctx->subst);
    if (!iter_ctx->subst) return -1;
    for (size_t k = 0; k < pvar_count; k++) {
        am_value_t list_val = am_map_get(NULL, ctx->subst, pvars[k]);
        am_list_t *ellip_list = macro_list_from_handle(ctx->ast, am_value_to_handle(list_val));
        am_value_t elem = am_list_get(ctx->ast->alloc, ellip_list, j);
        am_map_t *m = am_map_set(ctx->ast->alloc, iter_ctx->subst, pvars[k], elem);
        if (!m) {
            am_map_destroy(ctx->ast->alloc, iter_ctx->subst);
            iter_ctx->subst = NULL;
            return -1;
        }
        iter_ctx->subst = m;
    }
    return 0;
}


// 实例化 lambda 模板，支持参数和函数体中的 ellipsis 展开。
static am_value_t macro_instantiate_lambda(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                                            am_macro_clause_t *clause, am_list_t *lst,
                                            am_map_t *template_bindings, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;

    am_handle_t new_h = am_ast_make_lambda_node(ctx->ast, parent);
    if (new_h == AM_HANDLE_NULL) {
        macro_set_error(ctx, L"out of memory instantiating lambda");
        return AM_VALUE_UNDEFINED;
    }

    if (macro_register_lambda_scope(ctx, new_h, parent) != 0) {
        macro_set_error(ctx, L"failed to register lambda scope");
        return AM_VALUE_UNDEFINED;
    }

    // 参数处理
    am_uint_t n_param = 0;
    if (lst->length >= 2) {
        am_value_t n_val = am_list_get(ctx->ast->alloc, lst, 1);
        if (am_value_is_uint(n_val)) n_param = am_value_to_uint(n_val);
    }

    size_t param_fixed_end = (size_t)n_param;
    int param_has_ellipsis = 0;
    if (n_param >= 2) {
        am_value_t last_param = am_list_get(ctx->ast->alloc, lst, 2 + n_param - 1);
        if (macro_is_ellipsis_marker(ctx->ast, last_param, 0)) {
            param_has_ellipsis = 1;
            param_fixed_end = n_param - 2;
        }
    }

    for (size_t i = 0; i < param_fixed_end; i++) {
        am_value_t p = am_list_get(ctx->ast->alloc, lst, 2 + i);
        am_value_t inst_p = macro_instantiate(ctx, macro, clause, p, template_bindings, new_h);
        if (ctx->error) return AM_VALUE_UNDEFINED;
        if (!am_value_is_varid(inst_p)) {
            macro_set_error(ctx, L"lambda parameter must be variable");
            return AM_VALUE_UNDEFINED;
        }
        if (macro_lambda_add_param(ctx->ast, new_h, am_value_to_varid(inst_p)) != 0) {
            macro_set_error(ctx, L"failed to add instantiated lambda param");
            return AM_VALUE_UNDEFINED;
        }
        if (macro_lambda_scope_add_var(ctx, new_h, am_value_to_varid(inst_p)) != 0) {
            macro_set_error(ctx, L"failed to add lambda param to scope");
            return AM_VALUE_UNDEFINED;
        }
    }

    if (param_has_ellipsis) {
        am_value_t ellip_template = am_list_get(ctx->ast->alloc, lst, 2 + param_fixed_end);
        am_value_t *pvars = NULL;
        size_t pvar_count = 0;
        size_t n = macro_ellipsis_length(ctx, macro, clause, ellip_template, &pvars, &pvar_count);
        if (n == SIZE_MAX) {
            macro_set_error(ctx, L"invalid ellipsis in lambda parameter list");
            return AM_VALUE_UNDEFINED;
        }

        for (size_t j = 0; j < n; j++) {
            am_macro_expand_ctx_t iter_ctx = *ctx;
            if (macro_ellipsis_iter_setup(ctx, &iter_ctx, pvars, pvar_count, j) != 0) {
                free(pvars);
                macro_set_error(ctx, L"out of memory in lambda parameter ellipsis");
                return AM_VALUE_UNDEFINED;
            }
            am_value_t inst_p = macro_instantiate(&iter_ctx, macro, clause, ellip_template,
                                                 template_bindings, new_h);
            am_map_destroy(ctx->ast->alloc, iter_ctx.subst);
            if (iter_ctx.error) {
                ctx->error = 1;
                wcsncpy(ctx->error_msg, iter_ctx.error_msg, 256);
                free(pvars);
                return AM_VALUE_UNDEFINED;
            }
            if (!am_value_is_varid(inst_p)) {
                macro_set_error(ctx, L"lambda ellipsis parameter must be variable");
                free(pvars);
                return AM_VALUE_UNDEFINED;
            }
            if (macro_lambda_add_param(ctx->ast, new_h, am_value_to_varid(inst_p)) != 0) {
                macro_set_error(ctx, L"failed to add lambda ellipsis param");
                free(pvars);
                return AM_VALUE_UNDEFINED;
            }
            if (macro_lambda_scope_add_var(ctx, new_h, am_value_to_varid(inst_p)) != 0) {
                macro_set_error(ctx, L"failed to add lambda ellipsis param to scope");
                free(pvars);
                return AM_VALUE_UNDEFINED;
            }
        }
        free(pvars);
    }

    // 函数体处理
    size_t n_body = 0;
    am_value_t *bodies = am_list_lambda_get_bodies(ctx->ast->alloc, lst, &n_body);

    size_t body_fixed_end = n_body;
    int body_has_ellipsis = 0;
    if (n_body >= 2) {
        am_value_t last_body = bodies[n_body - 1];
        if (macro_is_ellipsis_marker(ctx->ast, last_body, 0)) {
            body_has_ellipsis = 1;
            body_fixed_end = n_body - 2;
        }
    }

    for (size_t i = 0; i < body_fixed_end; i++) {
        am_value_t inst = macro_instantiate(ctx, macro, clause, bodies[i], template_bindings, new_h);
        if (ctx->error) {
            free(bodies);
            return AM_VALUE_UNDEFINED;
        }
        if (macro_lambda_add_body(ctx->ast, new_h, inst, NULL) != 0) {
            macro_set_error(ctx, L"failed to add instantiated lambda body");
            free(bodies);
            return AM_VALUE_UNDEFINED;
        }
    }

    if (body_has_ellipsis) {
        am_value_t ellip_template = bodies[body_fixed_end];
        am_value_t *pvars = NULL;
        size_t pvar_count = 0;
        size_t n = macro_ellipsis_length(ctx, macro, clause, ellip_template, &pvars, &pvar_count);
        if (n == SIZE_MAX) {
            free(bodies);
            macro_set_error(ctx, L"invalid ellipsis in lambda body");
            return AM_VALUE_UNDEFINED;
        }

        for (size_t j = 0; j < n; j++) {
            am_macro_expand_ctx_t iter_ctx = *ctx;
            if (macro_ellipsis_iter_setup(ctx, &iter_ctx, pvars, pvar_count, j) != 0) {
                free(pvars);
                free(bodies);
                macro_set_error(ctx, L"out of memory in lambda body ellipsis");
                return AM_VALUE_UNDEFINED;
            }
            am_value_t inst = macro_instantiate(&iter_ctx, macro, clause, ellip_template,
                                                 template_bindings, new_h);
            am_map_destroy(ctx->ast->alloc, iter_ctx.subst);
            if (iter_ctx.error) {
                ctx->error = 1;
                wcsncpy(ctx->error_msg, iter_ctx.error_msg, 256);
                free(pvars);
                free(bodies);
                return AM_VALUE_UNDEFINED;
            }
            if (macro_lambda_add_body(ctx->ast, new_h, inst, NULL) != 0) {
                macro_set_error(ctx, L"failed to add lambda ellipsis body");
                free(pvars);
                free(bodies);
                return AM_VALUE_UNDEFINED;
            }
        }
        free(pvars);
    }

    free(bodies);
    return am_make_value_of_handle(new_h);
}


static am_value_t macro_instantiate_list(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                                          am_macro_clause_t *clause, am_list_t *lst,
                                          am_map_t *template_bindings, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;

    am_handle_t new_h;
    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        return macro_instantiate_lambda(ctx, macro, clause, lst, template_bindings, parent);
    } else {
        new_h = am_ast_make_slist_node(ctx->ast, parent, lst->type);
    }
    if (new_h == AM_HANDLE_NULL) {
        macro_set_error(ctx, L"out of memory instantiating list");
        return AM_VALUE_UNDEFINED;
    }

    // 普通列表：扫描子元素，处理 ellipsis
    int in_quote = (lst->type == AM_LIST_TYPE_QUOTE);
    for (size_t i = 0; i < lst->length; ) {
        am_value_t child = am_list_get(ctx->ast->alloc, lst, i);

        // ellipsis 模板：T ...
        if (i + 1 < lst->length &&
            macro_is_ellipsis_marker(ctx->ast, am_list_get(ctx->ast->alloc, lst, i + 1), in_quote)) {
            am_value_t ellip_template = child;

            am_value_t *pvars = NULL;
            size_t pvar_count = 0;
            if (macro_collect_pvars_in_value(macro, clause, ellip_template, &pvars, &pvar_count) != 0) {
                macro_set_error(ctx, L"out of memory collecting ellipsis pattern variables");
                return AM_VALUE_UNDEFINED;
            }
            if (pvar_count == 0) {
                macro_set_error(ctx, L"ellipsis template contains no pattern variables");
                free(pvars);
                return AM_VALUE_UNDEFINED;
            }

            // 所有模式变量的 ellipsis 列表长度必须相同
            size_t n = 0;
            int first = 1;
            for (size_t j = 0; j < pvar_count; j++) {
                am_value_t list_val = am_map_get(NULL, ctx->subst, pvars[j]);
                if (!am_value_is_handle(list_val)) {
                    macro_set_error(ctx, L"ellipsis pattern variable not bound to list");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
                am_list_t *ellip_list = macro_list_from_handle(ctx->ast, am_value_to_handle(list_val));
                if (!ellip_list) {
                    macro_set_error(ctx, L"ellipsis binding is not a list");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
                if (first) {
                    n = ellip_list->length;
                    first = 0;
                } else if (ellip_list->length != n) {
                    macro_set_error(ctx, L"ellipsis pattern variables have inconsistent lengths");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
            }

            for (size_t j = 0; j < n; j++) {
                // 构造临时 subst：拷贝当前 subst 并覆盖 ellipsis 模式变量
                am_macro_expand_ctx_t iter_ctx = *ctx;
                iter_ctx.subst = am_map_copy(ctx->ast->alloc, ctx->subst);
                if (!iter_ctx.subst) {
                    macro_set_error(ctx, L"out of memory in ellipsis instantiation");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
                int subst_ok = 1;
                for (size_t k = 0; k < pvar_count; k++) {
                    am_value_t list_val = am_map_get(NULL, ctx->subst, pvars[k]);
                    am_list_t *ellip_list = macro_list_from_handle(ctx->ast, am_value_to_handle(list_val));
                    am_value_t elem = am_list_get(ctx->ast->alloc, ellip_list, j);
                    am_map_t *m = am_map_set(ctx->ast->alloc, iter_ctx.subst, pvars[k], elem);
                    if (!m) { subst_ok = 0; break; }
                    iter_ctx.subst = m;
                }
                if (!subst_ok) {
                    am_map_destroy(ctx->ast->alloc, iter_ctx.subst);
                    macro_set_error(ctx, L"out of memory in ellipsis instantiation");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
                am_value_t inst = macro_instantiate(&iter_ctx, macro, clause, ellip_template,
                                                     template_bindings, new_h);
                am_map_destroy(ctx->ast->alloc, iter_ctx.subst);
                if (iter_ctx.error) {
                    ctx->error = 1;
                    wcsncpy(ctx->error_msg, iter_ctx.error_msg, 256);
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
                if (macro_list_push(ctx->ast, new_h, inst, NULL) != 0) {
                    macro_set_error(ctx, L"failed to push ellipsis instantiation");
                    free(pvars);
                    return AM_VALUE_UNDEFINED;
                }
            }

            free(pvars);
            i += 2;
        } else {
            am_value_t inst = macro_instantiate(ctx, macro, clause, child, template_bindings, new_h);
            if (ctx->error) return AM_VALUE_UNDEFINED;
            if (macro_list_push(ctx->ast, new_h, inst, NULL) != 0) {
                macro_set_error(ctx, L"failed to push instantiated child");
                return AM_VALUE_UNDEFINED;
            }
            i += 1;
        }
    }

    return am_make_value_of_handle(new_h);
}


static am_value_t macro_instantiate(am_macro_expand_ctx_t *ctx, am_macro_t *macro,
                                     am_macro_clause_t *clause, am_value_t template,
                                     am_map_t *template_bindings, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;

    // 模式变量：替换为使用处子树
    if (am_value_is_varid(template)) {
        am_varid_t vid = am_value_to_varid(template);
        if (macro_is_pattern_var(macro, clause, vid)) {
            // 注意：am_map 用 AM_VALUE_NULL 作为“不存在”的哨兵，
            // 因此不能通过返回值是否为 null 判断绑定是否存在。
            if (am_map_contains(NULL, ctx->subst, template) != 0) {
                macro_set_error(ctx, L"unbound pattern variable in template");
                return AM_VALUE_UNDEFINED;
            }
            am_value_t subst_val = am_map_get(NULL, ctx->subst, template);
            return macro_deep_copy_value(ctx, subst_val, parent);
        }

        // 模板内绑定：freshen
        if (am_map_contains(NULL, template_bindings, template) == 0) {
            am_value_t fresh_val = am_map_get(NULL, ctx->fresh_map, template);
            if (am_value_is_varid(fresh_val)) return fresh_val;
            am_varid_t fresh = macro_make_fresh_varid(ctx->ast, vid, ctx->expansion_id);
            if (fresh == SIZE_MAX) {
                macro_set_error(ctx, L"failed to make fresh variable");
                return AM_VALUE_UNDEFINED;
            }
            fresh_val = am_make_value_of_varid(fresh);
            am_map_t *m = am_map_set(ctx->ast->alloc, ctx->fresh_map, template, fresh_val);
            if (!m) {
                macro_set_error(ctx, L"out of memory in fresh map");
                return AM_VALUE_UNDEFINED;
            }
            ctx->fresh_map = m;
            return fresh_val;
        }

        // 自由标识符：保持 ARN 结果
        return template;
    }

    // 非 handle 立即数直接返回
    if (!am_value_is_handle(template)) {
        return template;
    }

    // handle：列表或字符串
    am_list_t *lst = macro_as_list(ctx->ast, template);
    if (!lst) {
        return macro_deep_copy_value(ctx, template, parent);
    }

    return macro_instantiate_list(ctx, macro, clause, lst, template_bindings, parent);
}


// ===============================================================================
// AST 展开
// ===============================================================================

static int macro_is_define_syntax(am_ast_t *ast, am_list_t *lst) {
    if (!lst || lst->type != AM_LIST_TYPE_APPLICATION || lst->length != 3) return 0;
    am_value_t first = am_list_get(ast->alloc, lst, 0);
    if (!macro_is_symbol_value(first, AM_VALUE_KW_define_syntax)) return 0;
    am_value_t second = am_list_get(ast->alloc, lst, 1);
    return am_value_is_varid(second);
}


static int macro_track_allocated_macro(am_macro_expand_ctx_t *ctx, am_macro_t *macro) {
    if (ctx->allocated_macro_count >= ctx->allocated_macro_capacity) {
        size_t new_cap = ctx->allocated_macro_capacity ? ctx->allocated_macro_capacity * 2 : 16;
        am_macro_t **new_arr = (am_macro_t **)realloc(ctx->allocated_macros, new_cap * sizeof(am_macro_t *));
        if (!new_arr) return -1;
        ctx->allocated_macros = new_arr;
        ctx->allocated_macro_capacity = new_cap;
    }
    ctx->allocated_macros[ctx->allocated_macro_count++] = macro;
    return 0;
}


static am_value_t macro_expand_value(am_macro_expand_ctx_t *ctx, am_value_t value,
                                      am_macro_env_frame_t *env, am_handle_t parent);


static int macro_expand_body_sequence(am_macro_expand_ctx_t *ctx, am_value_t *bodies, size_t n_body,
                                       am_macro_env_frame_t *env, am_handle_t parent,
                                       am_value_t **out_bodies, size_t *out_n_body) {
    // 第一趟：收集 define-syntax
    am_macro_env_frame_t *new_frame = macro_env_frame_create(ctx->ast);
    if (!new_frame) {
        macro_set_error(ctx, L"out of memory creating macro env frame");
        return -1;
    }
    new_frame->parent = env;

    for (size_t i = 0; i < n_body; i++) {
        am_value_t body = bodies[i];
        if (!am_value_is_handle(body)) continue;
        am_list_t *body_lst = macro_as_list(ctx->ast, body);
        if (!body_lst) continue;
        if (macro_is_define_syntax(ctx->ast, body_lst)) {
            am_value_t name_val = am_list_get(ctx->ast->alloc, body_lst, 1);
            am_value_t transformer_val = am_list_get(ctx->ast->alloc, body_lst, 2);
            if (!am_value_is_handle(transformer_val)) {
                macro_set_error(ctx, L"invalid define-syntax transformer");
                macro_env_frame_destroy(new_frame);
                return -1;
            }
            am_macro_t *macro = macro_parse_syntax_rules(ctx->ast, am_value_to_varid(name_val),
                                                          am_value_to_handle(transformer_val));
            if (!macro) {
                macro_set_error(ctx, L"failed to parse syntax-rules");
                macro_env_frame_destroy(new_frame);
                return -1;
            }
            if (macro_track_allocated_macro(ctx, macro) != 0) {
                macro_free_macro(macro);
                macro_env_frame_destroy(new_frame);
                macro_set_error(ctx, L"out of memory tracking macro");
                return -1;
            }
            if (macro_env_define(ctx->ast, new_frame, am_value_to_varid(name_val), macro) != 0) {
                macro_env_frame_destroy(new_frame);
                macro_set_error(ctx, L"out of memory defining macro");
                return -1;
            }
        }
    }

    // 第二趟：展开非 define-syntax 的 body
    am_value_t *new_bodies = (am_value_t *)malloc(n_body * sizeof(am_value_t));
    if (!new_bodies) {
        macro_env_frame_destroy(new_frame);
        macro_set_error(ctx, L"out of memory expanding body sequence");
        return -1;
    }
    size_t count = 0;
    for (size_t i = 0; i < n_body; i++) {
        am_value_t body = bodies[i];
        if (am_value_is_handle(body)) {
            am_list_t *body_lst = macro_as_list(ctx->ast, body);
            if (body_lst && macro_is_define_syntax(ctx->ast, body_lst)) {
                ctx->changed = 1;
                continue;
            }
        }
        am_value_t expanded = macro_expand_value(ctx, body, new_frame, parent);
        if (ctx->error) {
            free(new_bodies);
            macro_env_frame_destroy(new_frame);
            return -1;
        }
        new_bodies[count++] = expanded;
    }

    macro_env_frame_destroy(new_frame);
    *out_bodies = new_bodies;
    *out_n_body = count;
    return 0;
}


static am_value_t macro_expand_lambda(am_macro_expand_ctx_t *ctx, am_handle_t old_h, am_list_t *old_lst,
                                       am_macro_env_frame_t *env, am_handle_t parent) {
    size_t n_body = 0;
    am_value_t *bodies = am_list_lambda_get_bodies(ctx->ast->alloc, old_lst, &n_body);
    am_value_t *new_bodies = NULL;
    size_t new_n_body = 0;
    if (bodies) {
        if (macro_expand_body_sequence(ctx, bodies, n_body, env, old_h, &new_bodies, &new_n_body) != 0) {
            free(bodies);
            return AM_VALUE_UNDEFINED;
        }
    }

    // 如果 body 没有变化（数量与内容均相同），直接返回原 lambda，避免制造冗余节点
    int bodies_changed = 0;
    if (new_n_body != n_body) {
        bodies_changed = 1;
    } else if (bodies) {
        for (size_t i = 0; i < n_body; i++) {
            if (!am_value_equal(bodies[i], new_bodies[i])) {
                bodies_changed = 1;
                break;
            }
        }
    }

    if (!bodies_changed) {
        free(bodies);
        free(new_bodies);
        return am_make_value_of_handle(old_h);
    }

    am_handle_t new_h = am_ast_make_lambda_node(ctx->ast, parent);
    if (new_h == AM_HANDLE_NULL) {
        free(bodies);
        free(new_bodies);
        macro_set_error(ctx, L"out of memory expanding lambda");
        return AM_VALUE_UNDEFINED;
    }

    if (macro_register_lambda_scope(ctx, new_h, parent) != 0) {
        free(bodies);
        free(new_bodies);
        macro_set_error(ctx, L"failed to register expanded lambda scope");
        return AM_VALUE_UNDEFINED;
    }

    am_uint_t n_param = 0;
    if (old_lst->length >= 2) {
        am_value_t n_val = am_list_get(ctx->ast->alloc, old_lst, 1);
        if (am_value_is_uint(n_val)) n_param = am_value_to_uint(n_val);
    }
    for (size_t i = 0; i < (size_t)n_param; i++) {
        am_value_t p = am_list_get(ctx->ast->alloc, old_lst, 2 + i);
        if (macro_lambda_add_param(ctx->ast, new_h, am_value_to_varid(p)) != 0) {
            free(bodies);
            free(new_bodies);
            macro_set_error(ctx, L"failed to copy lambda param");
            return AM_VALUE_UNDEFINED;
        }
        if (macro_lambda_scope_add_var(ctx, new_h, am_value_to_varid(p)) != 0) {
            free(bodies);
            free(new_bodies);
            macro_set_error(ctx, L"failed to add expanded lambda param to scope");
            return AM_VALUE_UNDEFINED;
        }
    }

    if (new_bodies) {
        for (size_t i = 0; i < new_n_body; i++) {
            if (macro_lambda_add_body(ctx->ast, new_h, new_bodies[i], NULL) != 0) {
                free(bodies);
                free(new_bodies);
                macro_set_error(ctx, L"failed to add expanded lambda body");
                return AM_VALUE_UNDEFINED;
            }
        }
    }

    free(bodies);
    free(new_bodies);
    return am_make_value_of_handle(new_h);
}


static am_value_t macro_expand_slist(am_macro_expand_ctx_t *ctx, am_handle_t old_h, am_list_t *old_lst,
                                      am_macro_env_frame_t *env, am_handle_t parent) {
    am_value_t *expanded_children = (am_value_t *)malloc(old_lst->length * sizeof(am_value_t));
    if (!expanded_children) {
        macro_set_error(ctx, L"out of memory expanding slist");
        return AM_VALUE_UNDEFINED;
    }

    int any_changed = 0;
    for (size_t i = 0; i < old_lst->length; i++) {
        am_value_t child = am_list_get(ctx->ast->alloc, old_lst, i);
        am_value_t expanded = macro_expand_value(ctx, child, env, old_h);
        if (ctx->error) {
            free(expanded_children);
            return AM_VALUE_UNDEFINED;
        }
        expanded_children[i] = expanded;
        if (!any_changed && !am_value_equal(child, expanded)) {
            any_changed = 1;
        }
    }

    if (!any_changed) {
        free(expanded_children);
        return am_make_value_of_handle(old_h);
    }

    am_handle_t new_h = am_ast_make_slist_node(ctx->ast, parent, old_lst->type);
    if (new_h == AM_HANDLE_NULL) {
        free(expanded_children);
        macro_set_error(ctx, L"out of memory expanding slist");
        return AM_VALUE_UNDEFINED;
    }

    for (size_t i = 0; i < old_lst->length; i++) {
        if (macro_list_push(ctx->ast, new_h, expanded_children[i], NULL) != 0) {
            free(expanded_children);
            macro_set_error(ctx, L"failed to push expanded child");
            return AM_VALUE_UNDEFINED;
        }
    }
    free(expanded_children);

    return am_make_value_of_handle(new_h);
}


static am_value_t macro_expand_macro_use(am_macro_expand_ctx_t *ctx, am_handle_t use_h,
                                          am_macro_t *macro, am_macro_env_frame_t *env,
                                          am_handle_t parent) {
    ctx->parent = parent;
    am_value_t input = am_make_value_of_handle(use_h);

    for (size_t ci = 0; ci < macro->clause_count; ci++) {
        am_macro_clause_t *clause = &macro->clauses[ci];

        am_map_t *subst = am_map_create(ctx->ast->alloc, 16);
        if (!subst) {
            macro_set_error(ctx, L"out of memory creating macro subst");
            return AM_VALUE_UNDEFINED;
        }
        ctx->subst = subst;

        if (macro_match_value(ctx, macro, clause, clause->pattern, input) == 0) {
            ctx->changed = 1;
            // 收集模板内绑定
            am_map_t *template_bindings = am_map_create(ctx->ast->alloc, 16);
            if (!template_bindings) {
                am_map_destroy(ctx->ast->alloc, subst);
                ctx->subst = NULL;
                macro_set_error(ctx, L"out of memory creating template bindings");
                return AM_VALUE_UNDEFINED;
            }
            if (macro_collect_template_bindings_recursive(macro, clause, clause->template, &template_bindings) != 0) {
                am_map_destroy(ctx->ast->alloc, subst);
                am_map_destroy(ctx->ast->alloc, template_bindings);
                ctx->subst = NULL;
                macro_set_error(ctx, L"failed to collect template bindings");
                return AM_VALUE_UNDEFINED;
            }

            // 创建 fresh map
            am_map_t *fresh_map = am_map_create(ctx->ast->alloc, 16);
            if (!fresh_map) {
                am_map_destroy(ctx->ast->alloc, subst);
                am_map_destroy(ctx->ast->alloc, template_bindings);
                ctx->subst = NULL;
                macro_set_error(ctx, L"out of memory creating fresh map");
                return AM_VALUE_UNDEFINED;
            }
            ctx->fresh_map = fresh_map;
            macro->expansion_counter++;
            ctx->expansion_id = macro->expansion_counter;

            am_value_t inst = macro_instantiate(ctx, macro, clause, clause->template,
                                                 template_bindings, parent);

            am_map_destroy(ctx->ast->alloc, subst);
            am_map_destroy(ctx->ast->alloc, fresh_map);
            am_map_destroy(ctx->ast->alloc, template_bindings);
            ctx->subst = NULL;
            ctx->fresh_map = NULL;

            if (ctx->error) return AM_VALUE_UNDEFINED;

            // 递归展开实例化结果中的嵌套宏
            am_value_t expanded = macro_expand_value(ctx, inst, env, parent);
            return expanded;
        }

        am_map_destroy(ctx->ast->alloc, subst);
        ctx->subst = NULL;
    }

    macro_set_error(ctx, L"macro use did not match any clause");
    return AM_VALUE_UNDEFINED;
}


static am_value_t macro_expand_let_syntax(am_macro_expand_ctx_t *ctx, am_handle_t h, am_list_t *lst,
                                           am_macro_env_frame_t *env, am_handle_t parent, int isrec) {
    (void)isrec;
    (void)h;
    ctx->changed = 1;
    if (lst->length < 2) {
        macro_set_error(ctx, L"invalid let-syntax form");
        return AM_VALUE_UNDEFINED;
    }

    am_value_t bindings_val = am_list_get(ctx->ast->alloc, lst, 1);
    if (!am_value_is_handle(bindings_val)) {
        macro_set_error(ctx, L"invalid let-syntax bindings");
        return AM_VALUE_UNDEFINED;
    }
    am_list_t *bindings_lst = macro_list_from_handle(ctx->ast, am_value_to_handle(bindings_val));
    if (!bindings_lst || bindings_lst->type != AM_LIST_TYPE_APPLICATION) {
        macro_set_error(ctx, L"invalid let-syntax bindings list");
        return AM_VALUE_UNDEFINED;
    }

    am_macro_env_frame_t *new_frame = macro_env_frame_create(ctx->ast);
    if (!new_frame) {
        macro_set_error(ctx, L"out of memory creating let-syntax env");
        return AM_VALUE_UNDEFINED;
    }
    new_frame->parent = env;

    for (size_t i = 0; i < bindings_lst->length; i++) {
        am_value_t binding_val = am_list_get(ctx->ast->alloc, bindings_lst, i);
        if (!am_value_is_handle(binding_val)) {
            macro_set_error(ctx, L"invalid let-syntax binding");
            macro_env_frame_destroy(new_frame);
            return AM_VALUE_UNDEFINED;
        }
        am_list_t *binding_lst = macro_list_from_handle(ctx->ast, am_value_to_handle(binding_val));
        if (!binding_lst || binding_lst->type != AM_LIST_TYPE_APPLICATION || binding_lst->length != 2) {
            macro_set_error(ctx, L"invalid let-syntax binding form");
            macro_env_frame_destroy(new_frame);
            return AM_VALUE_UNDEFINED;
        }
        am_value_t name_val = am_list_get(ctx->ast->alloc, binding_lst, 0);
        am_value_t transformer_val = am_list_get(ctx->ast->alloc, binding_lst, 1);
        if (!am_value_is_varid(name_val) || !am_value_is_handle(transformer_val)) {
            macro_set_error(ctx, L"invalid let-syntax binding content");
            macro_env_frame_destroy(new_frame);
            return AM_VALUE_UNDEFINED;
        }
        am_macro_t *macro = macro_parse_syntax_rules(ctx->ast, am_value_to_varid(name_val),
                                                      am_value_to_handle(transformer_val));
        if (!macro) {
            macro_set_error(ctx, L"failed to parse let-syntax syntax-rules");
            macro_env_frame_destroy(new_frame);
            return AM_VALUE_UNDEFINED;
        }
        if (macro_track_allocated_macro(ctx, macro) != 0) {
            macro_free_macro(macro);
            macro_env_frame_destroy(new_frame);
            macro_set_error(ctx, L"out of memory tracking let-syntax macro");
            return AM_VALUE_UNDEFINED;
        }
        if (macro_env_define(ctx->ast, new_frame, am_value_to_varid(name_val), macro) != 0) {
            macro_env_frame_destroy(new_frame);
            macro_set_error(ctx, L"out of memory defining let-syntax macro");
            return AM_VALUE_UNDEFINED;
        }
    }

    size_t n_body = lst->length - 2;
    am_value_t *expanded_bodies = (am_value_t *)malloc(n_body * sizeof(am_value_t));
    if (!expanded_bodies) {
        macro_env_frame_destroy(new_frame);
        macro_set_error(ctx, L"out of memory expanding let-syntax bodies");
        return AM_VALUE_UNDEFINED;
    }
    size_t count = 0;
    for (size_t i = 2; i < lst->length; i++) {
        am_value_t body = am_list_get(ctx->ast->alloc, lst, i);
        am_value_t expanded = macro_expand_value(ctx, body, new_frame, parent);
        if (ctx->error) {
            free(expanded_bodies);
            macro_env_frame_destroy(new_frame);
            return AM_VALUE_UNDEFINED;
        }
        expanded_bodies[count++] = expanded;
    }
    macro_env_frame_destroy(new_frame);

    if (count == 1) {
        am_value_t result = expanded_bodies[0];
        free(expanded_bodies);
        return result;
    }

    // 多 body 时包装为 begin
    am_handle_t begin_h = am_ast_make_slist_node(ctx->ast, parent, AM_LIST_TYPE_APPLICATION);
    if (begin_h == AM_HANDLE_NULL) {
        free(expanded_bodies);
        macro_set_error(ctx, L"out of memory creating begin wrapper");
        return AM_VALUE_UNDEFINED;
    }
    if (macro_list_push(ctx->ast, begin_h, AM_VALUE_KW_begin, NULL) != 0) {
        free(expanded_bodies);
        macro_set_error(ctx, L"failed to push begin keyword");
        return AM_VALUE_UNDEFINED;
    }
    for (size_t i = 0; i < count; i++) {
        if (macro_list_push(ctx->ast, begin_h, expanded_bodies[i], NULL) != 0) {
            free(expanded_bodies);
            macro_set_error(ctx, L"failed to push begin body");
            return AM_VALUE_UNDEFINED;
        }
    }
    free(expanded_bodies);
    return am_make_value_of_handle(begin_h);
}


static am_value_t macro_expand_value(am_macro_expand_ctx_t *ctx, am_value_t value,
                                      am_macro_env_frame_t *env, am_handle_t parent) {
    if (ctx->error) return AM_VALUE_UNDEFINED;
    if (!am_value_is_handle(value)) return value;

    am_handle_t h = am_value_to_handle(value);
    am_list_t *lst = macro_as_list(ctx->ast, value);
    if (!lst) {
        // WString 或其他对象，无需展开
        return value;
    }

    // 宏使用
    if (lst->length > 0) {
        am_value_t first = am_list_get(ctx->ast->alloc, lst, 0);
        if (am_value_is_varid(first)) {
            am_macro_t *macro = macro_env_lookup(env, am_value_to_varid(first));
            if (macro) {
                return macro_expand_macro_use(ctx, h, macro, env, parent);
            }
        }
    }

    // let-syntax / letrec-syntax
    if (lst->length >= 2) {
        am_value_t first = am_list_get(ctx->ast->alloc, lst, 0);
        if (macro_is_symbol_value(first, AM_VALUE_KW_let_syntax)) {
            return macro_expand_let_syntax(ctx, h, lst, env, parent, 0);
        }
        if (macro_is_symbol_value(first, AM_VALUE_KW_letrec_syntax)) {
            return macro_expand_let_syntax(ctx, h, lst, env, parent, 1);
        }
    }

    // quote / quasiquote / unquote 内部不展开宏，避免用户 symbol 与关键字冲突
    if (lst->type == AM_LIST_TYPE_QUOTE ||
        lst->type == AM_LIST_TYPE_QUASIQUOTE ||
        lst->type == AM_LIST_TYPE_UNQUOTE) {
        return value;
    }

    // 普通列表：深拷贝并递归展开子元素
    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        return macro_expand_lambda(ctx, h, lst, env, parent);
    }
    return macro_expand_slist(ctx, h, lst, env, parent);
}


// ===============================================================================
// 展开后元数据刷新
// ===============================================================================

typedef struct {
    am_ast_t *ast;
} macro_lambda_collect_t;


static void macro_collect_lambda_cb(am_handle_t handle, am_value_t value, void *user_data) {
    macro_lambda_collect_t *data = (macro_lambda_collect_t *)user_data;
    if (!am_value_is_ptr(value)) return;
    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;
    am_list_t *lst = (am_list_t *)obj;
    if (lst->type != AM_LIST_TYPE_LAMBDA) return;

    am_list_t *new_lst = am_list_push(data->ast->alloc, data->ast->lambda_handles,
                                      am_make_value_of_handle(handle));
    if (new_lst) {
        data->ast->lambda_handles = new_lst;
    }
}


static void macro_rebuild_lambda_handles(am_ast_t *ast) {
    if (!ast || !ast->lambda_handles) return;
    ast->lambda_handles->length = 0;
    macro_lambda_collect_t data = { ast };
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, macro_collect_lambda_cb, &data);
}


static void macro_rebuild_var_top(am_ast_t *ast) {
    if (!ast || !ast->var_top) return;
    ast->var_top->length = 0;

    am_handle_t top_lambda = am_ast_get_top_lambda_node_handle(ast);
    if (top_lambda == AM_HANDLE_NULL) return;

    am_value_t lambda_val = am_ast_get_node(ast, top_lambda);
    if (!am_value_is_ptr(lambda_val)) return;
    am_list_t *lambda = (am_list_t *)am_value_to_ptr(lambda_val);
    size_t n_body = am_list_lambda_get_body_number(ast->alloc, lambda);
    am_value_t *bodies = am_list_lambda_get_bodies(ast->alloc, lambda, &n_body);
    if (!bodies) return;

    for (size_t i = 0; i < n_body; i++) {
        am_value_t body = bodies[i];
        if (!am_value_is_handle(body)) continue;
        am_value_t node_val = am_ast_get_node(ast, am_value_to_handle(body));
        if (!am_value_is_ptr(node_val)) continue;
        am_object_t *obj = am_value_to_ptr(node_val);
        if (obj->type != AM_OBJECT_TYPE_LIST) continue;
        am_list_t *lst = (am_list_t *)obj;
        if (lst->type != AM_LIST_TYPE_APPLICATION || lst->length < 2) continue;
        am_value_t first = am_list_get(ast->alloc, lst, 0);
        if (!macro_is_symbol_value(first, AM_VALUE_KW_define)) continue;
        am_value_t second = am_list_get(ast->alloc, lst, 1);
        if (!am_value_is_varid(second)) continue;
        am_ast_add_var_top(ast, am_value_to_varid(second));
    }

    free(bodies);
}


// ===============================================================================
// 入口函数
// ===============================================================================

static int macro_is_any_macro_keyword(am_value_t v) {
    return macro_is_symbol_value(v, AM_VALUE_KW_define_syntax) ||
           macro_is_symbol_value(v, AM_VALUE_KW_let_syntax) ||
           macro_is_symbol_value(v, AM_VALUE_KW_letrec_syntax) ||
           macro_is_symbol_value(v, AM_VALUE_KW_syntax_rules);
}


typedef struct {
    am_ast_t *ast;
    int       found;
} macro_fast_path_scan_t;


static void macro_fast_path_scan_cb(am_handle_t handle, am_value_t value, void *user_data) {
    macro_fast_path_scan_t *data = (macro_fast_path_scan_t *)user_data;
    if (data->found) return;
    (void)handle;

    if (!am_value_is_ptr(value)) return;
    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->length == 0) return;

    am_value_t first = am_list_get(data->ast->alloc, lst, 0);
    if (macro_is_any_macro_keyword(first)) {
        data->found = 1;
    }
}


int32_t am_macro_expand(am_ast_t *ast) {
    if (!ast) return -1;

    // 快速路径：扫描 AST 堆中是否出现任何宏关键字。
    // 若整个 AST 都不含 define-syntax / let-syntax / letrec-syntax / syntax-rules，
    // 则无需进行递归宏展开，直接返回成功。
    macro_fast_path_scan_t scan = { ast, 0 };
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, macro_fast_path_scan_cb, &scan);
    if (!scan.found) return 0;

    am_macro_expand_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.ast = ast;

    am_handle_t top_lambda = am_ast_get_top_lambda_node_handle(ast);
    if (top_lambda == AM_HANDLE_NULL) {
        macro_set_error(&ctx, L"failed to get top lambda handle");
        fprintf(stderr, "[Macro Error] %ls\n", ctx.error_msg);
        return -1;
    }

    am_value_t lambda_val = am_ast_get_node(ast, top_lambda);
    if (!am_value_is_ptr(lambda_val)) {
        macro_set_error(&ctx, L"top lambda node is not a list");
        fprintf(stderr, "[Macro Error] %ls\n", ctx.error_msg);
        return -1;
    }
    am_list_t *lambda = (am_list_t *)am_value_to_ptr(lambda_val);

    size_t n_body = am_list_lambda_get_body_number(ast->alloc, lambda);
    am_value_t *bodies = am_list_lambda_get_bodies(ast->alloc, lambda, &n_body);
    if (!bodies) return 0;

    am_value_t *new_bodies = NULL;
    size_t new_n_body = 0;
    int ok = macro_expand_body_sequence(&ctx, bodies, n_body, NULL, top_lambda,
                                         &new_bodies, &new_n_body);
    free(bodies);

    if (ok != 0 || ctx.error) {
        free(new_bodies);
        for (size_t i = 0; i < ctx.allocated_macro_count; i++) {
            macro_free_macro(ctx.allocated_macros[i]);
        }
        free(ctx.allocated_macros);
        if (ctx.error) {
            fprintf(stderr, "[Macro Error] %ls\n", ctx.error_msg);
        }
        return -1;
    }

    // 若实际发生过宏展开或 define-syntax 消除，才替换顶层节点并刷新元数据。
    // 无宏时直接复用原 AST，避免制造冗余节点与重复元数据。
    if (ctx.changed) {
        if (am_ast_set_global_nodes(ast, new_bodies, new_n_body) != 0) {
            free(new_bodies);
            for (size_t i = 0; i < ctx.allocated_macro_count; i++) {
                macro_free_macro(ctx.allocated_macros[i]);
            }
            free(ctx.allocated_macros);
            macro_set_error(&ctx, L"failed to set global nodes");
            fprintf(stderr, "[Macro Error] %ls\n", ctx.error_msg);
            return -1;
        }
        free(new_bodies);

        // 刷新元数据
        macro_rebuild_lambda_handles(ast);
        am_parser_tail_call_analysis(ast);
        macro_rebuild_var_top(ast);
    } else {
        free(new_bodies);
    }

    // 释放宏描述符
    for (size_t i = 0; i < ctx.allocated_macro_count; i++) {
        macro_free_macro(ctx.allocated_macros[i]);
    }
    free(ctx.allocated_macros);

    return 0;
}
