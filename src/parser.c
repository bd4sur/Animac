#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

#include "object.h"
#include "allocator.h"
#include "lexer.h"
#include "list.h"
#include "vocab.h"
#include "heap.h"
#include "ast.h"
#include "opcode.h"
#include "scope.h"
#include "parser.h"
#include "macro.h"


#define PARSER_LOG(x) ((void)x); // printf(x);


// ===============================================================================
// 解析器状态
// ===============================================================================

#define AM_PARSER_STATE_NONE         (0)
#define AM_PARSER_STATE_PARAMETER    (1)
#define AM_PARSER_STATE_QUOTE        (2)
#define AM_PARSER_STATE_UNQUOTE      (3)
#define AM_PARSER_STATE_QUASIQUOTE   (4)

#define AM_PARSER_SPECIAL_APP_NONE   (0)
#define AM_PARSER_SPECIAL_APP_IMPORT (1)
#define AM_PARSER_SPECIAL_APP_NATIVE (2)


typedef struct parser_ctx_t {
    am_ast_t *ast;
    am_token_t *tokens;
    size_t token_count;

    am_value_t *node_stack;
    size_t node_stack_capacity;
    size_t node_stack_length;

    int *state_stack;
    size_t state_stack_capacity;
    size_t state_stack_length;

    am_handle_t *lambda_stack;
    size_t lambda_stack_capacity;
    size_t lambda_stack_length;

    int *special_app_stack;
    size_t special_app_stack_capacity;
    size_t special_app_stack_length;

    int32_t is_keep_free; // 为 1 时，将未定义变量视为全局自由变量

    int error;
    wchar_t error_msg[256];
} parser_ctx_t;


// ===============================================================================
// 前向声明
// ===============================================================================

static size_t parse_term(parser_ctx_t *ctx, size_t index);
static size_t parse_slist(parser_ctx_t *ctx, size_t index);
static size_t parse_slist_seq(parser_ctx_t *ctx, size_t index);
static size_t parse_lambda(parser_ctx_t *ctx, size_t index);
static size_t parse_arg_list(parser_ctx_t *ctx, size_t index);
static size_t parse_arg_list_seq(parser_ctx_t *ctx, size_t index);
static size_t parse_arg_identifier(parser_ctx_t *ctx, size_t index);
static size_t parse_body(parser_ctx_t *ctx, size_t index);
static size_t parse_body_tail(parser_ctx_t *ctx, size_t index);
static size_t parse_body_term(parser_ctx_t *ctx, size_t index);
static size_t parse_quote(parser_ctx_t *ctx, size_t index);
static size_t parse_unquote(parser_ctx_t *ctx, size_t index);
static size_t parse_quasiquote(parser_ctx_t *ctx, size_t index);
static size_t parse_quote_term(parser_ctx_t *ctx, size_t index);
static size_t parse_unquote_term(parser_ctx_t *ctx, size_t index);
static size_t parse_quasiquote_term(parser_ctx_t *ctx, size_t index);
static size_t parse_identifier(parser_ctx_t *ctx, size_t index);


// ===============================================================================
// 内部辅助函数
// ===============================================================================

static void parser_set_error(parser_ctx_t *ctx, const wchar_t *msg) {
    if (!ctx || ctx->error) return;
    ctx->error = 1;
    wcsncpy(ctx->error_msg, msg, 255);
    ctx->error_msg[255] = L'\0';
}


static am_token_t *token_at(parser_ctx_t *ctx, size_t index) {
    if (!ctx || index >= ctx->token_count) return NULL;
    return &ctx->tokens[index];
}


static int state_stack_top(parser_ctx_t *ctx) {
    if (!ctx || ctx->state_stack_length == 0) return AM_PARSER_STATE_NONE;
    return ctx->state_stack[ctx->state_stack_length - 1];
}


static void state_stack_push(parser_ctx_t *ctx, int state) {
    if (!ctx) return;
    if (ctx->state_stack_length >= ctx->state_stack_capacity) {
        size_t new_cap = ctx->state_stack_capacity ? ctx->state_stack_capacity * 2 : 16;
        int *new_stack = (int *)realloc(ctx->state_stack, new_cap * sizeof(int));
        if (!new_stack) {
            parser_set_error(ctx, L"state stack out of memory");
            return;
        }
        ctx->state_stack = new_stack;
        ctx->state_stack_capacity = new_cap;
    }
    ctx->state_stack[ctx->state_stack_length++] = state;
}


static void state_stack_pop(parser_ctx_t *ctx) {
    if (!ctx || ctx->state_stack_length == 0) return;
    ctx->state_stack_length--;
}


static int special_app_stack_top(parser_ctx_t *ctx) {
    if (!ctx || ctx->special_app_stack_length == 0) return AM_PARSER_SPECIAL_APP_NONE;
    return ctx->special_app_stack[ctx->special_app_stack_length - 1];
}


static void special_app_stack_push(parser_ctx_t *ctx, int state) {
    if (!ctx) return;
    if (ctx->special_app_stack_length >= ctx->special_app_stack_capacity) {
        size_t new_cap = ctx->special_app_stack_capacity ? ctx->special_app_stack_capacity * 2 : 16;
        int *new_stack = (int *)realloc(ctx->special_app_stack, new_cap * sizeof(int));
        if (!new_stack) {
            parser_set_error(ctx, L"special app stack out of memory");
            return;
        }
        ctx->special_app_stack = new_stack;
        ctx->special_app_stack_capacity = new_cap;
    }
    ctx->special_app_stack[ctx->special_app_stack_length++] = state;
}


static void special_app_stack_pop(parser_ctx_t *ctx) {
    if (!ctx || ctx->special_app_stack_length == 0) return;
    ctx->special_app_stack_length--;
}


static void lambda_stack_push(parser_ctx_t *ctx, am_handle_t lambda_handle) {
    if (!ctx) return;
    if (ctx->lambda_stack_length >= ctx->lambda_stack_capacity) {
        size_t new_cap = ctx->lambda_stack_capacity ? ctx->lambda_stack_capacity * 2 : 16;
        am_handle_t *new_stack = (am_handle_t *)realloc(ctx->lambda_stack, new_cap * sizeof(am_handle_t));
        if (!new_stack) {
            parser_set_error(ctx, L"lambda stack out of memory");
            return;
        }
        ctx->lambda_stack = new_stack;
        ctx->lambda_stack_capacity = new_cap;
    }
    ctx->lambda_stack[ctx->lambda_stack_length++] = lambda_handle;
}


static void lambda_stack_pop(parser_ctx_t *ctx) {
    if (!ctx || ctx->lambda_stack_length == 0) return;
    ctx->lambda_stack_length--;
}


static am_value_t node_stack_top(parser_ctx_t *ctx) {
    if (!ctx || ctx->node_stack_length == 0) return AM_VALUE_UNDEFINED;
    return ctx->node_stack[ctx->node_stack_length - 1];
}


static void node_stack_push(parser_ctx_t *ctx, am_value_t value) {
    if (!ctx) return;
    if (ctx->node_stack_length >= ctx->node_stack_capacity) {
        size_t new_cap = ctx->node_stack_capacity ? ctx->node_stack_capacity * 2 : 16;
        am_value_t *new_stack = (am_value_t *)realloc(ctx->node_stack, new_cap * sizeof(am_value_t));
        if (!new_stack) {
            parser_set_error(ctx, L"node stack out of memory");
            return;
        }
        ctx->node_stack = new_stack;
        ctx->node_stack_capacity = new_cap;
    }
    ctx->node_stack[ctx->node_stack_length++] = value;
}


static am_value_t node_stack_pop(parser_ctx_t *ctx) {
    if (!ctx || ctx->node_stack_length == 0) return AM_VALUE_UNDEFINED;
    return ctx->node_stack[--ctx->node_stack_length];
}


static int detect_special_app(parser_ctx_t *ctx) {
    if (!ctx || ctx->node_stack_length == 0) return AM_PARSER_SPECIAL_APP_NONE;

    am_value_t top = node_stack_top(ctx);
    if (!am_value_is_handle(top)) return AM_PARSER_SPECIAL_APP_NONE;

    am_handle_t list_handle = am_value_to_handle(top);
    if (list_handle == AM_TOP_NODE_HANDLE) return AM_PARSER_SPECIAL_APP_NONE;

    am_value_t list_val = am_ast_get_node(ctx->ast, list_handle);
    if (!am_value_is_ptr(list_val)) return AM_PARSER_SPECIAL_APP_NONE;

    am_list_t *lst = (am_list_t *)am_value_to_ptr(list_val);
    if (lst->length != 1) return AM_PARSER_SPECIAL_APP_NONE;

    am_value_t first = am_list_get(ctx->ast->alloc, lst, 0);
    if (!am_value_is_symbol(first)) return AM_PARSER_SPECIAL_APP_NONE;

    am_symbol_t sym = am_value_to_symbol(first);
    if (sym == am_value_to_symbol(AM_VALUE_KW_import)) return AM_PARSER_SPECIAL_APP_IMPORT;
    if (sym == am_value_to_symbol(AM_VALUE_KW_native)) return AM_PARSER_SPECIAL_APP_NATIVE;

    return AM_PARSER_SPECIAL_APP_NONE;
}


static int is_identifier_token(am_token_t *tok) {
    if (!tok) return 0;
    switch (tok->type) {
        case AM_TOKEN_TYPE_NUMBER:
        case AM_TOKEN_TYPE_STRING:
        case AM_TOKEN_TYPE_SYMBOL:
        case AM_TOKEN_TYPE_IDENTIFIER:
        case AM_TOKEN_TYPE_KEYWORD:
        case AM_TOKEN_TYPE_BOOLEAN:
        case AM_TOKEN_TYPE_NULL:
        case AM_TOKEN_TYPE_UNDEFINED:
            return 1;
        default:
            return 0;
    }
}


static int is_term_start_token(am_token_t *tok) {
    if (!tok) return 0;
    return tok->type == AM_TOKEN_TYPE_LB ||
           tok->type == AM_TOKEN_TYPE_QUOTE ||
           tok->type == AM_TOKEN_TYPE_UNQUOTE ||
           tok->type == AM_TOKEN_TYPE_QUASIQUOTE ||
           is_identifier_token(tok);
}


static wchar_t *token_text_dup(am_token_t *tok, wchar_t *code) {
    if (!tok || !code) return NULL;
    wchar_t *s = (wchar_t *)malloc((tok->length + 1) * sizeof(wchar_t));
    if (!s) return NULL;
    wcsncpy(s, code + tok->index, tok->length);
    s[tok->length] = L'\0';
    return s;
}


static am_value_t parse_number_token(am_token_t *tok, wchar_t *code) {
    if (!tok || !code) return AM_VALUE_UNDEFINED;

    wchar_t *text = token_text_dup(tok, code);
    if (!text) return AM_VALUE_UNDEFINED;

    am_value_t result = AM_VALUE_UNDEFINED;
    int has_dot = 0;
    int has_e = 0;
    size_t len = wcslen(text);

    for (size_t i = 0; i < len; i++) {
        if (text[i] == L'.') has_dot = 1;
        else if (text[i] == L'e' || text[i] == L'E') has_e = 1;
    }

    if (has_dot || has_e) {
        double d = wcstod(text, NULL);
        result = am_make_value_of_float((am_float_t)d);
    }
    else {
        long long ll = wcstoll(text, NULL, 10);
        if (ll >= 0) {
            result = am_make_value_of_uint((am_uint_t)ll);
        }
        else {
            result = am_make_value_of_int((am_int_t)ll);
        }
    }

    free(text);
    return result;
}


static int32_t append_child_to_top(parser_ctx_t *ctx) {
    if (!ctx || ctx->error) return -1;
    if (ctx->node_stack_length < 2) {
        parser_set_error(ctx, L"node stack underflow");
        return -1;
    }

    am_value_t child = node_stack_pop(ctx);
    if (ctx->error) return -1;

    am_value_t parent_val = node_stack_top(ctx);
    if (!am_value_is_handle(parent_val)) {
        parser_set_error(ctx, L"parent is not a handle");
        return -1;
    }

    am_handle_t parent_handle = am_value_to_handle(parent_val);
    am_value_t node_val = am_ast_get_node(ctx->ast, parent_handle);
    if (!am_value_is_ptr(node_val)) {
        parser_set_error(ctx, L"parent node not found");
        return -1;
    }

    am_object_t *obj = am_value_to_ptr(node_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) {
        parser_set_error(ctx, L"parent is not a list");
        return -1;
    }

    am_list_t *lst = (am_list_t *)obj;
    am_list_t *new_lst = am_list_push(ctx->ast->alloc, lst, child);
    if (!new_lst) {
        parser_set_error(ctx, L"failed to append child");
        return -1;
    }

    if (new_lst != lst) {
        if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, parent_handle,
                        am_make_value_of_ptr((am_object_t *)new_lst)) != 0) {
            am_list_destroy(ctx->ast->alloc, new_lst);
            parser_set_error(ctx, L"failed to update parent node");
            return -1;
        }
    }

    return 0;
}


static int32_t add_parameter_to_top_lambda(parser_ctx_t *ctx, am_value_t param) {
    if (!ctx || ctx->error) return -1;

    am_value_t top = node_stack_top(ctx);
    if (!am_value_is_handle(top)) {
        parser_set_error(ctx, L"lambda stack corrupted");
        return -1;
    }

    am_handle_t lambda_handle = am_value_to_handle(top);
    am_value_t node_val = am_ast_get_node(ctx->ast, lambda_handle);
    if (!am_value_is_ptr(node_val)) {
        parser_set_error(ctx, L"lambda node not found");
        return -1;
    }

    am_list_t *lst = (am_list_t *)am_value_to_ptr(node_val);
    am_list_t *new_lst = am_list_lambda_add_parameter(ctx->ast->alloc, lst, param);
    if (!new_lst) {
        parser_set_error(ctx, L"failed to add parameter");
        return -1;
    }

    if (new_lst != lst) {
        if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, lambda_handle,
                        am_make_value_of_ptr((am_object_t *)new_lst)) != 0) {
            am_list_destroy(ctx->ast->alloc, new_lst);
            parser_set_error(ctx, L"failed to update lambda node");
            return -1;
        }
    }

    return 0;
}


static int32_t add_body_to_top_lambda(parser_ctx_t *ctx, am_value_t body) {
    if (!ctx || ctx->error) return -1;

    am_value_t top = node_stack_top(ctx);
    if (!am_value_is_handle(top)) {
        parser_set_error(ctx, L"lambda stack corrupted");
        return -1;
    }

    am_handle_t lambda_handle = am_value_to_handle(top);
    am_value_t node_val = am_ast_get_node(ctx->ast, lambda_handle);
    if (!am_value_is_ptr(node_val)) {
        parser_set_error(ctx, L"lambda node not found");
        return -1;
    }

    am_list_t *lst = (am_list_t *)am_value_to_ptr(node_val);
    am_list_t *new_lst = am_list_lambda_add_body(ctx->ast->alloc, lst, body);
    if (!new_lst) {
        parser_set_error(ctx, L"failed to add body");
        return -1;
    }

    if (new_lst != lst) {
        if (am_heap_set(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, lambda_handle,
                        am_make_value_of_ptr((am_object_t *)new_lst)) != 0) {
            am_list_destroy(ctx->ast->alloc, new_lst);
            parser_set_error(ctx, L"failed to update lambda node");
            return -1;
        }
    }

    return 0;
}


static am_varid_t ensure_varid(parser_ctx_t *ctx, wchar_t *word) {
    if (!ctx || !ctx->ast || !ctx->ast->var_vocab || !ctx->ast->var_type) return SIZE_MAX;
    size_t idx = am_vocab_find(ctx->ast->alloc, ctx->ast->var_vocab, word);
    if (idx != SIZE_MAX) return (am_varid_t)idx;
    size_t old_len = ctx->ast->var_vocab->length;
    ctx->ast->var_vocab = am_vocab_insert(ctx->ast->alloc, ctx->ast->var_vocab, word, &idx);
    if (!ctx->ast->var_vocab || idx == SIZE_MAX) return SIZE_MAX;
    // 新变量加入时，同步在 var_type 中追加默认类型
    if (idx == old_len) {
        am_list_t *vt = am_list_push(ctx->ast->alloc, ctx->ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_OLD));
        if (!vt) return SIZE_MAX;
        ctx->ast->var_type = vt;
    }
    return (am_varid_t)idx;
}


static am_symbol_t ensure_symbol(parser_ctx_t *ctx, wchar_t *word) {
    if (!ctx || !ctx->ast || !ctx->ast->symbol_vocab) return SIZE_MAX;
    size_t idx = am_vocab_find(ctx->ast->alloc, ctx->ast->symbol_vocab, word);
    if (idx != SIZE_MAX) return (am_symbol_t)idx;
    ctx->ast->symbol_vocab = am_vocab_insert(ctx->ast->alloc, ctx->ast->symbol_vocab, word, &idx);
    if (!ctx->ast->symbol_vocab || idx == SIZE_MAX) return SIZE_MAX;
    return (am_symbol_t)idx;
}


static int is_global_builtin_variable(const wchar_t *text) {
    if (!text) return 0;
    for (size_t i = 0; i < AM_GLOBAL_BUILTIN_VAR_NUM; i++) {
        if (AM_GLOBAL_BUILTIN_VAR[i] && wcscmp(text, AM_GLOBAL_BUILTIN_VAR[i]) == 0) {
            return 1;
        }
    }
    return 0;
}


// ===============================================================================
// 递归下降分析
// ===============================================================================

static size_t parse_term(parser_ctx_t *ctx, size_t index) { PARSER_LOG("Term\n");
    am_token_t *tok = token_at(ctx, index);
    am_token_t *next = token_at(ctx, index + 1);
    int state = state_stack_top(ctx);

    if (ctx->error) return index;
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in term");
        return index;
    }

    // (lambda ...) 且不在 quote/quasiquote 状态
    if (state != AM_PARSER_STATE_QUOTE && state != AM_PARSER_STATE_QUASIQUOTE &&
        tok->type == AM_TOKEN_TYPE_LB && next && next->type == AM_TOKEN_TYPE_KEYWORD &&
        next->id == am_value_to_symbol(AM_VALUE_KW_lambda)) {
        return parse_lambda(ctx, index);
    }
    // (quote ...)
    else if (tok->type == AM_TOKEN_TYPE_LB && next && next->type == AM_TOKEN_TYPE_KEYWORD &&
             next->id == am_value_to_symbol(AM_VALUE_KW_quote)) {
        size_t next_index = parse_quote(ctx, index + 1);
        am_token_t *after = token_at(ctx, next_index);
        if (!after || after->type != AM_TOKEN_TYPE_RB) {
            parser_set_error(ctx, L"quote 右侧括号未闭合");
            return index;
        }
        return next_index + 1;
    }
    // (unquote ...)
    else if (tok->type == AM_TOKEN_TYPE_LB && next && next->type == AM_TOKEN_TYPE_KEYWORD &&
             next->id == am_value_to_symbol(AM_VALUE_KW_unquote)) {
        size_t next_index = parse_unquote(ctx, index + 1);
        am_token_t *after = token_at(ctx, next_index);
        if (!after || after->type != AM_TOKEN_TYPE_RB) {
            parser_set_error(ctx, L"unquote 右侧括号未闭合");
            return index;
        }
        return next_index + 1;
    }
    // (quasiquote ...)
    else if (tok->type == AM_TOKEN_TYPE_LB && next && next->type == AM_TOKEN_TYPE_KEYWORD &&
             next->id == am_value_to_symbol(AM_VALUE_KW_quasiquote)) {
        size_t next_index = parse_quasiquote(ctx, index + 1);
        am_token_t *after = token_at(ctx, next_index);
        if (!after || after->type != AM_TOKEN_TYPE_RB) {
            parser_set_error(ctx, L"quasiquote 右侧括号未闭合");
            return index;
        }
        return next_index + 1;
    }
    // '...
    else if (tok->type == AM_TOKEN_TYPE_QUOTE) {
        return parse_quote(ctx, index);
    }
    // ,...
    else if (tok->type == AM_TOKEN_TYPE_UNQUOTE) {
        return parse_unquote(ctx, index);
    }
    // `...
    else if (tok->type == AM_TOKEN_TYPE_QUASIQUOTE) {
        return parse_quasiquote(ctx, index);
    }
    // ( ... )
    else if (tok->type == AM_TOKEN_TYPE_LB) {
        return parse_slist(ctx, index);
    }
    // identifier
    else if (is_identifier_token(tok)) {
        return parse_identifier(ctx, index);
    }
    else {
        parser_set_error(ctx, L"unexpected token in term");
        return index;
    }
}


static size_t parse_slist(parser_ctx_t *ctx, size_t index) { PARSER_LOG("SList\n");
    am_token_t *tok = token_at(ctx, index);
    if (!tok || tok->type != AM_TOKEN_TYPE_LB) {
        parser_set_error(ctx, L"expected '(' for slist");
        return index;
    }

    int state = state_stack_top(ctx);
    int32_t list_type = AM_LIST_TYPE_APPLICATION;
    if (state == AM_PARSER_STATE_QUOTE) list_type = AM_LIST_TYPE_QUOTE;
    else if (state == AM_PARSER_STATE_QUASIQUOTE) list_type = AM_LIST_TYPE_QUASIQUOTE;
    else if (state == AM_PARSER_STATE_UNQUOTE) list_type = AM_LIST_TYPE_UNQUOTE;

    am_handle_t parent_handle = AM_HANDLE_NULL;
    am_value_t top = node_stack_top(ctx);
    if (!ctx->error && am_value_is_handle(top) && top != am_make_value_of_handle(AM_TOP_NODE_HANDLE)) {
        parent_handle = am_value_to_handle(top);
    }

    am_handle_t list_handle = am_ast_make_slist_node(ctx->ast, parent_handle, list_type);
    if (list_handle == AM_HANDLE_NULL) {
        parser_set_error(ctx, L"failed to create slist node");
        return index;
    }

    node_stack_push(ctx, am_make_value_of_handle(list_handle));
    am_ast_set_node_token_index(ctx->ast, list_handle, index);

    size_t next_index = parse_slist_seq(ctx, index + 1);
    if (ctx->error) return index;

    am_token_t *after = token_at(ctx, next_index);
    if (!after || after->type != AM_TOKEN_TYPE_RB) {
        parser_set_error(ctx, L"slist 右侧括号未闭合");
        return index;
    }
    return next_index + 1;
}


static size_t parse_slist_seq(parser_ctx_t *ctx, size_t index) { PARSER_LOG("SListSeq\n");
    am_token_t *tok = token_at(ctx, index);
    if (ctx->error) return index;
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in slist seq");
        return index;
    }

    if (is_term_start_token(tok)) {
        size_t next_index = parse_term(ctx, index);
        if (ctx->error) return index;

        if (append_child_to_top(ctx) < 0) return index;

        // 如果刚解析完 (import ...) 或 (native ...) 的第一个元素，
        // 则对第二个元素推送特殊 application 状态，解析完成后立即弹出
        int special_app = detect_special_app(ctx);
        if (special_app != AM_PARSER_SPECIAL_APP_NONE) {
            special_app_stack_push(ctx, special_app);
            next_index = parse_term(ctx, next_index);
            if (ctx->error) return index;
            if (append_child_to_top(ctx) < 0) {
                special_app_stack_pop(ctx);
                return index;
            }
            special_app_stack_pop(ctx);
        }

        return parse_slist_seq(ctx, next_index);
    }
    else {
        return index;
    }
}


static size_t parse_lambda(parser_ctx_t *ctx, size_t index) { PARSER_LOG("Lambda\n");
    am_token_t *tok = token_at(ctx, index);
    if (!tok || tok->type != AM_TOKEN_TYPE_LB) {
        parser_set_error(ctx, L"expected '(' for lambda");
        return index;
    }

    am_handle_t parent_handle = AM_HANDLE_NULL;
    am_value_t top = node_stack_top(ctx);
    if (!ctx->error && am_value_is_handle(top) && top != am_make_value_of_handle(AM_TOP_NODE_HANDLE)) {
        parent_handle = am_value_to_handle(top);
    }

    am_handle_t lambda_handle = am_ast_make_lambda_node(ctx->ast, parent_handle);
    if (lambda_handle == AM_HANDLE_NULL) {
        parser_set_error(ctx, L"failed to create lambda node");
        return index;
    }

    node_stack_push(ctx, am_make_value_of_handle(lambda_handle));
    am_ast_set_node_token_index(ctx->ast, lambda_handle, index);
    lambda_stack_push(ctx, lambda_handle);

    size_t result = index; // 出错时默认返回原索引

    size_t next_index = parse_arg_list(ctx, index + 2); // 跳过 '(' 和 'lambda'
    if (ctx->error) goto lambda_done;

    next_index = parse_body(ctx, next_index);
    if (ctx->error) goto lambda_done;

    am_token_t *after = token_at(ctx, next_index);
    if (!after || after->type != AM_TOKEN_TYPE_RB) {
        parser_set_error(ctx, L"lambda 右侧括号未闭合");
        goto lambda_done;
    }
    result = next_index + 1;

lambda_done:
    lambda_stack_pop(ctx);
    return result;
}


static size_t parse_arg_list(parser_ctx_t *ctx, size_t index) { PARSER_LOG("ArgList\n");
    am_token_t *tok = token_at(ctx, index);
    if (!tok || tok->type != AM_TOKEN_TYPE_LB) {
        parser_set_error(ctx, L"expected '(' for arglist");
        return index;
    }

    state_stack_push(ctx, AM_PARSER_STATE_PARAMETER);
    size_t next_index = parse_arg_list_seq(ctx, index + 1);
    state_stack_pop(ctx);
    if (ctx->error) return index;

    am_token_t *after = token_at(ctx, next_index);
    if (!after || after->type != AM_TOKEN_TYPE_RB) {
        parser_set_error(ctx, L"arglist 右侧括号未闭合");
        return index;
    }
    return next_index + 1;
}


static size_t parse_arg_list_seq(parser_ctx_t *ctx, size_t index) { PARSER_LOG("ArgListSeq\n");
    am_token_t *tok = token_at(ctx, index);
    if (ctx->error) return index;
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in arglist seq");
        return index;
    }

    if (is_identifier_token(tok)) {
        size_t next_index = parse_arg_identifier(ctx, index);
        if (ctx->error) return index;

        am_value_t param = node_stack_pop(ctx);
        if (ctx->error) return index;
        if (!am_value_is_varid(param)) {
            // 允许 '...' 出现在 lambda 参数列表中，用于 syntax-rules 宏模板。
            if (!(am_value_is_symbol(param) && am_value_to_symbol(param) == am_value_to_symbol(AM_VALUE_KW_dot3))) {
                parser_set_error(ctx, L"lambda parameter must be variable");
                return index;
            }
        }

        if (add_parameter_to_top_lambda(ctx, param) < 0) return index;

        return parse_arg_list_seq(ctx, next_index);
    }
    else {
        return index;
    }
}


static size_t parse_arg_identifier(parser_ctx_t *ctx, size_t index) { PARSER_LOG("ArgId\n");
    return parse_identifier(ctx, index);
}


static size_t parse_body(parser_ctx_t *ctx, size_t index) { PARSER_LOG("Body\n");
    size_t next_index = parse_body_term(ctx, index);
    if (ctx->error) return index;

    am_value_t body = node_stack_pop(ctx);
    if (ctx->error) return index;

    if (add_body_to_top_lambda(ctx, body) < 0) return index;

    return parse_body_tail(ctx, next_index);
}


static size_t parse_body_tail(parser_ctx_t *ctx, size_t index) { PARSER_LOG("BodyTail\n");
    am_token_t *tok = token_at(ctx, index);
    if (ctx->error) return index;
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in body tail");
        return index;
    }

    if (is_term_start_token(tok)) {
        size_t next_index = parse_body_term(ctx, index);
        if (ctx->error) return index;

        am_value_t body = node_stack_pop(ctx);
        if (ctx->error) return index;

        if (add_body_to_top_lambda(ctx, body) < 0) return index;

        return parse_body_tail(ctx, next_index);
    }
    else {
        return index;
    }
}


static size_t parse_body_term(parser_ctx_t *ctx, size_t index) { PARSER_LOG("BodyTerm\n");
    return parse_term(ctx, index);
}


static size_t parse_quote(parser_ctx_t *ctx, size_t index) {
    am_token_t *tok = token_at(ctx, index);
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in quote");
        return index;
    }

    size_t start = index;
    if (tok->type == AM_TOKEN_TYPE_QUOTE) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_KEYWORD && tok->id == am_value_to_symbol(AM_VALUE_KW_quote)) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_LB) {
        start = index + 2; // 跳过 ( quote
    }
    else {
        parser_set_error(ctx, L"expected quote");
        return index;
    }

    state_stack_push(ctx, AM_PARSER_STATE_QUOTE);
    size_t next_index = parse_quote_term(ctx, start);
    state_stack_pop(ctx);
    return next_index;
}


static size_t parse_unquote(parser_ctx_t *ctx, size_t index) {
    am_token_t *tok = token_at(ctx, index);
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in unquote");
        return index;
    }

    size_t start = index;
    if (tok->type == AM_TOKEN_TYPE_UNQUOTE) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_KEYWORD && tok->id == am_value_to_symbol(AM_VALUE_KW_unquote)) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_LB) {
        start = index + 2; // 跳过 ( unquote
    }
    else {
        parser_set_error(ctx, L"expected unquote");
        return index;
    }

    state_stack_push(ctx, AM_PARSER_STATE_UNQUOTE);
    size_t next_index = parse_unquote_term(ctx, start);
    state_stack_pop(ctx);
    return next_index;
}


static size_t parse_quasiquote(parser_ctx_t *ctx, size_t index) {
    am_token_t *tok = token_at(ctx, index);
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in quasiquote");
        return index;
    }

    size_t start = index;
    if (tok->type == AM_TOKEN_TYPE_QUASIQUOTE) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_KEYWORD && tok->id == am_value_to_symbol(AM_VALUE_KW_quasiquote)) {
        start = index + 1;
    }
    else if (tok->type == AM_TOKEN_TYPE_LB) {
        start = index + 2; // 跳过 ( quasiquote
    }
    else {
        parser_set_error(ctx, L"expected quasiquote");
        return index;
    }

    state_stack_push(ctx, AM_PARSER_STATE_QUASIQUOTE);
    size_t next_index = parse_quasiquote_term(ctx, start);
    state_stack_pop(ctx);
    return next_index;
}


static size_t parse_quote_term(parser_ctx_t *ctx, size_t index) {
    return parse_term(ctx, index);
}


static size_t parse_unquote_term(parser_ctx_t *ctx, size_t index) {
    return parse_term(ctx, index);
}


static size_t parse_quasiquote_term(parser_ctx_t *ctx, size_t index) {
    return parse_term(ctx, index);
}


// ===============================================================================
// Identifier 解析
// ===============================================================================

static size_t parse_identifier(parser_ctx_t *ctx, size_t index) { PARSER_LOG("Identifier\n");
    am_token_t *tok = token_at(ctx, index);
    if (!tok) {
        parser_set_error(ctx, L"unexpected end of input in identifier");
        return index;
    }

    int state = state_stack_top(ctx);
    am_value_t value = AM_VALUE_UNDEFINED;

    switch (tok->type) {
        case AM_TOKEN_TYPE_NUMBER: {
            value = parse_number_token(tok, ctx->ast->code);
            if (value == AM_VALUE_UNDEFINED) {
                parser_set_error(ctx, L"invalid number token");
                return index;
            }
            break;
        }

        case AM_TOKEN_TYPE_STRING: {
            am_handle_t str_handle = am_ast_make_wstring_node(ctx->ast, tok);
            if (str_handle == AM_HANDLE_NULL) {
                parser_set_error(ctx, L"failed to create string node");
                return index;
            }
            am_ast_set_node_token_index(ctx->ast, str_handle, index);
            value = am_make_value_of_handle(str_handle);
            break;
        }

        case AM_TOKEN_TYPE_SYMBOL: {
            if (state == AM_PARSER_STATE_UNQUOTE) {
                // 解除引用：去掉前导单引号，作为变量
                wchar_t *text = token_text_dup(tok, ctx->ast->code);
                if (!text) {
                    parser_set_error(ctx, L"out of memory");
                    return index;
                }
                wchar_t *var_text = text;
                while (*var_text == L'\'') var_text++;
                am_varid_t varid = ensure_varid(ctx, var_text);
                free(text);
                if (varid == SIZE_MAX) {
                    parser_set_error(ctx, L"failed to create varid");
                    return index;
                }
                value = am_make_value_of_varid(varid);
            }
            else {
                value = am_make_value_of_symbol((am_symbol_t)tok->id);
            }
            break;
        }

        case AM_TOKEN_TYPE_IDENTIFIER:
        case AM_TOKEN_TYPE_KEYWORD: {
            if (state == AM_PARSER_STATE_QUOTE || state == AM_PARSER_STATE_QUASIQUOTE) {
                // 被 quote 的标识符/关键字变成 symbol，前加单引号
                wchar_t *text = token_text_dup(tok, ctx->ast->code);
                if (!text) {
                    parser_set_error(ctx, L"out of memory");
                    return index;
                }
                size_t len = wcslen(text);
                wchar_t *sym_text = (wchar_t *)malloc((len + 2) * sizeof(wchar_t));
                if (!sym_text) {
                    free(text);
                    parser_set_error(ctx, L"out of memory");
                    return index;
                }
                sym_text[0] = L'\'';
                wcscpy(sym_text + 1, text);
                free(text);

                am_symbol_t sym_id = ensure_symbol(ctx, sym_text);
                free(sym_text);
                if (sym_id == SIZE_MAX) {
                    parser_set_error(ctx, L"failed to create symbol");
                    return index;
                }
                value = am_make_value_of_symbol(sym_id);
            }
            // else if (state == AM_PARSER_STATE_UNQUOTE) {
            //     // 作为变量处理
            //     wchar_t *text = token_text_dup(tok, ctx->ast->code);
            //     if (!text) {
            //         parser_set_error(ctx, L"out of memory");
            //         return index;
            //     }
            //     am_varid_t varid = ensure_varid(ctx, text);
            //     free(text);
            //     if (varid == SIZE_MAX) {
            //         parser_set_error(ctx, L"failed to create varid");
            //         return index;
            //     }
            //     value = am_make_value_of_varid(varid);
            // }
            else { // 含state == AM_PARSER_STATE_UNQUOTE
                // 普通状态：关键字作为 symbol，变量作为 varid
                if (tok->type == AM_TOKEN_TYPE_KEYWORD) {
                    value = am_make_value_of_symbol((am_symbol_t)tok->id);
                }
                else {
                    wchar_t *var_text = token_text_dup(tok, ctx->ast->code);
                    if (!var_text) {
                        parser_set_error(ctx, L"out of memory");
                        return index;
                    }

                    // 按需将实际变量注册到 var_vocab；quote/quasiquote 中的标识符
                    // 在前面已被转换为 symbol，不会走到这里，因此不会污染 var_vocab。
                    am_varid_t varid = ensure_varid(ctx, var_text);
                    if (varid == SIZE_MAX) {
                        free(var_text);
                        parser_set_error(ctx, L"failed to create varid");
                        return index;
                    }
                    tok->id = (size_t)varid;

                    // (import ...) / (native ...) 的第二个元素保持原形，不参与 Alpha-renaming
                    int special_app = special_app_stack_top(ctx);
                    if (special_app != AM_PARSER_SPECIAL_APP_NONE) {
                        if (am_list_set(ctx->ast->alloc, ctx->ast->var_type, (size_t)varid,
                                        am_make_value_of_uint(AM_VAR_TYPE_OLD)) != 0) {
                            free(var_text);
                            parser_set_error(ctx, L"failed to set var_type");
                            return index;
                        }
                        value = am_make_value_of_varid(varid);
                        free(var_text);
                    }
                    // EXT_REF 格式（前缀.后缀）保持原形，不参与 Alpha-renaming
                    else if (am_ast_check_ext_ref(ctx->ast, varid) == 0) {
                        if (am_list_set(ctx->ast->alloc, ctx->ast->var_type, (size_t)varid,
                                        am_make_value_of_uint(AM_VAR_TYPE_EXT_REF)) != 0) {
                            free(var_text);
                            parser_set_error(ctx, L"failed to set var_type");
                            return index;
                        }
                        value = am_make_value_of_varid(varid);
                        free(var_text);
                    }
                    // 全局内置变量不做 Alpha-renaming
                    else if (is_global_builtin_variable(var_text)) {
                        value = am_make_value_of_varid(varid);
                        free(var_text);
                    }
                    else {
                        // 普通变量：解析阶段保持原 varid，var_type 保持 OLD，
                        // Alpha-renaming 在后续独立的 ARN 阶段完成
                        value = am_make_value_of_varid(varid);
                        free(var_text);
                    }
                }
            }
            break;
        }

        case AM_TOKEN_TYPE_BOOLEAN: {
            wchar_t *text = token_text_dup(tok, ctx->ast->code);
            if (!text) {
                parser_set_error(ctx, L"out of memory");
                return index;
            }
            value = (wcscmp(text, L"#t") == 0) ? AM_VALUE_TRUE : AM_VALUE_FALSE;
            free(text);
            break;
        }

        case AM_TOKEN_TYPE_NULL: {
            value = AM_VALUE_NULL;
            break;
        }

        case AM_TOKEN_TYPE_UNDEFINED: {
            value = AM_VALUE_UNDEFINED;
            break;
        }

        default: {
            parser_set_error(ctx, L"illegal identifier token");
            return index;
        }
    }

    node_stack_push(ctx, value);
    return index + 1;
}


// ===============================================================================
// 预处理指令解析
// ===============================================================================

typedef struct {
    parser_ctx_t *ctx;
} preprocess_iter_data_t;

static void preprocess_iter_cb(am_handle_t handle, am_value_t value, void *user_data) {
    (void)handle;
    preprocess_iter_data_t *data = (preprocess_iter_data_t *)user_data;
    parser_ctx_t *ctx = data->ctx;
    am_ast_t *ast = ctx->ast;

    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->type != AM_LIST_TYPE_APPLICATION || lst->length == 0) return;

    am_value_t first = am_list_get(ast->alloc, lst, 0);
    if (!am_value_is_symbol(first)) return;

    am_symbol_t first_sym = am_value_to_symbol(first);

    // (import <Alias> <Path>)
    if (first_sym == am_value_to_symbol(AM_VALUE_KW_import) && lst->length == 3) {
        am_value_t alias_val = am_list_get(ast->alloc, lst, 1);
        am_value_t path_handle_val = am_list_get(ast->alloc, lst, 2);

        if (!am_value_is_varid(alias_val) || !am_value_is_handle(path_handle_val)) {
            parser_set_error(ctx, L"invalid import syntax");
            return;
        }

        am_varid_t alias_varid = am_value_to_varid(alias_val);
        am_handle_t path_handle = am_value_to_handle(path_handle_val);

        am_value_t path_node_val = am_ast_get_node(ast, path_handle);
        if (!am_value_is_ptr(path_node_val) ||
            ((am_object_t *)am_value_to_ptr(path_node_val))->type != AM_OBJECT_TYPE_WSTRING) {
            parser_set_error(ctx, L"import path must be string");
            return;
        }

        if (am_ast_set_dependency(ast, alias_varid, path_handle) < 0) {
            parser_set_error(ctx, L"failed to set dependency");
            return;
        }
    }
    // (native <NativeLibName>)
    else if (first_sym == am_value_to_symbol(AM_VALUE_KW_native) && lst->length == 2) {
        am_value_t name_val = am_list_get(ast->alloc, lst, 1);
        if (!am_value_is_varid(name_val)) {
            parser_set_error(ctx, L"invalid native syntax");
            return;
        }
        am_varid_t native_varid = am_value_to_varid(name_val);
        if (am_list_set(ast->alloc, ast->var_type, (size_t)native_varid,
                        am_make_value_of_uint(AM_VAR_TYPE_NATIVE_ID)) != 0) {
            parser_set_error(ctx, L"failed to set native var type");
            return;
        }
        if (am_ast_set_native(ast, native_varid, AM_HANDLE_NULL) < 0) {
            parser_set_error(ctx, L"failed to set native");
            return;
        }
    }
}


static void preprocess_analysis(parser_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return;
    preprocess_iter_data_t data = { ctx };
    am_heap_iter(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, preprocess_iter_cb, &data);
}


// ===============================================================================
// Alpha-renaming（变量换名）
// ===============================================================================

// 第一阶段：递归下降解析完成后，所有变量保持原名（OLD）。
// 第二阶段 ARN 再分两趟扫描：
//   Pass 1: 扫描整棵 AST，构建词法作用域 scope 的树状嵌套关系，并在 scope 上挂载 old 变量；
//   Pass 2: 根据 scope 嵌套关系，执行 ARN，并在 ast->var_arn_mapping 中登记新旧 varid 映射。


typedef struct {
    parser_ctx_t *ctx;
    am_handle_t *handles;
    size_t count;
    size_t capacity;
} arn_lambda_collect_t;


typedef struct {
    am_varid_t varid;
    am_handle_t lambda_handle;
} arn_define_entry_t;


typedef struct {
    parser_ctx_t *ctx;
    arn_define_entry_t *entries;
    size_t count;
    size_t capacity;
} arn_define_collect_t;


typedef struct {
    parser_ctx_t *ctx;
} arn_rename_iter_t;


static void arn_free_lambda_collect(arn_lambda_collect_t *data) {
    if (!data) return;
    if (data->handles) {
        free(data->handles);
        data->handles = NULL;
    }
    data->count = 0;
    data->capacity = 0;
}


static void arn_free_define_collect(arn_define_collect_t *data) {
    if (!data) return;
    if (data->entries) {
        free(data->entries);
        data->entries = NULL;
    }
    data->count = 0;
    data->capacity = 0;
}


// Pass 1-1: 收集所有 lambda 节点把柄
static void arn_collect_lambda_cb(am_handle_t handle, am_value_t value, void *user_data) {
    arn_lambda_collect_t *data = (arn_lambda_collect_t *)user_data;
    parser_ctx_t *ctx = data->ctx;

    if (ctx->error) return;
    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->type != AM_LIST_TYPE_LAMBDA) return;

    if (data->count >= data->capacity) {
        size_t new_cap = data->capacity ? data->capacity * 2 : 16;
        am_handle_t *new_arr = (am_handle_t *)realloc(data->handles, new_cap * sizeof(am_handle_t));
        if (!new_arr) {
            parser_set_error(ctx, L"out of memory collecting lambda handles");
            return;
        }
        data->handles = new_arr;
        data->capacity = new_cap;
    }
    data->handles[data->count++] = handle;
}


// Pass 1-2: 为每个 lambda 节点创建对应的 scope
static int32_t arn_create_scopes(parser_ctx_t *ctx, arn_lambda_collect_t *lambdas) {
    am_ast_t *ast = ctx->ast;

    for (size_t i = 0; i < lambdas->count; i++) {
        am_handle_t lambda_handle = lambdas->handles[i];
        am_value_t node_val = am_ast_get_node(ast, lambda_handle);
        if (!am_value_is_ptr(node_val)) return -1;

        am_list_t *lst = (am_list_t *)am_value_to_ptr(node_val);
        if (lst->type != AM_LIST_TYPE_LAMBDA) return -1;

        am_handle_t parent_lambda = AM_HANDLE_NULL;
        am_handle_t parent_scope = AM_HANDLE_NULL;
        if (lst->parent != AM_TOP_NODE_HANDLE) {
            parent_lambda = am_ast_find_nearest_lambda_handle(ast, lst->parent);
            if (parent_lambda != AM_HANDLE_NULL) {
                parent_scope = am_ast_get_scope(ast, parent_lambda);
            }
        }

        am_scope_t *scope = am_scope_create(ast->alloc, parent_scope, parent_lambda, lambda_handle, 16);
        if (!scope) return -1;

        am_handle_t scope_handle = am_heap_alloc_handle(ast->alloc, ast->alloc, ast->nodes);
        if (scope_handle == AM_HANDLE_NULL) {
            am_scope_destroy(ast->alloc, scope);
            return -1;
        }

        if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, scope_handle,
                        am_make_value_of_ptr((am_object_t *)scope)) != 0) {
            am_scope_destroy(ast->alloc, scope);
            return -1;
        }

        if (am_ast_set_scope(ast, lambda_handle, scope_handle) != 0) {
            return -1;
        }
    }

    return 0;
}


// Pass 1-3: 将 lambda 的 parameters 注册到对应 scope
static int32_t arn_add_lambda_params_to_scope(parser_ctx_t *ctx, am_handle_t lambda_handle) {
    am_ast_t *ast = ctx->ast;
    am_value_t node_val = am_ast_get_node(ast, lambda_handle);
    if (!am_value_is_ptr(node_val)) return -1;

    am_list_t *lst = (am_list_t *)am_value_to_ptr(node_val);
    if (lst->type != AM_LIST_TYPE_LAMBDA) return -1;

    am_handle_t scope_handle = am_ast_get_scope(ast, lambda_handle);
    if (scope_handle == AM_HANDLE_NULL) return -1;

    am_value_t scope_val = am_ast_get_node(ast, scope_handle);
    if (!am_value_is_ptr(scope_val)) return -1;

    am_scope_t *scope = (am_scope_t *)am_value_to_ptr(scope_val);

    size_t n_param = 0;
    if (lst->length >= 2) {
        am_value_t n_param_val = am_list_get(ast->alloc, lst, 1);
        if (am_value_is_uint(n_param_val)) n_param = (size_t)am_value_to_uint(n_param_val);
    }

    for (size_t i = 0; i < n_param; i++) {
        am_value_t param = am_list_get(ast->alloc, lst, 2 + i);
        if (!am_value_is_varid(param)) continue;

        am_scope_t *new_scope = am_scope_add_var(ast->alloc, scope, am_value_to_varid(param), AM_VALUE_NULL);
        if (!new_scope) return -1;

        if (new_scope != scope) {
            if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, scope_handle,
                            am_make_value_of_ptr((am_object_t *)new_scope)) != 0) {
                return -1;
            }
            scope = new_scope;
        }
    }

    return 0;
}


// Pass 1-4: 收集所有 (define var ...) 定义的变量
static void arn_collect_defines_cb(am_handle_t handle, am_value_t value, void *user_data) {
    (void)handle;
    arn_define_collect_t *data = (arn_define_collect_t *)user_data;
    parser_ctx_t *ctx = data->ctx;
    am_ast_t *ast = ctx->ast;

    if (ctx->error) return;
    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->type != AM_LIST_TYPE_APPLICATION || lst->length < 2) return;

    am_value_t first = am_list_get(ast->alloc, lst, 0);
    if (!am_value_is_symbol(first)) return;
    if (am_value_to_symbol(first) != am_value_to_symbol(AM_VALUE_KW_define)) return;

    am_value_t second = am_list_get(ast->alloc, lst, 1);
    if (!am_value_is_varid(second)) return;

    am_handle_t parent_handle = (lst->parent != AM_TOP_NODE_HANDLE) ? lst->parent : AM_HANDLE_NULL;
    am_handle_t lambda_handle = AM_HANDLE_NULL;
    if (parent_handle != AM_HANDLE_NULL) {
        lambda_handle = am_ast_find_nearest_lambda_handle(ast, parent_handle);
    }
    if (lambda_handle == AM_HANDLE_NULL) {
        parser_set_error(ctx, L"define outside lambda scope");
        return;
    }

    if (data->count >= data->capacity) {
        size_t new_cap = data->capacity ? data->capacity * 2 : 16;
        arn_define_entry_t *new_arr = (arn_define_entry_t *)realloc(data->entries,
                                                                     new_cap * sizeof(arn_define_entry_t));
        if (!new_arr) {
            parser_set_error(ctx, L"out of memory collecting defines");
            return;
        }
        data->entries = new_arr;
        data->capacity = new_cap;
    }
    data->entries[data->count].varid = am_value_to_varid(second);
    data->entries[data->count].lambda_handle = lambda_handle;
    data->count++;
}


// Pass 1-5: 将 define 的变量注册到所在 lambda 的 scope
static int32_t arn_add_defines_to_scope(parser_ctx_t *ctx, arn_define_collect_t *defines) {
    am_ast_t *ast = ctx->ast;

    for (size_t i = 0; i < defines->count; i++) {
        am_handle_t scope_handle = am_ast_get_scope(ast, defines->entries[i].lambda_handle);
        if (scope_handle == AM_HANDLE_NULL) return -1;

        am_value_t scope_val = am_ast_get_node(ast, scope_handle);
        if (!am_value_is_ptr(scope_val)) return -1;

        am_scope_t *scope = (am_scope_t *)am_value_to_ptr(scope_val);

        am_scope_t *new_scope = am_scope_add_var(ast->alloc, scope,
                                                  defines->entries[i].varid, AM_VALUE_NULL);
        if (!new_scope) return -1;

        if (new_scope != scope) {
            if (am_heap_set(ast->alloc, ast->alloc, ast->nodes, scope_handle,
                            am_make_value_of_ptr((am_object_t *)new_scope)) != 0) {
                return -1;
            }
            scope = new_scope;
        }
    }

    return 0;
}


// Pass 2: 判断某个 varid 是否属于不参与 ARN 的特殊类型
static int arn_should_skip_var_type(am_ast_t *ast, am_varid_t varid) {
    am_value_t type_val = am_list_get(ast->alloc, ast->var_type, (size_t)varid);
    if (!am_value_is_uint(type_val)) return 1;

    am_uint_t t = am_value_to_uint(type_val);
    return (t == AM_VAR_TYPE_IMPORT_ALIAS ||
            t == AM_VAR_TYPE_NATIVE_ID ||
            t == AM_VAR_TYPE_IMPORT_REF ||
            t == AM_VAR_TYPE_NATIVE_REF ||
            t == AM_VAR_TYPE_EXT_REF);
}


// Pass 2: 将 list 中指定位置的变量替换为 ARN 后的新 varid
static void arn_rename_varid(parser_ctx_t *ctx, am_handle_t node_handle, am_list_t *lst,
                              size_t index, int is_parameter) {
    am_ast_t *ast = ctx->ast;
    am_value_t child = am_list_get(ast->alloc, lst, index);
    if (!am_value_is_varid(child)) return;

    am_varid_t old_varid = am_value_to_varid(child);

    if (arn_should_skip_var_type(ast, old_varid)) return;

    am_handle_t lambda_handle = AM_HANDLE_NULL;
    if (is_parameter) {
        lambda_handle = node_handle;
    } else {
        lambda_handle = am_ast_find_var_lambda_handle(ast, old_varid, node_handle);
    }

    if (lambda_handle == AM_HANDLE_NULL) {
        // 未定义变量：全局内置变量保持原 varid；其余保持原 varid（宽松语义，兼容自由变量）
        wchar_t *var_str = am_vocab_get(ast->alloc, ast->var_vocab, &old_varid);
        if (var_str && is_global_builtin_variable(var_str)) {
            return;
        }
        // 若启用 is_keep_free，将未定义变量标记为全局自由变量
        if (ctx->is_keep_free) {
            if (am_list_set(ast->alloc, ast->var_type, (size_t)old_varid,
                            am_make_value_of_uint(AM_VAR_TYPE_GLOBAL_FREE)) != 0) {
                parser_set_error(ctx, L"failed to set global free var type");
            }
        }
        return;
    }

    am_varid_t new_varid = am_ast_make_unique_variable(ast, old_varid, lambda_handle);
    if (new_varid == SIZE_MAX) {
        parser_set_error(ctx, L"failed to create unique variable");
        return;
    }

    if (am_list_set(ast->alloc, lst, index, am_make_value_of_varid(new_varid)) != 0) {
        parser_set_error(ctx, L"failed to set renamed varid");
        return;
    }

    am_map_t *map = am_map_set(ast->alloc, ast->var_arn_mapping,
                                am_make_value_of_varid(new_varid),
                                am_make_value_of_varid(old_varid));
    if (!map) {
        parser_set_error(ctx, L"failed to set var_arn_mapping");
        return;
    }
    ast->var_arn_mapping = map;
}


// Pass 2: 处理 lambda 节点（parameters 与 body 中出现的变量）
static void arn_rename_lambda(parser_ctx_t *ctx, am_handle_t handle, am_list_t *lst) {
    size_t n_param = 0;
    if (lst->length >= 2) {
        am_value_t n_param_val = am_list_get(ctx->ast->alloc, lst, 1);
        if (am_value_is_uint(n_param_val)) n_param = (size_t)am_value_to_uint(n_param_val);
    }

    for (size_t i = 0; i < n_param; i++) {
        arn_rename_varid(ctx, handle, lst, 2 + i, 1);
        if (ctx->error) return;
    }

    for (size_t i = 2 + n_param; i < lst->length; i++) {
        am_value_t child = am_list_get(ctx->ast->alloc, lst, i);
        if (am_value_is_varid(child)) {
            arn_rename_varid(ctx, handle, lst, i, 0);
            if (ctx->error) return;
        }
    }
}


// Pass 2: 处理 application / unquote / quasiquote 节点
static void arn_rename_application(parser_ctx_t *ctx, am_handle_t handle, am_list_t *lst) {
    am_ast_t *ast = ctx->ast;
    if (lst->length == 0) return;

    am_value_t first = am_list_get(ast->alloc, lst, 0);
    if (am_value_is_symbol(first) &&
        (am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_import) ||
         am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_native))) {
        return;
    }

    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(ast->alloc, lst, i);
        if (am_value_is_varid(child)) {
            arn_rename_varid(ctx, handle, lst, i, 0);
            if (ctx->error) return;
        }
    }
}


// Pass 2: 节点遍历回调
static void arn_rename_iter_cb(am_handle_t handle, am_value_t value, void *user_data) {
    arn_rename_iter_t *data = (arn_rename_iter_t *)user_data;
    parser_ctx_t *ctx = data->ctx;

    if (ctx->error) return;
    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        arn_rename_lambda(ctx, handle, lst);
    }
    else if (lst->type == AM_LIST_TYPE_APPLICATION ||
             lst->type == AM_LIST_TYPE_QUASIQUOTE ||
             lst->type == AM_LIST_TYPE_UNQUOTE) {
        arn_rename_application(ctx, handle, lst);
    }
}


static void alpha_rename_analysis(parser_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return;
    am_ast_t *ast = ctx->ast;

    arn_lambda_collect_t lambdas = { ctx, NULL, 0, 0 };
    arn_define_collect_t defines = { ctx, NULL, 0, 0 };

    // Pass 1-1: 收集所有 lambda handle
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, arn_collect_lambda_cb, &lambdas);
    if (ctx->error) goto arn_cleanup;

    // Pass 1-2: 为每个 lambda 创建 scope
    if (arn_create_scopes(ctx, &lambdas) != 0) {
        if (!ctx->error) parser_set_error(ctx, L"failed to create scopes");
        goto arn_cleanup;
    }

    // Pass 1-3: 注册 lambda parameters
    for (size_t i = 0; i < lambdas.count; i++) {
        if (arn_add_lambda_params_to_scope(ctx, lambdas.handles[i]) != 0) {
            if (!ctx->error) parser_set_error(ctx, L"failed to add lambda params to scope");
            goto arn_cleanup;
        }
    }

    // Pass 1-4: 收集 define
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, arn_collect_defines_cb, &defines);
    if (ctx->error) goto arn_cleanup;

    // Pass 1-5: 注册 define 变量
    if (arn_add_defines_to_scope(ctx, &defines) != 0) {
        if (!ctx->error) parser_set_error(ctx, L"failed to add defines to scope");
        goto arn_cleanup;
    }

    // Pass 2: 执行变量换名
    arn_rename_iter_t rename_data = { ctx };
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, arn_rename_iter_cb, &rename_data);

arn_cleanup:
    arn_free_lambda_collect(&lambdas);
    arn_free_define_collect(&defines);
}


// ===============================================================================
// 清理 ARN 阶段遗留的 scope 对象
// ===============================================================================

typedef struct {
    parser_ctx_t *ctx;
    am_handle_t *scope_handles;
    size_t count;
    size_t capacity;
} arn_scope_cleanup_data_t;


static void arn_collect_scope_handles_cb(am_handle_t handle, am_value_t value, void *user_data) {
    arn_scope_cleanup_data_t *data = (arn_scope_cleanup_data_t *)user_data;
    parser_ctx_t *ctx = data->ctx;

    if (ctx->error) return;
    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_SCOPE) return;

    if (data->count >= data->capacity) {
        size_t new_cap = data->capacity ? data->capacity * 2 : 16;
        am_handle_t *new_arr = (am_handle_t *)realloc(data->scope_handles, new_cap * sizeof(am_handle_t));
        if (!new_arr) {
            parser_set_error(ctx, L"out of memory collecting scope handles");
            return;
        }
        data->scope_handles = new_arr;
        data->capacity = new_cap;
    }
    data->scope_handles[data->count++] = handle;
}


static void cleanup_scope_objects(parser_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return;

    arn_scope_cleanup_data_t data = { ctx, NULL, 0, 0 };
    am_heap_iter(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, arn_collect_scope_handles_cb, &data);

    if (!ctx->error) {
        for (size_t i = 0; i < data.count; i++) {
            am_heap_free_handle(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, data.scope_handles[i]);
        }
    }
    free(data.scope_handles);
}


// ===============================================================================
// 引用模块别名（alias）和外部引用（ext_ref）更名
// ===============================================================================

typedef struct {
    parser_ctx_t *ctx;
    am_varid_t *old_aliases;
    size_t old_aliases_capacity;
    size_t old_aliases_length;
} alias_rename_iter_data_t;

static int alias_rename_record_old_alias(alias_rename_iter_data_t *data, am_varid_t varid) {
    if (!data) return 0;
    if (data->old_aliases_length >= data->old_aliases_capacity) {
        size_t new_cap = data->old_aliases_capacity ? data->old_aliases_capacity * 2 : 8;
        am_varid_t *new_arr = (am_varid_t *)realloc(data->old_aliases, new_cap * sizeof(am_varid_t));
        if (!new_arr) return 0;
        data->old_aliases = new_arr;
        data->old_aliases_capacity = new_cap;
    }
    data->old_aliases[data->old_aliases_length++] = varid;
    return 1;
}

static void alias_rename_free_old_aliases(alias_rename_iter_data_t *data) {
    if (!data) return;
    free(data->old_aliases);
    data->old_aliases = NULL;
    data->old_aliases_capacity = 0;
    data->old_aliases_length = 0;
}

static void alias_rename_iter_cb(am_handle_t handle, am_value_t value, void *user_data) {
    (void)handle;
    alias_rename_iter_data_t *data = (alias_rename_iter_data_t *)user_data;
    parser_ctx_t *ctx = data->ctx;
    am_ast_t *ast = ctx->ast;

    if (!am_value_is_ptr(value)) return;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return;

    am_list_t *lst = (am_list_t *)obj;

    // (import <Alias> <Path>)
    if (lst->type == AM_LIST_TYPE_APPLICATION && lst->length == 3) {
        am_value_t first = am_list_get(ast->alloc, lst, 0);
        if (am_value_is_symbol(first) &&
            am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_import)) {
            am_value_t alias_val = am_list_get(ast->alloc, lst, 1);
            am_value_t path_handle_val = am_list_get(ast->alloc, lst, 2);

            if (!am_value_is_varid(alias_val) || !am_value_is_handle(path_handle_val)) {
                parser_set_error(ctx, L"invalid import syntax in alias rename");
                return;
            }

            am_varid_t old_alias_varid = am_value_to_varid(alias_val);
            am_varid_t new_alias_varid = am_ast_make_unique_module_alias(ast, old_alias_varid);
            if (new_alias_varid == SIZE_MAX) {
                parser_set_error(ctx, L"failed to create unique module alias");
                return;
            }

            if (am_list_set(ast->alloc, lst, 1, am_make_value_of_varid(new_alias_varid)) != 0) {
                parser_set_error(ctx, L"failed to set renamed import alias");
                return;
            }

            if (am_ast_set_dependency(ast, new_alias_varid, am_value_to_handle(path_handle_val)) < 0) {
                parser_set_error(ctx, L"failed to set dependency for renamed alias");
                return;
            }

            if (!alias_rename_record_old_alias(data, old_alias_varid)) {
                parser_set_error(ctx, L"out of memory recording old alias");
                return;
            }

            return; // import 节点本身不处理 children 中的 ext_ref
        }
    }

    // 其他节点：遍历 children，处理 AM_VAR_TYPE_EXT_REF 的 varid（IMPORT_REF 更名，NATIVE_REF 设置类型）
    for (size_t i = 0; i < lst->length; i++) {
        am_value_t child = am_list_get(ast->alloc, lst, i);
        if (!am_value_is_varid(child)) continue;

        am_varid_t varid = am_value_to_varid(child);
        am_value_t type_val = am_list_get(ast->alloc, ast->var_type, (size_t)varid);
        if (!am_value_is_uint(type_val)) continue;

        if (am_value_to_uint(type_val) != AM_VAR_TYPE_EXT_REF) continue;

        if (am_ast_check_native_ref(ast, varid) == 0) {
            if (am_list_set(ast->alloc, ast->var_type, (size_t)varid,
                            am_make_value_of_uint(AM_VAR_TYPE_NATIVE_REF)) != 0) {
                parser_set_error(ctx, L"failed to set native ref var type");
                return;
            }
            continue;
        }

        if (am_ast_check_import_ref(ast, varid) != 0) continue;

        am_varid_t new_varid = am_ast_make_unique_import_ref(ast, varid);
        if (new_varid == SIZE_MAX) {
            parser_set_error(ctx, L"failed to create unique import ref");
            return;
        }

        if (am_list_set(ast->alloc, lst, i, am_make_value_of_varid(new_varid)) != 0) {
            parser_set_error(ctx, L"failed to set renamed import ref");
            return;
        }
    }
}


static void alias_rename_analysis(parser_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return;
    alias_rename_iter_data_t data = { ctx, NULL, 0, 0 };
    am_heap_iter(ctx->ast->alloc, ctx->ast->alloc, ctx->ast->nodes, alias_rename_iter_cb, &data);

    if (!ctx->error) {
        for (size_t i = 0; i < data.old_aliases_length; i++) {
            am_map_delete(ctx->ast->alloc, ctx->ast->dependencies,
                          am_make_value_of_varid(data.old_aliases[i]));
        }
    }

    alias_rename_free_old_aliases(&data);
}


// ===============================================================================
// 设置顶层 lambda 与顶级变量列表
// ===============================================================================

static void populate_top_lambda_and_var_top(parser_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return;
    am_ast_t *ast = ctx->ast;

    // 清空 var_top，避免与 macro_rebuild_var_top 重复累积
    if (ast->var_top) {
        ast->var_top->length = 0;
    }

    ast->top_lambda_handle = am_ast_get_top_lambda_node_handle(ast);
    if (ast->top_lambda_handle == AM_HANDLE_NULL) {
        parser_set_error(ctx, L"failed to get top lambda handle");
        return;
    }

    am_value_t *bodies = am_ast_get_global_nodes(ast);
    if (!bodies) return;

    am_value_t lambda_val = am_ast_get_node(ast, ast->top_lambda_handle);
    if (!am_value_is_ptr(lambda_val)) {
        free(bodies);
        parser_set_error(ctx, L"top lambda node not found");
        return;
    }

    am_list_t *lambda = (am_list_t *)am_value_to_ptr(lambda_val);
    size_t n_body = am_list_lambda_get_body_number(ast->alloc, lambda);

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
        if (!am_value_is_symbol(first) ||
            am_value_to_symbol(first) != am_value_to_symbol(AM_VALUE_KW_define)) {
            continue;
        }

        am_value_t second = am_list_get(ast->alloc, lst, 1);
        if (!am_value_is_varid(second)) continue;

        if (am_ast_add_var_top(ast, am_value_to_varid(second)) < 0) {
            parser_set_error(ctx, L"failed to add top variable");
            break;
        }
    }

    free(bodies);
}


// ===============================================================================
// 尾位置分析
// ===============================================================================

static int32_t tail_call_analysis_item(am_ast_t *ast, am_value_t item, int is_tail);


static int32_t tail_call_analysis_application(am_ast_t *ast, am_handle_t handle, am_list_t *lst, int is_tail) {
    if (!ast || !lst) return -1;

    if (lst->length == 0) {
        if (is_tail) {
            if (am_ast_add_tailcall(ast, handle) != 0) return -1;
        }
        return 0;
    }

    am_value_t first = am_list_get(ast->alloc, lst, 0);

    // if 特殊构造: (if cond then else)
    if (am_value_is_symbol(first) &&
        am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_if)) {
        if (lst->length > 1) {
            if (tail_call_analysis_item(ast, am_list_get(ast->alloc, lst, 1), 0) != 0) return -1;
        }
        if (lst->length > 2) {
            if (tail_call_analysis_item(ast, am_list_get(ast->alloc, lst, 2), is_tail) != 0) return -1;
        }
        if (lst->length > 3) {
            if (tail_call_analysis_item(ast, am_list_get(ast->alloc, lst, 3), is_tail) != 0) return -1;
        }
    }
    // cond 特殊构造: (cond (c1 e1) (c2 e2) ...)
    else if (am_value_is_symbol(first) &&
             am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_cond)) {
        for (size_t i = 1; i < lst->length; i++) {
            am_value_t clause = am_list_get(ast->alloc, lst, i);
            if (!am_value_is_handle(clause)) continue;

            am_value_t clause_val = am_ast_get_node(ast, am_value_to_handle(clause));
            if (!am_value_is_ptr(clause_val)) continue;

            am_object_t *clause_obj = am_value_to_ptr(clause_val);
            if (clause_obj->type != AM_OBJECT_TYPE_LIST) continue;

            am_list_t *clause_lst = (am_list_t *)clause_obj;
            if (clause_lst->type != AM_LIST_TYPE_APPLICATION) continue;

            if (clause_lst->length > 0) {
                if (tail_call_analysis_item(ast, am_list_get(ast->alloc, clause_lst, 0), 0) != 0) return -1;
            }
            if (clause_lst->length > 1) {
                if (tail_call_analysis_item(ast, am_list_get(ast->alloc, clause_lst, 1), is_tail) != 0) return -1;
            }
        }
    }
    // 其他构造，含 begin、and、or
    else {
        int is_seq_form = am_value_is_symbol(first) &&
            (am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_begin) ||
             am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_and) ||
             am_value_to_symbol(first) == am_value_to_symbol(AM_VALUE_KW_or));

        for (size_t i = 0; i < lst->length; i++) {
            int child_is_tail = 0;
            if (is_seq_form && i == lst->length - 1) {
                child_is_tail = is_tail;
            }
            if (tail_call_analysis_item(ast, am_list_get(ast->alloc, lst, i), child_is_tail) != 0) return -1;
        }
    }

    if (is_tail) {
        if (am_ast_add_tailcall(ast, handle) != 0) return -1;
    }
    return 0;
}


static int32_t tail_call_analysis_item(am_ast_t *ast, am_value_t item, int is_tail) {
    if (!ast) return -1;
    if (!am_value_is_handle(item)) return 0;

    am_handle_t handle = am_value_to_handle(item);
    am_value_t node_val = am_ast_get_node(ast, handle);
    if (!am_value_is_ptr(node_val)) return 0;

    am_object_t *obj = am_value_to_ptr(node_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return 0;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->type == AM_LIST_TYPE_APPLICATION) {
        return tail_call_analysis_application(ast, handle, lst, is_tail);
    }
    else if (lst->type == AM_LIST_TYPE_LAMBDA) {
        size_t n_body = 0;
        am_value_t *bodies = am_list_lambda_get_bodies(ast->alloc, lst, &n_body);
        if (!bodies) return 0;

        int32_t result = 0;
        for (size_t i = 0; i < n_body; i++) {
            if (tail_call_analysis_item(ast, bodies[i], (i == n_body - 1) ? 1 : 0) != 0) {
                result = -1;
                break;
            }
        }
        free(bodies);
        return result;
    }
    // QUOTE / QUASIQUOTE / UNQUOTE 不进入深层分析（被引用的代码不参与执行）
    return 0;
}


// 对 AST 执行整体的尾位置分析。
// 调用前会清空 ast->tailcall_handles，因此可安全地重复调用。
int32_t am_parser_tail_call_analysis(am_ast_t *ast) {
    if (!ast) return -1;
    if (ast->tailcall_handles) {
        ast->tailcall_handles->length = 0;
    }

    am_handle_t top_app = am_ast_get_top_node_handle(ast);
    if (top_app == AM_HANDLE_NULL) return -1;

    return tail_call_analysis_item(ast, am_make_value_of_handle(top_app), 1);
}




// ===============================================================================
// 解析器入口
// ===============================================================================

am_ast_t *am_parse(am_allocator_t *alloc, wchar_t *code, wchar_t *absolute_path, int32_t is_keep_free) {
    if (!alloc || !code || !absolute_path) return NULL;

    // 词法分析
    size_t max_tokens = wcslen(code) + 1;
    am_token_t *tokens = (am_token_t *)am_calloc(alloc, max_tokens * sizeof(am_token_t));
    if (!tokens) return NULL;

    int32_t count = am_lexer(code, tokens);
    if (count < 0) {
        am_free(alloc, tokens);
        return NULL;
    }

    // 创建 AST
    am_ast_t *ast = am_ast_create(alloc, code, absolute_path, tokens, (size_t)count);
    if (!ast) {
        am_free(alloc, tokens);
        return NULL;
    }

    // 构建词汇表：symbol 预置所有关键字；变量在 parse_identifier 中按需注册，
    // 避免把 quote/quasiquote 内部的标识符错误加入 var_vocab。
    am_build_symbol_vocabulary(ast);

    // 初始化解析器上下文
    parser_ctx_t ctx;
    memset(&ctx, 0, sizeof(ctx));
    ctx.ast = ast;
    ctx.tokens = tokens;
    ctx.token_count = (size_t)count;
    ctx.is_keep_free = is_keep_free;

    // 初始栈：顶部为 TOP_NODE_HANDLE（已是编码后的 am_value_t）
    node_stack_push(&ctx, am_make_value_of_handle(AM_TOP_NODE_HANDLE));

    // 递归下降语法分析
    size_t final_index = parse_term(&ctx, 0);

    if (ctx.error || final_index != ctx.token_count) {
        if (!ctx.error) {
            parser_set_error(&ctx, L"trailing tokens after parse");
        }
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // 预处理指令解析
    preprocess_analysis(&ctx);
    if (ctx.error) {
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // 引用模块别名（alias）和外部引用（ext_ref）更名
    alias_rename_analysis(&ctx);
    if (ctx.error) {
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // Alpha-renaming（两阶段变量换名）
    alpha_rename_analysis(&ctx);
    if (ctx.error) {
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // syntax-rules 卫生宏展开
    if (am_macro_expand(ast) != 0) {
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // 清理 ARN 阶段遗留的 scope 对象
    cleanup_scope_objects(&ctx);
    if (ctx.error) {
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    // 设置顶层 lambda 与顶级变量列表
    populate_top_lambda_and_var_top(&ctx);
    if (ctx.error) {
        fprintf(stderr, "[Parser Error] %ls\n", ctx.error_msg);
        free(ctx.node_stack);
        free(ctx.state_stack);
        free(ctx.lambda_stack);
        free(ctx.special_app_stack);
        am_ast_destroy(ast);
        am_free(alloc, tokens);
        return NULL;
    }

    free(ctx.node_stack);
    free(ctx.state_stack);
    free(ctx.lambda_stack);
    free(ctx.special_app_stack);
    return ast;
}
