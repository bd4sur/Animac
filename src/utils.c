#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "utils.h"


// 将 UTF-32 码点（wchar_t）数组转换为 UTF-8 字符串
// 注意：此函数假设 wchar_t 为 32 位（即 UTF-32），符合 ESP32 的配置（通常 -fshort-wchar 未启用）
uint32_t am_wcstombs(char *dest, const wchar_t *src, uint32_t dest_size) {
    const wchar_t *p = src;
    char *q = dest;
    uint32_t dest_len = 0;
    char *end = dest + dest_size - 1; // 留 1 字节给 \0

    while (*p != L'\0' && q < end) {
        uint32_t cp = (uint32_t)*p++;
        if (cp <= 0x7F && q < end) {
            *q++ = (char)cp;
            dest_len++;
        } else if (cp <= 0x7FF && q + 1 < end) {
            *q++ = 0xC0 | (cp >> 6);
            *q++ = 0x80 | (cp & 0x3F);
            dest_len += 2;
        } else if (cp <= 0xFFFF && q + 2 < end) {
            *q++ = 0xE0 | (cp >> 12);
            *q++ = 0x80 | ((cp >> 6) & 0x3F);
            *q++ = 0x80 | (cp & 0x3F);
            dest_len += 3;
        } else if (cp <= 0x10FFFF && q + 3 < end) {
            *q++ = 0xF0 | (cp >> 18);
            *q++ = 0x80 | ((cp >> 12) & 0x3F);
            *q++ = 0x80 | ((cp >> 6) & 0x3F);
            *q++ = 0x80 | (cp & 0x3F);
            dest_len += 4;
        } else if (q < end) {
            *q++ = '?';
            dest_len++;
        }
    }
    *q = '\0';
    return dest_len;
}

// 将 UTF-8 字符串转换为 null-terminated 的 UTF-32 (wchar_t) 字符串
// 返回值：成功转换的 wchar_t 字符数量（不包括结尾的 L'\0'）
// 注意：dest 必须有至少 (length + 1) 个 wchar_t 的空间（最坏情况）
uint32_t am_mbstowcs(wchar_t *dest, const char *src, uint32_t length) {
    const uint8_t *p = (const uint8_t *)src;
    const uint8_t *end = p + length;
    wchar_t *out = dest;

    while (p < end) {
        uint8_t byte = *p;
        if (byte == '\0') break;
        p++;

        if ((byte & 0x80) == 0) {
            // 1-byte: ASCII
            if (dest) *out++ = (wchar_t)byte;
            else out++;
        } else if ((byte & 0xE0) == 0xC0) {
            // 2-byte
            if (p >= end) goto invalid;
            uint8_t b2 = *p++;
            if ((b2 & 0xC0) != 0x80) goto invalid;
            uint32_t cp = ((byte & 0x1F) << 6) | (b2 & 0x3F);
            if (cp < 0x80) goto invalid; // overlong
            if (dest) *out++ = (wchar_t)cp;
            else out++;
        } else if ((byte & 0xF0) == 0xE0) {
            // 3-byte
            if (p + 1 >= end) goto invalid;
            uint8_t b2 = *p++;
            uint8_t b3 = *p++;
            if ((b2 & 0xC0) != 0x80 || (b3 & 0xC0) != 0x80) goto invalid;
            uint32_t cp = ((byte & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
            if (cp < 0x800) goto invalid;
            if (cp >= 0xD800 && cp <= 0xDFFF) goto invalid; // surrogate
            if (dest) *out++ = (wchar_t)cp;
            else out++;
        } else if ((byte & 0xF8) == 0xF0) {
            // 4-byte
            if (p + 2 >= end) goto invalid;
            uint8_t b2 = *p++;
            uint8_t b3 = *p++;
            uint8_t b4 = *p++;
            if ((b2 & 0xC0) != 0x80 || (b3 & 0xC0) != 0x80 || (b4 & 0xC0) != 0x80) goto invalid;
            uint32_t cp = ((byte & 0x07) << 18) | ((b2 & 0x3F) << 12) |
                          ((b3 & 0x3F) << 6) | (b4 & 0x3F);
            if (cp < 0x10000) goto invalid;
            if (cp > 0x10FFFF) goto invalid;
            if (dest) *out++ = (wchar_t)cp;
            else out++;
        } else {
            goto invalid;
        }
    }

    // 正常结束：添加 null 终止符
    *out = (wchar_t)0;
    return (uint32_t)(out - dest);

invalid:
    // 遇到无效 UTF-8：用 '?' 替代并终止
    if (dest) *out++ = (wchar_t)'?';
    else out++;
    if (dest) *out = (wchar_t)0;  // 仍然保证 null-terminated
    return (uint32_t)(out - dest); // 返回包含 '?' 的字符数
}


// 从 Linux 格式的文件路径中提取文件所在目录的绝对路径
// 即最后一个 '/' 之前的内容，不包含末尾的 '/'
// 返回值：动态分配的字符串，调用者需 free()；失败或路径不含 '/' 时返回 NULL
char* am_path_dirname(const char *path) {
    if (!path) return NULL;

    const char *last_slash = strrchr(path, '/');
    if (!last_slash) return NULL;

    size_t len = (size_t)(last_slash - path);
    char *dir = (char *)malloc(len + 1);
    if (!dir) return NULL;

    memcpy(dir, path, len);
    dir[len] = '\0';
    return dir;
}
