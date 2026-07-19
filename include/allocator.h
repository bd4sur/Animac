#ifndef __AM_ALLOCATOR_H__
#define __AM_ALLOCATOR_H__

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

///////////////////////////////////////////
// 抽象内存分配器
// NOTE 注意allocator返回的指针必须是2字节对齐的！以确保其am_value_t的最低位恒0。
///////////////////////////////////////////

// 定义抽象内存管理的虚接口（虚函数表）
typedef struct am_allocator_vtable_t {
    void* (*malloc)(void *state, size_t size);
    void* (*calloc)(void *state, size_t size);
    void* (*realloc)(void *state, void *ptr, size_t size);
    void  (*free)(void *state, void *ptr);
    void  (*destroy)(void *state); // 销毁整个分配器
} am_allocator_vtable_t;

// 抽象内存管理器：其实现待定
typedef struct am_allocator_t {
    const am_allocator_vtable_t *vtable; // 指向具体的实现
    void *state; // TODO 具体策略的上下文（如FreeList的头指针，Arena的指针等）
} am_allocator_t;

// 抽象内存管理接口
static inline void* am_malloc(am_allocator_t *alloc, size_t size) {
    return alloc->vtable->malloc(alloc->state, size);
}
static inline void* am_calloc(am_allocator_t *alloc, size_t size) {
    return alloc->vtable->calloc(alloc->state, size);
}
static inline void* am_realloc(am_allocator_t *alloc, void *ptr, size_t size) {
    return alloc->vtable->realloc(alloc->state, ptr, size);
}
static inline void am_free(am_allocator_t *alloc, void *ptr) {
    return alloc->vtable->free(alloc->state, ptr);
}

// 示例：虚函数的具体实现
// void* am_malloc_impl(void *state, size_t size) { return malloc(size); }
// void am_free_impl(void *state, void *ptr) { free(ptr); }
// const am_allocator_vtable_t malloc_vtable = { am_malloc_impl, am_free_impl, NULL };





#ifndef AM_ALLOCATOR_PRINT_COMPACT_REPORT
#define AM_ALLOCATOR_PRINT_COMPACT_REPORT (0)
#endif

///////////////////////////////////////////
// 共享内存池与双分配器管理
///////////////////////////////////////////

// 每经历 AM_HEAP_COMPACT_INTERVAL 次 GC 后触发一次标记-压缩。
// 设为 0 表示不在 GC 时自动触发压缩（可手动调用 am_allocator_heap_compact）。
#ifndef AM_HEAP_COMPACT_INTERVAL
#define AM_HEAP_COMPACT_INTERVAL (1)
#endif

// 动态边界调整相关阈值与限制。
// 边界以占总池比例表示；heap 区最小/最大比例受以下宏约束。
#ifndef AM_POOL_MIN_HEAP_RATIO
#define AM_POOL_MIN_HEAP_RATIO (0.1)
#endif
#ifndef AM_POOL_MIN_VM_RATIO
#define AM_POOL_MIN_VM_RATIO (0.1)
#endif

#ifndef AM_POOL_VM_EXPAND_THRESHOLD
#define AM_POOL_VM_EXPAND_THRESHOLD (0.75)
#endif
#ifndef AM_POOL_HEAP_EXPAND_THRESHOLD
#define AM_POOL_HEAP_EXPAND_THRESHOLD (0.75)
#endif
#ifndef AM_POOL_VM_SLACK_THRESHOLD
#define AM_POOL_VM_SLACK_THRESHOLD (0.30)
#endif
#ifndef AM_POOL_HEAP_SLACK_THRESHOLD
#define AM_POOL_HEAP_SLACK_THRESHOLD (0.30)
#endif
#ifndef AM_POOL_BOUNDARY_ADJ_STEP
#define AM_POOL_BOUNDARY_ADJ_STEP (0.05)
#endif

// 不透明内存池类型
typedef struct am_allocator_pool_t am_allocator_pool_t;

// 创建/销毁统一内存池。成功返回池指针，失败返回 NULL。
am_allocator_pool_t *am_allocator_pool_create(size_t total_size);
void am_allocator_pool_destroy(am_allocator_pool_t *pool);

// 获取池中 VM 工作区与堆区分配器。
am_allocator_t *am_allocator_pool_get_vm(am_allocator_pool_t *pool);
am_allocator_t *am_allocator_pool_get_heap(am_allocator_pool_t *pool);

// 重置 VM 工作区/堆区。重置会丢弃当前已分配内容，回到初始状态。
void am_allocator_pool_reset_vm(am_allocator_pool_t *pool);
void am_allocator_pool_reset_heap(am_allocator_pool_t *pool);

// 查询池大小与已使用字节数。
size_t am_allocator_pool_total_size(const am_allocator_pool_t *pool);
size_t am_allocator_pool_vm_used(const am_allocator_pool_t *pool);
size_t am_allocator_pool_heap_used(const am_allocator_pool_t *pool);
size_t am_allocator_pool_heap_capacity(const am_allocator_pool_t *pool);

// 对堆区执行标记-压缩：移动 heap 中所有被 handle 引用的对象到堆区前端，
// 更新 heap 表中的指针，并在尾部重建一个空闲块。必须在 GC 安全点调用。
struct am_heap_t;
typedef struct am_heap_t am_heap_t;
int32_t am_allocator_heap_compact(am_allocator_t *heap_alloc, am_heap_t *heap);

// 对多个进程堆一起执行全局标记-压缩：把所有 heap 中存活对象搬到同一堆区前端，
// 更新所有 heap 表中的指针。用于多进程共享同一个 heap_alloc 的场景。
int32_t am_allocator_heap_compact_global(am_allocator_t *heap_alloc, am_heap_t **heaps, size_t heap_count);

// 按占总池比例调整 VM/heap 边界。
// - ratio 为 heap 区所占比例；内部会被裁剪到 [AM_POOL_MIN_HEAP_RATIO, 1 - AM_POOL_MIN_VM_RATIO]。
// - 若新边界大于当前边界（heap 扩张），仅当 VM 工作区为空时才允许。
// - 若新边界小于当前边界（VM 扩张），要求当前已用 heap 对象能够放入新的 heap 容量中。
int32_t am_allocator_pool_adjust_boundary(am_allocator_pool_t *pool, double ratio);

// 根据 VM/heap 使用压力自动调整边界。通常在每个 GC 安全点之后调用。
int32_t am_allocator_pool_auto_adjust(am_allocator_pool_t *pool);

// 返回当前活动的内存池（单池场景下使用）。
am_allocator_pool_t *am_allocator_pool_current(void);

#ifdef __cplusplus
}
#endif

#endif