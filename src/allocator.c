#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdio.h>

#include "allocator.h"
#include "object.h"
#include "map.h"
#include "heap.h"

#define AM_ALLOC_ALIGN      (sizeof(void *))
#define AM_ALIGN_UP(x, a)   (((x) + (a) - 1) & ~((a) - 1))
#define AM_BLOCK_USED_FLAG  ((size_t)1)

/* 用于压缩报告：当前活动的内存池。单池场景下使用。 */
static am_allocator_pool_t *g_current_pool = NULL;

/* =============================================================================
 * VM 工作区分配器：Segregated Free-List + 边界标签合并
 *
 * 工作区对象生命周期差异大（map/list 频繁扩容，临时缓冲区等），且代码中
 * 大量调用 am_free/am_realloc。若继续使用 bump pointer，废弃对象会钉死
 * 内存，导致 VM 空闲空间快速耗尽。改用分离空闲链表：
 *   - 小/中对象按预定义 size class 分桶，分配 O(1)；
 *   - 大对象使用单独的有序空闲链表；
 *   - 释放时按边界标签与相邻空闲块合并，再插回对应桶。
 * ============================================================================ */

/* 预定义 size classes：
 *   48..512  按 16 字节递增（减少 map/list 等常见小对象的内部碎片）
 *   1024..524288 按 2 的幂递增
 *   大于 524288 的块放入 large_free_head 链表 */
static const size_t am_vm_size_classes[] = {
    48, 64, 80, 96, 112, 128, 144, 160, 176, 192,
    208, 224, 240, 256, 272, 288, 304, 320, 336, 352,
    368, 384, 400, 416, 432, 448, 464, 480, 496, 512,
    1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288
};
#define AM_VM_N_CLASSES (sizeof(am_vm_size_classes) / sizeof(am_vm_size_classes[0]))
#define AM_VM_SMALL_MAX_CLASS (524288)

typedef struct am_vm_block_header_t {
    size_t size;       /* 总块大小（含头部），最低位为 1 表示已分配 */
    size_t prev_size;  /* 前一个块的总大小，首块为 0 */
    struct am_vm_block_header_t *next_free;
    struct am_vm_block_header_t *prev_free;
} am_vm_block_header_t;

#define AM_VM_HEADER_SIZE AM_ALIGN_UP(sizeof(am_vm_block_header_t), AM_ALLOC_ALIGN)
#define AM_VM_MIN_BLOCK_SIZE (AM_VM_HEADER_SIZE + AM_ALLOC_ALIGN)

typedef struct am_segregated_state_t {
    uint8_t *base;      /* VM 区起始地址 */
    uint8_t *end;       /* VM 区结束地址 */
    size_t used_bytes;  /* 已分配字节数 */
    am_vm_block_header_t *buckets[AM_VM_N_CLASSES];
    am_vm_block_header_t *large_free_head; /* 管理大于 AM_VM_SMALL_MAX_CLASS 的块 */
} am_segregated_state_t;

static inline size_t vm_block_real_size(const am_vm_block_header_t *b) {
    return b->size & ~AM_BLOCK_USED_FLAG;
}

static inline bool vm_block_is_used(const am_vm_block_header_t *b) {
    return (b->size & AM_BLOCK_USED_FLAG) != 0;
}

static inline void vm_block_set_size(am_vm_block_header_t *b, size_t sz, bool used) {
    b->size = (sz & ~AM_BLOCK_USED_FLAG) | (used ? AM_BLOCK_USED_FLAG : 0);
}

static inline uint8_t *vm_block_payload(const am_vm_block_header_t *b) {
    return (uint8_t *)b + AM_VM_HEADER_SIZE;
}

static inline am_vm_block_header_t *vm_block_from_payload(void *p) {
    return (am_vm_block_header_t *)((uint8_t *)p - AM_VM_HEADER_SIZE);
}

static inline am_vm_block_header_t *vm_block_next(const am_segregated_state_t *s,
                                                   const am_vm_block_header_t *b) {
    uint8_t *p = (uint8_t *)b + vm_block_real_size(b);
    if (p >= s->end) return NULL;
    return (am_vm_block_header_t *)p;
}

static inline am_vm_block_header_t *vm_block_prev(const am_segregated_state_t *s,
                                                   const am_vm_block_header_t *b) {
    size_t ps = b->prev_size & ~AM_BLOCK_USED_FLAG;
    (void)s;
    if (ps == 0) return NULL;
    return (am_vm_block_header_t *)((uint8_t *)b - ps);
}

/* 扫描 VM 区，返回第一个已用块相对于 VM 基址的偏移。
 * 若 VM 为空或全部空闲，返回 VM 区总容量。
 * 用于判断边界能否向 heap 方向移动：只要新边界不超过第一个已用块地址，
 * 低端空闲空间就可以安全地划归 heap。 */
static size_t vm_lowest_used_offset(const am_segregated_state_t *s) {
    if (!s || s->base >= s->end) return 0;
    if (s->used_bytes == 0) return (size_t)(s->end - s->base);

    uint8_t *p = s->base;
    while (p < s->end) {
        am_vm_block_header_t *b = (am_vm_block_header_t *)p;
        if (vm_block_is_used(b)) return (size_t)(p - s->base);
        p += vm_block_real_size(b);
    }
    return (size_t)(s->end - s->base);
}

/* 根据块大小返回 size class 索引；若超过所有桶则返回 SIZE_MAX */
static size_t vm_size_to_class_index(size_t size) {
    if (size <= 512) {
        if (size <= 48) return 0;
        return ((size + 15) / 16) - 3; /* class[0] = 48 = 3*16 */
    }
    if (size <= AM_VM_SMALL_MAX_CLASS) {
        size_t s = 1024;
        size_t idx = 30;
        while (s < size) {
            s <<= 1;
            idx++;
        }
        return idx;
    }
    return SIZE_MAX;
}

/* 将空闲块插入对应 bucket 或 large list */
static void vm_bucket_insert(am_segregated_state_t *s, am_vm_block_header_t *b) {
    size_t sz = vm_block_real_size(b);
    size_t idx = vm_size_to_class_index(sz);
    if (idx != SIZE_MAX) {
        b->prev_free = NULL;
        b->next_free = s->buckets[idx];
        if (s->buckets[idx]) s->buckets[idx]->prev_free = b;
        s->buckets[idx] = b;
    } else {
        b->prev_free = NULL;
        b->next_free = s->large_free_head;
        if (s->large_free_head) s->large_free_head->prev_free = b;
        s->large_free_head = b;
    }
}

/* 从 bucket 或 large list 中移除空闲块 */
static void vm_bucket_remove(am_segregated_state_t *s, am_vm_block_header_t *b) {
    size_t sz = vm_block_real_size(b);
    size_t idx = vm_size_to_class_index(sz);
    if (idx != SIZE_MAX) {
        if (b->prev_free) b->prev_free->next_free = b->next_free;
        else s->buckets[idx] = b->next_free;
        if (b->next_free) b->next_free->prev_free = b->prev_free;
    } else {
        if (b->prev_free) b->prev_free->next_free = b->next_free;
        else s->large_free_head = b->next_free;
        if (b->next_free) b->next_free->prev_free = b->prev_free;
    }
    b->prev_free = NULL;
    b->next_free = NULL;
}

/* 将释放/拆分出的块尝试与相邻块合并，再插回桶中 */
static void vm_coalesce_and_insert(am_segregated_state_t *s, am_vm_block_header_t *b) {
    size_t new_size = vm_block_real_size(b);
    am_vm_block_header_t *prev = vm_block_prev(s, b);
    am_vm_block_header_t *next = vm_block_next(s, b);

    if (prev && !vm_block_is_used(prev)) {
        vm_bucket_remove(s, prev);
        new_size += vm_block_real_size(prev);
        b = prev;
    }
    if (next && !vm_block_is_used(next)) {
        vm_bucket_remove(s, next);
        new_size += vm_block_real_size(next);
    }

    vm_block_set_size(b, new_size, false);
    am_vm_block_header_t *new_next = vm_block_next(s, b);
    if (new_next) new_next->prev_size = new_size;
    vm_bucket_insert(s, b);
}

/* 在 large list 中查找足够大的空闲块，优先返回地址最高（最靠近 VM 区顶部）的块，
 * 使已用块尽量向 VM 区顶部聚集，低端留出连续空闲空间供边界向 heap 方向移动。 */
static am_vm_block_header_t *vm_find_large_block(am_segregated_state_t *s, size_t min_size) {
    am_vm_block_header_t *best = NULL;
    am_vm_block_header_t *best_prev = NULL;
    am_vm_block_header_t *prev = NULL;
    for (am_vm_block_header_t *cur = s->large_free_head; cur; cur = cur->next_free) {
        if (vm_block_real_size(cur) >= min_size) {
            if (!best || cur > best) {
                best = cur;
                best_prev = prev;
            }
        }
        prev = cur;
    }
    if (!best) return NULL;

    if (best_prev) best_prev->next_free = best->next_free;
    else s->large_free_head = best->next_free;
    if (best->next_free) best->next_free->prev_free = best_prev;
    best->next_free = best->prev_free = NULL;
    return best;
}

/* 从指定 class 开始向上查找足够大的空闲块。
 * 在每个 size class 内部选择地址最高（最靠近 VM 区顶部）的块，
 * 配合“从高端拆分”策略，使已用块向 VM 区顶部聚集。 */
static am_vm_block_header_t *vm_find_free_block(am_segregated_state_t *s, size_t class_idx, size_t alloc_size) {
    for (size_t i = class_idx; i < AM_VM_N_CLASSES; i++) {
        am_vm_block_header_t *prev = NULL;
        am_vm_block_header_t *best = NULL;
        am_vm_block_header_t *best_prev = NULL;
        for (am_vm_block_header_t *cur = s->buckets[i]; cur; cur = cur->next_free) {
            size_t cur_sz = vm_block_real_size(cur);
            if (cur_sz >= alloc_size) {
                if (!best || cur > best) {
                    best = cur;
                    best_prev = prev;
                }
            }
            prev = cur;
        }
        if (best) {
            if (best_prev) best_prev->next_free = best->next_free;
            else s->buckets[i] = best->next_free;
            if (best->next_free) best->next_free->prev_free = best_prev;
            best->next_free = best->prev_free = NULL;
            return best;
        }
    }
    return vm_find_large_block(s, alloc_size);
}

static void *segregated_malloc(void *state, size_t size) {
    am_segregated_state_t *s = (am_segregated_state_t *)state;
    if (size == 0 || !s) return NULL;

    size_t needed = AM_ALIGN_UP(AM_VM_HEADER_SIZE + size, AM_ALLOC_ALIGN);
    if (needed < AM_VM_MIN_BLOCK_SIZE) needed = AM_VM_MIN_BLOCK_SIZE;

    size_t class_idx = vm_size_to_class_index(needed);
    size_t alloc_size = (class_idx != SIZE_MAX) ? am_vm_size_classes[class_idx] : needed;

    am_vm_block_header_t *b;
    if (class_idx != SIZE_MAX) {
        b = vm_find_free_block(s, class_idx, alloc_size);
    } else {
        b = vm_find_large_block(s, needed);
    }
    if (!b) {
        fprintf(stderr, "[allocator] VM segregated 分配失败: 请求 %zu bytes (含头部对齐后 %zu), 已用 %zu / %zu bytes\n",
                size, needed, s->used_bytes, (size_t)(s->end - s->base));
        return NULL;
    }

    size_t block_sz = vm_block_real_size(b);

    /* 拆分：从块的高端分配，低端保留为空闲。这样已用块尽量向 VM 区顶部聚集，
     * 低端形成连续空闲区，便于在需要时把边界向 heap 方向移动。 */
    if (block_sz >= alloc_size + AM_VM_MIN_BLOCK_SIZE) {
        size_t split_size = block_sz - alloc_size;
        am_vm_block_header_t *freeb = b;                       // 低端：保持空闲
        am_vm_block_header_t *usedb = (am_vm_block_header_t *)((uint8_t *)b + split_size); // 高端：分配出去
        vm_block_set_size(freeb, split_size, false);
        // freeb->prev_size 继承原 b 的 prev_size
        vm_block_set_size(usedb, alloc_size, true);
        usedb->prev_size = split_size;
        am_vm_block_header_t *next = vm_block_next(s, usedb);
        if (next) next->prev_size = alloc_size;
        vm_bucket_insert(s, freeb);
        b = usedb;
        block_sz = alloc_size;
    }

    vm_block_set_size(b, block_sz, true);
    s->used_bytes += block_sz;
    return vm_block_payload(b);
}

static void *segregated_calloc(void *state, size_t size) {
    void *p = segregated_malloc(state, size);
    if (p) memset(p, 0, size);
    return p;
}

static void segregated_free(void *state, void *ptr) {
    am_segregated_state_t *s = (am_segregated_state_t *)state;
    if (!ptr || !s) return;

    am_vm_block_header_t *b = vm_block_from_payload(ptr);
    if (!vm_block_is_used(b)) return; /* 重复释放 */

    s->used_bytes -= vm_block_real_size(b);
    vm_block_set_size(b, vm_block_real_size(b), false);
    vm_coalesce_and_insert(s, b);
}

static void *segregated_realloc(void *state, void *ptr, size_t size) {
    if (ptr == NULL) return segregated_malloc(state, size);
    if (size == 0) {
        segregated_free(state, ptr);
        return NULL;
    }

    am_vm_block_header_t *b = vm_block_from_payload(ptr);
    size_t old_payload = vm_block_real_size(b) - AM_VM_HEADER_SIZE;
    if (size <= old_payload) return ptr;

    void *new_ptr = segregated_malloc(state, size);
    if (new_ptr) {
        size_t copy = old_payload < size ? old_payload : size;
        memcpy(new_ptr, ptr, copy);
        segregated_free(state, ptr);
    }
    return new_ptr;
}

static void segregated_destroy(void *state) {
    (void)state;
}

static const am_allocator_vtable_t segregated_vtable = {
    segregated_malloc,
    segregated_calloc,
    segregated_realloc,
    segregated_free,
    segregated_destroy
};

/* =============================================================================
 * 堆区分配器：First-Fit Free-List + 边界标签合并
 * 这是受 GC 管理的用户堆区的底层物理内存分配器。
 * ============================================================================ */

typedef struct am_heap_block_header_t {
    size_t size;       /* 总块大小（含头部），最低位为 1 表示已分配 */
    size_t prev_size;  /* 前一个块的总大小，首块为 0 */
    struct am_heap_block_header_t *next_free;
    struct am_heap_block_header_t *prev_free;
    bool live;         /* 压缩阶段使用的临时标记 */
} am_heap_block_header_t;

#define AM_HEAP_HEADER_SIZE AM_ALIGN_UP(sizeof(am_heap_block_header_t), AM_ALLOC_ALIGN)
#define AM_BLOCK_MIN_SIZE   (AM_HEAP_HEADER_SIZE + AM_ALLOC_ALIGN)

typedef struct am_freelist_state_t {
    uint8_t *base;
    size_t capacity;
    am_heap_block_header_t *free_list_head;
    size_t used_bytes;
} am_freelist_state_t;

static inline size_t block_real_size(const am_heap_block_header_t *b) {
    return b->size & ~AM_BLOCK_USED_FLAG;
}

static inline bool block_is_used(const am_heap_block_header_t *b) {
    return (b->size & AM_BLOCK_USED_FLAG) != 0;
}

static inline void block_set_size(am_heap_block_header_t *b, size_t sz, bool used) {
    b->size = (sz & ~AM_BLOCK_USED_FLAG) | (used ? AM_BLOCK_USED_FLAG : 0);
}

static inline uint8_t *block_payload(const am_heap_block_header_t *b) {
    return (uint8_t *)b + AM_HEAP_HEADER_SIZE;
}

static inline am_heap_block_header_t *block_from_payload(void *p) {
    return (am_heap_block_header_t *)((uint8_t *)p - AM_HEAP_HEADER_SIZE);
}

static inline am_heap_block_header_t *block_next(const am_freelist_state_t *s,
                                                  const am_heap_block_header_t *b) {
    uint8_t *p = (uint8_t *)b + block_real_size(b);
    if (p >= s->base + s->capacity) return NULL;
    return (am_heap_block_header_t *)p;
}

static inline am_heap_block_header_t *block_prev(const am_freelist_state_t *s,
                                                  const am_heap_block_header_t *b) {
    size_t ps = b->prev_size & ~AM_BLOCK_USED_FLAG;
    (void)s;
    if (ps == 0) return NULL;
    return (am_heap_block_header_t *)((uint8_t *)b - ps);
}

static void freelist_insert(am_freelist_state_t *s, am_heap_block_header_t *b) {
    b->prev_free = NULL;
    b->next_free = s->free_list_head;
    if (s->free_list_head) {
        s->free_list_head->prev_free = b;
    }
    s->free_list_head = b;
}

static void freelist_remove(am_freelist_state_t *s, am_heap_block_header_t *b) {
    if (b->prev_free) {
        b->prev_free->next_free = b->next_free;
    } else {
        s->free_list_head = b->next_free;
    }
    if (b->next_free) {
        b->next_free->prev_free = b->prev_free;
    }
    b->prev_free = NULL;
    b->next_free = NULL;
}

static void freelist_coalesce(am_freelist_state_t *s, am_heap_block_header_t *b) {
    size_t new_size = block_real_size(b);
    am_heap_block_header_t *prev = block_prev(s, b);
    am_heap_block_header_t *next = block_next(s, b);

    if (prev && !block_is_used(prev)) {
        freelist_remove(s, prev);
        new_size += block_real_size(prev);
        b = prev;
    }
    if (next && !block_is_used(next)) {
        freelist_remove(s, next);
        new_size += block_real_size(next);
    }

    block_set_size(b, new_size, false);
    b->live = false;

    am_heap_block_header_t *new_next = block_next(s, b);
    if (new_next) {
        new_next->prev_size = new_size;
    }
    freelist_insert(s, b);
}

static void *freelist_malloc(void *state, size_t size) {
    am_freelist_state_t *s = (am_freelist_state_t *)state;
    if (size == 0 || !s) return NULL;

    size_t needed = AM_ALIGN_UP(AM_HEAP_HEADER_SIZE + size, AM_ALLOC_ALIGN);
    if (needed < AM_BLOCK_MIN_SIZE) needed = AM_BLOCK_MIN_SIZE;

    am_heap_block_header_t *cur = s->free_list_head;
    while (cur) {
        size_t cur_size = block_real_size(cur);
        if (cur_size >= needed) {
            freelist_remove(s, cur);
            size_t remainder = cur_size - needed;
            if (remainder >= AM_BLOCK_MIN_SIZE) {
                am_heap_block_header_t *split = (am_heap_block_header_t *)((uint8_t *)cur + needed);
                block_set_size(split, remainder, false);
                split->prev_size = needed;
                split->live = false;
                am_heap_block_header_t *split_next = block_next(s, split);
                if (split_next) split_next->prev_size = remainder;
                freelist_insert(s, split);
                block_set_size(cur, needed, true);
            } else {
                block_set_size(cur, cur_size, true);
            }
            cur->live = false;
            s->used_bytes += block_real_size(cur);
            return block_payload(cur);
        }
        cur = cur->next_free;
    }
    fprintf(stderr, "[allocator] heap freelist 分配失败: 请求 %zu bytes (含头部对齐后 %zu), 堆已用 %zu / %zu bytes\n",
            size, needed, s->used_bytes, s->capacity);
    return NULL;
}

static void *freelist_calloc(void *state, size_t size) {
    void *p = freelist_malloc(state, size);
    if (p) memset(p, 0, size);
    return p;
}

static void freelist_free(void *state, void *ptr) {
    am_freelist_state_t *s = (am_freelist_state_t *)state;
    if (!ptr || !s) return;

    am_heap_block_header_t *b = block_from_payload(ptr);
    if (!block_is_used(b)) return; /* 重复释放 */

    s->used_bytes -= block_real_size(b);
    block_set_size(b, block_real_size(b), false);
    b->live = false;
    freelist_coalesce(s, b);
}

static void *freelist_realloc(void *state, void *ptr, size_t size) {
    if (ptr == NULL) return freelist_malloc(state, size);
    if (size == 0) {
        freelist_free(state, ptr);
        return NULL;
    }

    am_heap_block_header_t *b = block_from_payload(ptr);
    size_t old_payload = block_real_size(b) - AM_HEAP_HEADER_SIZE;
    if (size <= old_payload) return ptr;

    void *new_ptr = freelist_malloc(state, size);
    if (new_ptr) {
        size_t copy = old_payload < size ? old_payload : size;
        memcpy(new_ptr, ptr, copy);
        freelist_free(state, ptr);
    }
    return new_ptr;
}

static void freelist_destroy(void *state) {
    (void)state;
}

static const am_allocator_vtable_t freelist_vtable = {
    freelist_malloc,
    freelist_calloc,
    freelist_realloc,
    freelist_free,
    freelist_destroy
};

/* =============================================================================
 * 内存池：统一管理 VM 工作区与堆区
 * ============================================================================ */

struct am_allocator_pool_t {
    uint8_t *base;
    size_t total_size;
    size_t boundary;

    am_segregated_state_t vm_state;
    am_allocator_t vm_alloc;

    am_freelist_state_t heap_state;
    am_allocator_t heap_alloc;
};

static void pool_init_heap(am_allocator_pool_t *pool) {
    am_freelist_state_t *s = &pool->heap_state;
    s->base = pool->base;
    s->capacity = pool->boundary;
    s->used_bytes = 0;
    s->free_list_head = NULL;

    am_heap_block_header_t *b = (am_heap_block_header_t *)s->base;
    block_set_size(b, s->capacity, false);
    b->prev_size = 0;
    b->next_free = NULL;
    b->prev_free = NULL;
    b->live = false;
    s->free_list_head = b;
}

static void pool_init_vm(am_allocator_pool_t *pool) {
    am_segregated_state_t *s = &pool->vm_state;
    s->base = pool->base + pool->boundary;
    s->end = pool->base + pool->total_size;
    s->used_bytes = 0;
    for (size_t i = 0; i < AM_VM_N_CLASSES; i++) {
        s->buckets[i] = NULL;
    }
    s->large_free_head = NULL;

    size_t cap = (size_t)(s->end - s->base);
    if (cap >= AM_VM_MIN_BLOCK_SIZE) {
        am_vm_block_header_t *b = (am_vm_block_header_t *)s->base;
        vm_block_set_size(b, cap, false);
        b->prev_size = 0;
        vm_bucket_insert(s, b);
    }
}

am_allocator_pool_t *am_allocator_pool_create(size_t total_size) {
    am_allocator_pool_t *pool = (am_allocator_pool_t *)malloc(sizeof(am_allocator_pool_t));
    if (!pool) {
        fprintf(stderr, "[allocator] 内存池控制块分配失败: sizeof=%zu\n", sizeof(am_allocator_pool_t));
        return NULL;
    }

    pool->base = (uint8_t *)malloc(total_size);
    if (!pool->base) {
        fprintf(stderr, "[allocator] 内存池底层内存分配失败: 请求 %zu bytes\n", total_size);
        free(pool);
        return NULL;
    }
    pool->total_size = total_size;
    pool->boundary = (total_size / 2) & ~(AM_ALLOC_ALIGN - 1);

    pool_init_heap(pool);
    pool_init_vm(pool);

    g_current_pool = pool;

    pool->heap_alloc.vtable = &freelist_vtable;
    pool->heap_alloc.state = &pool->heap_state;

    pool->vm_alloc.vtable = &segregated_vtable;
    pool->vm_alloc.state = &pool->vm_state;

    return pool;
}

void am_allocator_pool_destroy(am_allocator_pool_t *pool) {
    if (!pool) return;
    if (g_current_pool == pool) {
        g_current_pool = NULL;
    }
    if (pool->base) {
        free(pool->base);
        pool->base = NULL;
    }
    free(pool);
}

am_allocator_t *am_allocator_pool_get_vm(am_allocator_pool_t *pool) {
    if (!pool) return NULL;
    return &pool->vm_alloc;
}

am_allocator_t *am_allocator_pool_get_heap(am_allocator_pool_t *pool) {
    if (!pool) return NULL;
    return &pool->heap_alloc;
}

void am_allocator_pool_reset_vm(am_allocator_pool_t *pool) {
    if (!pool) return;
    pool_init_vm(pool);
}

void am_allocator_pool_reset_heap(am_allocator_pool_t *pool) {
    if (!pool) return;
    pool_init_heap(pool);
}

size_t am_allocator_pool_total_size(const am_allocator_pool_t *pool) {
    return pool ? pool->total_size : 0;
}

size_t am_allocator_pool_vm_used(const am_allocator_pool_t *pool) {
    if (!pool) return 0;
    return pool->vm_state.used_bytes;
}

size_t am_allocator_pool_heap_used(const am_allocator_pool_t *pool) {
    if (!pool) return 0;
    return pool->heap_state.used_bytes;
}

size_t am_allocator_pool_heap_capacity(const am_allocator_pool_t *pool) {
    if (!pool) return 0;
    return pool->boundary;
}

am_allocator_pool_t *am_allocator_pool_current(void) {
    return g_current_pool;
}

/* 计算 pos 之前紧邻的已分配/空闲块大小（从堆首线性扫描），用于重建边界后的空闲块 prev_size。 */
static size_t pool_prev_block_size(const am_freelist_state_t *s, const uint8_t *pos) {
    uint8_t *p = s->base;
    size_t last_size = 0;
    while (p < pos) {
        am_heap_block_header_t *b = (am_heap_block_header_t *)p;
        last_size = block_real_size(b);
        if (p + last_size >= pos) break;
        p += last_size;
    }
    return last_size;
}

/* 返回 heap 区顶部（紧贴 capacity）的连续空闲块大小。若顶部不是空闲块则返回 0。 */
static size_t heap_top_free_size(const am_freelist_state_t *s) {
    am_heap_block_header_t *top_free = NULL;
    uint8_t *p = s->base;
    while (p < s->base + s->capacity) {
        am_heap_block_header_t *b = (am_heap_block_header_t *)p;
        if (!block_is_used(b)) top_free = b;
        p += block_real_size(b);
    }
    if (!top_free) return 0;
    size_t free_start = (size_t)((uint8_t *)top_free - s->base);
    size_t free_size = block_real_size(top_free);
    if (free_start + free_size != s->capacity) return 0;
    return free_size;
}

/* 在不移动 heap 对象的前提下，按新的 boundary 重新初始化 heap 空闲链表。
 * - 收缩时（new_boundary <= capacity）假设 heap 已压缩：已用块集中在底部，
 *   空闲块从 used_bytes 开始延伸到新边界。
 * - 扩张时（new_boundary > capacity）要求 heap 顶部存在连续空闲块，
 *   并将其延伸到新边界。 */
static int32_t pool_reinit_heap_at(am_allocator_pool_t *pool, size_t new_boundary) {
    am_freelist_state_t *s = &pool->heap_state;
    if (new_boundary < s->used_bytes) return -1;

    if (new_boundary > s->capacity) {
        // heap 扩张：延伸顶部空闲块
        size_t top_free = heap_top_free_size(s);
        if (top_free == 0) return -1;
        size_t free_start = s->capacity - top_free;
        am_heap_block_header_t *freeb = (am_heap_block_header_t *)(s->base + free_start);
        s->capacity = new_boundary;
        block_set_size(freeb, new_boundary - free_start, false);
        return 0;
    }

    size_t free_size = new_boundary - s->used_bytes;
    if (free_size != 0 && free_size < AM_BLOCK_MIN_SIZE) return -1;

    s->capacity = new_boundary;
    if (free_size == 0) {
        s->free_list_head = NULL;
        return 0;
    }

    am_heap_block_header_t *freeb = (am_heap_block_header_t *)(pool->base + s->used_bytes);
    block_set_size(freeb, free_size, false);
    freeb->prev_size = (s->used_bytes > 0) ? pool_prev_block_size(s, (uint8_t *)freeb) : 0;
    freeb->next_free = NULL;
    freeb->prev_free = NULL;
    freeb->live = false;
    s->free_list_head = freeb;
    return 0;
}

/* 按新的 boundary 重新初始化 VM segregated 分配器。
 * - 若 VM 为空（used_bytes == 0），允许边界向任意方向移动。
 * - 若边界左移（VM 扩张），保留现有 VM 对象，把新增区域 [new_base, old_base)
 *   作为空闲块加入。
 * - 若边界右移（heap 扩张），调用前必须保证 [old_base, new_base) 内没有已用块，
 *   即低端空闲块可以全部划归 heap。 */
static void pool_reinit_vm_at(am_allocator_pool_t *pool, size_t new_boundary) {
    am_segregated_state_t *s = &pool->vm_state;
    uint8_t *new_base = pool->base + new_boundary;

    if (s->used_bytes == 0) {
        // VM 为空：直接按新区域重新开始
        s->base = new_base;
        s->end = pool->base + pool->total_size;
        s->used_bytes = 0;
        for (size_t i = 0; i < AM_VM_N_CLASSES; i++) {
            s->buckets[i] = NULL;
        }
        s->large_free_head = NULL;

        size_t cap = (size_t)(s->end - s->base);
        if (cap >= AM_VM_MIN_BLOCK_SIZE) {
            am_vm_block_header_t *b = (am_vm_block_header_t *)s->base;
            vm_block_set_size(b, cap, false);
            b->prev_size = 0;
            vm_bucket_insert(s, b);
        }
        return;
    }

    uint8_t *old_base = s->base;
    s->base = new_base;
    s->end = pool->base + pool->total_size;

    if (new_base <= old_base) {
        // VM 扩张（边界左移）：新增低端空间
        size_t added = (size_t)(old_base - new_base);
        if (added >= AM_VM_MIN_BLOCK_SIZE) {
            am_vm_block_header_t *b = (am_vm_block_header_t *)new_base;
            vm_block_set_size(b, added, false);
            b->prev_size = 0;
            // 与紧邻的已有块连接
            am_vm_block_header_t *next = vm_block_next(s, b);
            if (next) next->prev_size = added;
            vm_coalesce_and_insert(s, b);
        }
    } else {
        // VM 收缩（边界右移，heap 扩张）：把 [old_base, new_base) 移出 VM，
        // 保留 [new_base, vm_used_low) 作为新的低端空闲块。
        size_t removed = (size_t)(new_base - old_base);
        am_vm_block_header_t *first = (am_vm_block_header_t *)old_base;
        size_t first_sz = vm_block_real_size(first);
        if (removed > first_sz) removed = first_sz; // 防御性截断，理论上不会发生
        vm_bucket_remove(s, first);

        size_t remaining = first_sz - removed;
        if (remaining >= AM_VM_MIN_BLOCK_SIZE) {
            am_vm_block_header_t *freeb = (am_vm_block_header_t *)new_base;
            vm_block_set_size(freeb, remaining, false);
            freeb->prev_size = 0;
            am_vm_block_header_t *next = vm_block_next(s, freeb);
            if (next) next->prev_size = remaining;
            vm_bucket_insert(s, freeb);
        } else {
            // remaining 为 0：第一个已用块直接位于 VM 区首
            am_vm_block_header_t *next = vm_block_next(s, first);
            if (next) next->prev_size = 0;
        }
    }
}

int32_t am_allocator_pool_adjust_boundary(am_allocator_pool_t *pool, double ratio) {
    if (!pool) return -1;

    double min_ratio = AM_POOL_MIN_HEAP_RATIO;
    double max_ratio = 1.0 - AM_POOL_MIN_VM_RATIO;
    if (ratio < min_ratio) ratio = min_ratio;
    if (ratio > max_ratio) ratio = max_ratio;

    size_t align_mask = ~(AM_ALLOC_ALIGN - 1);
    size_t min_boundary = ((size_t)(pool->total_size * min_ratio)) & align_mask;
    size_t max_boundary = ((size_t)(pool->total_size * max_ratio)) & align_mask;
    size_t new_boundary = ((size_t)(pool->total_size * ratio)) & align_mask;

    if (new_boundary < min_boundary) new_boundary = min_boundary;
    if (new_boundary > max_boundary) new_boundary = max_boundary;
    if (new_boundary == pool->boundary) return 0;

    if (new_boundary > pool->boundary) {
        // heap 扩张：要求 VM 区低端有足够连续空闲空间
        size_t vm_free_bottom = vm_lowest_used_offset(&pool->vm_state);
        size_t vm_used_low = pool->boundary + vm_free_bottom;
        size_t max_new_boundary = vm_used_low;
        if (max_new_boundary > max_boundary) max_new_boundary = max_boundary;
        if (new_boundary > max_new_boundary) new_boundary = max_new_boundary;
        // 若剩余 VM 空闲空间太小无法构成有效空闲块，则全部让给 heap
        if (new_boundary < vm_used_low) {
            size_t remaining = vm_used_low - new_boundary;
            if (remaining > 0 && remaining < AM_VM_MIN_BLOCK_SIZE) {
                new_boundary = vm_used_low;
            }
        }
        if (new_boundary == pool->boundary) return 0;
        if (pool_reinit_heap_at(pool, new_boundary) != 0) return -1;
        pool->boundary = new_boundary;
        pool_reinit_vm_at(pool, new_boundary);
        return 0;
    } else {
        // VM 扩张：要求当前已用 heap 对象能放入新的 heap 容量
        if (pool->heap_state.used_bytes > new_boundary) return -1;
        if (pool_reinit_heap_at(pool, new_boundary) != 0) return -1;
        pool->boundary = new_boundary;
        pool_reinit_vm_at(pool, new_boundary);
        return 0;
    }
}

static void compact_print_boundary_adjust_report(const am_allocator_pool_t *pool,
                                                 size_t old_boundary,
                                                 size_t old_heap_used,
                                                 size_t old_vm_used,
                                                 const char *direction);

int32_t am_allocator_pool_auto_adjust(am_allocator_pool_t *pool) {
    if (!pool) return -1;

    size_t total = pool->total_size;
    size_t heap_cap = pool->boundary;
    size_t vm_cap = total - pool->boundary;
    if (heap_cap == 0 || vm_cap == 0) return -1;

    size_t heap_used = pool->heap_state.used_bytes;
    size_t vm_used = pool->vm_state.used_bytes;

    double heap_ratio = (double)heap_used / (double)heap_cap;
    double vm_ratio = (double)vm_used / (double)vm_cap;
    double current_ratio = (double)heap_cap / (double)total;

    size_t old_boundary = pool->boundary;
    size_t old_heap_used = heap_used;
    size_t old_vm_used = vm_used;

    // VM 压力大且 heap 有富余：把边界让给 VM（减小 heap 比例）
    if (vm_ratio > AM_POOL_VM_EXPAND_THRESHOLD && heap_ratio < AM_POOL_HEAP_SLACK_THRESHOLD) {
        double target = current_ratio - AM_POOL_BOUNDARY_ADJ_STEP;
        int32_t ret = am_allocator_pool_adjust_boundary(pool, target);
        if (ret == 0 && pool->boundary != old_boundary) {
            compact_print_boundary_adjust_report(pool, old_boundary, old_heap_used, old_vm_used,
                                                 "VM 扩张（heap 比例减小）");
        }
        return ret;
    }

    // heap 压力大且 VM 有富余：把边界让给 heap（增大 heap 比例）
    if (heap_ratio > AM_POOL_HEAP_EXPAND_THRESHOLD &&
        vm_ratio < AM_POOL_VM_SLACK_THRESHOLD) {
        double target = current_ratio + AM_POOL_BOUNDARY_ADJ_STEP;
        int32_t ret = am_allocator_pool_adjust_boundary(pool, target);
        if (ret == 0 && pool->boundary != old_boundary) {
            compact_print_boundary_adjust_report(pool, old_boundary, old_heap_used, old_vm_used,
                                                 "heap 扩张（heap 比例增大）");
        }
        return ret;
    }

    return 0;
}

/* =============================================================================
 * 堆区压缩：在 GC 安全点移动存活对象，更新 heap 表中的指针
 * ============================================================================ */

typedef struct {
    am_heap_block_header_t *block;
    am_map_entry_t *slot;
} live_entry_t;

typedef struct {
    void *old_ptr;
    void *new_ptr;
} reloc_entry_t;

static int cmp_live_entry(const void *a, const void *b) {
    const live_entry_t *ea = (const live_entry_t *)a;
    const live_entry_t *eb = (const live_entry_t *)b;
    if (ea->block < eb->block) return -1;
    if (ea->block > eb->block) return 1;
    return 0;
}

static int cmp_slot_ptr(const void *a, const void *b) {
    am_map_entry_t *const *sa = (am_map_entry_t *const *)a;
    am_map_entry_t *const *sb = (am_map_entry_t *const *)b;
    if (*sa < *sb) return -1;
    if (*sa > *sb) return 1;
    return 0;
}

/* 压缩报告用到的空闲块快照 */
typedef struct compact_free_info_t {
    uint8_t *start;
    size_t size;
} compact_free_info_t;

/* 遍历堆区，打印所有空闲块的位置和大小（要求块头部有效） */
static void compact_print_free_blocks(const am_freelist_state_t *s, const char *label) {
    fprintf(stderr, "%s\n", label);
    uint8_t *p = s->base;
    int n = 0;
    while (p < s->base + s->capacity) {
        am_heap_block_header_t *b = (am_heap_block_header_t *)p;
        size_t sz = block_real_size(b);
        if (!block_is_used(b)) {
            fprintf(stderr, "  起始=%p 结束=%p 大小=%zu\n",
                    (void *)p, (void *)(p + sz), sz);
            n++;
        }
        p += sz;
    }
    if (n == 0) {
        fprintf(stderr, "  (无空闲块)\n");
    }
}

/* 打印 VM 工作区信息 */
static void compact_print_vm_section(const am_allocator_pool_t *pool) {
    size_t vm_cap = (size_t)(pool->vm_state.end - pool->vm_state.base);
    size_t vm_used = pool->vm_state.used_bytes;
    fprintf(stderr, "---------- VM 工作区 ----------\n");
    fprintf(stderr, "  起始地址=%p\n", (void *)pool->vm_state.base);
    fprintf(stderr, "  结束地址=%p\n", (void *)pool->vm_state.end);
    fprintf(stderr, "  容量=%zu bytes\n", vm_cap);
    fprintf(stderr, "  已用=%zu bytes\n", vm_used);
    fprintf(stderr, "  空闲=%zu bytes\n", vm_cap - vm_used);
    if (vm_cap > 0) {
        fprintf(stderr, "  使用率=%.2f%%\n", 100.0 * (double)vm_used / (double)vm_cap);
    }
}

/* 打印边界位置信息 */
static void compact_print_boundary_section(const am_allocator_pool_t *pool) {
    uint8_t *boundary_addr = pool->base + pool->boundary;
    double heap_ratio = (double)pool->boundary / (double)pool->total_size;
    fprintf(stderr, "---------- 边界 ----------\n");
    fprintf(stderr, "  边界地址=%p\n", (void *)boundary_addr);
    fprintf(stderr, "  heap 占比=%.2f%%\n", heap_ratio * 100.0);
    fprintf(stderr, "  VM 占比=%.2f%%\n", (1.0 - heap_ratio) * 100.0);
}

/* 打印用户堆区压缩信息 */
static void compact_print_heap_section(const am_freelist_state_t *s,
                                       size_t used_before,
                                       const compact_free_info_t *before_free,
                                       size_t before_free_count,
                                       size_t live_count) {
    fprintf(stderr, "---------- 用户堆区 ----------\n");
    fprintf(stderr, "  起始地址=%p\n", (void *)s->base);
    fprintf(stderr, "  结束地址=%p\n", (void *)(s->base + s->capacity));
    fprintf(stderr, "  容量=%zu bytes\n", s->capacity);
    fprintf(stderr, "  压缩前: 已用=%zu 空闲=%zu\n",
            used_before, s->capacity - used_before);
    fprintf(stderr, "  压缩前空闲块: %zu个\n", before_free_count);
    (void)before_free;
    // if (before_free_count == 0) {
    //     fprintf(stderr, "    (无空闲块)\n");
    // } else {
    //     for (size_t i = 0; i < before_free_count; i++) {
    //         fprintf(stderr, "    起始=%p 结束=%p 大小=%zu\n",
    //                 (void *)before_free[i].start,
    //                 (void *)(before_free[i].start + before_free[i].size),
    //                 before_free[i].size);
    //     }
    // }

    fprintf(stderr, "  压缩后: 已用=%zu 空闲=%zu\n",
            s->used_bytes, s->capacity - s->used_bytes);
    compact_print_free_blocks(s, "  压缩后空闲块:");
    fprintf(stderr, "  存活对象: %zu 个, 共 %zu bytes\n", live_count, s->used_bytes);
    fprintf(stderr, "  使用率: %.2f%%\n", 100.0 * (double)s->used_bytes / (double)s->capacity);
}

/* 打印一次完整的压缩报告。调用时压缩已完成，before_* 参数记录压缩前状态。 */
static void compact_print_report(const am_freelist_state_t *s,
                                 size_t used_before,
                                 const compact_free_info_t *before_free,
                                 size_t before_free_count,
                                 size_t live_count) {
#if !AM_ALLOCATOR_PRINT_COMPACT_REPORT
    (void)s;
    (void)used_before;
    (void)before_free;
    (void)before_free_count;
    (void)live_count;
    return;
#endif

    fprintf(stderr, "\n========== 内存池压缩报告 ==========\n");
    if (g_current_pool) {
        compact_print_vm_section(g_current_pool);
        compact_print_boundary_section(g_current_pool);
        compact_print_heap_section(s, used_before, before_free, before_free_count, live_count);
    } else {
        fprintf(stderr, "内存池信息: (未知)\n");
    }
    fprintf(stderr, "====================================\n\n");
}

/* 打印边界调整报告。调用时调整已完成。 */
static void compact_print_boundary_adjust_report(const am_allocator_pool_t *pool,
                                                 size_t old_boundary,
                                                 size_t old_heap_used,
                                                 size_t old_vm_used,
                                                 const char *direction) {
#if !AM_ALLOCATOR_PRINT_COMPACT_REPORT
    (void)pool;
    (void)old_boundary;
    (void)old_heap_used;
    (void)old_vm_used;
    (void)direction;
    return;
#endif

    if (!pool) return;

    fprintf(stderr, "\n========== 内存池边界调整报告 ==========\n");

    fprintf(stderr, "---------- 调整前 ----------\n");
    size_t old_vm_cap = pool->total_size - old_boundary;
    fprintf(stderr, "  VM 工作区: 起始=%p 容量=%zu 已用=%zu\n",
            (void *)(pool->base + old_boundary), old_vm_cap, old_vm_used);
    fprintf(stderr, "  边界地址=%p (heap 占比 %.2f%%)\n",
            (void *)(pool->base + old_boundary),
            100.0 * (double)old_boundary / (double)pool->total_size);
    fprintf(stderr, "  用户堆区: 起始=%p 容量=%zu 已用=%zu\n",
            (void *)pool->base, old_boundary, old_heap_used);

    fprintf(stderr, "---------- 调整后 ----------\n");
    size_t vm_cap = (size_t)(pool->vm_state.end - pool->vm_state.base);
    size_t vm_used = pool->vm_state.used_bytes;
    fprintf(stderr, "  VM 工作区: 起始=%p 容量=%zu 已用=%zu\n",
            (void *)pool->vm_state.base, vm_cap, vm_used);
    fprintf(stderr, "  边界地址=%p (heap 占比 %.2f%%)\n",
            (void *)(pool->base + pool->boundary),
            100.0 * (double)pool->boundary / (double)pool->total_size);
    fprintf(stderr, "  用户堆区: 起始=%p 容量=%zu 已用=%zu\n",
            (void *)pool->heap_state.base, pool->boundary, pool->heap_state.used_bytes);

    fprintf(stderr, "  调整方向: %s\n", direction ? direction : "无");
    fprintf(stderr, "========================================\n\n");
}

/* 对多个进程堆一起执行标记-压缩：把所有 heap 中被 handle 引用的存活对象
 * 搬到堆区前端，更新所有 heap 表中的指针，并在尾部重建空闲块。
 * 必须在 GC 安全点调用（所有相关进程已完成标记-清除）。 */
int32_t am_allocator_heap_compact_global(am_allocator_t *heap_alloc, am_heap_t **heaps, size_t heap_count) {
    if (!heap_alloc || !heap_alloc->state) return -1;
    am_freelist_state_t *s = (am_freelist_state_t *)heap_alloc->state;

    live_entry_t *entries = NULL;
    size_t count = 0;
    size_t entries_cap = 0;

    /* 第一遍：收集所有 heap 中被 handle 引用的存活对象
     * （仅处理物理上位于堆区内的对象）。用 block->live 去重，以应对
     * 同一对象被多个 heap 引用（理论上 fork 后不应出现，但做防御）。 */
    for (size_t h = 0; h < heap_count; h++) {
        am_heap_t *heap = heaps[h];
        if (!heap || !heap->table) continue;
        size_t cap = heap->table->capacity;
        for (size_t i = 0; i < cap; i++) {
            am_value_t key = heap->table->slots[i].key;
            if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) continue;
            am_value_t v = heap->table->slots[i].value;
            if (!am_value_is_ptr(v)) continue;

            am_heap_block_header_t *b = block_from_payload(am_value_to_ptr(v));
            if ((uint8_t *)b < s->base || (uint8_t *)b >= s->base + s->capacity) continue;

            if (!b->live) {
                b->live = true;
                if (count >= entries_cap) {
                    entries_cap = entries_cap ? entries_cap * 2 : 64;
                    live_entry_t *tmp = (live_entry_t *)realloc(entries, entries_cap * sizeof(live_entry_t));
                    if (!tmp) {
                        fprintf(stderr, "[allocator] 全局压缩失败: entries realloc 失败 (%zu bytes)\n",
                                entries_cap * sizeof(live_entry_t));
                        free(entries);
                        return -1;
                    }
                    entries = tmp;
                }
                entries[count].block = b;
                entries[count].slot = &heap->table->slots[i];
                count++;
            }
        }
    }

#if AM_ALLOCATOR_PRINT_COMPACT_REPORT
    /* 记录压缩前的堆区统计与空闲块分布，用于最后输出报告 */
    size_t used_before = s->used_bytes;
    compact_free_info_t *before_free = NULL;
    size_t before_free_count = 0;
    size_t before_free_cap = 0;
    {
        uint8_t *p = s->base;
        while (p < s->base + s->capacity) {
            am_heap_block_header_t *b = (am_heap_block_header_t *)p;
            size_t sz = block_real_size(b);
            if (!block_is_used(b)) {
                if (before_free_count >= before_free_cap) {
                    before_free_cap = before_free_cap ? before_free_cap * 2 : 16;
                    compact_free_info_t *tmp = (compact_free_info_t *)realloc(
                        before_free, before_free_cap * sizeof(compact_free_info_t));
                    if (!tmp) {
                        fprintf(stderr, "[allocator] 全局压缩失败: before_free realloc 失败 (%zu bytes)\n",
                                before_free_cap * sizeof(compact_free_info_t));
                        free(entries);
                        free(before_free);
                        return -1;
                    }
                    before_free = tmp;
                }
                before_free[before_free_count].start = p;
                before_free[before_free_count].size = sz;
                before_free_count++;
            }
            p += sz;
        }
    }
#endif

    if (count == 0) {
        am_heap_block_header_t *b = (am_heap_block_header_t *)s->base;
        block_set_size(b, s->capacity, false);
        b->prev_size = 0;
        b->next_free = NULL;
        b->prev_free = NULL;
        b->live = false;
        s->free_list_head = b;
        s->used_bytes = 0;
#if AM_ALLOCATOR_PRINT_COMPACT_REPORT
        compact_print_report(s, used_before, before_free, before_free_count, 0);
        free(before_free);
#endif
        free(entries);
        return 0;
    }

    qsort(entries, count, sizeof(live_entry_t), cmp_live_entry);

    am_map_entry_t **primary_slots = (am_map_entry_t **)malloc(count * sizeof(am_map_entry_t *));
    if (!primary_slots) {
        fprintf(stderr, "[allocator] 全局压缩失败: primary_slots malloc 失败 (%zu bytes)\n",
                count * sizeof(am_map_entry_t *));
        free(entries);
#if AM_ALLOCATOR_PRINT_COMPACT_REPORT
        free(before_free);
#endif
        return -1;
    }
    for (size_t i = 0; i < count; i++) {
        primary_slots[i] = entries[i].slot;
    }
    qsort(primary_slots, count, sizeof(am_map_entry_t *), cmp_slot_ptr);

    reloc_entry_t *reloc = (reloc_entry_t *)malloc(count * sizeof(reloc_entry_t));
    if (!reloc) {
        fprintf(stderr, "[allocator] 全局压缩失败: reloc malloc 失败 (%zu bytes)\n",
                count * sizeof(reloc_entry_t));
        free(entries);
        free(primary_slots);
#if AM_ALLOCATOR_PRINT_COMPACT_REPORT
        free(before_free);
#endif
        return -1;
    }

    uint8_t *dest = s->base;
    size_t prev_size = 0;
    for (size_t i = 0; i < count; i++) {
        am_heap_block_header_t *b = entries[i].block;
        size_t sz = block_real_size(b);
        void *old_payload = block_payload(b);

        if ((uint8_t *)b != dest) {
            memmove(dest, b, sz);
        }

        am_heap_block_header_t *newb = (am_heap_block_header_t *)dest;
        block_set_size(newb, sz, true);
        newb->prev_size = prev_size;
        newb->live = false;

        void *new_payload = block_payload(newb);
        reloc[i].old_ptr = old_payload;
        reloc[i].new_ptr = new_payload;
        entries[i].slot->value = am_make_value_of_ptr((am_object_t *)new_payload);

        dest += sz;
        prev_size = sz;
    }

    /* 第二遍：更新所有 heap 中非主 slot 中仍指向旧地址的指针。
     * 主 slot 已在移动循环中更新；若其新地址恰好等于某个旧地址，
     * 必须避免在此处被再次更新为另一个对象的新地址。 */
    for (size_t h = 0; h < heap_count; h++) {
        am_heap_t *heap = heaps[h];
        if (!heap || !heap->table) continue;
        size_t cap = heap->table->capacity;
        for (size_t i = 0; i < cap; i++) {
            am_value_t key = heap->table->slots[i].key;
            if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) continue;
            am_value_t v = heap->table->slots[i].value;
            if (!am_value_is_ptr(v)) continue;

            am_map_entry_t *slot = &heap->table->slots[i];
            am_map_entry_t *slot_key = slot;
            if (bsearch(&slot_key, primary_slots, count, sizeof(am_map_entry_t *), cmp_slot_ptr) != NULL) {
                continue;
            }

            void *old_ptr = am_value_to_ptr(v);
            size_t lo = 0, hi = count;
            while (lo < hi) {
                size_t mid = (lo + hi) / 2;
                if (reloc[mid].old_ptr < old_ptr) lo = mid + 1;
                else hi = mid;
            }
            if (lo < count && reloc[lo].old_ptr == old_ptr) {
                slot->value = am_make_value_of_ptr((am_object_t *)reloc[lo].new_ptr);
            }
        }
    }

    size_t free_size = (s->base + s->capacity) - dest;
    if (free_size > 0) {
        am_heap_block_header_t *freeb = (am_heap_block_header_t *)dest;
        block_set_size(freeb, free_size, false);
        freeb->prev_size = prev_size;
        freeb->next_free = NULL;
        freeb->prev_free = NULL;
        freeb->live = false;
        s->free_list_head = freeb;
    } else {
        s->free_list_head = NULL;
    }
    s->used_bytes = (size_t)(dest - s->base);

#if AM_ALLOCATOR_PRINT_COMPACT_REPORT
    compact_print_report(s, used_before, before_free, before_free_count, count);
    free(before_free);
#endif

    free(entries);
    free(primary_slots);
    free(reloc);
    return 0;
}

int32_t am_allocator_heap_compact(am_allocator_t *heap_alloc, am_heap_t *heap) {
    if (!heap_alloc || !heap_alloc->state || !heap || !heap->table) return -1;
    am_heap_t *heaps[1] = {heap};
    return am_allocator_heap_compact_global(heap_alloc, heaps, 1);
}
