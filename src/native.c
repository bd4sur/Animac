#include "native.h"

#include <wchar.h>


static const am_native_lib_entry_t *g_native_libs[AM_NATIVE_MAX_LIBS];
static size_t g_native_lib_count = 0;


// 注册一个native库到全局native库表中。成功返回0，失败返回-1。
int32_t am_native_register_lib(const am_native_lib_entry_t *lib) {
    if (!lib || !lib->name || !lib->funcs || lib->func_count == 0) return -1;
    if (g_native_lib_count >= AM_NATIVE_MAX_LIBS) return -1;
    g_native_libs[g_native_lib_count++] = lib;
    return 0;
}


// 运行时查表：根据库名和函数名定位native函数实现。
am_native_func_t am_native_find_func(const wchar_t *lib_name, const wchar_t *func_name) {
    if (!lib_name || !func_name) return NULL;

    for (size_t i = 0; i < g_native_lib_count; i++) {
        const am_native_lib_entry_t *lib = g_native_libs[i];
        if (!lib) continue;
        if (wcscmp(lib->name, lib_name) != 0) continue;

        for (size_t j = 0; j < lib->func_count; j++) {
            if (wcscmp(lib->funcs[j].name, func_name) == 0) {
                return lib->funcs[j].func;
            }
        }
    }
    return NULL;
}
