#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>
#include <wctype.h>

#include "object.h"
#include "allocator.h"
#include "lexer.h"
#include "vocab.h"
#include "heap.h"
#include "map.h"
#include "list.h"
#include "scope.h"
#include "wstring.h"
#include "ast.h"


const wchar_t* AM_GLOBAL_BUILTIN_VAR[] = {
    L"+", L"-", L"*", L"/", L"mod", L"pow",
    L"not", L">", L"<", L">=", L"<=", L"==",
    L"eq?", L"eqv?", L"equal?", L"null?", L"undefined?", L"atom?", L"list?", L"number?", L"nan?", L"typeof",
    L"car", L"cdr", L"cons", L"get_item", L"set_item!", L"push", L"pop", L"length",
    L"display", L"newline", L"write", L"read", L"call/cc", L"fork", L"dynamic-wind", NULL
};

// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 将模块绝对路径转换为模块ID。
// 规则（对应TS的PathUtils.PathToModuleID）：将斜杠/反斜杠替换为点号，空格替换为下划线，去掉冒号，去掉.scm后缀。
// 返回新分配的 wchar_t*（使用ast分配器），失败返回NULL。
wchar_t *am_absolute_path_to_module_id(am_allocator_t *alloc, const wchar_t *absolute_path) {
    if (!absolute_path) return NULL;

    size_t len = wcslen(absolute_path);
    wchar_t *module_id = (wchar_t *)am_malloc(alloc, (len + 1) * sizeof(wchar_t));
    if (!module_id) return NULL;

    size_t j = 0;
    for (size_t i = 0; i < len; i++) {
        wchar_t c = absolute_path[i];
        if (i == 0 && c == L'/') {
            // 首字符为/时直接去掉
        }
        else if (c == L'/' || c == L'\\') {
            module_id[j++] = L'.';
        }
        else if (c == L' ') {
            module_id[j++] = L'_';
        }
        else if (c == L':') {
            // 去掉冒号
        }
        else {
            module_id[j++] = c;
        }
    }
    module_id[j] = L'\0';

    // 去掉末尾的 .scm（不区分大小写）
    size_t id_len = wcslen(module_id);
    if (id_len >= 4) {
        if (module_id[id_len - 4] == L'.' &&
            (module_id[id_len - 3] == L's' || module_id[id_len - 3] == L'S') &&
            (module_id[id_len - 2] == L'c' || module_id[id_len - 2] == L'C') &&
            (module_id[id_len - 1] == L'm' || module_id[id_len - 1] == L'M')) {
            module_id[id_len - 4] = L'\0';
        }
    }

    return module_id;
}


// 提取token对应的源码文本，返回新分配的以L'\0'结尾的宽字符串（使用系统malloc）。
// 调用者负责free。虚拟token（index == SIZE_MAX）返回NULL，但begin虚拟token返回L"begin"。
static wchar_t *am_token_text_dup(am_token_t *tok, wchar_t *code) {
    if (!tok) return NULL;

    // 虚拟token：仅begin返回对应文本，其他返回NULL
    if (tok->index == SIZE_MAX) {
        if (tok->type == AM_TOKEN_TYPE_KEYWORD && tok->length == 5) {
            wchar_t *buf = (wchar_t *)malloc(6 * sizeof(wchar_t));
            if (!buf) return NULL;
            wcscpy(buf, L"begin");
            return buf;
        }
        return NULL;
    }

    if (!code) return NULL;

    size_t len = tok->length;
    wchar_t *buf = (wchar_t *)malloc((len + 1) * sizeof(wchar_t));
    if (!buf) return NULL;

    wcsncpy(buf, &code[tok->index], len);
    buf[len] = L'\0';
    return buf;
}


// 根据token文本查找关键字在AM_KEYWORDS中的索引。
static size_t keyword_index(const wchar_t *text) {
    for (size_t i = 0; AM_KEYWORDS[i]; i++) {
        if (wcscmp(text, AM_KEYWORDS[i]) == 0) {
            return i;
        }
    }
    return SIZE_MAX;
}


// 辅助：从am_value_t解包出am_list_t*（不做类型检查，调用者应确保）
static am_list_t *value_to_list(am_value_t v) {
    return (am_list_t *)am_value_to_ptr(v);
}


// ===============================================================================
// 构造函数 / 析构函数 / 拷贝
// ===============================================================================

// 功能描述：创建AST对象。
am_ast_t *am_ast_create(am_allocator_t *alloc, wchar_t *code, wchar_t *absolute_path, am_token_t *tokens, size_t token_count) {
    if (!alloc) return NULL;

    am_ast_t *ast = (am_ast_t *)am_calloc(alloc, sizeof(am_ast_t));
    if (!ast) return NULL;

    ast->alloc = alloc;
    ast->code = code;
    ast->tokens = tokens;
    ast->token_count = token_count;
    ast->absolute_path = absolute_path;
    ast->module_id = am_absolute_path_to_module_id(alloc, absolute_path);
    if (!ast->module_id) {
        am_free(alloc, ast);
        return NULL;
    }

    ast->symbol_vocab = am_vocab_create(alloc, 64);
    ast->var_vocab = am_vocab_create(alloc, 64);
    ast->var_type = am_list_create(alloc, 64, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    ast->nodes = am_heap_create(alloc, alloc, 512);
    ast->node_token_mapping = am_map_create(alloc, 64);
    ast->strindex = am_strindex_create(alloc, 512);
    ast->scopes = am_map_create(alloc, 64);
    ast->var_arn_mapping = am_map_create(alloc, 64);
    ast->lambda_handles = am_list_create(alloc, 32, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    ast->tailcall_handles = am_list_create(alloc, 32, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    ast->var_top = am_list_create(alloc, 32, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    ast->dependencies = am_map_create(alloc, 16);
    ast->natives = am_map_create(alloc, 16);

    if (!ast->symbol_vocab || !ast->var_vocab || !ast->var_type || !ast->nodes ||
        !ast->node_token_mapping || !ast->strindex || !ast->scopes || !ast->var_arn_mapping ||
        !ast->lambda_handles || !ast->tailcall_handles || !ast->var_top ||
        !ast->dependencies || !ast->natives) {
        am_ast_destroy(ast);
        return NULL;
    }

    return ast;
}


// 功能描述：销毁AST对象。
int32_t am_ast_destroy(am_ast_t *ast) {
    if (!ast) return 0;

    am_allocator_t *alloc = ast->alloc;

    if (ast->tokens) am_free(alloc, ast->tokens);
    if (ast->module_id) am_free(alloc, ast->module_id);
    if (ast->symbol_vocab) am_vocab_destroy(alloc, ast->symbol_vocab);
    if (ast->var_vocab) am_vocab_destroy(alloc, ast->var_vocab);
    if (ast->var_type) am_list_destroy(alloc, ast->var_type);
    if (ast->nodes) am_heap_destroy(alloc, alloc, ast->nodes);
    if (ast->node_token_mapping) am_map_destroy(alloc, ast->node_token_mapping);
    if (ast->strindex) am_strindex_destroy(alloc, ast->strindex);
    if (ast->scopes) am_map_destroy(alloc, ast->scopes);
    if (ast->var_arn_mapping) am_map_destroy(alloc, ast->var_arn_mapping);
    if (ast->lambda_handles) am_list_destroy(alloc, ast->lambda_handles);
    if (ast->tailcall_handles) am_list_destroy(alloc, ast->tailcall_handles);
    if (ast->var_top) am_list_destroy(alloc, ast->var_top);
    if (ast->dependencies) am_map_destroy(alloc, ast->dependencies);
    if (ast->natives) am_map_destroy(alloc, ast->natives);

    am_free(alloc, ast);
    return 0;
}


// 功能描述：深拷贝AST对象。
am_ast_t *am_ast_copy(am_ast_t *ast) {
    if (!ast) return NULL;

    am_ast_t *copy = (am_ast_t *)am_calloc(ast->alloc, sizeof(am_ast_t));
    if (!copy) return NULL;

    copy->alloc = ast->alloc;
    copy->code = ast->code;
    copy->tokens = ast->tokens;
    copy->token_count = ast->token_count;
    copy->absolute_path = ast->absolute_path;
    copy->module_id = am_absolute_path_to_module_id(ast->alloc, ast->absolute_path);
    if (!copy->module_id) {
        am_free(ast->alloc, copy);
        return NULL;
    }

    copy->symbol_vocab = ast->symbol_vocab ? am_vocab_copy(ast->alloc, ast->symbol_vocab) : NULL;
    copy->var_vocab = ast->var_vocab ? am_vocab_copy(ast->alloc, ast->var_vocab) : NULL;
    copy->var_type = ast->var_type ? am_list_copy(ast->alloc, ast->var_type) : NULL;
    copy->nodes = ast->nodes ? am_heap_copy(ast->alloc, ast->alloc, ast->nodes) : NULL;
    copy->node_token_mapping = ast->node_token_mapping ? am_map_copy(ast->alloc, ast->node_token_mapping) : NULL;
    copy->strindex = ast->strindex ? am_strindex_copy(ast->alloc, ast->strindex) : NULL;
    copy->scopes = ast->scopes ? am_map_copy(ast->alloc, ast->scopes) : NULL;
    copy->var_arn_mapping = ast->var_arn_mapping ? am_map_copy(ast->alloc, ast->var_arn_mapping) : NULL;
    copy->lambda_handles = ast->lambda_handles ? am_list_copy(ast->alloc, ast->lambda_handles) : NULL;
    copy->tailcall_handles = ast->tailcall_handles ? am_list_copy(ast->alloc, ast->tailcall_handles) : NULL;
    copy->var_top = ast->var_top ? am_list_copy(ast->alloc, ast->var_top) : NULL;
    copy->dependencies = ast->dependencies ? am_map_copy(ast->alloc, ast->dependencies) : NULL;
    copy->natives = ast->natives ? am_map_copy(ast->alloc, ast->natives) : NULL;

    if (!copy->symbol_vocab || !copy->var_vocab || !copy->var_type || !copy->nodes ||
        !copy->node_token_mapping || !copy->strindex || !copy->scopes || !copy->var_arn_mapping ||
        !copy->lambda_handles || !copy->tailcall_handles || !copy->var_top ||
        !copy->dependencies || !copy->natives) {
        am_ast_destroy(copy);
        return NULL;
    }

    return copy;
}


// 功能描述：设置AST节点把柄对应的token索引。
int32_t am_ast_set_node_token_index(am_ast_t *ast, am_handle_t node_handle, size_t token_index) {
    if (!ast || !ast->node_token_mapping) return -1;
    am_map_t *map = am_map_set(ast->alloc, ast->node_token_mapping,
                                am_make_value_of_handle(node_handle),
                                am_make_value_of_uint((am_uint_t)token_index));
    if (!map) return -1;
    ast->node_token_mapping = map;
    return 0;
}


// 功能描述：获取AST节点把柄对应的token索引。
size_t am_ast_get_node_token_index(am_ast_t *ast, am_handle_t node_handle) {
    if (!ast || !ast->node_token_mapping) return SIZE_MAX;
    am_value_t v = am_map_get(ast->alloc, ast->node_token_mapping, am_make_value_of_handle(node_handle));
    if (am_value_is_uint(v)) {
        return (size_t)am_value_to_uint(v);
    }
    return SIZE_MAX;
}


// am_ast_merge 内部辅助：收集 importee->nodes 中所有把柄与值

typedef struct {
    am_handle_t old_handle;
    am_value_t  old_value;
} merge_node_entry_t;

typedef struct {
    merge_node_entry_t *entries;
    size_t              length;
    size_t              capacity;
} merge_node_collect_ctx_t;

static void merge_collect_node_cb(am_handle_t handle, am_value_t value, void *user_data) {
    merge_node_collect_ctx_t *ctx = (merge_node_collect_ctx_t *)user_data;

    // 词法作用域对象仅在编译期使用，不参与模块合并
    if (am_value_is_ptr(value)) {
        am_object_t *obj = am_value_to_ptr(value);
        if (obj->type == AM_OBJECT_TYPE_SCOPE) return;
    }

    if (ctx->length >= ctx->capacity) {
        size_t new_cap = ctx->capacity ? ctx->capacity * 2 : 16;
        merge_node_entry_t *new_entries = (merge_node_entry_t *)realloc(ctx->entries,
                                                                         new_cap * sizeof(merge_node_entry_t));
        if (!new_entries) return;
        ctx->entries = new_entries;
        ctx->capacity = new_cap;
    }
    ctx->entries[ctx->length].old_handle = handle;
    ctx->entries[ctx->length].old_value = value;
    ctx->length++;
}

static am_wstring_t *merge_copy_wstring(am_allocator_t *alloc, am_wstring_t *ws) {
    if (!ws) return NULL;
    size_t total_size = sizeof(am_wstring_t) + ws->length * sizeof(am_value_t);
    am_wstring_t *copy = (am_wstring_t *)am_malloc(alloc, total_size);
    if (!copy) return NULL;
    copy->base = ws->base;
    copy->length = ws->length;
    if (ws->length > 0) {
        memcpy(copy->content, ws->content, ws->length * sizeof(am_value_t));
    }
    return copy;
}


// 从 handle 列表中移除指定的 handle（按值过滤，in-place 缩短 length）。
static am_list_t *merge_remove_handle_from_list(am_allocator_t *alloc, am_list_t *lst, am_handle_t h) {
    if (!lst) return NULL;
    size_t write = 0;
    for (size_t i = 0; i < lst->length; i++) {
        am_value_t v = am_list_get(alloc, lst, i);
        if (am_value_is_handle(v) && am_value_to_handle(v) == h) continue;
        lst->children[write++] = v;
    }
    lst->length = write;
    return lst;
}


// 功能描述：将importee融合进importer，也就是importer吃掉importee。
// 实现说明：成功返回0；失败返回-1。
int32_t am_ast_merge(am_ast_t *importer, am_ast_t *importee, int32_t order) {
    if (!importer || !importee || !importer->alloc || !importee->alloc) return -1;

    // =============================================================================
    // 第1步：修改importee的元数据，将其映射/合并到importer
    // =============================================================================

    // 1.1 symbol 映射
    size_t symbol_count = importee->symbol_vocab ? importee->symbol_vocab->length : 0;
    am_map_t *symbol_merge_mapping = am_map_create(importer->alloc,
                                                    symbol_count > 0 ? symbol_count : 8);
    if (!symbol_merge_mapping) return -1;

    for (size_t i = 0; i < symbol_count; i++) {
        wchar_t *word = am_vocab_get(importee->alloc, importee->symbol_vocab, &i);
        if (!word) return -1;
        size_t new_idx;
        importer->symbol_vocab = am_vocab_insert(importer->alloc, importer->symbol_vocab, word, &new_idx);
        if (!importer->symbol_vocab || new_idx == SIZE_MAX) return -1;

        am_map_t *m = am_map_set(importer->alloc, symbol_merge_mapping,
                                  am_make_value_of_symbol((am_symbol_t)i),
                                  am_make_value_of_symbol((am_symbol_t)new_idx));
        if (!m) return -1;
        symbol_merge_mapping = m;
    }

    // 1.2 variable 映射及相关元数据
    size_t var_count = importee->var_vocab ? importee->var_vocab->length : 0;
    am_map_t *varid_merge_mapping = am_map_create(importer->alloc,
                                                   var_count > 0 ? var_count : 8);
    if (!varid_merge_mapping) return -1;

    for (size_t i = 0; i < var_count; i++) {
        wchar_t *word = am_vocab_get(importee->alloc, importee->var_vocab, &i);
        if (!word) return -1;
        size_t new_varid;
        importer->var_vocab = am_vocab_insert(importer->alloc, importer->var_vocab, word, &new_varid);
        if (!importer->var_vocab || new_varid == SIZE_MAX) return -1;

        am_map_t *m = am_map_set(importer->alloc, varid_merge_mapping,
                                  am_make_value_of_varid((am_varid_t)i),
                                  am_make_value_of_varid((am_varid_t)new_varid));
        if (!m) return -1;
        varid_merge_mapping = m;

        am_value_t vtype = am_list_get(importee->alloc, importee->var_type, i);
        if (new_varid >= importer->var_type->length) {
            am_list_t *vt = am_list_push(importer->alloc, importer->var_type, vtype);
            if (!vt) return -1;
            importer->var_type = vt;
        } else {
            if (am_list_set(importer->alloc, importer->var_type, new_varid, vtype) != 0) return -1;
        }
    }

    // var_top 迁移：将 importee 的顶级变量 varid 映射后追加到 importer，去重
    if (importee->var_top) {
        for (size_t i = 0; i < importee->var_top->length; i++) {
            am_value_t vv = am_list_get(importee->alloc, importee->var_top, i);
            if (!am_value_is_varid(vv)) continue;
            am_value_t mapped = am_map_get(importer->alloc, varid_merge_mapping, vv);
            if (!am_value_is_varid(mapped)) continue;

            // 检查 importer->var_top 中是否已存在相同 varid
            int duplicate = 0;
            for (size_t j = 0; j < importer->var_top->length; j++) {
                if (am_value_equal(am_list_get(importer->alloc, importer->var_top, j), mapped)) {
                    duplicate = 1;
                    break;
                }
            }
            if (duplicate) continue;

            am_list_t *lst = am_list_push(importer->alloc, importer->var_top, mapped);
            if (!lst) return -1;
            importer->var_top = lst;
        }
    }

    // 预先收集 importee->nodes 中所有节点，便于多遍扫描
    merge_node_collect_ctx_t node_ctx = { NULL, 0, 0 };
    if (importee->nodes) {
        am_heap_iter(importee->alloc, importee->alloc, importee->nodes, merge_collect_node_cb, &node_ctx);
    }
    size_t n_nodes = node_ctx.length;

    // 1.3 handle 映射
    am_map_t *handle_merge_mapping = am_map_create(importer->alloc,
                                                    n_nodes > 0 ? n_nodes : 8);
    if (!handle_merge_mapping) {
        free(node_ctx.entries);
        return -1;
    }

    for (size_t i = 0; i < n_nodes; i++) {
        am_handle_t new_handle = am_heap_alloc_handle(importer->alloc, importer->alloc, importer->nodes);
        if (new_handle == AM_HANDLE_NULL) {
            free(node_ctx.entries);
            return -1;
        }
        am_map_t *m = am_map_set(importer->alloc, handle_merge_mapping,
                                  am_make_value_of_handle(node_ctx.entries[i].old_handle),
                                  am_make_value_of_handle(new_handle));
        if (!m) {
            free(node_ctx.entries);
            return -1;
        }
        handle_merge_mapping = m;
    }

    // 迁移 lambda_handles
    if (importee->lambda_handles) {
        for (size_t i = 0; i < importee->lambda_handles->length; i++) {
            am_value_t old_hv = am_list_get(importee->alloc, importee->lambda_handles, i);
            am_value_t new_hv = am_map_get(importer->alloc, handle_merge_mapping, old_hv);
            if (!am_value_is_handle(new_hv)) continue;
            am_list_t *lst = am_list_push(importer->alloc, importer->lambda_handles, new_hv);
            if (!lst) {
                free(node_ctx.entries);
                return -1;
            }
            importer->lambda_handles = lst;
        }
    }

    // 迁移 tailcall_handles
    if (importee->tailcall_handles) {
        for (size_t i = 0; i < importee->tailcall_handles->length; i++) {
            am_value_t old_hv = am_list_get(importee->alloc, importee->tailcall_handles, i);
            am_value_t new_hv = am_map_get(importer->alloc, handle_merge_mapping, old_hv);
            if (!am_value_is_handle(new_hv)) continue;
            am_list_t *lst = am_list_push(importer->alloc, importer->tailcall_handles, new_hv);
            if (!lst) {
                free(node_ctx.entries);
                return -1;
            }
            importer->tailcall_handles = lst;
        }
    }

    // 迁移 dependencies
    if (importee->dependencies) {
        size_t dep_count = am_map_length(importee->alloc, importee->dependencies);
        am_value_t *dep_keys = am_map_keys(importee->alloc, importee->dependencies);
        for (size_t i = 0; i < dep_count; i++) {
            am_value_t old_varid_val = dep_keys[i];
            am_value_t old_h_val = am_map_get(importee->alloc, importee->dependencies, old_varid_val);
            am_value_t new_varid_val = am_map_get(importer->alloc, varid_merge_mapping, old_varid_val);
            am_value_t new_h_val = am_map_get(importer->alloc, handle_merge_mapping, old_h_val);
            if (am_value_is_varid(new_varid_val) && am_value_is_handle(new_h_val)) {
                am_map_t *m = am_map_set(importer->alloc, importer->dependencies,
                                          new_varid_val, new_h_val);
                if (!m) {
                    am_free(importee->alloc, dep_keys);
                    free(node_ctx.entries);
                    return -1;
                }
                importer->dependencies = m;
            }
        }
        am_free(importee->alloc, dep_keys);
    }

    // 迁移 natives
    if (importee->natives) {
        size_t nat_count = am_map_length(importee->alloc, importee->natives);
        am_value_t *nat_keys = am_map_keys(importee->alloc, importee->natives);
        for (size_t i = 0; i < nat_count; i++) {
            am_value_t old_varid_val = nat_keys[i];
            am_value_t old_h_val = am_map_get(importee->alloc, importee->natives, old_varid_val);
            am_value_t new_varid_val = am_map_get(importer->alloc, varid_merge_mapping, old_varid_val);
            am_value_t new_h_val = am_map_get(importer->alloc, handle_merge_mapping, old_h_val);
            if (am_value_is_varid(new_varid_val) && am_value_is_handle(new_h_val)) {
                am_map_t *m = am_map_set(importer->alloc, importer->natives,
                                          new_varid_val, new_h_val);
                if (!m) {
                    am_free(importee->alloc, nat_keys);
                    free(node_ctx.entries);
                    return -1;
                }
                importer->natives = m;
            }
        }
        am_free(importee->alloc, nat_keys);
    }

    // 第三遍扫描：替换所有 list 节点 children 中的 symbol/varid/handle
    for (size_t i = 0; i < n_nodes; i++) {
        am_value_t val = node_ctx.entries[i].old_value;
        if (!am_value_is_ptr(val)) {
            free(node_ctx.entries);
            return -1;
        }
        am_object_t *obj = am_value_to_ptr(val);
        if (obj->type != AM_OBJECT_TYPE_LIST) continue;

        am_list_t *lst = (am_list_t *)obj;
        for (size_t j = 0; j < lst->length; j++) {
            am_value_t child = am_list_get(importee->alloc, lst, j);
            am_value_t new_child = child;
            int replaced = 0;
            if (am_value_is_symbol(child)) {
                new_child = am_map_get(importer->alloc, symbol_merge_mapping, child);
                if (am_value_is_symbol(new_child)) replaced = 1;
            } else if (am_value_is_varid(child)) {
                new_child = am_map_get(importer->alloc, varid_merge_mapping, child);
                if (am_value_is_varid(new_child)) replaced = 1;
            } else if (am_value_is_handle(child)) {
                new_child = am_map_get(importer->alloc, handle_merge_mapping, child);
                if (am_value_is_handle(new_child)) replaced = 1;
            }
            if (replaced && new_child != child) {
                if (am_list_set(importee->alloc, lst, j, new_child) != 0) {
                    free(node_ctx.entries);
                    return -1;
                }
            }
        }
    }

    // 在拷贝节点之前先确定 importer / importee 的顶层 lambda，
    // 避免 importee 顶层 application 也被拷贝到 importer 后产生查找歧义。
    am_handle_t importer_top_lambda = importer->top_lambda_handle;
    if (importer_top_lambda == AM_HANDLE_NULL ||
        am_heap_has_handle(importer->alloc, importer->alloc, importer->nodes, importer_top_lambda) != 0) {
        importer_top_lambda = am_ast_get_top_lambda_node_handle(importer);
    }
    am_handle_t importee_top_lambda = importee->top_lambda_handle;
    if (importee_top_lambda == AM_HANDLE_NULL ||
        am_heap_has_handle(importee->alloc, importee->alloc, importee->nodes, importee_top_lambda) != 0) {
        importee_top_lambda = am_ast_get_top_lambda_node_handle(importee);
    }
    if (importer_top_lambda == AM_HANDLE_NULL || importee_top_lambda == AM_HANDLE_NULL) {
        free(node_ctx.entries);
        return -1;
    }

    // =============================================================================
    // 第2步：将 importee 的所有 nodes 深拷贝到 importer->nodes 中
    // =============================================================================
    for (size_t i = 0; i < n_nodes; i++) {
        am_value_t old_h_val = am_make_value_of_handle(node_ctx.entries[i].old_handle);
        am_value_t new_h_val = am_map_get(importer->alloc, handle_merge_mapping, old_h_val);
        if (!am_value_is_handle(new_h_val)) continue;
        am_handle_t new_h = am_value_to_handle(new_h_val);

        am_value_t val = node_ctx.entries[i].old_value;
        if (!am_value_is_ptr(val)) {
            free(node_ctx.entries);
            return -1;
        }
        am_object_t *obj = am_value_to_ptr(val);
        am_value_t new_val;
        if (obj->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *old_lst = (am_list_t *)obj;
            am_list_t *new_lst = am_list_copy(importer->alloc, old_lst);
            if (!new_lst) {
                free(node_ctx.entries);
                return -1;
            }
            if (new_lst->parent != AM_HANDLE_NULL) {
                am_value_t mapped_parent = am_map_get(importer->alloc, handle_merge_mapping,
                                                       am_make_value_of_handle(new_lst->parent));
                if (am_value_is_handle(mapped_parent)) {
                    new_lst->parent = am_value_to_handle(mapped_parent);
                }
            }
            new_val = am_make_value_of_ptr((am_object_t *)new_lst);
        } else if (obj->type == AM_OBJECT_TYPE_WSTRING) {
            am_wstring_t *new_ws = merge_copy_wstring(importer->alloc, (am_wstring_t *)obj);
            if (!new_ws) {
                free(node_ctx.entries);
                return -1;
            }
            new_val = am_make_value_of_ptr((am_object_t *)new_ws);
        } else if (obj->type == AM_OBJECT_TYPE_SCOPE) {
            // scope 对象是编译期词法作用域，不参与模块合并
            continue;
        } else {
            free(node_ctx.entries);
            return -1;
        }

        if (am_heap_set(importer->alloc, importer->alloc, importer->nodes, new_h, new_val) != 0) {
            free(node_ctx.entries);
            return -1;
        }
    }

    // =============================================================================
    // 第2.5步：合并 strindex（机械合并：把 importee 的 hash/handle 映射后插入 importer）
    // =============================================================================
    if (importee->strindex && importee->strindex->length > 0) {
        for (size_t i = 0; i < importee->strindex->capacity; i++) {
            uint32_t hash = importee->strindex->slots[i].hash;
            if (hash == AM_STRINDEX_KEY_EMPTY || hash == AM_STRINDEX_KEY_TOMBSTONE) continue;

            am_value_t old_h_val = importee->strindex->slots[i].value;
            if (!am_value_is_handle(old_h_val)) continue;

            am_value_t new_h_val = am_map_get(importer->alloc, handle_merge_mapping, old_h_val);
            if (!am_value_is_handle(new_h_val)) continue;

            am_strindex_t *new_si = am_strindex_set_raw(importer->alloc, importer->strindex,
                                                         hash, new_h_val);
            if (!new_si) {
                free(node_ctx.entries);
                return -1;
            }
            importer->strindex = new_si;
        }
    }

    // =============================================================================
    // 第3步：将 importee 的顶级节点嫁接到 importer 的顶层作用域
    // =============================================================================

    // importee 顶层 lambda 的函数体
    am_value_t importee_top_lambda_val = am_heap_get(importee->alloc, importee->alloc, importee->nodes,
                                                       importee_top_lambda);
    if (!am_value_is_ptr(importee_top_lambda_val)) {
        free(node_ctx.entries);
        return -1;
    }
    am_list_t *importee_top_lambda_lst = (am_list_t *)am_value_to_ptr(importee_top_lambda_val);
    am_handle_t importee_top_app = importee_top_lambda_lst->parent;
    size_t n_importee_bodies = 0;
    am_value_t *importee_bodies = am_list_lambda_get_bodies(importee->alloc,
                                                              importee_top_lambda_lst,
                                                              &n_importee_bodies);

    // importee_bodies 中的 handle 已在第1步第三遍扫描中被替换为 importer->nodes 中的新 handle，
    // 因此可以直接使用，无需再次查表映射。
    if (n_importee_bodies > 0 && !importee_bodies) {
        free(node_ctx.entries);
        return -1;
    }

    // 将嫁接到 importer 的顶级节点的 parent 修正为 importer 顶层 lambda
    for (size_t i = 0; i < n_importee_bodies; i++) {
        am_value_t body = importee_bodies[i];
        if (am_value_is_handle(body)) {
            am_handle_t body_h = am_value_to_handle(body);
            am_value_t body_val = am_heap_get(importer->alloc, importer->alloc, importer->nodes, body_h);
            if (am_value_is_ptr(body_val)) {
                am_object_t *body_obj = am_value_to_ptr(body_val);
                if (body_obj->type == AM_OBJECT_TYPE_LIST) {
                    ((am_list_t *)body_obj)->parent = importer_top_lambda;
                }
            }
        }
    }

    // importer 现有的顶层函数体
    am_value_t importer_top_lambda_val = am_heap_get(importer->alloc, importer->alloc, importer->nodes,
                                                       importer_top_lambda);
    if (!am_value_is_ptr(importer_top_lambda_val)) {
        free(importee_bodies);
        free(node_ctx.entries);
        return -1;
    }
    am_list_t *importer_top_lambda_lst = (am_list_t *)am_value_to_ptr(importer_top_lambda_val);
    size_t n_importer_bodies = 0;
    am_value_t *importer_bodies = am_list_lambda_get_bodies(importer->alloc,
                                                              importer_top_lambda_lst,
                                                              &n_importer_bodies);

    size_t total_bodies = n_importee_bodies + n_importer_bodies;
    am_value_t *new_bodies = NULL;
    if (total_bodies > 0) {
        new_bodies = (am_value_t *)malloc(total_bodies * sizeof(am_value_t));
        if (!new_bodies) {
            free(importer_bodies);
            free(importee_bodies);
            free(node_ctx.entries);
            return -1;
        }
        if (order == 0) {
            if (n_importee_bodies > 0) {
                memcpy(new_bodies, importee_bodies,
                       n_importee_bodies * sizeof(am_value_t));
            }
            if (n_importer_bodies > 0) {
                memcpy(new_bodies + n_importee_bodies, importer_bodies,
                       n_importer_bodies * sizeof(am_value_t));
            }
        } else {
            if (n_importer_bodies > 0) {
                memcpy(new_bodies, importer_bodies,
                       n_importer_bodies * sizeof(am_value_t));
            }
            if (n_importee_bodies > 0) {
                memcpy(new_bodies + n_importer_bodies, importee_bodies,
                       n_importee_bodies * sizeof(am_value_t));
            }
        }
    }

    int32_t set_result = 0;
    if (total_bodies > 0) {
        am_list_t *new_lambda = am_list_lambda_set_bodies(importer->alloc, importer_top_lambda_lst,
                                                          new_bodies, &total_bodies);
        if (!new_lambda) {
            set_result = -1;
        } else if (new_lambda != importer_top_lambda_lst) {
            if (am_heap_set(importer->alloc, importer->alloc, importer->nodes, importer_top_lambda,
                            am_make_value_of_ptr((am_object_t *)new_lambda)) != 0) {
                /* 扩容成功但 heap 更新失败：新 lambda 已不再被任何 handle 引用，
                 * 必须释放，否则会造成泄漏。 */
                am_list_destroy(importer->alloc, new_lambda);
                set_result = -1;
            }
        }
    }

    // 清理 importee 遗留的、已不可达的顶层 application 与顶层 lambda 节点
    if (importee_top_app != AM_HANDLE_NULL) {
        am_value_t dead_app_val = am_map_get(importer->alloc, handle_merge_mapping,
                                              am_make_value_of_handle(importee_top_app));
        am_value_t dead_lambda_val = am_map_get(importer->alloc, handle_merge_mapping,
                                                 am_make_value_of_handle(importee_top_lambda));
        if (am_value_is_handle(dead_app_val) && am_value_is_handle(dead_lambda_val)) {
            am_handle_t dead_app_h = am_value_to_handle(dead_app_val);
            am_handle_t dead_lambda_h = am_value_to_handle(dead_lambda_val);

            // 从 lambda_handles / tailcall_handles 中移除对这些死节点的引用
            importer->lambda_handles = merge_remove_handle_from_list(importer->alloc,
                                                                      importer->lambda_handles,
                                                                      dead_lambda_h);
            importer->tailcall_handles = merge_remove_handle_from_list(importer->alloc,
                                                                        importer->tailcall_handles,
                                                                        dead_app_h);

            // 从 importer->nodes 中释放死节点
            am_heap_free_handle(importer->alloc, importer->alloc, importer->nodes, dead_app_h);
            am_heap_free_handle(importer->alloc, importer->alloc, importer->nodes, dead_lambda_h);
        }
    }

    free(new_bodies);
    free(importer_bodies);
    free(importee_bodies);
    free(node_ctx.entries);

    am_map_destroy(importer->alloc, symbol_merge_mapping);
    am_map_destroy(importer->alloc, varid_merge_mapping);
    am_map_destroy(importer->alloc, handle_merge_mapping);

    if (set_result != 0) return -1;
    return 0;
}


// ===============================================================================
// 词汇表构建
// ===============================================================================

// 功能描述：遍历tokens，使用其中的KEYWORD和SYMBOL构建ast->symbol_vocab。
size_t am_build_symbol_vocabulary(am_ast_t *ast) {
    if (!ast || !ast->symbol_vocab || !ast->tokens) return 0;

    // 预置所有关键字到symbol_vocab的前端条目，索引与AM_VALUE_KW_*常量一致
    for (size_t i = 0; AM_KEYWORDS[i]; i++) {
        size_t idx;
        ast->symbol_vocab = am_vocab_insert(ast->alloc, ast->symbol_vocab, (wchar_t *)AM_KEYWORDS[i], &idx);
        if (!ast->symbol_vocab || idx == SIZE_MAX) return 0;
    }

    for (size_t i = 0; i < ast->token_count; i++) {
        am_token_t *t = &ast->tokens[i];
        // if (t->index == SIZE_MAX) continue; // 跳过虚拟token

        if (t->type == AM_TOKEN_TYPE_KEYWORD) {
            wchar_t *text = am_token_text_dup(t, ast->code);
            if (!text) return 0;
            size_t kw_idx = keyword_index(text);
            free(text);
            if (kw_idx != SIZE_MAX) {
                t->id = kw_idx;
            }
        }
        else if (t->type == AM_TOKEN_TYPE_SYMBOL) {
            wchar_t *text = am_token_text_dup(t, ast->code);
            if (!text) return 0;
            size_t idx;
            ast->symbol_vocab = am_vocab_insert(ast->alloc, ast->symbol_vocab, text, &idx);
            free(text);
            if (!ast->symbol_vocab || idx == SIZE_MAX) return 0;
            t->id = idx;
        }
    }

    return ast->symbol_vocab->length;
}


// 功能描述：遍历tokens，使用其中的IDENTIFIER构建ast->var_vocab。
size_t am_build_variable_vocabulary(am_ast_t *ast) {
    if (!ast || !ast->var_vocab || !ast->var_type || !ast->tokens) return 0;

    for (size_t i = 0; i < ast->token_count; i++) {
        am_token_t *t = &ast->tokens[i];
        if (t->index == SIZE_MAX) continue; // 跳过虚拟token

        if (t->type == AM_TOKEN_TYPE_IDENTIFIER) {
            wchar_t *text = am_token_text_dup(t, ast->code);
            if (!text) return 0;
            size_t old_len = ast->var_vocab->length;
            size_t idx;
            ast->var_vocab = am_vocab_insert(ast->alloc, ast->var_vocab, text, &idx);
            free(text);
            if (!ast->var_vocab || idx == SIZE_MAX) return 0;
            // 新变量加入时，同步在 var_type 中追加默认类型
            if (idx == old_len) {
                am_list_t *vt = am_list_push(ast->alloc, ast->var_type,
                                              am_make_value_of_uint(AM_VAR_TYPE_OLD));
                if (!vt) return 0;
                ast->var_type = vt;
            }
            t->id = idx;
        }
    }

    return ast->var_vocab->length;
}


// ===============================================================================
// EXT/NATIVE/IMPORT 引用判断
// ===============================================================================

// 功能描述：判断某个变量在形式上是否是“前缀.后缀”的格式（EXT_REF）。
int32_t am_ast_check_ext_ref(am_ast_t *ast, am_varid_t v) {
    if (!ast || !ast->var_vocab) return -1;

    wchar_t *var_str = am_vocab_get(ast->alloc, ast->var_vocab, &v);
    if (!var_str) return -1;

    // 必须有且仅有一个点号，且不在开头和末尾
    wchar_t *first_dot = wcschr(var_str, L'.');
    if (!first_dot || first_dot == var_str || first_dot[1] == L'\0') return -1;
    if (wcschr(first_dot + 1, L'.')) return -1;

    return 0;
}


// 功能描述：判断某个变量是否是 AM_VAR_TYPE_NATIVE_REF。
int32_t am_ast_check_native_ref(am_ast_t *ast, am_varid_t v) {
    if (!ast || !ast->var_vocab || !ast->natives) return -1;

    wchar_t *var_str = am_vocab_get(ast->alloc, ast->var_vocab, &v);
    if (!var_str) return -1;

    // 提取点号分隔的第1部分
    size_t len = wcslen(var_str);
    wchar_t *prefix = (wchar_t *)am_malloc(ast->alloc, (len + 1) * sizeof(wchar_t));
    if (!prefix) return -1;

    size_t i = 0;
    while (i < len && var_str[i] != L'.') {
        prefix[i] = var_str[i];
        i++;
    }
    prefix[i] = L'\0';

    size_t native_varid = am_vocab_find(ast->alloc, ast->var_vocab, prefix);
    am_free(ast->alloc, prefix);
    if (native_varid == SIZE_MAX) return -1;

    return am_map_contains(ast->alloc, ast->natives, am_make_value_of_varid(native_varid));
}


// 功能描述：判断某个变量是否是 AM_VAR_TYPE_IMPORT_REF。
int32_t am_ast_check_import_ref(am_ast_t *ast, am_varid_t v) {
    if (!ast || !ast->var_vocab || !ast->dependencies) return -1;

    wchar_t *var_str = am_vocab_get(ast->alloc, ast->var_vocab, &v);
    if (!var_str) return -1;

    // 提取最后一个点号分隔的第1部分作为 alias
    wchar_t *last_dot = wcsrchr(var_str, L'.');
    if (!last_dot || last_dot == var_str) return -1;

    size_t prefix_len = (size_t)(last_dot - var_str);
    wchar_t *prefix = (wchar_t *)am_malloc(ast->alloc, (prefix_len + 1) * sizeof(wchar_t));
    if (!prefix) return -1;
    wcsncpy(prefix, var_str, prefix_len);
    prefix[prefix_len] = L'\0';

    size_t alias_varid = am_vocab_find(ast->alloc, ast->var_vocab, prefix);
    am_free(ast->alloc, prefix);
    if (alias_varid == SIZE_MAX) return -1;

    return am_map_contains(ast->alloc, ast->dependencies, am_make_value_of_varid(alias_varid));
}


// ===============================================================================
// 节点访问
// ===============================================================================

// 功能描述：根据把柄从AST->nodes堆中获取相应的am_value_t。
am_value_t am_ast_get_node(am_ast_t *ast, am_handle_t handle) {
    if (!ast || !ast->nodes) return AM_VALUE_UNDEFINED;
    return am_heap_get(ast->alloc, ast->alloc, ast->nodes, handle);
}


// ===============================================================================
// 节点创建
// ===============================================================================

// 功能描述：创建lambda对象，返回其在AST->nodes堆中的把柄。
am_handle_t am_ast_make_lambda_node(am_ast_t *ast, am_handle_t parent) {
    if (!ast || !ast->nodes) return AM_HANDLE_NULL;

    am_handle_t handle = am_heap_alloc_handle(ast->alloc, ast->alloc, ast->nodes);
    if (handle == AM_HANDLE_NULL) return AM_HANDLE_NULL;

    am_list_t *lambda = am_list_create(ast->alloc, 32, AM_LIST_TYPE_LAMBDA, parent);
    if (!lambda) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }

    // Lambda表结构：children[0] = 'lambda, children[1] = 参数数量(uint)
    lambda = am_list_push(ast->alloc, lambda, AM_VALUE_KW_lambda);
    if (!lambda) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }
    lambda = am_list_push(ast->alloc, lambda, am_make_value_of_uint(0));
    if (!lambda) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }

    if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, handle, am_make_value_of_ptr((am_object_t *)lambda)) != 0) {
        am_list_destroy(ast->alloc, lambda);
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }

    am_list_t *lst = am_list_push(ast->alloc, ast->lambda_handles, am_make_value_of_handle(handle));
    if (!lst) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }
    ast->lambda_handles = lst;

    return handle;
}


// 功能描述：创建SList对象，返回其在AST->nodes堆中的把柄。
am_handle_t am_ast_make_slist_node(am_ast_t *ast, am_handle_t parent, int32_t type) {
    if (!ast || !ast->nodes) return AM_HANDLE_NULL;
    if (type != AM_LIST_TYPE_APPLICATION && type != AM_LIST_TYPE_QUOTE &&
        type != AM_LIST_TYPE_QUASIQUOTE && type != AM_LIST_TYPE_UNQUOTE) {
        return AM_HANDLE_NULL;
    }

    am_handle_t handle = am_heap_alloc_handle(ast->alloc, ast->alloc, ast->nodes);
    if (handle == AM_HANDLE_NULL) return AM_HANDLE_NULL;

    am_list_t *lst = am_list_create(ast->alloc, 32, type, parent);
    if (!lst) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }

    if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, handle, am_make_value_of_ptr((am_object_t *)lst)) != 0) {
        am_list_destroy(ast->alloc, lst);
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        return AM_HANDLE_NULL;
    }

    return handle;
}


// 功能描述：创建WString对象，返回其在AST->nodes堆中的把柄。
// 实现说明：基于全局字符串驻留索引 strindex 实现同值复用。先查索引，若存在相同内容
//         的字符串则复用其 handle；否则新建对象并登记到 strindex。

// 将词法层面截取的字符串字面量内容做转义还原。
// 支持 \" \\ \n \t \r；未知转义序列保留反斜杠与原字符。
static size_t ast_unescape_string(wchar_t *dst, const wchar_t *src, size_t len) {
    size_t i = 0, j = 0;
    while (i < len) {
        if (src[i] == L'\\' && i + 1 < len) {
            switch (src[i + 1]) {
                case L'"': dst[j++] = L'"'; i += 2; continue;
                case L'\\': dst[j++] = L'\\'; i += 2; continue;
                case L'n': dst[j++] = L'\n'; i += 2; continue;
                case L't': dst[j++] = L'\t'; i += 2; continue;
                case L'r': dst[j++] = L'\r'; i += 2; continue;
                default: break;
            }
        }
        dst[j++] = src[i++];
    }
    dst[j] = L'\0';
    return j;
}

am_handle_t am_ast_make_wstring_node(am_ast_t *ast, am_token_t *str_token) {
    if (!ast || !ast->nodes || !ast->strindex || !str_token) return AM_HANDLE_NULL;

    // 从token指示的位置截取字符串（去掉两侧引号）
    size_t len = str_token->length;
    if (len >= 2) len -= 2;
    wchar_t *text = (wchar_t *)malloc((len + 1) * sizeof(wchar_t));
    if (!text) return AM_HANDLE_NULL;
    wcsncpy(text, &ast->code[str_token->index + 1], len);
    text[len] = L'\0';

    // 还原转义序列
    size_t unescaped_len = ast_unescape_string(text, text, len);
    len = unescaped_len;

    uint32_t hash = am_strindex_hash_string(text);

    // 在 strindex 中查找候选 handle
    size_t n_candidates = am_strindex_get_all(ast->alloc, ast->strindex, text, NULL, 0);
    if (n_candidates > 0) {
        am_value_t *candidates = (am_value_t *)malloc(n_candidates * sizeof(am_value_t));
        if (!candidates) {
            free(text);
            return AM_HANDLE_NULL;
        }
        size_t got = am_strindex_get_all(ast->alloc, ast->strindex, text, candidates, n_candidates);

        for (size_t i = 0; i < got; i++) {
            am_handle_t cand_h = am_value_to_handle(candidates[i]);
            am_value_t cand_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, cand_h);
            if (!am_value_is_ptr(cand_val)) continue;
            am_object_t *obj = am_value_to_ptr(cand_val);
            if (obj->type != AM_OBJECT_TYPE_WSTRING) continue;
            am_wstring_t *ws = (am_wstring_t *)obj;

            // 先比长度，再比内容
            if (ws->length != len) continue;
            bool match = true;
            for (size_t j = 0; j < len; j++) {
                am_wchar_t wc = am_value_to_wchar(ws->content[j]);
                if (wc != (am_wchar_t)text[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                free(candidates);
                free(text);
                return cand_h;
            }
        }
        free(candidates);
    }

    // 不存在可复用的字符串，新建对象
    am_handle_t handle = am_heap_alloc_handle(ast->alloc, ast->alloc, ast->nodes);
    if (handle == AM_HANDLE_NULL) {
        free(text);
        return AM_HANDLE_NULL;
    }

    am_wstring_t *ws = am_wstring_create(ast->alloc, text, len);
    if (!ws) {
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        free(text);
        return AM_HANDLE_NULL;
    }

    // 缓存 hash 到对象头，便于后续快速判等
    ws->base.hash = hash;

    if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, handle, am_make_value_of_ptr((am_object_t *)ws)) != 0) {
        // 注：am_wstring_t 的 content 是柔性数组，am_free 即可释放整个对象
        am_free(ast->alloc, ws);
        am_heap_free_handle(ast->alloc, ast->alloc, ast->nodes, handle);
        free(text);
        return AM_HANDLE_NULL;
    }

    // 登记到 strindex。注意 strindex_set 可能扩容并改变指针。
    am_strindex_t *new_si = am_strindex_set(ast->alloc, ast->strindex, text, am_make_value_of_handle(handle));
    if (new_si) {
        ast->strindex = new_si;
    }
    // 即使 strindex 登记失败，字符串对象已经创建并绑定到 heap，仍返回 handle。

    free(text);
    return handle;
}


// ===============================================================================
// 顶级节点操作
// ===============================================================================

typedef struct {
    am_handle_t found_handle;
} am_top_node_search_t;

static void am_ast_top_node_iter(am_handle_t handle, am_value_t value, void *user_data) {
    am_top_node_search_t *ctx = (am_top_node_search_t *)user_data;
    if (ctx->found_handle != AM_HANDLE_NULL) return;
    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->parent == AM_TOP_NODE_HANDLE) {
        ctx->found_handle = handle;
    }
}


// 功能描述：查找最顶级Application的handle。
am_handle_t am_ast_get_top_node_handle(am_ast_t *ast) {
    if (!ast || !ast->nodes) return AM_HANDLE_NULL;

    am_top_node_search_t ctx = { AM_HANDLE_NULL };
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, am_ast_top_node_iter, &ctx);
    return ctx.found_handle;
}


// 功能描述：查找顶级Lambda（全局作用域）节点的handle。
am_handle_t am_ast_get_top_lambda_node_handle(am_ast_t *ast) {
    am_handle_t top_app = am_ast_get_top_node_handle(ast);
    if (top_app == AM_HANDLE_NULL) return AM_HANDLE_NULL;

    am_value_t app_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, top_app);
    if (!am_value_is_ptr(app_val)) return AM_HANDLE_NULL;

    am_list_t *app = (am_list_t *)am_value_to_ptr(app_val);
    if (app->length == 0) return AM_HANDLE_NULL;

    am_value_t first = am_list_get(ast->alloc, app, 0);
    if (!am_value_is_handle(first)) return AM_HANDLE_NULL;

    return am_value_to_handle(first);
}


// 功能描述：获取位于全局作用域的node列表（函数体列表）。
am_value_t *am_ast_get_global_nodes(am_ast_t *ast) {
    if (!ast || !ast->nodes) return NULL;

    am_handle_t top_lambda = am_ast_get_top_lambda_node_handle(ast);
    if (top_lambda == AM_HANDLE_NULL) return NULL;

    am_value_t lambda_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, top_lambda);
    if (!am_value_is_ptr(lambda_val)) return NULL;

    am_list_t *lambda = (am_list_t *)am_value_to_ptr(lambda_val);
    size_t n_body = 0;
    return am_list_lambda_get_bodies(ast->alloc, lambda, &n_body);
}


// 功能描述：设置全局作用域（顶层lambda）的node列表（函数体列表）。
int32_t am_ast_set_global_nodes(am_ast_t *ast, am_value_t *bodies, size_t n_body) {
    if (!ast || !ast->nodes || !bodies) return -1;

    am_handle_t top_lambda = am_ast_get_top_lambda_node_handle(ast);
    if (top_lambda == AM_HANDLE_NULL) return -1;

    am_value_t lambda_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, top_lambda);
    if (!am_value_is_ptr(lambda_val)) return -1;

    am_list_t *lambda = (am_list_t *)am_value_to_ptr(lambda_val);

    am_list_t *new_lambda = am_list_lambda_set_bodies(ast->alloc, lambda, bodies, &n_body);
    if (!new_lambda) return -1;

    // 如果lambda对象指针发生变化，更新heap中的绑定
    if (new_lambda != lambda) {
        if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, top_lambda, am_make_value_of_ptr((am_object_t *)new_lambda)) != 0) {
            am_list_destroy(ast->alloc, new_lambda);
            return -1;
        }
    }

    return 0;
}


// ===============================================================================
// 作用域上溯查找
// ===============================================================================

// 功能描述：从某个节点开始，向上上溯查找某个varid归属的lambda节点把柄。
am_handle_t am_ast_find_var_lambda_handle(am_ast_t *ast, am_varid_t varid, am_handle_t from_node_handle) {
    if (!ast || !ast->nodes) return AM_HANDLE_NULL;

    am_handle_t current = from_node_handle;
    while (current != AM_TOP_NODE_HANDLE) {
        am_value_t node_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, current);
        if (!am_value_is_ptr(node_val)) return AM_HANDLE_NULL;

        am_object_t *obj = am_value_to_ptr(node_val);
        if (obj->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *lst = (am_list_t *)obj;
            if (lst->type == AM_LIST_TYPE_LAMBDA) {
                // 获取该lambda对应的scope
                am_value_t scope_handle_val = am_map_get(ast->alloc, ast->scopes, am_make_value_of_handle(current));
                if (am_value_is_handle(scope_handle_val)) {
                    am_handle_t scope_handle = am_value_to_handle(scope_handle_val);
                    am_value_t scope_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, scope_handle);
                    if (am_value_is_ptr(scope_val)) {
                        am_scope_t *scope = (am_scope_t *)am_value_to_ptr(scope_val);
                        if (am_scope_has_var(ast->alloc, scope, varid) >= 0) {
                            return current;
                        }
                    }
                }
            }
            current = lst->parent;
        }
        else {
            // 非list节点无法继续上溯
            return AM_HANDLE_NULL;
        }
    }

    return AM_HANDLE_NULL;
}


// ===============================================================================
// AST 节点转字符串
// ===============================================================================

// 动态宽字符串缓冲区
typedef struct {
    am_allocator_t *alloc;
    wchar_t        *buf;
    size_t          len;
    size_t          cap;
} am_ast_strbuf_t;


// 初始化字符串缓冲区。成功返回 0，失败返回 -1。
static int32_t am_ast_strbuf_init(am_allocator_t *alloc, am_ast_strbuf_t *sb, size_t initial_cap) {
    if (!alloc || !sb || initial_cap == 0) return -1;
    sb->alloc = alloc;
    sb->buf = (wchar_t *)am_malloc(alloc, initial_cap * sizeof(wchar_t));
    if (!sb->buf) return -1;
    sb->buf[0] = L'\0';
    sb->len = 0;
    sb->cap = initial_cap;
    return 0;
}


// 确保缓冲区容量至少为 needed（含结尾 L'\0'）。成功返回 0，失败返回 -1。
static int32_t am_ast_strbuf_ensure(am_ast_strbuf_t *sb, size_t needed) {
    if (!sb || !sb->buf) return -1;
    if (needed <= sb->cap) return 0;

    size_t new_cap = sb->cap;
    while (new_cap < needed) {
        new_cap *= 2;
    }

    wchar_t *new_buf = (wchar_t *)am_malloc(sb->alloc, new_cap * sizeof(wchar_t));
    if (!new_buf) return -1;

    memcpy(new_buf, sb->buf, (sb->len + 1) * sizeof(wchar_t));
    am_free(sb->alloc, sb->buf);
    sb->buf = new_buf;
    sb->cap = new_cap;
    return 0;
}


// 追加一个宽字符。成功返回 0，失败返回 -1。
static int32_t am_ast_strbuf_append_char(am_ast_strbuf_t *sb, wchar_t c) {
    if (!sb) return -1;
    if (am_ast_strbuf_ensure(sb, sb->len + 2) != 0) return -1;
    sb->buf[sb->len++] = c;
    sb->buf[sb->len] = L'\0';
    return 0;
}


// 追加一个宽字符串。成功返回 0，失败返回 -1。
static int32_t am_ast_strbuf_append_string(am_ast_strbuf_t *sb, const wchar_t *s) {
    if (!sb || !s) return -1;
    size_t slen = wcslen(s);
    if (am_ast_strbuf_ensure(sb, sb->len + slen + 1) != 0) return -1;
    memcpy(&sb->buf[sb->len], s, slen * sizeof(wchar_t));
    sb->len += slen;
    sb->buf[sb->len] = L'\0';
    return 0;
}


// 前向声明
static int32_t am_ast_append_value_to_strbuf(am_ast_strbuf_t *sb, am_ast_t *ast, am_value_t value);


// 将 lambda 节点追加到缓冲区。成功返回 0，失败返回 -1。
static int32_t am_ast_append_lambda_to_strbuf(am_ast_strbuf_t *sb, am_ast_t *ast, am_list_t *lambda) {
    if (!sb || !ast || !lambda) return -1;

    if (am_ast_strbuf_append_string(sb, L"(lambda (") != 0) return -1;

    size_t n_param = 0;
    if (lambda->length >= 2) {
        am_value_t n_param_val = am_list_get(ast->alloc, lambda, 1);
        if (am_value_is_uint(n_param_val)) {
            n_param = (size_t)am_value_to_uint(n_param_val);
        }
    }

    // 形参
    for (size_t i = 0; i < n_param; i++) {
        if (i > 0) {
            if (am_ast_strbuf_append_char(sb, L' ') != 0) return -1;
        }
        am_value_t param = am_list_get(ast->alloc, lambda, 2 + i);
        if (am_ast_append_value_to_strbuf(sb, ast, param) != 0) return -1;
    }
    if (am_ast_strbuf_append_char(sb, L')') != 0) return -1;

    // 函数体
    size_t n_body = am_list_lambda_get_body_number(ast->alloc, lambda);
    for (size_t i = 0; i < n_body; i++) {
        if (am_ast_strbuf_append_char(sb, L' ') != 0) return -1;
        am_value_t body = am_list_get(ast->alloc, lambda, 2 + n_param + i);
        if (am_ast_append_value_to_strbuf(sb, ast, body) != 0) return -1;
    }

    if (am_ast_strbuf_append_char(sb, L')') != 0) return -1;
    return 0;
}


// 将 application / quote / quasiquote / unquote 列表追加到缓冲区。成功返回 0，失败返回 -1。
static int32_t am_ast_append_list_to_strbuf(am_ast_strbuf_t *sb, am_ast_t *ast, am_list_t *lst) {
    if (!sb || !ast || !lst) return -1;

    const wchar_t *prefix = L"(";
    if (lst->type == AM_LIST_TYPE_QUOTE)       prefix = L"'(";
    else if (lst->type == AM_LIST_TYPE_QUASIQUOTE) prefix = L"`(";
    else if (lst->type == AM_LIST_TYPE_UNQUOTE)    prefix = L",(";

    if (am_ast_strbuf_append_string(sb, prefix) != 0) return -1;

    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) {
            if (am_ast_strbuf_append_char(sb, L' ') != 0) return -1;
        }
        am_value_t child = am_list_get(ast->alloc, lst, i);
        if (am_ast_append_value_to_strbuf(sb, ast, child) != 0) return -1;
    }

    if (am_ast_strbuf_append_char(sb, L')') != 0) return -1;
    return 0;
}


// 将任意 AST 值追加到缓冲区。成功返回 0，失败返回 -1。
static int32_t am_ast_append_value_to_strbuf(am_ast_strbuf_t *sb, am_ast_t *ast, am_value_t value) {
    if (!sb || !ast) return -1;

    if (am_value_is_handle(value)) {
        // 子节点以 handle 立即数形式引用，需到 heap 中查找
        am_handle_t h = am_value_to_handle(value);
        if (h == AM_HANDLE_NULL) {
            return am_ast_strbuf_append_string(sb, L"#<null-handle>");
        }
        am_value_t node_val = am_ast_get_node(ast, h);
        return am_ast_append_value_to_strbuf(sb, ast, node_val);
    }
    else if (am_value_is_ptr(value)) {
        am_object_t *obj = am_value_to_ptr(value);
        if (obj->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *lst = (am_list_t *)obj;
            if (lst->type == AM_LIST_TYPE_LAMBDA) {
                return am_ast_append_lambda_to_strbuf(sb, ast, lst);
            }
            return am_ast_append_list_to_strbuf(sb, ast, lst);
        }
        else if (obj->type == AM_OBJECT_TYPE_WSTRING) {
            am_wstring_t *ws = (am_wstring_t *)obj;
            for (size_t i = 0; i < ws->length; i++) {
                am_value_t cv = ws->content[i];
                if (!am_value_is_wchar(cv)) continue;
                if (am_ast_strbuf_append_char(sb, (wchar_t)am_value_to_wchar(cv)) != 0) return -1;
            }
            return 0;
        }
        return am_ast_strbuf_append_string(sb, L"#<object>");
    }
    else if (am_value_is_varid(value)) {
        am_varid_t varid = am_value_to_varid(value);
        wchar_t *text = am_vocab_get(ast->alloc, ast->var_vocab, &varid);
        if (!text) return am_ast_strbuf_append_string(sb, L"#<var>");
        return am_ast_strbuf_append_string(sb, text);
    }
    else if (am_value_is_symbol(value)) {
        am_symbol_t sym = am_value_to_symbol(value);
        wchar_t *text = am_vocab_get(ast->alloc, ast->symbol_vocab, &sym);
        if (!text) return am_ast_strbuf_append_string(sb, L"#<sym>");
        // symbol 在词汇表中可能以单引号开头（如被 quote 的标识符），输出时去掉前导单引号
        // while (*text == L'\'') text++;
        return am_ast_strbuf_append_string(sb, text);
    }
    else if (am_value_is_uint(value)) {
        wchar_t tmp[64];
        swprintf(tmp, 64, L"%llu", (unsigned long long)am_value_to_uint(value));
        return am_ast_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_int(value)) {
        wchar_t tmp[64];
        swprintf(tmp, 64, L"%lld", (long long)am_value_to_int(value));
        return am_ast_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_float(value)) {
        wchar_t tmp[128];
        swprintf(tmp, 128, L"%g", (double)am_value_to_float(value));
        return am_ast_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_boolean(value)) {
        return am_ast_strbuf_append_string(sb, am_value_to_boolean(value) ? L"#t" : L"#f");
    }
    else if (am_value_is_null(value)) {
        return am_ast_strbuf_append_string(sb, L"#null");
    }
    else if (am_value_is_undefined(value)) {
        return am_ast_strbuf_append_string(sb, L"#undefined");
    }

    return am_ast_strbuf_append_string(sb, L"#<value>");
}


// 功能描述：将AST中的某个节点转成Scheme代码字符串（对应TS的AST.NodeToString）。
// 实现说明：返回使用 alloc 分配器分配的以 L'\0' 结尾的宽字符串，失败返回 NULL。
//         若 length 不为 NULL，则将字符串的逻辑长度（字符数）写入 *length。
wchar_t *am_ast_node_to_string(am_allocator_t *alloc, am_ast_t *ast, am_handle_t node_handle, size_t *length) {
    if (!alloc || !ast) return NULL;

    am_value_t value = am_ast_get_node(ast, node_handle);

    am_ast_strbuf_t sb;
    if (am_ast_strbuf_init(alloc, &sb, 256) != 0) return NULL;

    if (am_ast_append_value_to_strbuf(&sb, ast, value) != 0) {
        am_free(alloc, sb.buf);
        return NULL;
    }

    if (length) *length = sb.len;
    return sb.buf;
}




// 功能描述：从某个节点开始，向上上溯查找最近的lambda节点的把柄。
am_handle_t am_ast_find_nearest_lambda_handle(am_ast_t *ast, am_handle_t from_node_handle) {
    if (!ast || !ast->nodes) return AM_HANDLE_NULL;

    am_handle_t current = from_node_handle;
    while (current != AM_TOP_NODE_HANDLE) {
        am_value_t node_val = am_heap_get(ast->alloc, ast->alloc, ast->nodes, current);
        if (!am_value_is_ptr(node_val)) return AM_HANDLE_NULL;

        am_object_t *obj = am_value_to_ptr(node_val);
        if (obj->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *lst = (am_list_t *)obj;
            if (lst->type == AM_LIST_TYPE_LAMBDA) {
                return current;
            }
            current = lst->parent;
        }
        else {
            return AM_HANDLE_NULL;
        }
    }

    return AM_HANDLE_NULL;
}


// ===============================================================================
// 变量换名
// ===============================================================================

// 功能描述：生成模块（AST）内唯一的变量名。
am_varid_t am_ast_make_unique_variable(am_ast_t *ast, am_varid_t varid, am_handle_t lambda_handle) {
    if (!ast || !ast->var_vocab || !ast->var_type) return SIZE_MAX;

    wchar_t *var_str = am_vocab_get(ast->alloc, ast->var_vocab, &varid);
    if (!var_str) return SIZE_MAX;

    // 生成新变量名：module_id.lambda_handle.var_string
    // 估算所需空间：module_id + 分隔点1 + handle最大20位 + 分隔点1 + var_str + 结尾\0
    size_t module_id_len = wcslen(ast->module_id);
    size_t var_len = wcslen(var_str);
    size_t buf_size = module_id_len + 1 + 20 + 1 + var_len + 1;

    wchar_t *new_name = (wchar_t *)am_malloc(ast->alloc, buf_size * sizeof(wchar_t));
    if (!new_name) return SIZE_MAX;

    int n = swprintf(new_name, buf_size, L"%ls.%zu.%ls", ast->module_id, lambda_handle, var_str);
    if (n <= 0 || (size_t)n >= buf_size) {
        am_free(ast->alloc, new_name);
        return SIZE_MAX;
    }

    size_t old_len = ast->var_vocab->length;
    size_t new_varid;
    ast->var_vocab = am_vocab_insert(ast->alloc, ast->var_vocab, new_name, &new_varid);
    am_free(ast->alloc, new_name);

    if (!ast->var_vocab || new_varid == SIZE_MAX) return SIZE_MAX;
    // 新变量加入时，同步在 var_type 中追加默认类型
    if (new_varid == old_len) {
        am_list_t *vt = am_list_push(ast->alloc, ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_NEW));
        if (!vt) return SIZE_MAX;
        ast->var_type = vt;
    }
    return (am_varid_t)new_varid;
}


// 功能描述：为 import 别名生成模块级唯一变量名。
am_varid_t am_ast_make_unique_module_alias(am_ast_t *ast, am_varid_t alias_varid) {
    if (!ast || !ast->var_vocab || !ast->var_type) return SIZE_MAX;

    wchar_t *alias_str = am_vocab_get(ast->alloc, ast->var_vocab, &alias_varid);
    if (!alias_str) return SIZE_MAX;

    // 生成新变量名：module_id.alias
    size_t module_id_len = wcslen(ast->module_id);
    size_t alias_len = wcslen(alias_str);
    size_t buf_size = module_id_len + 1 + alias_len + 1;

    wchar_t *new_name = (wchar_t *)am_malloc(ast->alloc, buf_size * sizeof(wchar_t));
    if (!new_name) return SIZE_MAX;

    int n = swprintf(new_name, buf_size, L"%ls.%ls", ast->module_id, alias_str);
    if (n <= 0 || (size_t)n >= buf_size) {
        am_free(ast->alloc, new_name);
        return SIZE_MAX;
    }

    size_t old_len = ast->var_vocab->length;
    size_t new_varid;
    ast->var_vocab = am_vocab_insert(ast->alloc, ast->var_vocab, new_name, &new_varid);
    am_free(ast->alloc, new_name);

    if (!ast->var_vocab || new_varid == SIZE_MAX) return SIZE_MAX;

    // 设置 var_type 为 AM_VAR_TYPE_IMPORT_ALIAS
    if (new_varid == old_len) {
        am_list_t *vt = am_list_push(ast->alloc, ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_IMPORT_ALIAS));
        if (!vt) return SIZE_MAX;
        ast->var_type = vt;
    }
    else {
        if (am_list_set(ast->alloc, ast->var_type, new_varid,
                        am_make_value_of_uint(AM_VAR_TYPE_IMPORT_ALIAS)) != 0) {
            return SIZE_MAX;
        }
    }

    return (am_varid_t)new_varid;
}


// 功能描述：为 import 外部引用生成模块级唯一变量名。
am_varid_t am_ast_make_unique_import_ref(am_ast_t *ast, am_varid_t import_ref_varid) {
    if (!ast || !ast->var_vocab || !ast->var_type) return SIZE_MAX;

    wchar_t *ref_str = am_vocab_get(ast->alloc, ast->var_vocab, &import_ref_varid);
    if (!ref_str) return SIZE_MAX;

    // 生成新变量名：module_id.import_ref
    size_t module_id_len = wcslen(ast->module_id);
    size_t ref_len = wcslen(ref_str);
    size_t buf_size = module_id_len + 1 + ref_len + 1;

    wchar_t *new_name = (wchar_t *)am_malloc(ast->alloc, buf_size * sizeof(wchar_t));
    if (!new_name) return SIZE_MAX;

    int n = swprintf(new_name, buf_size, L"%ls.%ls", ast->module_id, ref_str);
    if (n <= 0 || (size_t)n >= buf_size) {
        am_free(ast->alloc, new_name);
        return SIZE_MAX;
    }

    size_t old_len = ast->var_vocab->length;
    size_t new_varid;
    ast->var_vocab = am_vocab_insert(ast->alloc, ast->var_vocab, new_name, &new_varid);
    am_free(ast->alloc, new_name);

    if (!ast->var_vocab || new_varid == SIZE_MAX) return SIZE_MAX;

    // 设置 var_type 为 AM_VAR_TYPE_IMPORT_REF
    if (new_varid == old_len) {
        am_list_t *vt = am_list_push(ast->alloc, ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_IMPORT_REF));
        if (!vt) return SIZE_MAX;
        ast->var_type = vt;
    }
    else {
        if (am_list_set(ast->alloc, ast->var_type, new_varid,
                        am_make_value_of_uint(AM_VAR_TYPE_IMPORT_REF)) != 0) {
            return SIZE_MAX;
        }
    }

    return (am_varid_t)new_varid;
}


// ===============================================================================
// AST 基本操作辅助接口
// ===============================================================================

// 功能描述：向 tailcall_handles 中添加一个尾调用节点把柄。
int32_t am_ast_add_tailcall(am_ast_t *ast, am_handle_t handle) {
    if (!ast || !ast->tailcall_handles) return -1;
    am_list_t *lst = am_list_push(ast->alloc, ast->tailcall_handles, am_make_value_of_handle(handle));
    if (!lst) return -1;
    ast->tailcall_handles = lst;
    return 0;
}


// 功能描述：向 var_top 中添加一个顶级变量 varid。
int32_t am_ast_add_var_top(am_ast_t *ast, am_varid_t varid) {
    if (!ast || !ast->var_top) return -1;
    am_list_t *lst = am_list_push(ast->alloc, ast->var_top, am_make_value_of_varid(varid));
    if (!lst) return -1;
    ast->var_top = lst;
    return 0;
}


// 功能描述：设置依赖模块记录。
int32_t am_ast_set_dependency(am_ast_t *ast, am_varid_t alias_varid, am_handle_t path_handle) {
    if (!ast || !ast->dependencies) return -1;
    am_map_t *map = am_map_set(ast->alloc, ast->dependencies,
                                am_make_value_of_varid(alias_varid),
                                am_make_value_of_handle(path_handle));
    if (!map) return -1;
    ast->dependencies = map;
    return 0;
}


// 功能描述：设置本地库记录。
int32_t am_ast_set_native(am_ast_t *ast, am_varid_t native_varid, am_handle_t handle) {
    if (!ast || !ast->natives) return -1;
    am_map_t *map = am_map_set(ast->alloc, ast->natives,
                                am_make_value_of_varid(native_varid),
                                am_make_value_of_handle(handle));
    if (!map) return -1;
    ast->natives = map;
    return 0;
}


// 功能描述：为lambda节点设置对应的词法作用域把柄。
int32_t am_ast_set_scope(am_ast_t *ast, am_handle_t lambda_handle, am_handle_t scope_handle) {
    if (!ast || !ast->scopes) return -1;
    am_map_t *map = am_map_set(ast->alloc, ast->scopes,
                                am_make_value_of_handle(lambda_handle),
                                am_make_value_of_handle(scope_handle));
    if (!map) return -1;
    ast->scopes = map;
    return 0;
}


// 功能描述：获取lambda节点对应的词法作用域把柄。
am_handle_t am_ast_get_scope(am_ast_t *ast, am_handle_t lambda_handle) {
    if (!ast || !ast->scopes) return AM_HANDLE_NULL;
    am_value_t v = am_map_get(ast->alloc, ast->scopes, am_make_value_of_handle(lambda_handle));
    if (am_value_is_handle(v)) {
        return am_value_to_handle(v);
    }
    return AM_HANDLE_NULL;
}
