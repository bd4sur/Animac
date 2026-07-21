#ifndef __AM_DISKIO_H__
#define __AM_DISKIO_H__

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "object.h"

///////////////////////////////////////////
// 平台无关固定宽度磁盘格式序列化原语
//
// 设计目标：
//   1. 与宿主字长（32/64位）、指针长度、size_t 长度、结构体填充完全无关；
//   2. 与宿主字节序无关：所有多字节整数一律以小端序（LE）显式按字节读写；
//   3. 尽可能紧凑：计数、索引、句柄等小值整数采用 ULEB128 变长编码，
//      有符号整数采用 zigzag+ULEB128 编码；TPV 采用 1字节类型标签+变长负载。
//
// 基本编码规则：
//   - u8/u16/u32/u64：定长小端；
//   - uvarint：ULEB128（每字节7位有效载荷，MSB为续位标志）；
//   - svarint：zigzag 映射后的 ULEB128；
//   - f64：IEEE-754 double 的 64 位位模式（小端）。
//
// TPV（am_value_t）磁盘编码 dvalue：
//   - 第1字节：类型标签 = AM_VALUE_TYPE_*（0x00~0x0C）；
//   - 负载：
//       PTR      (0x00)：uvarint(原始指针位模式)（仅用于堆转储中的对象偏移量，必须为偶数）
//       HANDLE/IADDR/VARID/LABEL/BOOLEAN/SYMBOL/WCHAR/UINT：uvarint(运行时值 >> 5)
//       NULL/UNDEFINED：无负载（载荷隐含为0）
//       INT：svarint(整数值)（磁盘上统一视为64位有符号整数）
//       FLOAT：f64（IEEE-754 double；32位平台上由float精确提升/舍入还原）
//
// 所有写函数允许 buffer 为 NULL（仅计算字节数，不实际写入）。
///////////////////////////////////////////


// ===============================================================================
// 定长小端整数
// ===============================================================================

static inline void am_disk_write_u16(uint8_t *buf, size_t off, uint16_t v) {
    if (!buf) return;
    buf[off + 0] = (uint8_t)(v & 0xFFu);
    buf[off + 1] = (uint8_t)((v >> 8) & 0xFFu);
}

static inline void am_disk_write_u32(uint8_t *buf, size_t off, uint32_t v) {
    if (!buf) return;
    buf[off + 0] = (uint8_t)(v & 0xFFu);
    buf[off + 1] = (uint8_t)((v >> 8) & 0xFFu);
    buf[off + 2] = (uint8_t)((v >> 16) & 0xFFu);
    buf[off + 3] = (uint8_t)((v >> 24) & 0xFFu);
}

static inline void am_disk_write_u64(uint8_t *buf, size_t off, uint64_t v) {
    if (!buf) return;
    for (int i = 0; i < 8; i++) {
        buf[off + i] = (uint8_t)((v >> (8 * i)) & 0xFFu);
    }
}

static inline uint16_t am_disk_read_u16(const uint8_t *buf, size_t off) {
    return (uint16_t)((uint16_t)buf[off] | ((uint16_t)buf[off + 1] << 8));
}

static inline uint32_t am_disk_read_u32(const uint8_t *buf, size_t off) {
    return ((uint32_t)buf[off + 0]) |
           ((uint32_t)buf[off + 1] << 8) |
           ((uint32_t)buf[off + 2] << 16) |
           ((uint32_t)buf[off + 3] << 24);
}

static inline uint64_t am_disk_read_u64(const uint8_t *buf, size_t off) {
    uint64_t v = 0;
    for (int i = 0; i < 8; i++) {
        v |= ((uint64_t)buf[off + i]) << (8 * i);
    }
    return v;
}


// ===============================================================================
// 变长整数（ULEB128 / zigzag+ULEB128）
// ===============================================================================

// 写入 ULEB128 编码的无符号整数。返回占用字节数。buf 为 NULL 时仅计算字节数。
static inline size_t am_disk_write_uvarint(uint8_t *buf, size_t off, uint64_t v) {
    size_t n = 0;
    do {
        uint8_t b = (uint8_t)(v & 0x7Fu);
        v >>= 7;
        if (v) b |= 0x80u;
        if (buf) buf[off + n] = b;
        n++;
    } while (v);
    return n;
}

// 读取 ULEB128 编码的无符号整数。成功返回消耗字节数（>=1），失败（溢出/超长）返回0。
static inline size_t am_disk_read_uvarint(const uint8_t *buf, size_t off, uint64_t *out) {
    uint64_t v = 0;
    for (size_t n = 0; n < 10; n++) {
        uint8_t b = buf[off + n];
        if (n == 9 && b > 1) return 0; // 超过64位
        v |= ((uint64_t)(b & 0x7Fu)) << (7 * n);
        if (!(b & 0x80u)) {
            *out = v;
            return n + 1;
        }
    }
    return 0;
}

// 写入 zigzag+ULEB128 编码的有符号整数。返回占用字节数。buf 为 NULL 时仅计算字节数。
static inline size_t am_disk_write_svarint(uint8_t *buf, size_t off, int64_t v) {
    uint64_t z = ((uint64_t)v << 1) ^ (uint64_t)(v >> 63);
    return am_disk_write_uvarint(buf, off, z);
}

// 读取 zigzag+ULEB128 编码的有符号整数。成功返回消耗字节数，失败返回0。
static inline size_t am_disk_read_svarint(const uint8_t *buf, size_t off, int64_t *out) {
    uint64_t z = 0;
    size_t n = am_disk_read_uvarint(buf, off, &z);
    if (!n) return 0;
    *out = (int64_t)(z >> 1) ^ (-(int64_t)(z & 1u));
    return n;
}


// ===============================================================================
// IEEE-754 double（小端位模式）
// ===============================================================================

static inline void am_disk_write_f64(uint8_t *buf, size_t off, double d) {
    uint64_t bits = 0;
    memcpy(&bits, &d, sizeof(bits));
    am_disk_write_u64(buf, off, bits);
}

static inline double am_disk_read_f64(const uint8_t *buf, size_t off) {
    uint64_t bits = am_disk_read_u64(buf, off);
    double d = 0.0;
    memcpy(&d, &bits, sizeof(d));
    return d;
}


// ===============================================================================
// 对象基类头 am_object_t（固定16字节：u32 header, u32 hash, u32 gcmark, i32 type）
// ===============================================================================

#define AM_DISK_BASE_SIZE (16)

static inline void am_disk_write_base(uint8_t *buf, size_t off, const am_object_t *base) {
    am_disk_write_u32(buf, off + 0,  base->header);
    am_disk_write_u32(buf, off + 4,  base->hash);
    am_disk_write_u32(buf, off + 8,  base->gcmark);
    am_disk_write_u32(buf, off + 12, (uint32_t)base->type);
}

static inline void am_disk_read_base(const uint8_t *buf, size_t off, am_object_t *base) {
    base->header = am_disk_read_u32(buf, off + 0);
    base->hash   = am_disk_read_u32(buf, off + 4);
    base->gcmark = am_disk_read_u32(buf, off + 8);
    base->type   = (int32_t)am_disk_read_u32(buf, off + 12);
}


// ===============================================================================
// TPV（am_value_t）磁盘编码
// ===============================================================================

// 本宿主 TPV 立即数能够容纳的无符号载荷上限（payload = value >> 5）
#define AM_DISK_UINT_PAYLOAD_MAX ((uint64_t)(UINTPTR_MAX >> 5))

// 本宿主 TPV 能够容纳的有符号整数范围（make/to_int 往返不失真）
#define AM_DISK_INT_BITS ((int)(sizeof(am_value_t) * 8) - 6)

// 计算 TPV 编码后的字节数。失败（不支持的类型）返回 SIZE_MAX。
static inline size_t am_disk_value_size(am_value_t v) {
    if (am_value_is_float(v)) {
        return 1 + 8;
    }
    if (am_value_is_null(v) || am_value_is_undefined(v)) {
        return 1;
    }
    if (am_value_is_int(v)) {
        return 1 + am_disk_write_svarint(NULL, 0, (int64_t)am_value_to_int(v));
    }
    if (am_value_is_ptr(v)) {
        return 1 + am_disk_write_uvarint(NULL, 0, (uint64_t)v);
    }
    // 其余 uint_like 立即数
    return 1 + am_disk_write_uvarint(NULL, 0, (uint64_t)(v >> 5));
}

// 将 TPV 编码写入 buffer[off]。返回写入字节数；buffer 为 NULL 时仅计算字节数。
static inline size_t am_disk_write_value(uint8_t *buf, size_t off, am_value_t v) {
    uint8_t tag = (uint8_t)am_value_type(v);
    if (buf) buf[off] = tag;

    if (am_value_is_float(v)) {
        if (buf) am_disk_write_f64(buf, off + 1, (double)am_value_to_float(v));
        return 1 + 8;
    }
    if (am_value_is_null(v) || am_value_is_undefined(v)) {
        return 1;
    }
    if (am_value_is_int(v)) {
        return 1 + am_disk_write_svarint(buf, off + 1, (int64_t)am_value_to_int(v));
    }
    if (am_value_is_ptr(v)) {
        // 仅用于堆转储中的对象相对偏移量（必须保持偶数，以维持PTR标签位）
        return 1 + am_disk_write_uvarint(buf, off + 1, (uint64_t)v);
    }
    // 其余 uint_like 立即数
    return 1 + am_disk_write_uvarint(buf, off + 1, (uint64_t)(v >> 5));
}

// 从 buffer[off] 解码 TPV，结果写入 *out。
// 成功返回消耗字节数；失败返回0（含：未知标签、变长整数溢出、32位宿主值域越界）。
static inline size_t am_disk_read_value(const uint8_t *buf, size_t off, am_value_t *out) {
    uint8_t tag = buf[off];
    if (tag > AM_VALUE_TYPE_FLOAT) return 0;

    if (tag == AM_VALUE_TYPE_NULL || tag == AM_VALUE_TYPE_UNDEFINED) {
        *out = AM_MAKE_VALUE_OF_UINT_LIKE(0, ((am_value_t)tag << 1) | 1);
        return 1;
    }
    if (tag == AM_VALUE_TYPE_FLOAT) {
        double d = am_disk_read_f64(buf, off + 1);
        *out = am_make_value_of_float((am_float_t)d);
        return 1 + 8;
    }
    if (tag == AM_VALUE_TYPE_INT) {
        int64_t sv = 0;
        size_t n = am_disk_read_svarint(buf, off + 1, &sv);
        if (!n) return 0;
        // 检查是否超出本宿主 TPV 可表示的整数范围
        if ((sv >> AM_DISK_INT_BITS) != 0 && (sv >> AM_DISK_INT_BITS) != -1) return 0;
        *out = am_make_value_of_int((am_int_t)sv);
        return 1 + n;
    }

    uint64_t payload = 0;
    size_t n = am_disk_read_uvarint(buf, off + 1, &payload);
    if (!n) return 0;

    if (tag == AM_VALUE_TYPE_PTR) {
        // 原始指针位模式（堆转储中的对象偏移量）：必须适配本宿主指针宽度且为偶数
        if (payload > (uint64_t)UINTPTR_MAX) return 0;
        if (payload & 1u) return 0;
        *out = (am_value_t)(uintptr_t)payload;
        return 1 + n;
    }

    // 其余 uint_like 立即数
    if (payload > AM_DISK_UINT_PAYLOAD_MAX) return 0;
    *out = AM_MAKE_VALUE_OF_UINT_LIKE(payload, ((am_value_t)tag << 1) | 1);
    return 1 + n;
}


#ifdef __cplusplus
}
#endif

#endif
