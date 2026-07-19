#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "object.h"
#include "allocator.h"

#include "map.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 将容量向上取整为不小于它的最小 2 的幂
static size_t am_map_round_up_capacity(size_t capacity) {
    size_t cap = 1;
    while (cap < capacity) cap <<= 1;
    return cap;
}

// 查找 key 所在槽位。
// 找到返回 0；未找到返回 -1。
// 无论是否找到，*out_insert_idx 都会返回可插入位置（首个墓碑或空槽）。
static int32_t am_map_find_slot(const am_map_t *m, am_value_t key, size_t *out_insert_idx) {
    size_t idx = am_value_hash(key) & m->mask;
    size_t insert_idx = UINT32_MAX;

    while (1) {
        am_value_t k = m->slots[idx].key;
        if (k == AM_MAP_KEY_EMPTY) {
            if (insert_idx == UINT32_MAX) insert_idx = idx;
            *out_insert_idx = insert_idx;
            return -1;
        }
        if (k == AM_MAP_KEY_TOMBSTONE) {
            if (insert_idx == UINT32_MAX) insert_idx = idx;
        } else if (am_value_equal(k, key)) {
            *out_insert_idx = idx;
            return 0;
        }
        idx = (idx + 1) & m->mask;
    }
}

// 原地重哈希：清除墓碑，不改变容量
static int32_t am_map_rehash(am_allocator_t *alloc, am_map_t *map) {
    am_map_t *m = (am_map_t *)map;
    size_t cap = m->capacity;
    size_t entries_size = cap * sizeof(am_map_entry_t);

    am_map_entry_t *old_slots = (am_map_entry_t *)am_malloc(alloc, entries_size);
    if (!old_slots) return -1;
    memcpy(old_slots, m->slots, entries_size);

    for (size_t i = 0; i < cap; i++) {
        m->slots[i].key = AM_MAP_KEY_EMPTY;
        m->slots[i].value = AM_VALUE_NULL;
    }
    m->length = 0;
    m->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        if (old_slots[i].key != AM_MAP_KEY_EMPTY && old_slots[i].key != AM_MAP_KEY_TOMBSTONE) {
            size_t insert_idx;
            am_map_find_slot(m, old_slots[i].key, &insert_idx);
            m->slots[insert_idx].key = old_slots[i].key;
            m->slots[insert_idx].value = old_slots[i].value;
            m->length++;
        }
    }

    am_free(alloc, old_slots);
    return 0;
}

// 扩容并重哈希到新容量（new_capacity 会被向上取整为 2 的幂）。
// 返回新的 map 对象指针；失败返回 NULL。原 map 对象会被释放，调用者必须使用返回的新指针。
static am_map_t *am_map_resize(am_allocator_t *alloc, am_map_t *map, size_t new_capacity) {
    am_map_t *m = (am_map_t *)map;
    size_t cap = am_map_round_up_capacity(new_capacity);
    if (cap <= m->capacity) {
        // 容量未增加：仅做重哈希清理墓碑
        if (am_map_rehash(alloc, map) != 0) return NULL;
        return map;
    }

    size_t old_capacity = m->capacity;
    size_t old_entries_size = old_capacity * sizeof(am_map_entry_t);

    am_map_entry_t *old_slots = NULL;
    if (old_entries_size > 0) {
        old_slots = (am_map_entry_t *)am_malloc(alloc, old_entries_size);
        if (!old_slots) return NULL;
        memcpy(old_slots, m->slots, old_entries_size);
    }

    size_t new_total_size = sizeof(am_map_t) + cap * sizeof(am_map_entry_t);
    am_map_t *new_m = (am_map_t *)am_malloc(alloc, new_total_size);
    if (!new_m) {
        am_free(alloc, old_slots);
        return NULL;
    }

    new_m->base = m->base;
    new_m->capacity = cap;
    new_m->mask = cap - 1;
    new_m->length = 0;
    new_m->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        new_m->slots[i].key = AM_MAP_KEY_EMPTY;
        new_m->slots[i].value = AM_VALUE_NULL;
    }

    for (size_t i = 0; i < old_capacity; i++) {
        if (old_slots[i].key != AM_MAP_KEY_EMPTY && old_slots[i].key != AM_MAP_KEY_TOMBSTONE) {
            size_t insert_idx;
            am_map_find_slot(new_m, old_slots[i].key, &insert_idx);
            new_m->slots[insert_idx].key = old_slots[i].key;
            new_m->slots[insert_idx].value = old_slots[i].value;
            new_m->length++;
        }
    }

    am_free(alloc, old_slots);
    am_free(alloc, m);
    return (am_map_t *)new_m;
}

// ===============================================================================
// 构造函数
// ===============================================================================

// 以初始容量新建哈希表。capacity 会被向上取整为不小于它的最小 2 的幂。
// 所有 key 初始化为 AM_MAP_KEY_EMPTY，value 初始化为 AM_VALUE_NULL。
am_map_t *am_map_create(am_allocator_t *alloc, size_t capacity) {
    size_t cap = am_map_round_up_capacity(capacity);
    if (cap < 8) cap = 8;

    size_t total_size = sizeof(am_map_t) + cap * sizeof(am_map_entry_t);
    am_map_t *map = (am_map_t *)am_malloc(alloc, total_size);
    if (!map) return NULL;

    memset(map, 0, total_size);

    map->base.type = AM_OBJECT_TYPE_MAP;
    map->capacity = cap;
    map->mask = cap - 1;
    map->length = 0;
    map->tombstones = 0;

    for (size_t i = 0; i < cap; i++) {
        map->slots[i].key = AM_MAP_KEY_EMPTY;
        map->slots[i].value = AM_VALUE_NULL;
    }

    return (am_map_t *)map;
}

// ===============================================================================
// 析构与清理
// ===============================================================================

// 清空哈希表：对所有有效 entry，若 value 是指针则先释放，再将 key 置为 EMPTY、value 置为 NULL
int32_t am_map_clear(am_allocator_t *alloc, am_map_t *map) {
    am_map_t *m = (am_map_t *)map;
    for (size_t i = 0; i < m->capacity; i++) {
        if (m->slots[i].key != AM_MAP_KEY_EMPTY && m->slots[i].key != AM_MAP_KEY_TOMBSTONE) {
            if (am_value_is_ptr(m->slots[i].value)) {
                am_free(alloc, am_value_to_ptr(m->slots[i].value));
            }
        }
        m->slots[i].key = AM_MAP_KEY_EMPTY;
        m->slots[i].value = AM_VALUE_NULL;
    }
    m->length = 0;
    m->tombstones = 0;
    return 0;
}

// 彻底销毁哈希表对象
int32_t am_map_destroy(am_allocator_t *alloc, am_map_t *map) {
    am_map_clear(alloc, map);
    am_free(alloc, map);
    return 0;
}

// ===============================================================================
// 拷贝
// ===============================================================================

// 深拷贝：创建并返回一个与原 map 内容完全一致的新 map 对象。
// 所有 key/value 按位拷贝（与闭包 Copy 语义一致，不递归拷贝指针指向的对象）。
am_map_t *am_map_copy(am_allocator_t *alloc, am_map_t *map) {
    am_map_t *m = (am_map_t *)map;
    am_map_t *copy = am_map_create(alloc, m->capacity);
    if (!copy) return NULL;

    copy->length = m->length;
    copy->tombstones = m->tombstones;

    for (uint32_t i = 0; i < m->capacity; i++) {
        copy->slots[i].key = m->slots[i].key;
        copy->slots[i].value = m->slots[i].value;
    }

    return copy;
}

// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_map_size(am_allocator_t *alloc, am_map_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->capacity > (SIZE_MAX - sizeof(am_map_t)) / sizeof(am_map_entry_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_map_t) + obj->capacity * sizeof(am_map_entry_t);
}

// ===============================================================================
// 对象二进制转储 TODO
// ===============================================================================

// 功能说明：将散列表对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
//       压缩对象，将capacity压缩到跟length一致，丢弃墓碑和空闲槽位。
size_t am_map_dump(am_allocator_t *alloc, am_map_t *map, uint8_t *buffer, size_t offset) {
    (void)alloc;
    am_map_t *m = (am_map_t *)map;

    if (!m) return SIZE_MAX;

    size_t dump_size = sizeof(am_map_t) + m->length * sizeof(am_map_entry_t);
    if (buffer != NULL && offset != SIZE_MAX) {
        am_map_t *dump = (am_map_t *)&buffer[offset];
        dump->base = m->base;
        dump->length = m->length;
        dump->capacity = m->length;
        dump->mask = (m->length > 0) ? (m->length - 1) : 0;
        dump->tombstones = 0;

        size_t idx = 0;
        for (size_t i = 0; i < m->capacity; i++) {
            if (m->slots[i].key != AM_MAP_KEY_EMPTY && m->slots[i].key != AM_MAP_KEY_TOMBSTONE) {
                dump->slots[idx].key = m->slots[i].key;
                dump->slots[idx].value = m->slots[i].value;
                idx++;
            }
        }
    }

    return dump_size;
}


// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的散列表对象，构造散列表对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_map_t对象的指针，失败则返回NULL。
am_map_t *am_map_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    am_map_t *dump = (am_map_t *)&buffer[offset];
    if (dump->base.type != AM_OBJECT_TYPE_MAP) return NULL;

    // 重新构造一个功能完整的散列表（capacity 取不小于 length 的 2 的幂，留有空槽）。
    am_map_t *map = am_map_create(alloc, dump->length);
    if (!map) return NULL;

    for (size_t i = 0; i < dump->length; i++) {
        am_map_t *new_map = am_map_set(alloc, map, dump->slots[i].key, dump->slots[i].value);
        if (!new_map) {
            am_map_destroy(alloc, map);
            return NULL;
        }
        map = new_map;
    }

    return map;
}


// ===============================================================================
// 基本操作
// ===============================================================================

// 查找：返回对应的 value；若不存在返回 AM_VALUE_NULL
am_value_t am_map_get(am_allocator_t *alloc, am_map_t *map, am_value_t key) {
    (void)alloc;
    am_map_t *m = (am_map_t *)map;
    if (m->length == 0) return AM_VALUE_NULL;

    size_t idx;
    if (am_map_find_slot(m, key, &idx) < 0) return AM_VALUE_NULL;
    return m->slots[idx].value;
}

// 存在性检查：存在返回 0，不存在返回 -1
int32_t am_map_contains(am_allocator_t *alloc, am_map_t *map, am_value_t key) {
    (void)alloc;
    am_map_t *m = (am_map_t *)map;
    if (m->length == 0) return -1;

    size_t idx;
    return am_map_find_slot(m, key, &idx) < 0 ? -1 : 0;
}

// 不扩容地插入或修改（stable 版本）。
// 仅做插入/替换，绝不分配或释放 map 对象本身，因此 map 指针保持稳定。
// 若 map 已满且 key 不存在，返回 -1；成功返回 0。
// 替换已存在的 key 时，会释放旧的指针 value。
int32_t am_map_set_stable(am_allocator_t *alloc, am_map_t *map, am_value_t key, am_value_t value) {
    if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) return -1;

    am_map_t *m = (am_map_t *)map;

    // 表已完全填满（无空槽、无墓碑）：只能替换已有 key。
    if (m->length == m->capacity) {
        size_t idx = am_value_hash(key) & m->mask;
        for (size_t i = 0; i < m->capacity; i++) {
            am_value_t k = m->slots[idx].key;
            if (am_value_equal(k, key)) {
                if (am_value_is_ptr(m->slots[idx].value)) {
                    am_free(alloc, am_value_to_ptr(m->slots[idx].value));
                }
                m->slots[idx].value = value;
                return 0;
            }
            idx = (idx + 1) & m->mask;
        }
        return -1; // 表满且 key 不存在
    }

    // 存在空槽或墓碑，find_slot 必然终止
    size_t idx;
    int32_t found = am_map_find_slot(m, key, &idx);
    if (found >= 0) {
        if (am_value_is_ptr(m->slots[idx].value)) {
            am_free(alloc, am_value_to_ptr(m->slots[idx].value));
        }
        m->slots[idx].value = value;
    } else {
        if (m->slots[idx].key == AM_MAP_KEY_TOMBSTONE) {
            m->tombstones--;
        }
        m->slots[idx].key = key;
        m->slots[idx].value = value;
        m->length++;
    }
    return 0;
}

// 插入或修改。
// 插入新键值对；若 key 已存在则替换 value，并释放旧的指针 value。
// 当负载因子（含墓碑）超过 75% 时自动扩容。
// 返回新的 map 对象指针；失败返回 NULL。调用者必须使用返回的指针替换原有 map 指针。
am_map_t *am_map_set(am_allocator_t *alloc, am_map_t *map, am_value_t key, am_value_t value) {
    if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) return NULL;

    am_map_t *m = (am_map_t *)map;

    // 负载因子超过 75% 时扩容
    if ((m->length + m->tombstones + 1) * 4 > m->capacity * 3) {
        am_map_t *new_map = am_map_resize(alloc, map, m->capacity * 2);
        if (!new_map) return NULL;
        map = new_map;
        m = (am_map_t *)map;
    }

    size_t idx;
    int32_t found = am_map_find_slot(m, key, &idx);
    if (found >= 0) {
        if (am_value_is_ptr(m->slots[idx].value)) {
            am_free(alloc, am_value_to_ptr(m->slots[idx].value));
        }
        m->slots[idx].value = value;
    } else {
        if (m->slots[idx].key == AM_MAP_KEY_TOMBSTONE) {
            m->tombstones--;
        }
        m->slots[idx].key = key;
        m->slots[idx].value = value;
        m->length++;
    }
    return map;
}

// 删除指定 key。若存在且 value 为指针则释放。
// 删除成功返回 0；key 不存在返回 -1。
int32_t am_map_delete(am_allocator_t *alloc, am_map_t *map, am_value_t key) {
    am_map_t *m = (am_map_t *)map;
    if (m->length == 0) return -1;

    size_t idx;
    if (am_map_find_slot(m, key, &idx) < 0) return -1;

    if (am_value_is_ptr(m->slots[idx].value)) {
        am_free(alloc, am_value_to_ptr(m->slots[idx].value));
    }
    m->slots[idx].key = AM_MAP_KEY_TOMBSTONE;
    m->slots[idx].value = AM_VALUE_NULL;
    m->length--;
    m->tombstones++;

    // 墓碑过多时原地重哈希（失败则 map 未被修改，继续保留墓碑）
    if (m->tombstones * 2 > m->capacity) {
        if (am_map_rehash(alloc, map) != 0) {
            // 内存不足，重哈希失败；删除操作本身已完成
        }
    }
    return 0;
}

// 当前有效键值对数量
size_t am_map_length(am_allocator_t *alloc, am_map_t *map) {
    (void)alloc;
    return ((am_map_t *)map)->length;
}

// 物理槽位数
size_t am_map_capacity(am_allocator_t *alloc, am_map_t *map) {
    (void)alloc;
    return ((am_map_t *)map)->capacity;
}

// ===============================================================================
// 遍历与键列表
// ===============================================================================

// 遍历所有有效键值对，调用回调 cb
void am_map_iter(am_allocator_t *alloc, am_map_t *map, am_map_iter_callback_t cb, void *user_data) {
    (void)alloc;
    if (!cb) return;
    am_map_t *m = (am_map_t *)map;
    for (size_t i = 0; i < m->capacity; i++) {
        if (m->slots[i].key != AM_MAP_KEY_EMPTY && m->slots[i].key != AM_MAP_KEY_TOMBSTONE) {
            cb(m->slots[i].key, m->slots[i].value, user_data);
        }
    }
}

// 获取所有 key 的副本列表，使用 allocator 分配。
// 调用者负责使用 am_free(alloc, ...) 释放返回的指针；size 为 0 时返回 NULL。
am_value_t *am_map_keys(am_allocator_t *alloc, am_map_t *map) {
    if (!alloc || !map) return NULL;
    am_map_t *m = (am_map_t *)map;
    if (m->length == 0) return NULL;

    am_value_t *keys = (am_value_t *)am_malloc(alloc, m->length * sizeof(am_value_t));
    if (!keys) return NULL;

    size_t count = 0;
    for (size_t i = 0; i < m->capacity; i++) {
        if (m->slots[i].key != AM_MAP_KEY_EMPTY && m->slots[i].key != AM_MAP_KEY_TOMBSTONE) {
            keys[count++] = m->slots[i].key;
        }
    }
    return keys;
}
