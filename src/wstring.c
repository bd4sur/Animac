#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include "object.h"
#include "allocator.h"
#include "wstring.h"


// 创建并初始化一个字符串对象。字符串对象是不可变的。
// 注意：am_wstring_t.content是am_value_t数组，每个元素是一个am_wchar_t。
am_wstring_t *am_wstring_create(am_allocator_t *alloc, wchar_t *str, size_t length) {
    if (!alloc || !str) return NULL;

    am_wstring_t *ws = (am_wstring_t *)am_malloc(alloc, sizeof(am_wstring_t) + length * sizeof(am_value_t));
    if (!ws) return NULL;

    ws->base.header = 0;
    ws->base.hash = 0;
    ws->base.gcmark = 0;
    ws->base.type = AM_OBJECT_TYPE_WSTRING;
    ws->length = length;
    for (size_t i = 0; i < length; i++) {
        ws->content[i] = am_make_value_of_wchar((am_wchar_t)str[i]);
    }
    return ws;
}


// 销毁对象。obj 为 NULL 时视为成功。成功返回 0，失败返回 -1。
int32_t am_wstring_destroy(am_allocator_t *alloc, am_wstring_t *obj) {
    if (!obj) return 0;
    if (!alloc) return -1;
    am_free(alloc, obj);
    return 0;
}


// 功能说明：拷贝wstring对象。成功则返回新副本对象的指针，失败则返回NULL。
am_wstring_t *am_wstring_copy(am_allocator_t *alloc, am_wstring_t *obj) {
    if (!alloc || !obj) return NULL;

    size_t total_size = sizeof(am_wstring_t) + obj->length * sizeof(am_value_t);
    am_wstring_t *copy = (am_wstring_t *)am_malloc(alloc, total_size);
    if (!copy) return NULL;

    copy->base = obj->base;
    copy->length = obj->length;
    if (obj->length > 0) {
        memcpy(copy->content, obj->content, obj->length * sizeof(am_value_t));
    }
    return copy;
}


// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_wstring_size(am_allocator_t *alloc, am_wstring_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->length > (SIZE_MAX - sizeof(am_wstring_t)) / sizeof(am_value_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_wstring_t) + obj->length * sizeof(am_value_t);
}


// 转储格式：
//   [sizeof(am_object_t) bytes] 对象基类头（含type=AM_OBJECT_TYPE_WSTRING）
//   [sizeof(size_t) bytes] 字符串长度（字符个数）
//   [length * sizeof(am_value_t) bytes] 字符内容（每个字符为一个am_value_t）

// 功能说明：将字符串对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
size_t am_wstring_dump(am_allocator_t *alloc, am_wstring_t *obj, uint8_t *buffer, size_t offset) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    size_t content_size = obj->length * sizeof(am_value_t);
    size_t total_size = sizeof(am_object_t) + sizeof(size_t) + content_size;

    if (buffer != NULL && offset != SIZE_MAX) {
        // 写入对象基类头
        am_wstring_t *dump = (am_wstring_t *)&buffer[offset];
        dump->base = obj->base;
        dump->length = obj->length;
        if (content_size > 0) {
            memcpy(dump->content, obj->content, content_size);
        }
    }

    return total_size;
}


// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的字符串对象，构造字符串对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_wstring_t对象的指针，失败则返回NULL。
am_wstring_t *am_wstring_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    am_wstring_t *dump = (am_wstring_t *)&buffer[offset];
    if (dump->base.type != AM_OBJECT_TYPE_WSTRING) return NULL;

    size_t length = dump->length;
    am_wstring_t *ws = (am_wstring_t *)am_malloc(alloc, sizeof(am_wstring_t) + length * sizeof(am_value_t));
    if (!ws) return NULL;

    ws->base = dump->base;
    ws->length = length;
    if (length > 0) {
        memcpy(ws->content, dump->content, length * sizeof(am_value_t));
    }
    return ws;
}


// ===============================================================================
// 多值字符串索引表 am_strindex_t 实现
// ===============================================================================

// FNV-1a 32-bit 参数
#define AM_FNV1A_OFFSET_BASIS ((uint32_t)0x811c9dc5u)
#define AM_FNV1A_PRIME        ((uint32_t)0x01000193u)

// 计算 wchar_t 字符串的 FNV-1a 32-bit 哈希值
uint32_t am_strindex_hash_string(const wchar_t *str) {
    uint32_t hash = AM_FNV1A_OFFSET_BASIS;
    while (*str != L'\0') {
        hash ^= (uint32_t)(*str);
        hash *= AM_FNV1A_PRIME;
        str++;
    }
    return hash;
}

// 内部静态别名，保持现有代码风格
static uint32_t am_strindex_hash(const wchar_t *str) {
    return am_strindex_hash_string(str);
}

// 将容量向上取整为不小于它的最小 2 的幂
static size_t am_strindex_round_up_capacity(size_t capacity) {
    size_t cap = 1;
    while (cap < capacity) cap <<= 1;
    return cap;
}

// 查找可插入槽位：从 hash 对应位置开始，返回第一个 EMPTY 或 TOMBSTONE 槽的索引
static size_t am_strindex_find_insert_slot(const am_strindex_t *si, uint32_t hash) {
    size_t idx = (size_t)hash & si->mask;
    while (si->slots[idx].hash != AM_STRINDEX_KEY_EMPTY &&
           si->slots[idx].hash != AM_STRINDEX_KEY_TOMBSTONE) {
        idx = (idx + 1) & si->mask;
    }
    return idx;
}

// 收集指定 hash 对应的所有 value。
// values 为 NULL 或 n_values 为 0 时仅计数；否则最多写入 n_values 个。
// 返回实际匹配数量。
static size_t am_strindex_collect_values(const am_strindex_t *si, uint32_t hash,
                                         am_value_t *values, size_t n_values) {
    size_t idx = (size_t)hash & si->mask;
    size_t count = 0;
    while (si->slots[idx].hash != AM_STRINDEX_KEY_EMPTY) {
        if (si->slots[idx].hash == hash) {
            if (values != NULL && count < n_values) {
                values[count] = si->slots[idx].value;
            }
            count++;
        }
        idx = (idx + 1) & si->mask;
    }
    return count;
}

// 原地重哈希：清除墓碑，不改变容量
static int32_t am_strindex_rehash(am_allocator_t *alloc, am_strindex_t *si) {
    size_t cap = si->capacity;
    size_t entries_size = cap * sizeof(am_strindex_entry_t);

    am_strindex_entry_t *old_slots = (am_strindex_entry_t *)am_malloc(alloc, entries_size);
    if (!old_slots) return -1;
    memcpy(old_slots, si->slots, entries_size);

    for (size_t i = 0; i < cap; i++) {
        si->slots[i].hash = AM_STRINDEX_KEY_EMPTY;
        si->slots[i].value = AM_VALUE_NULL;
    }
    si->length = 0;
    si->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        if (old_slots[i].hash != AM_STRINDEX_KEY_EMPTY &&
            old_slots[i].hash != AM_STRINDEX_KEY_TOMBSTONE) {
            size_t insert_idx = am_strindex_find_insert_slot(si, old_slots[i].hash);
            si->slots[insert_idx].hash = old_slots[i].hash;
            si->slots[insert_idx].value = old_slots[i].value;
            si->length++;
        }
    }

    am_free(alloc, old_slots);
    return 0;
}

// 扩容并重哈希到新容量（new_capacity 会被向上取整为 2 的幂）。
// 返回新的 strindex 对象指针；失败返回 NULL。原对象会被释放，调用者必须使用返回的新指针。
static am_strindex_t *am_strindex_resize(am_allocator_t *alloc, am_strindex_t *si, size_t new_capacity) {
    size_t cap = am_strindex_round_up_capacity(new_capacity);
    if (cap < 8) cap = 8;

    if (cap <= si->capacity) {
        if (am_strindex_rehash(alloc, si) != 0) return NULL;
        return si;
    }

    size_t old_capacity = si->capacity;
    size_t old_entries_size = old_capacity * sizeof(am_strindex_entry_t);

    am_strindex_entry_t *old_slots = NULL;
    if (old_entries_size > 0) {
        old_slots = (am_strindex_entry_t *)am_malloc(alloc, old_entries_size);
        if (!old_slots) return NULL;
        memcpy(old_slots, si->slots, old_entries_size);
    }

    size_t new_total_size = sizeof(am_strindex_t) + cap * sizeof(am_strindex_entry_t);
    am_strindex_t *new_si = (am_strindex_t *)am_malloc(alloc, new_total_size);
    if (!new_si) {
        am_free(alloc, old_slots);
        return NULL;
    }

    new_si->base = si->base;
    new_si->capacity = cap;
    new_si->mask = cap - 1;
    new_si->length = 0;
    new_si->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        new_si->slots[i].hash = AM_STRINDEX_KEY_EMPTY;
        new_si->slots[i].value = AM_VALUE_NULL;
    }

    for (size_t i = 0; i < old_capacity; i++) {
        if (old_slots[i].hash != AM_STRINDEX_KEY_EMPTY &&
            old_slots[i].hash != AM_STRINDEX_KEY_TOMBSTONE) {
            size_t insert_idx = am_strindex_find_insert_slot(new_si, old_slots[i].hash);
            new_si->slots[insert_idx].hash = old_slots[i].hash;
            new_si->slots[insert_idx].value = old_slots[i].value;
            new_si->length++;
        }
    }

    am_free(alloc, old_slots);
    am_free(alloc, si);
    return new_si;
}

// ===============================================================================
// 构造函数
// ===============================================================================

// 以初始容量新建多值哈希表。capacity 会被向上取整为不小于它的最小 2 的幂。
// 所有 key 初始化为 AM_STRINDEX_KEY_EMPTY，value 初始化为 AM_VALUE_NULL。
am_strindex_t *am_strindex_create(am_allocator_t *alloc, size_t capacity) {
    if (!alloc) return NULL;

    size_t cap = am_strindex_round_up_capacity(capacity);
    if (cap < 8) cap = 8;

    size_t total_size = sizeof(am_strindex_t) + cap * sizeof(am_strindex_entry_t);
    am_strindex_t *si = (am_strindex_t *)am_malloc(alloc, total_size);
    if (!si) return NULL;

    memset(si, 0, total_size);

    si->base.type = AM_OBJECT_TYPE_STRINDEX;
    si->capacity = cap;
    si->mask = cap - 1;
    si->length = 0;
    si->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        si->slots[i].hash = AM_STRINDEX_KEY_EMPTY;
        si->slots[i].value = AM_VALUE_NULL;
    }

    return si;
}

// ===============================================================================
// 析构与清理
// ===============================================================================

// 彻底销毁
int32_t am_strindex_destroy(am_allocator_t *alloc, am_strindex_t *obj) {
    if (!obj) return 0;
    if (!alloc) return -1;
    am_free(alloc, obj);
    return 0;
}

// ===============================================================================
// 拷贝
// ===============================================================================

// 深拷贝：创建并返回一个与原 strindex 内容完全一致的新对象。所有 key/value 按位拷贝。
am_strindex_t *am_strindex_copy(am_allocator_t *alloc, am_strindex_t *obj) {
    if (!alloc || !obj) return NULL;

    am_strindex_t *copy = am_strindex_create(alloc, obj->capacity);
    if (!copy) return NULL;

    copy->length = obj->length;
    copy->tombstones = obj->tombstones;

    for (size_t i = 0; i < obj->capacity; i++) {
        copy->slots[i].hash = obj->slots[i].hash;
        copy->slots[i].value = obj->slots[i].value;
    }

    return copy;
}

// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_strindex_size(am_allocator_t *alloc, am_strindex_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->capacity > (SIZE_MAX - sizeof(am_strindex_t)) / sizeof(am_strindex_entry_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_strindex_t) + obj->capacity * sizeof(am_strindex_entry_t);
}

// ===============================================================================
// 对象二进制转储
// ===============================================================================

// 功能说明：将表对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
//       压缩对象，将capacity压缩到跟length一致，丢弃墓碑和空闲槽位。
size_t am_strindex_dump(am_allocator_t *alloc, am_strindex_t *obj, uint8_t *buffer, size_t offset) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    size_t dump_size = sizeof(am_strindex_t) + obj->length * sizeof(am_strindex_entry_t);
    if (buffer != NULL && offset != SIZE_MAX) {
        am_strindex_t *dump = (am_strindex_t *)&buffer[offset];
        dump->base = obj->base;
        dump->length = obj->length;
        dump->capacity = obj->length;
        dump->mask = (obj->length > 0) ? (obj->length - 1) : 0;
        dump->tombstones = 0;

        size_t idx = 0;
        for (size_t i = 0; i < obj->capacity; i++) {
            if (obj->slots[i].hash != AM_STRINDEX_KEY_EMPTY &&
                obj->slots[i].hash != AM_STRINDEX_KEY_TOMBSTONE) {
                dump->slots[idx].hash = obj->slots[i].hash;
                dump->slots[idx].value = obj->slots[i].value;
                idx++;
            }
        }
    }

    return dump_size;
}

// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的对象，构造对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_strindex_t对象的指针，失败则返回NULL。
am_strindex_t *am_strindex_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    am_strindex_t *dump = (am_strindex_t *)&buffer[offset];
    if (dump->base.type != AM_OBJECT_TYPE_STRINDEX) return NULL;

    // dump 中 capacity 与 length 一致，创建功能表时使用稍大的容量，确保有空槽。
    am_strindex_t *si = am_strindex_create(alloc, dump->length);
    if (!si) return NULL;

    // 直接从 dump 的 hash/value 重建，不重新计算字符串 hash。
    for (size_t i = 0; i < dump->length; i++) {
        if ((si->length + si->tombstones + 1) * 4 > si->capacity * 3) {
            am_strindex_t *new_si = am_strindex_resize(alloc, si, si->capacity * 2);
            if (!new_si) {
                am_strindex_destroy(alloc, si);
                return NULL;
            }
            si = new_si;
        }

        size_t insert_idx = am_strindex_find_insert_slot(si, dump->slots[i].hash);
        if (si->slots[insert_idx].hash == AM_STRINDEX_KEY_TOMBSTONE) {
            si->tombstones--;
        }
        si->slots[insert_idx].hash = dump->slots[i].hash;
        si->slots[insert_idx].value = dump->slots[i].value;
        si->length++;
    }

    return si;
}

// ===============================================================================
// 基本操作
// ===============================================================================

// 查找：输入一个wchar_t字符串，计算其uint32_t哈希值，得到所有对应的value的列表（values由调用者管理）。
// values 为 NULL 或 n_values 为 0 时，仅返回匹配条目的数量，不写入 values。
// 返回值为实际匹配条目数量；若不存在则返回 0；若出错则返回 SIZE_MAX。
size_t am_strindex_get_all(am_allocator_t *alloc, am_strindex_t *obj, wchar_t *str,
                           am_value_t *values, size_t n_values) {
    if (!alloc || !obj || !str) return SIZE_MAX;

    uint32_t hash = am_strindex_hash(str);
    return am_strindex_collect_values(obj, hash, values, n_values);
}

// 插入新键值对。对输入的字符串计算hash，插入(key=hash,handle)时，直接根据hash找到对应的桶，如果被占用，则往后寻找第一个空桶插入。
// 当负载因子（含墓碑）超过 75% 时自动扩容。
// 返回新的对象指针；失败返回 NULL。调用者必须使用返回的指针替换原有指针。
am_strindex_t *am_strindex_set(am_allocator_t *alloc, am_strindex_t *obj, wchar_t *str, am_value_t value) {
    if (!alloc || !obj || !str) return NULL;

    uint32_t hash = am_strindex_hash(str);

    // 负载因子超过 75% 时扩容
    if ((obj->length + obj->tombstones + 1) * 4 > obj->capacity * 3) {
        am_strindex_t *new_si = am_strindex_resize(alloc, obj, obj->capacity * 2);
        if (!new_si) return NULL;
        obj = new_si;
    }

    size_t idx = am_strindex_find_insert_slot(obj, hash);
    if (obj->slots[idx].hash == AM_STRINDEX_KEY_TOMBSTONE) {
        obj->tombstones--;
    }
    obj->slots[idx].hash = hash;
    obj->slots[idx].value = value;
    obj->length++;

    return obj;
}

// 按已知 hash 直接插入 (hash, value)，不重新计算字符串 hash。
// 当负载因子（含墓碑）超过 75% 时自动扩容。
// 返回新的对象指针；失败返回 NULL。调用者必须使用返回的指针替换原有指针。
am_strindex_t *am_strindex_set_raw(am_allocator_t *alloc, am_strindex_t *obj, uint32_t hash, am_value_t value) {
    if (!alloc || !obj) return NULL;
    if (hash == AM_STRINDEX_KEY_EMPTY || hash == AM_STRINDEX_KEY_TOMBSTONE) return NULL;

    // 负载因子超过 75% 时扩容
    if ((obj->length + obj->tombstones + 1) * 4 > obj->capacity * 3) {
        am_strindex_t *new_si = am_strindex_resize(alloc, obj, obj->capacity * 2);
        if (!new_si) return NULL;
        obj = new_si;
    }

    size_t idx = am_strindex_find_insert_slot(obj, hash);
    if (obj->slots[idx].hash == AM_STRINDEX_KEY_TOMBSTONE) {
        obj->tombstones--;
    }
    obj->slots[idx].hash = hash;
    obj->slots[idx].value = value;
    obj->length++;

    return obj;
}

// 删除指定 value（handle）所在的条目。按 value 的位模式精确匹配；删除成功返回 0；未找到返回 -1。
int32_t am_strindex_delete(am_allocator_t *alloc, am_strindex_t *obj, am_value_t value) {
    if (!alloc || !obj) return -1;

    for (size_t i = 0; i < obj->capacity; i++) {
        if (obj->slots[i].hash != AM_STRINDEX_KEY_EMPTY &&
            obj->slots[i].hash != AM_STRINDEX_KEY_TOMBSTONE &&
            obj->slots[i].value == value) {
            obj->slots[i].hash = AM_STRINDEX_KEY_TOMBSTONE;
            obj->slots[i].value = AM_VALUE_NULL;
            obj->length--;
            obj->tombstones++;

            // 墓碑过多时原地重哈希
            if (obj->tombstones * 2 > obj->capacity) {
                if (am_strindex_rehash(alloc, obj) != 0) {
                    // 内存不足，重哈希失败；删除操作本身已完成
                }
            }
            return 0;
        }
    }
    return -1;
}

// 当前有效键值对数量
size_t am_strindex_length(am_allocator_t *alloc, am_strindex_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;
    return obj->length;
}

// 物理槽位数
size_t am_strindex_capacity(am_allocator_t *alloc, am_strindex_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;
    return obj->capacity;
}
