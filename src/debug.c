#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <assert.h>
#include <wchar.h>

#include "debug.h"
#include "ast.h"
#include "object.h"
#include "list.h"
#include "vocab.h"
#include "map.h"
#include "heap.h"
#include "wstring.h"


#define AST_PRINT_INDENT 2


static void debug_ast_print_indent(FILE *out, int depth) {
    for (int i = 0; i < depth * AST_PRINT_INDENT; i++) {
        fputwc(L' ', out);
    }
}


static int debug_ast_is_handle_visited(am_handle_t *visited, size_t count, am_handle_t handle) {
    for (size_t i = 0; i < count; i++) {
        if (visited[i] == handle) return 1;
    }
    return 0;
}


static void debug_ast_print_value(am_ast_t *ast, am_value_t value, FILE *out,
                                  am_handle_t **visited, size_t *visited_count, size_t *visited_capacity, int depth);


static void debug_ast_print_ensure_visited_capacity(am_handle_t **visited, size_t *visited_capacity, size_t visited_count) {
    if (visited_count < *visited_capacity) return;
    size_t new_capacity = *visited_capacity ? *visited_capacity * 2 : 256;
    if (new_capacity < visited_count + 1) new_capacity = visited_count + 1;
    am_handle_t *new_visited = (am_handle_t *)realloc(*visited, new_capacity * sizeof(am_handle_t));
    if (!new_visited) {
        fprintf(stderr, "debug_ast_print: failed to allocate visited buffer\n");
        return;
    }
    *visited = new_visited;
    *visited_capacity = new_capacity;
}


static void debug_ast_print_node(am_ast_t *ast, am_handle_t handle, FILE *out,
                                 am_handle_t **visited, size_t *visited_count, size_t *visited_capacity, int depth) {
    am_value_t node_val = am_ast_get_node(ast, handle);
    if (!am_value_is_ptr(node_val)) {
        fwprintf(out, L"<H:%zu> (invalid)", (size_t)handle);
        return;
    }

    am_object_t *obj = am_value_to_ptr(node_val);

    if (obj->type == AM_OBJECT_TYPE_WSTRING) {
        am_wstring_t *ws = (am_wstring_t *)obj;
        fputwc(L'"', out);
        for (size_t i = 0; i < ws->length; i++) {
            wchar_t c = (wchar_t)am_value_to_wchar(ws->content[i]);
            if (c == L'"') fputwc(L'\\', out);
            fwprintf(out, L"%lc", c);
        }
        fputwc(L'"', out);
        return;
    }

    if (obj->type != AM_OBJECT_TYPE_LIST) {
        fwprintf(out, L"<H:%zu> (unknown type %d)", (size_t)handle, obj->type);
        return;
    }

    am_list_t *lst = (am_list_t *)obj;

    if (debug_ast_is_handle_visited(*visited, *visited_count, handle)) {
        fwprintf(out, L"<H:%zu>", (size_t)handle);
        return;
    }
    debug_ast_print_ensure_visited_capacity(visited, visited_capacity, *visited_count);
    (*visited)[(*visited_count)++] = handle;

    fwprintf(out, L"<H:%zu> {\n", (size_t)handle);
    debug_ast_print_indent(out, depth + 1);
    fwprintf(out, L"type: ");
    switch (lst->type) {
        case AM_LIST_TYPE_LAMBDA:      fwprintf(out, L"\"LAMBDA\"\n"); break;
        case AM_LIST_TYPE_APPLICATION: fwprintf(out, L"\"APPLICATION\"\n"); break;
        case AM_LIST_TYPE_QUOTE:       fwprintf(out, L"\"QUOTE\"\n"); break;
        case AM_LIST_TYPE_QUASIQUOTE:  fwprintf(out, L"\"QUASIQUOTE\"\n"); break;
        case AM_LIST_TYPE_UNQUOTE:     fwprintf(out, L"\"UNQUOTE\"\n"); break;
        default:                       fwprintf(out, L"\"UNKNOWN(%d)\"\n", lst->type); break;
    }

    debug_ast_print_indent(out, depth + 1);
    if (lst->parent == AM_HANDLE_NULL) {
        fwprintf(out, L"parent: null\n");
    }
    else {
        fwprintf(out, L"parent: <H:%zu>\n", (size_t)lst->parent);
    }

    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        am_uint_t n_param = 0;
        if (lst->length >= 2) {
            am_value_t np = am_list_get(ast->alloc, lst, 1);
            if (am_value_is_uint(np)) n_param = am_value_to_uint(np);
        }

        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"parameters: [\n");
        for (am_uint_t i = 0; i < n_param; i++) {
            debug_ast_print_indent(out, depth + 2);
            am_value_t param = am_list_get(ast->alloc, lst, 2 + i);
            debug_ast_print_value(ast, param, out, visited, visited_count, visited_capacity, depth + 2);
            if (i + 1 < n_param) fputwc(L',', out);
            fputwc(L'\n', out);
        }
        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"]\n");

        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"bodies: [\n");
        size_t body_start = 2 + n_param;
        for (size_t i = body_start; i < lst->length; i++) {
            debug_ast_print_indent(out, depth + 2);
            am_value_t body = am_list_get(ast->alloc, lst, i);
            debug_ast_print_value(ast, body, out, visited, visited_count, visited_capacity, depth + 2);
            if (i + 1 < lst->length) fputwc(L',', out);
            fputwc(L'\n', out);
        }
        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"]\n");
    }
    else {
        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"children: [\n");
        for (size_t i = 0; i < lst->length; i++) {
            debug_ast_print_indent(out, depth + 2);
            am_value_t child = am_list_get(ast->alloc, lst, i);
            debug_ast_print_value(ast, child, out, visited, visited_count, visited_capacity, depth + 2);
            if (i + 1 < lst->length) fputwc(L',', out);
            fputwc(L'\n', out);
        }
        debug_ast_print_indent(out, depth + 1);
        fwprintf(out, L"]\n");
    }

    debug_ast_print_indent(out, depth);
    fwprintf(out, L"}");
}


static void debug_ast_print_value(am_ast_t *ast, am_value_t value, FILE *out,
                                  am_handle_t **visited, size_t *visited_count, size_t *visited_capacity, int depth) {
    if (am_value_is_handle(value)) {
        am_handle_t h = am_value_to_handle(value);
        debug_ast_print_node(ast, h, out, visited, visited_count, visited_capacity, depth);
    }
    else if (am_value_is_varid(value)) {
        am_varid_t varid = am_value_to_varid(value);
        size_t idx = (size_t)varid;
        wchar_t *name = am_vocab_get(ast->alloc, ast->var_vocab, &idx);
        if (name) {
            fwprintf(out, L"\"%ls\" (varid=%zu)", name, (size_t)varid);
        }
        else {
            fwprintf(out, L"<varid=%zu>", (size_t)varid);
        }
    }
    else if (am_value_is_symbol(value)) {
        am_symbol_t sym = am_value_to_symbol(value);
        size_t idx = (size_t)sym;
        wchar_t *name = am_vocab_get(ast->alloc, ast->symbol_vocab, &idx);
        if (name) {
            fwprintf(out, L"\"%ls\" (symbol=%zu)", name, (size_t)sym);
        }
        else {
            fwprintf(out, L"<symbol=%zu>", (size_t)sym);
        }
    }
    else if (am_value_is_uint(value)) {
        fwprintf(out, L"%llu", (unsigned long long)am_value_to_uint(value));
    }
    else if (am_value_is_int(value)) {
        fwprintf(out, L"%lld", (long long)am_value_to_int(value));
    }
    else if (am_value_is_float(value)) {
        fwprintf(out, L"%g", (double)am_value_to_float(value));
    }
    else if (am_value_is_boolean(value)) {
        fwprintf(out, L"%ls", am_value_to_boolean(value) ? L"#t" : L"#f");
    }
    else if (am_value_is_null(value)) {
        fwprintf(out, L"#null");
    }
    else if (am_value_is_undefined(value)) {
        fwprintf(out, L"#undefined");
    }
    else {
        fwprintf(out, L"<value=%llu>", (unsigned long long)value);
    }
}


static void debug_ast_print_vocab(FILE *out, am_ast_t *ast, am_vocab_t *vocab) {
    fputwc(L'[', out);
    for (size_t i = 0; i < vocab->length; i++) {
        size_t idx = i;
        wchar_t *word = am_vocab_get(ast->alloc, vocab, &idx);
        if (i > 0) fwprintf(out, L", ");
        if (word) {
            fputwc(L'"', out);
            fwprintf(out, L"%ls", word);
            fputwc(L'"', out);
        }
        else {
            fwprintf(out, L"null");
        }
    }
    fputwc(L']', out);
}


static void debug_ast_print_handle_list(FILE *out, am_ast_t *ast, am_list_t *lst) {
    (void)ast;
    fputwc(L'[', out);
    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) fwprintf(out, L", ");
        fwprintf(out, L"<H:%zu>", (size_t)am_value_to_handle(am_list_get(ast->alloc, lst, i)));
    }
    fputwc(L']', out);
}


static void debug_ast_print_value_inline(am_ast_t *ast, am_value_t value, FILE *out);


static void debug_ast_print_value_list(FILE *out, am_ast_t *ast, am_list_t *lst) {
    fputwc(L'[', out);
    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) fwprintf(out, L", ");
        debug_ast_print_value_inline(ast, am_list_get(ast->alloc, lst, i), out);
    }
    fputwc(L']', out);
}


static void debug_ast_print_map_varid_to_handle(FILE *out, am_ast_t *ast, am_map_t *map) {
    fputwc(L'{', out);
    size_t count = am_map_length(ast->alloc, map);
    am_value_t *keys = am_map_keys(ast->alloc, map);
    for (size_t i = 0; i < count; i++) {
        if (i > 0) fwprintf(out, L", ");
        am_varid_t varid = am_value_to_varid(keys[i]);
        size_t idx = (size_t)varid;
        wchar_t *name = am_vocab_get(ast->alloc, ast->var_vocab, &idx);
        if (name) fwprintf(out, L"\"%ls\": ", name);
        else fwprintf(out, L"<varid=%zu>: ", (size_t)varid);

        am_value_t v = am_map_get(ast->alloc, map, keys[i]);
        if (am_value_is_handle(v)) {
            fwprintf(out, L"<H:%zu>", (size_t)am_value_to_handle(v));
        }
        else {
            fwprintf(out, L"null");
        }
    }
    if (keys) am_free(ast->alloc, keys);
    fputwc(L'}', out);
}


static const wchar_t *debug_var_type_name(am_uint_t type) {
    switch (type) {
        case AM_VAR_TYPE_OLD:          return L"OLD";
        case AM_VAR_TYPE_NEW:          return L"NEW";
        case AM_VAR_TYPE_BUILTIN:      return L"BUILTIN";
        case AM_VAR_TYPE_EXT_REF:      return L"EXT_REF";
        case AM_VAR_TYPE_IMPORT_REF:   return L"IMPORT_REF";
        case AM_VAR_TYPE_NATIVE_REF:   return L"NATIVE_REF";
        case AM_VAR_TYPE_IMPORT_ALIAS: return L"IMPORT_ALIAS";
        case AM_VAR_TYPE_NATIVE_ID:    return L"NATIVE_ID";
        default:                       return L"UNKNOWN";
    }
}


static void debug_ast_print_var_type(FILE *out, am_ast_t *ast, am_list_t *lst) {
    (void)ast;
    fputwc(L'[', out);
    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) fwprintf(out, L", ");
        am_value_t v = am_list_get(ast->alloc, lst, i);
        if (am_value_is_uint(v)) {
            am_uint_t t = am_value_to_uint(v);
            fwprintf(out, L"%ls(%zu)", debug_var_type_name(t), (size_t)t);
        }
        else {
            fwprintf(out, L"?");
        }
    }
    fputwc(L']', out);
}


static void debug_ast_print_var_arn_mapping(FILE *out, am_ast_t *ast, am_map_t *map) {
    fputwc(L'{', out);
    size_t count = am_map_length(ast->alloc, map);
    am_value_t *keys = am_map_keys(ast->alloc, map);
    for (size_t i = 0; i < count; i++) {
        if (i > 0) fwprintf(out, L", ");
        am_varid_t new_varid = am_value_to_varid(keys[i]);
        size_t new_idx = (size_t)new_varid;
        wchar_t *new_name = am_vocab_get(ast->alloc, ast->var_vocab, &new_idx);
        if (new_name) fwprintf(out, L"\"%ls\": ", new_name);
        else fwprintf(out, L"<varid=%zu>: ", (size_t)new_varid);

        am_value_t v = am_map_get(ast->alloc, map, keys[i]);
        if (am_value_is_varid(v)) {
            am_varid_t old_varid = am_value_to_varid(v);
            size_t old_idx = (size_t)old_varid;
            wchar_t *old_name = am_vocab_get(ast->alloc, ast->var_vocab, &old_idx);
            if (old_name) fwprintf(out, L"\"%ls\"", old_name);
            else fwprintf(out, L"<varid=%zu>", (size_t)old_varid);
        }
        else {
            fwprintf(out, L"null");
        }
    }
    if (keys) am_free(ast->alloc, keys);
    fputwc(L'}', out);
}


static void debug_ast_print_value_inline(am_ast_t *ast, am_value_t value, FILE *out) {
    if (am_value_is_handle(value)) {
        fwprintf(out, L"<H:%zu>", (size_t)am_value_to_handle(value));
    }
    else if (am_value_is_varid(value)) {
        am_varid_t varid = am_value_to_varid(value);
        size_t idx = (size_t)varid;
        wchar_t *name = am_vocab_get(ast->alloc, ast->var_vocab, &idx);
        if (name) fwprintf(out, L"\"%ls\"", name);
        else fwprintf(out, L"<varid=%zu>", (size_t)varid);
    }
    else if (am_value_is_symbol(value)) {
        am_symbol_t sym = am_value_to_symbol(value);
        size_t idx = (size_t)sym;
        wchar_t *name = am_vocab_get(ast->alloc, ast->symbol_vocab, &idx);
        if (name) fwprintf(out, L"\"%ls\"", name);
        else fwprintf(out, L"<symbol=%zu>", (size_t)sym);
    }
    else if (am_value_is_uint(value)) {
        fwprintf(out, L"%llu", (unsigned long long)am_value_to_uint(value));
    }
    else if (am_value_is_int(value)) {
        fwprintf(out, L"%lld", (long long)am_value_to_int(value));
    }
    else if (am_value_is_float(value)) {
        fwprintf(out, L"%g", (double)am_value_to_float(value));
    }
    else if (am_value_is_boolean(value)) {
        fwprintf(out, L"%ls", am_value_to_boolean(value) ? L"#t" : L"#f");
    }
    else if (am_value_is_null(value)) {
        fwprintf(out, L"#null");
    }
    else if (am_value_is_undefined(value)) {
        fwprintf(out, L"#undefined");
    }
    else {
        fwprintf(out, L"<value=%llu>", (unsigned long long)value);
    }
}


void am_debug_ast_print_node_summary(FILE *out, am_ast_t *ast, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ast, handle);
    if (!am_value_is_ptr(node_val)) {
        fwprintf(out, L"<H:%zu>: (invalid)\n", (size_t)handle);
        return;
    }

    am_object_t *obj = am_value_to_ptr(node_val);
    if (obj->type == AM_OBJECT_TYPE_WSTRING) {
        am_wstring_t *ws = (am_wstring_t *)obj;
        fwprintf(out, L"<H:%zu>: WSTRING len=%zu \"", (size_t)handle, ws->length);
        for (size_t i = 0; i < ws->length; i++) {
            wchar_t c = (wchar_t)am_value_to_wchar(ws->content[i]);
            if (c == L'"') fputwc(L'\\', out);
            fwprintf(out, L"%lc", c);
        }
        fwprintf(out, L"\"\n");
        return;
    }

    if (obj->type != AM_OBJECT_TYPE_LIST) {
        fwprintf(out, L"<H:%zu>: (unknown type %d)\n", (size_t)handle, obj->type);
        return;
    }

    am_list_t *lst = (am_list_t *)obj;
    const wchar_t *type_name = L"UNKNOWN";
    switch (lst->type) {
        case AM_LIST_TYPE_LAMBDA:      type_name = L"LAMBDA"; break;
        case AM_LIST_TYPE_APPLICATION: type_name = L"APPLICATION"; break;
        case AM_LIST_TYPE_QUOTE:       type_name = L"QUOTE"; break;
        case AM_LIST_TYPE_QUASIQUOTE:  type_name = L"QUASIQUOTE"; break;
        case AM_LIST_TYPE_UNQUOTE:     type_name = L"UNQUOTE"; break;
    }

    fwprintf(out, L"<H:%zu>: %ls parent=", (size_t)handle, type_name);
    if (lst->parent == AM_HANDLE_NULL) {
        fwprintf(out, L"null");
    }
    else {
        fwprintf(out, L"<H:%zu>", (size_t)lst->parent);
    }

    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        am_uint_t n_param = 0;
        if (lst->length >= 2) {
            am_value_t np = am_list_get(ast->alloc, lst, 1);
            if (am_value_is_uint(np)) n_param = am_value_to_uint(np);
        }
        size_t n_body = (lst->length > 2 + n_param) ? (lst->length - 2 - n_param) : 0;
        fwprintf(out, L" params=%u bodies=%zu", (unsigned)n_param, n_body);
    }
    else {
        fwprintf(out, L" length=%zu", lst->length);
    }

    fwprintf(out, L" children=[");
    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) fwprintf(out, L", ");
        debug_ast_print_value_inline(ast, am_list_get(ast->alloc, lst, i), out);
    }
    fwprintf(out, L"]\n");
}


typedef struct {
    am_handle_t *handles;
    size_t count;
    size_t capacity;
} debug_ast_collect_handles_ctx_t;


static void debug_ast_collect_handles_cb(am_handle_t handle, am_value_t value, void *user_data) {
    (void)value;
    debug_ast_collect_handles_ctx_t *ctx = (debug_ast_collect_handles_ctx_t *)user_data;

    if (ctx->count >= ctx->capacity) {
        size_t new_capacity = ctx->capacity ? ctx->capacity * 2 : 16;
        am_handle_t *new_handles = (am_handle_t *)realloc(ctx->handles, new_capacity * sizeof(am_handle_t));
        if (!new_handles) return;
        ctx->handles = new_handles;
        ctx->capacity = new_capacity;
    }

    ctx->handles[ctx->count++] = handle;
}


static int debug_ast_compare_handles(const void *a, const void *b) {
    am_handle_t ha = *(const am_handle_t *)a;
    am_handle_t hb = *(const am_handle_t *)b;
    if (ha < hb) return -1;
    if (ha > hb) return 1;
    return 0;
}


static void debug_ast_print_nodes_map(FILE *out, am_ast_t *ast) {
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"nodes: {\n");

    debug_ast_collect_handles_ctx_t ctx = { NULL, 0, 0 };
    am_heap_iter(ast->alloc, ast->alloc, ast->nodes, debug_ast_collect_handles_cb, &ctx);

    if (ctx.handles) {
        qsort(ctx.handles, ctx.count, sizeof(am_handle_t), debug_ast_compare_handles);
        for (size_t i = 0; i < ctx.count; i++) {
            debug_ast_print_indent(out, 2);
            am_debug_ast_print_node_summary(out, ast, ctx.handles[i]);
        }
        free(ctx.handles);
    }

    debug_ast_print_indent(out, 1);
    fwprintf(out, L"}\n");
}


void am_debug_ast_print(FILE *out, am_ast_t *ast) {
    if (!ast) {
        fwprintf(out, L"null\n");
        return;
    }

    size_t visited_capacity = 256;
    am_handle_t *visited = (am_handle_t *)malloc(visited_capacity * sizeof(am_handle_t));
    if (!visited) {
        fwprintf(out, L"(failed to allocate visited buffer)\n");
        return;
    }
    size_t visited_count = 0;
    (void)visited_count;

    fwprintf(out, L"AST {\n");
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"absolute_path: \"%ls\"\n", ast->absolute_path ? ast->absolute_path : L"(null)");
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"module_id: \"%ls\"\n", ast->module_id ? ast->module_id : L"(null)");
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"top_lambda_handle: <H:%zu>\n", (size_t)ast->top_lambda_handle);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"token_count: %zu\n", ast->token_count);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"symbol_vocab: ");
    debug_ast_print_vocab(out, ast, ast->symbol_vocab);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"var_vocab: ");
    debug_ast_print_vocab(out, ast, ast->var_vocab);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"var_type: ");
    debug_ast_print_var_type(out, ast, ast->var_type);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"var_arn_mapping: ");
    debug_ast_print_var_arn_mapping(out, ast, ast->var_arn_mapping);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"lambda_handles: ");
    debug_ast_print_handle_list(out, ast, ast->lambda_handles);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"tailcall_handles: ");
    debug_ast_print_handle_list(out, ast, ast->tailcall_handles);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"var_top: ");
    debug_ast_print_value_list(out, ast, ast->var_top);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"dependencies: ");
    debug_ast_print_map_varid_to_handle(out, ast, ast->dependencies);
    fputwc(L'\n', out);
    debug_ast_print_indent(out, 1);
    fwprintf(out, L"natives: ");
    debug_ast_print_map_varid_to_handle(out, ast, ast->natives);
    fputwc(L'\n', out);

    debug_ast_print_nodes_map(out, ast);

    // debug_ast_print_indent(out, 1);
    // fwprintf(out, L"top_node: ");
    // am_handle_t top = am_ast_get_top_node_handle(ast);
    // if (top == AM_HANDLE_NULL) {
    //     fwprintf(out, L"null\n");
    // }
    // else {
    //     fputwc(L'\n', out);
    //     debug_ast_print_node(ast, top, out, &visited, &visited_count, &visited_capacity, 2);
    //     fputwc(L'\n', out);
    // }

    free(visited);
    fwprintf(out, L"}\n");
}


void am_debug_ast_print_to_stdout(am_ast_t *ast) {
    FILE *out = tmpfile();
    assert(out != NULL);

    am_debug_ast_print(out, ast);
    rewind(out);

    size_t cap = 4096;
    size_t len = 0;
    wchar_t *buf = (wchar_t *)malloc(cap * sizeof(wchar_t));
    assert(buf != NULL);

    wint_t c;
    while ((c = fgetwc(out)) != WEOF) {
        if (len + 1 >= cap) {
            cap *= 2;
            wchar_t *new_buf = (wchar_t *)realloc(buf, cap * sizeof(wchar_t));
            if (!new_buf) {
                free(buf);
                fclose(out);
                return;
            }
            buf = new_buf;
        }
        buf[len++] = (wchar_t)c;
    }
    buf[len] = L'\0';
    fclose(out);

    printf("\n%ls\n", buf);
    free(buf);
}


// ===============================================================================
// 中间语言指令（IL Code）打印辅助
// ===============================================================================

const char *am_debug_opcode_name(uint32_t opcode) {
    switch (opcode) {
        case AM_VM_OP_nop:         return "nop";
        case AM_VM_OP_store:       return "store";
        case AM_VM_OP_load:        return "load";
        case AM_VM_OP_loadclosure: return "loadclosure";
        case AM_VM_OP_push:        return "push";
        case AM_VM_OP_pop:         return "pop";
        case AM_VM_OP_swap:        return "swap";
        case AM_VM_OP_set:         return "set";
        case AM_VM_OP_call:        return "call";
        case AM_VM_OP_callnative:  return "callnative";
        case AM_VM_OP_tailcall:    return "tailcall";
        case AM_VM_OP_return:      return "return";
        case AM_VM_OP_capturecc:   return "capturecc";
        case AM_VM_OP_iftrue:      return "iftrue";
        case AM_VM_OP_iffalse:     return "iffalse";
        case AM_VM_OP_goto:        return "goto";
        case AM_VM_OP_read:        return "read";
        case AM_VM_OP_write:       return "write";
        case AM_VM_OP_pause:       return "pause";
        case AM_VM_OP_halt:        return "halt";
        case AM_VM_OP_fork:        return "fork";
        case AM_VM_OP_display:     return "display";
        case AM_VM_OP_newline:     return "newline";
        case AM_VM_OP_add:         return "add";
        case AM_VM_OP_sub:         return "sub";
        case AM_VM_OP_mul:         return "mul";
        case AM_VM_OP_div:         return "div";
        case AM_VM_OP_mod:         return "mod";
        case AM_VM_OP_eq:          return "eq";
        case AM_VM_OP_eqv:         return "eqv";
        case AM_VM_OP_equal:       return "equal";
        case AM_VM_OP_ge:          return "ge";
        case AM_VM_OP_le:          return "le";
        case AM_VM_OP_gt:          return "gt";
        case AM_VM_OP_lt:          return "lt";
        case AM_VM_OP_not:         return "not";
        case AM_VM_OP_and:         return "and";
        case AM_VM_OP_or:          return "or";
        case AM_VM_OP_typeof:      return "typeof";
        case AM_VM_OP_car:         return "car";
        case AM_VM_OP_cdr:         return "cdr";
        case AM_VM_OP_cons:        return "cons";
        case AM_VM_OP_get_item:    return "get_item";
        case AM_VM_OP_set_item:    return "set_item";
        case AM_VM_OP_list_push:   return "list_push";
        case AM_VM_OP_list_pop:    return "list_pop";
        case AM_VM_OP_length:      return "length";
        case AM_VM_OP_concat:      return "concat";
        case AM_VM_OP_duplicate:   return "duplicate";
        case AM_VM_OP_evalcleanup: return "evalcleanup";
        case AM_VM_OP_dynamicwind:              return "dynamicwind";
        case AM_VM_OP_dynamicwind_after_before: return "dynamicwind_after_before";
        case AM_VM_OP_dynamicwind_before_after: return "dynamicwind_before_after";
        case AM_VM_OP_dynamicwind_done:         return "dynamicwind_done";
        case AM_VM_OP_wind:                     return "wind";
        default:                   return "?";
    }
}


void am_debug_print_operand(am_ast_t *ast, am_value_t op) {
    if (!ast) {
        printf("?");
        return;
    }

    if (am_value_is_varid(op)) {
        am_varid_t v = am_value_to_varid(op);
        wchar_t *name = am_vocab_get(ast->alloc, ast->var_vocab, &v);
        printf("%ls(%zu)", name ? name : L"?", (size_t)v);
    }
    else if (am_value_is_handle(op)) {
        printf("handle_%zu", am_value_to_handle(op));
    }
    else if (am_value_is_iaddr(op)) {
        printf("iaddr_%zu", am_value_to_iaddr(op));
    }
    else if (am_value_is_label(op)) {
        printf("label_%zu", am_value_to_label(op));
    }
    else if (am_value_is_symbol(op)) {
        am_symbol_t s = am_value_to_symbol(op);
        wchar_t *name = am_vocab_get(ast->alloc, ast->symbol_vocab, &s);
        printf("%ls", name ? name : L"?");
    }
    else if (am_value_is_uint(op)) {
        printf("%llu", (unsigned long long)am_value_to_uint(op));
    }
    else if (am_value_is_int(op)) {
        printf("%lld", (long long)am_value_to_int(op));
    }
    else if (am_value_is_float(op)) {
        printf("%g", (double)am_value_to_float(op));
    }
    else if (am_value_is_boolean(op)) {
        printf("%s", am_value_to_boolean(op) ? "#t" : "#f");
    }
    else if (am_value_is_null(op)) {
        printf("#null");
    }
    else if (am_value_is_undefined(op)) {
        printf("#undefined");
    }
    else {
        printf("?");
    }
}


void am_debug_print_ilcode(am_ast_t *ast, am_instruction_t *ilcode, am_iaddr_t icount) {
    if (!ilcode) return;

    for (am_iaddr_t i = 0; i < icount; i++) {
        printf("[%4zu] %-12s", (size_t)i, am_debug_opcode_name(ilcode[i].opcode));
        if (!am_value_is_undefined(ilcode[i].operand)) {
            printf(" ");
            am_debug_print_operand(ast, ilcode[i].operand);
        }
        printf("\n");
    }
}


void am_debug_print_ilcode_raw(am_instruction_t *ilcode, am_iaddr_t icount) {
    if (!ilcode) return;

    for (am_iaddr_t i = 0; i < icount; i++) {
        printf("[%4zu] %-12s operand=%016llx\n",
               (size_t)i,
               am_debug_opcode_name(ilcode[i].opcode),
               (unsigned long long)ilcode[i].operand);
    }
}
