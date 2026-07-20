#ifndef __AM_UTILS_H__
#define __AM_UTILS_H__

#include <stdint.h>
#include <wchar.h>

#ifdef __cplusplus
extern "C" {
#endif

// ===============================================================================
// 字符编码相关
// ===============================================================================

// 将 UTF-32 码点（wchar_t）数组转换为 UTF-8 字符串
// 注意：此函数假设 wchar_t 为 32 位（即 UTF-32），符合 ESP32 的配置（通常 -fshort-wchar 未启用）
uint32_t am_wcstombs(char *dest, const wchar_t *src, uint32_t dest_size);

// 将 UTF-8 字符串转换为 null-terminated 的 UTF-32 (wchar_t) 字符串
// 返回值：成功转换的 wchar_t 字符数量（不包括结尾的 L'\0'）
// 注意：dest 必须有至少 (length + 1) 个 wchar_t 的空间（最坏情况）
uint32_t am_mbstowcs(wchar_t *dest, const char *src, uint32_t length);

// 从 Linux 格式的文件路径中提取文件所在目录的绝对路径
// 即最后一个 '/' 之前的内容，不包含末尾的 '/'
// 返回值：动态分配的字符串，调用者需 free()；失败或路径不含 '/' 时返回 NULL
char* am_path_dirname(const char *path);

#ifdef __cplusplus
}
#endif

#endif
