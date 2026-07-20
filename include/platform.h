#ifndef __AM_PLATFORM_H__
#define __AM_PLATFORM_H__

#include <stdint.h>
#include <wchar.h>

#ifdef __cplusplus
extern "C" {
#endif

// 短时睡眠（毫秒）
void am_sleep_in_ms(uint64_t ms);

// 获取当前时间戳（毫秒）
uint64_t am_current_timestamp_in_ms();

/**
 * 读取文件内容（UTF-8），并转换为 wchar_t* 字符串
 *
 * @param filename 文件名
 * @return 成功时返回动态分配的 wchar_t*（以 L'\0' 结尾），失败返回 NULL。
 *         调用者需用 free() 释放返回值。
 */
wchar_t* am_read_file_to_wchar(char* filename);

// 从 Linux 格式的文件路径中提取文件所在目录的绝对路径
// 即最后一个 '/' 之前的内容，不包含末尾的 '/'
// 返回值：动态分配的字符串，调用者需 free()；失败或路径不含 '/' 时返回 NULL
char* am_path_dirname(const char *path);

#ifdef __cplusplus
}
#endif

#endif
