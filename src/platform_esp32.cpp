#include <Arduino.h>

#include "platform.h"
#include "utils.h"

// 短时睡眠（毫秒）
void am_sleep_in_ms(uint64_t ms) {
    delay(ms);
}

// 获取当前时间戳（毫秒）。优先使用 POSIX clock_gettime，失败则回退到 time()。
uint64_t am_current_timestamp_in_ms() {
    struct timespec ts;
    if (clock_gettime(CLOCK_REALTIME, &ts) == 0) {
        return (uint64_t)ts.tv_sec * 1000 + (uint64_t)ts.tv_nsec / 1000000;
    }
    return (uint64_t)time(NULL) * 1000;
}

/**
 * 读取文件内容（UTF-8），并转换为 wchar_t* 字符串
 *
 * @param filename 文件名
 * @return 成功时返回动态分配的 wchar_t*（以 L'\0' 结尾），失败返回 NULL。
 *         调用者需用 free() 释放返回值。
 */
wchar_t* am_read_file_to_wchar(char* filename) {
    if (!filename) return NULL;

    // 从 SD 卡打开文件（二进制读取，与 main.cpp 中 .load 逻辑一致）
    File f = SD.open(filename, FILE_READ);
    if (!f) {
        return NULL;
    }

    size_t size = f.size();
    if (size == 0) {
        f.close();
        wchar_t* empty = (wchar_t*)calloc(1, sizeof(wchar_t));
        if (empty) *empty = L'\0';
        return empty;
    }

    // 读取全部内容到 char 缓冲区（+1 保证可加 '\0'）
    char* buffer = (char*)calloc(size + 1, sizeof(char));
    if (!buffer) {
        f.close();
        return NULL;
    }

    size_t bytes_read = 0;
    char chunk[256];
    while (bytes_read < size) {
        size_t to_read = sizeof(chunk);
        if (size - bytes_read < to_read) {
            to_read = size - bytes_read;
        }
        int n = f.read((uint8_t*)chunk, to_read);
        if (n <= 0) break;
        memcpy(buffer + bytes_read, chunk, n);
        bytes_read += n;
    }
    f.close();

    if (bytes_read != size) {
        free(buffer);
        return NULL;
    }
    buffer[size] = '\0'; // 确保以 null 结尾（UTF-8 是 null-safe 的）

    // 计算所需 wchar_t 数量
    size_t wlen = size;

    // 分配 wchar_t 缓冲区
    wchar_t* wstr = (wchar_t*)calloc((wlen + 1), sizeof(wchar_t));
    if (!wstr) {
        free(buffer);
        return NULL;
    }

    // 执行实际转换（length 为 buffer 中实际字节数，不含结尾额外 \0）
    (void)am_mbstowcs(wstr, buffer, size);
    free(buffer);

    return wstr; // 调用者负责 free()
}
