#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <locale.h>
#include <assert.h>

#include "utils.h"
#include "parser.h"
#include "linker.h"
#include "compiler.h"
#include "module.h"
#include "process.h"
#include "runtime.h"
#include "debug.h"
#include "ast.h"
#include "highlight.h"
#include "js2scm.h"

#include "native_System.h"
#include "native_Math.h"
#include "native_String.h"
#include "native_LLM.h"
#include "native_Table.h"

// 打印 token 类型名称
const wchar_t* type_name(int32_t type) {
    switch(type) {
        case AM_TOKEN_TYPE_DELIMITER: return L"SEP";
        case AM_TOKEN_TYPE_LB: return L"LB";
        case AM_TOKEN_TYPE_RB: return L"RB";
        case AM_TOKEN_TYPE_KEYWORD: return L"KEYWORD";
        case AM_TOKEN_TYPE_BOOLEAN: return L"BOOLEAN";
        case AM_TOKEN_TYPE_UNDEFINED: return L"UNDEFINED";
        case AM_TOKEN_TYPE_NULL: return L"NULL";
        case AM_TOKEN_TYPE_NUMBER: return L"NUMBER";
        case AM_TOKEN_TYPE_SYMBOL: return L"SYMBOL";
        case AM_TOKEN_TYPE_IDENTIFIER: return L"IDENTIFIER";
        case AM_TOKEN_TYPE_STRING: return L"STRING";
        case AM_TOKEN_TYPE_QUOTE: return L"QUOTE";
        case AM_TOKEN_TYPE_QUASIQUOTE: return L"QUASIQUOTE";
        case AM_TOKEN_TYPE_UNQUOTE: return L"UNQUOTE";
        default: return L"UNEXPECTED";
    }
}

// ===============================================================================
// 基础设施：基于统一内存池的双分配器
// ===============================================================================


#ifndef AM_ALLOCATOR_POOL_SIZE
#define AM_ALLOCATOR_POOL_SIZE ((size_t)(256ULL * 1024 * 1024))
#endif


static am_allocator_pool_t *g_pool = NULL;
static am_allocator_t *vm_alloc = NULL;
static am_allocator_t *heap_alloc = NULL;


// ===============================================================================
// 辅助函数
// ===============================================================================

static int test_halt_called = 0;

static void on_halt(am_runtime_t *rt) {
    (void)rt;
    test_halt_called = 1;
}

static void on_error(am_runtime_t *rt) {
    (void)rt;
    // TODO
    return;
}

static void on_tick(am_runtime_t *rt) {
    if (!rt || !rt->output_fifo || !rt->error_fifo) return;

    while (rt->output_fifo->length > 0) {
        am_value_t v = am_list_shift(rt->vm_alloc, rt->output_fifo);
        if (am_value_is_wchar(v)) {
            printf("%lc", (wchar_t)am_value_to_wchar(v));
        }
    }

    while (rt->error_fifo->length > 0) {
        am_value_t v = am_list_shift(rt->vm_alloc, rt->error_fifo);
        if (am_value_is_wchar(v)) {
            printf("%lc", (wchar_t)am_value_to_wchar(v));
        }
    }

    fflush(stdout);
}



// ===============================================================================
// 文件读取辅助函数
// ===============================================================================

static wchar_t *read_file_as_wstring(const wchar_t *path) {
    size_t path_len = wcstombs(NULL, path, 0);
    if (path_len == (size_t)-1) return NULL;

    char *mb_path = (char *)malloc(path_len + 1);
    if (!mb_path) return NULL;
    wcstombs(mb_path, path, path_len + 1);

    FILE *f = fopen(mb_path, "rb");
    free(mb_path);
    if (!f) return NULL;

    if (fseek(f, 0, SEEK_END) != 0) { fclose(f); return NULL; }
    long size = ftell(f);
    if (size < 0) { fclose(f); return NULL; }
    fseek(f, 0, SEEK_SET);

    char *buf = (char *)malloc((size_t)size + 1);
    if (!buf) { fclose(f); return NULL; }

    size_t n = fread(buf, 1, (size_t)size, f);
    fclose(f);
    buf[n] = '\0';

    size_t wlen = mbstowcs(NULL, buf, 0);
    if (wlen == (size_t)-1) { free(buf); return NULL; }

    wchar_t *wbuf = (wchar_t *)malloc(((size_t)wlen + 1) * sizeof(wchar_t));
    if (!wbuf) { free(buf); return NULL; }
    mbstowcs(wbuf, buf, wlen + 1);
    free(buf);
    return wbuf;
}


// ===============================================================================
// 运行时测试
// ===============================================================================


static void test_runtime_load_from_wstring(wchar_t *code, char *path) {
    printf("test_runtime_load_from_string ... \n");
    test_halt_called = 0;

    char *base_dir_owned = am_path_dirname((char*)path);
    char *base_dir = base_dir_owned ? base_dir_owned : ".";

    wchar_t *path_w = (wchar_t *)am_malloc(vm_alloc, 256 * sizeof(wchar_t));
    wchar_t *base_dir_w = (wchar_t *)am_malloc(vm_alloc, 256 * sizeof(wchar_t));

    am_mbstowcs(path_w, path, 256);
    am_mbstowcs(base_dir_w, base_dir, 256);

    am_ast_t *ast = am_parse(vm_alloc, code, path_w, 0);
    assert(ast != NULL);

    // for (int32_t i = 0; i < ast->token_count; i++) {
    //     printf("[%4d] %12ls @%5zu+%3zu  %ls\n", 
    //         i, type_name(ast->tokens[i].type), 
    //         ast->tokens[i].index, ast->tokens[i].length,
    //         token_text(&(ast->tokens)[i], code));
    // }

    // printf("\033[1m=== 语法高亮输出 ===\033[0m\n");
    // am_print_highlighted(code, ast->tokens, ast->token_count);

    am_ast_t *linked = am_link(ast, base_dir_w);
    assert(linked != NULL);

    // printf("=== AST ===\n");
    // am_debug_ast_print_to_stdout(linked);

    am_module_t *mod = am_compile(linked, 0, 0);

    assert(mod != NULL);

    // printf("=== IL Code ===\n");
    // am_debug_print_ilcode(mod->ast, mod->ilcode, mod->ilcode_length);

    /* =============================================================
     * 1. 将编译出的模块持久化到系统内存（模拟外部文件转储）
     * ============================================================= */
    size_t dump_size = am_module_dump(vm_alloc, vm_alloc, mod, NULL, 0);
    assert(dump_size != SIZE_MAX);

    uint8_t *module_buffer = (uint8_t *)malloc(dump_size);
    assert(module_buffer != NULL);
    memset(module_buffer, 0, dump_size);

    size_t written = am_module_dump(vm_alloc, vm_alloc, mod, module_buffer, 0);
    assert(written == dump_size);
    printf("Module dumped: %zu bytes\n", dump_size);

    /* =============================================================
     * 2. 使用 PackBits 压缩/解压转储后的字节流并验证
     * ============================================================= */
    size_t compressed_size = am_packbits_compress(module_buffer, dump_size, NULL);
    assert(compressed_size != SIZE_MAX);

    uint8_t *compressed_buffer = (uint8_t *)malloc(compressed_size);
    assert(compressed_buffer != NULL);

    size_t compressed_written = am_packbits_compress(module_buffer, dump_size, compressed_buffer);
    assert(compressed_written == compressed_size);

    size_t decompressed_size = am_packbits_decompress(compressed_buffer, compressed_size, NULL);
    assert(decompressed_size == dump_size);

    uint8_t *decompressed_buffer = (uint8_t *)malloc(decompressed_size);
    assert(decompressed_buffer != NULL);

    size_t decompressed_written = am_packbits_decompress(compressed_buffer, compressed_size, decompressed_buffer);
    assert(decompressed_written == decompressed_size);
    assert(memcmp(module_buffer, decompressed_buffer, dump_size) == 0);

    printf("Module compressed: %zu bytes -> %zu bytes (%.2f%%)\n",
           dump_size, compressed_size,
           dump_size > 0 ? 100.0 * (double)compressed_size / (double)dump_size : 0.0);

    // 将压缩后的模块字节流保存到 main 所在目录的 module.bin
    if (0) {
        char bin_path[512];
        snprintf(bin_path, sizeof(bin_path), "%s/module.bin", base_dir);

        FILE *bin_file = fopen(bin_path, "wb");
        assert(bin_file != NULL);
        size_t bin_written = fwrite(compressed_buffer, 1, compressed_size, bin_file);
        fclose(bin_file);
        assert(bin_written == compressed_size);

        printf("Module compressed binary saved to: %s (%zu bytes)\n", bin_path, bin_written);
    }

    // 将解压后的数据写回原始缓冲区，使模块中的绝对指针保持有效
    memcpy(module_buffer, decompressed_buffer, dump_size);
    free(compressed_buffer);
    free(decompressed_buffer);

    /* =============================================================
     * 3. 彻底清空 VM 工作区，为 runtime 腾出空间
     *    （原始 AST、module、ilcode 均在 vm_alloc 中，转储后已不需要）
     * ============================================================= */
    am_allocator_pool_reset_vm(g_pool);

    /* base_dir_w 已随 VM 清空而失效，用栈缓冲区重新转换供 runtime 使用 */
    wchar_t base_dir_w_reload[256];
    am_mbstowcs(base_dir_w_reload, base_dir, 256);

    /* =============================================================
     * 4. 从转储缓冲区加载模块，然后创建 runtime 并运行
     * ============================================================= */
    am_module_t *mod_loaded = am_module_load(vm_alloc, heap_alloc, module_buffer, 0);
    assert(mod_loaded != NULL);
    printf("Module loaded: opstack_depth=%zu, ilcode_length=%zu\n",
           mod_loaded->opstack_depth, (size_t)mod_loaded->ilcode_length);

    // 创建VM实例
    am_runtime_t *rt = am_runtime_create(vm_alloc, heap_alloc, base_dir_w_reload);
    assert(rt != NULL);

    // 设置默认时间片长度（ticks）
    am_runtime_set_default_timeslice(rt, 8192);

    // 设置宿主上下文
    am_set_runtime_host_context(rt, NULL);

    // 注册内置 native 库
    am_runtime_register_native_lib(rt, &am_native_System_lib);
    am_runtime_register_native_lib(rt, &am_native_Math_lib);
    am_runtime_register_native_lib(rt, &am_native_String_lib);
    am_runtime_register_native_lib(rt, &am_native_LLM_lib);
    am_runtime_register_native_lib(rt, &am_native_Table_lib);

    // 设置VM回调函数
    rt->callback_on_halt = on_halt;
    rt->callback_on_error = on_error;
    rt->callback_on_tick = on_tick;

    // 加载模块为新进程
    am_pid_t pid1 = am_runtime_load_module(rt, mod_loaded);

    // 设置进程的宿主上下文
    am_process_t *proc = am_rumtime_get_process_by_pid(rt, pid1);
    am_set_process_host_context(rt, proc, NULL);

    // am_pid_t pid2 = am_runtime_load_module(rt, mod);

    // 启动解释器
    am_runtime_start(rt);

    // 释放资源
    am_runtime_destroy(rt);
    free(module_buffer);
    if (base_dir_owned) free(base_dir_owned);
}

static void test_runtime_load_from_file(char *path) {
    am_allocator_pool_reset_vm(g_pool);
    am_allocator_pool_reset_heap(g_pool);

    wchar_t path_w_stack[256];
    am_mbstowcs(path_w_stack, path, 256);
    wchar_t *file_content = read_file_as_wstring(path_w_stack);
    assert(file_content != NULL);

    const wchar_t *prefix = L"((lambda () \n";
    const wchar_t *suffix = L"\n))";
    size_t prefix_len = wcslen(prefix);
    size_t suffix_len = wcslen(suffix);
    size_t content_len = wcslen(file_content);
    size_t code_len = prefix_len + content_len + suffix_len;

    wchar_t *code = (wchar_t *)am_malloc(vm_alloc, (code_len + 1) * sizeof(wchar_t));
    assert(code != NULL);
    size_t pos = 0;
    for (size_t i = 0; i < prefix_len; i++) code[pos++] = prefix[i];
    for (size_t i = 0; i < content_len; i++) code[pos++] = file_content[i];
    for (size_t i = 0; i < suffix_len; i++) code[pos++] = suffix[i];
    code[pos] = L'\0';
    free(file_content);

    test_runtime_load_from_wstring(code, path);
}


int main(int argc, char* argv[]) {




    if (!setlocale(LC_ALL, "")) {
        fprintf(stderr, "setlocale failed\n");
        return 1;
    }

    // 读取源码文件（支持UTF-8）
    if(argc < 2) {
        printf("Usage: %s <source.scm>\n", argv[0]);
        return 1;
    }

    g_pool = am_allocator_pool_create(AM_ALLOCATOR_POOL_SIZE);
    if (!g_pool) {
        fprintf(stderr, "Failed to create allocator pool\n");
        return 1;
    }
    vm_alloc = am_allocator_pool_get_vm(g_pool);
    heap_alloc = am_allocator_pool_get_heap(g_pool);

    char *ext = strrchr(argv[1], '.');
    if (ext != NULL && strcmp(ext, ".js") == 0) {
        am_allocator_pool_reset_vm(g_pool);
        am_allocator_pool_reset_heap(g_pool);

        wchar_t path_w_stack[256];
        am_mbstowcs(path_w_stack, argv[1], 256);
        wchar_t *file_content = read_file_as_wstring(path_w_stack);
        assert(file_content != NULL);

        wchar_t *scheme_code = am_js_to_scheme(file_content);
        free(file_content);
        assert(scheme_code != NULL);

        size_t scheme_len = wcslen(scheme_code);
        wchar_t *code = (wchar_t *)am_malloc(vm_alloc, (scheme_len + 1) * sizeof(wchar_t));
        assert(code != NULL);
        wcscpy(code, scheme_code);
        free(scheme_code);

        test_runtime_load_from_wstring(code, argv[1]);
    } else {
        test_runtime_load_from_file(argv[1]);
    }

    am_allocator_pool_destroy(g_pool);
    g_pool = NULL;
    vm_alloc = NULL;
    heap_alloc = NULL;

    return 0;
}
