#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>

#include "am_gc.h"
#include "am_map.h"
#include "am_list.h"
#include "am_closure.h"
#include "am_continuation.h"


// ===============================================================================
// 标记-清除：GC 根收集
// ===============================================================================

// 判断一个am_value_t是否为指向堆对象的把柄（handle）
static inline bool is_handle_value(am_value_t v) {
    return am_value_is_handle(v);
}


// GC根收集辅助函数：分析一组运行时环境（当前闭包、opstack、fstack）中的GC根
static int32_t gc_root_helper(
    am_process_t *proc, am_list_t **gcroots,
    am_handle_t current_closure_handle,
    am_value_t *opstack, size_t opstack_length,
    am_value_t *fstack, size_t fstack_length
) {
    if (!proc || !gcroots || !*gcroots) return -1;

    // 加入当前闭包handle
    am_list_t *lst = am_list_push(proc->vm_alloc, *gcroots, am_make_value_of_handle(current_closure_handle));
    if (!lst) return -1;
    *gcroots = lst;

    // 加入当前闭包内的变量绑定（约束变量和自由变量）
    am_obj_closure_t *current_closure_obj = am_process_get_closure(proc, current_closure_handle);
    if (current_closure_obj) {
        for (size_t i = 0; i < current_closure_obj->length; i++) {
            am_value_t value = current_closure_obj->bindings[i].value;
            if (is_handle_value(value)) {
                lst = am_list_push(proc->vm_alloc, *gcroots, value);
                if (!lst) return -1;
                *gcroots = lst;
            }
        }
    }

    // 加入操作数栈内的把柄
    for (size_t i = 0; i < opstack_length; i++) {
        am_value_t v = opstack[i];
        if (is_handle_value(v)) {
            lst = am_list_push(proc->vm_alloc, *gcroots, v);
            if (!lst) return -1;
            *gcroots = lst;
        }
    }

    // 加入函数调用栈中每个栈帧对应的闭包把柄，以及这些闭包内的变量绑定
    // fstack成对存储：closure_handle_value, return_target_iaddr_value
    for (size_t i = 0; i + 1 < fstack_length; i += 2) {
        am_value_t closure_handle_value = fstack[i];
        am_value_t return_target_iaddr_value = fstack[i + 1];
        (void)return_target_iaddr_value;

        if (!am_value_is_handle(closure_handle_value)) {
            fprintf(stderr, "[gc_root_helper] 预期闭包handle，实际非handle\n");
            return -1;
        }

        am_handle_t closure_handle = am_value_to_handle(closure_handle_value);
        if (closure_handle == AM_HANDLE_NULL) continue;
        am_obj_closure_t *closure_obj = am_process_get_closure(proc, closure_handle);
        if (!closure_obj) {
            fprintf(stderr, "[gc_root_helper] 无法获取闭包对象 %zu\n", closure_handle);
            continue;
        }
        if (closure_obj->base.type != AM_OBJECT_TYPE_CLOSURE) {
            fprintf(stderr, "[gc_root_helper] 预期闭包，实际非闭包\n");
            return -1;
        }

        // 将栈帧的闭包handle加入GC根
        lst = am_list_push(proc->vm_alloc, *gcroots, closure_handle_value);
        if (!lst) return -1;
        *gcroots = lst;

        // 将该闭包内的变量绑定中的handle加入GC根
        for (size_t j = 0; j < closure_obj->length; j++) {
            am_value_t value = closure_obj->bindings[j].value;
            if (is_handle_value(value)) {
                lst = am_list_push(proc->vm_alloc, *gcroots, value);
                if (!lst) return -1;
                *gcroots = lst;
            }
        }
    }

    return 0;
}


// 功能说明：从当前进程和续体环境中收集GC根。成功返回0，失败返回-1
// 设计说明：可达性分析的根（GC根）有：当前闭包本身、当前闭包和函数调用栈对应闭包内的变量绑定、操作数栈内的把柄、函数调用栈内所有栈帧对应的闭包把柄、所有continuation中保留的上面的各项
// 实现说明：gcroots是收集到的GC根的TPV的列表，由外部分配和释放。
static int32_t gc_root(am_process_t *proc, am_list_t **gcroots) {
    if (!proc || !gcroots || !*gcroots || !proc->heap) return -1;

    // 分析当前进程中的GC根
    size_t opstack_length = am_process_length_of_opstack(proc);
    size_t fstack_length = am_process_length_of_fstack(proc);
    if (opstack_length == SIZE_MAX || fstack_length == SIZE_MAX) return -1;

    if (gc_root_helper(proc, gcroots, proc->current_closure_handle,
                       proc->opstack, opstack_length,
                       proc->fstack, fstack_length) != 0) {
        return -1;
    }

    // 将 strindex 中所有有效 handle 加入 GC 根，防止驻留字符串被回收后产生悬空引用
    if (proc->strindex) {
        for (size_t i = 0; i < proc->strindex->capacity; i++) {
            uint32_t hash = proc->strindex->slots[i].hash;
            if (hash == AM_STRINDEX_KEY_EMPTY || hash == AM_STRINDEX_KEY_TOMBSTONE) continue;

            am_value_t h_val = proc->strindex->slots[i].value;
            if (!am_value_is_handle(h_val)) continue;

            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots, h_val);
            if (!new_roots) return -1;
            *gcroots = new_roots;
        }
    }

    // 将当前 dynamic-wind 栈中的 entry handle 加入 GC 根
    if (proc->dynamic_wind_stack) {
        for (size_t i = 0; i < proc->dynamic_wind_stack->length; i++) {
            am_value_t entry_val = proc->dynamic_wind_stack->children[i];
            if (am_value_is_handle(entry_val)) {
                am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots, entry_val);
                if (!new_roots) return -1;
                *gcroots = new_roots;
            }
        }
    }

    // 将正在执行 after 的 dynamic-wind 条目 handle 加入 GC 根
    if (proc->dynamic_wind_after_stack) {
        for (size_t i = 0; i < proc->dynamic_wind_after_stack->length; i++) {
            am_value_t entry_val = proc->dynamic_wind_after_stack->children[i];
            if (am_value_is_handle(entry_val)) {
                am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots, entry_val);
                if (!new_roots) return -1;
                *gcroots = new_roots;
            }
        }
    }

    // 将 wind 跳板暂存的 continuation 把柄/值和待执行条目加入 GC 根
    if (proc->pending_cont_handle != AM_HANDLE_NULL) {
        am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                             am_make_value_of_handle(proc->pending_cont_handle));
        if (!new_roots) return -1;
        *gcroots = new_roots;
    }
    if (am_value_is_handle(proc->pending_cont_value)) {
        am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots, proc->pending_cont_value);
        if (!new_roots) return -1;
        *gcroots = new_roots;
    }
    if (proc->current_dynamic_wind_entry != AM_HANDLE_NULL) {
        am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                             am_make_value_of_handle(proc->current_dynamic_wind_entry));
        if (!new_roots) return -1;
        *gcroots = new_roots;
    }
    if (proc->current_dynamic_wind_thunk != AM_HANDLE_NULL) {
        am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                             am_make_value_of_handle(proc->current_dynamic_wind_thunk));
        if (!new_roots) return -1;
        *gcroots = new_roots;
    }
    if (proc->pending_after_entries) {
        for (size_t i = 0; i < proc->pending_after_count; i++) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(proc->pending_after_entries[i]));
            if (!new_roots) return -1;
            *gcroots = new_roots;
        }
    }
    if (proc->pending_before_entries) {
        for (size_t i = 0; i < proc->pending_before_count; i++) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(proc->pending_before_entries[i]));
            if (!new_roots) return -1;
            *gcroots = new_roots;
        }
    }

    // 分析所有已保存的续体环境中的GC根
    // 遍历堆中所有对象，找到continuation对象
    size_t heap_count = am_map_length(proc->heap_alloc, proc->heap->table);
    am_value_t *keys = am_map_keys(proc->vm_alloc, proc->heap->table);
    if (!keys && heap_count > 0) return -1;

    int32_t ret = 0;
    for (size_t i = 0; i < heap_count; i++) {
        am_handle_t hd = am_value_to_handle(keys[i]);
        am_value_t value = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (!am_value_is_ptr(value)) continue;

        am_object_t *obj = am_value_to_ptr(value);
        if (!obj || obj->type != AM_OBJECT_TYPE_CONTINUATION) continue;

        am_continuation_t *cont = (am_continuation_t *)obj;

        // 将续体保存的 dynamic-wind 相关 handle 加入 GC 根
        if (cont->dynamic_wind_stack_handle != AM_HANDLE_NULL) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(cont->dynamic_wind_stack_handle));
            if (!new_roots) {
                am_free(proc->vm_alloc, keys);
                return -1;
            }
            *gcroots = new_roots;
        }
        if (cont->dynamic_wind_after_stack_handle != AM_HANDLE_NULL) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(cont->dynamic_wind_after_stack_handle));
            if (!new_roots) {
                am_free(proc->vm_alloc, keys);
                return -1;
            }
            *gcroots = new_roots;
        }
        if (cont->current_dynamic_wind_entry_handle != AM_HANDLE_NULL) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(cont->current_dynamic_wind_entry_handle));
            if (!new_roots) {
                am_free(proc->vm_alloc, keys);
                return -1;
            }
            *gcroots = new_roots;
        }
        if (cont->current_dynamic_wind_thunk_handle != AM_HANDLE_NULL) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, *gcroots,
                                                 am_make_value_of_handle(cont->current_dynamic_wind_thunk_handle));
            if (!new_roots) {
                am_free(proc->vm_alloc, keys);
                return -1;
            }
            *gcroots = new_roots;
        }

        // 将续体内部环境加入GC根
        size_t cont_opstack_length = 0;
        size_t cont_fstack_length = 0;
        am_value_t *cont_opstack = am_continuation_get_opstack(proc->vm_alloc, cont, &cont_opstack_length);
        am_value_t *cont_fstack = am_continuation_get_fstack(proc->vm_alloc, cont, &cont_fstack_length);

        if (!cont_opstack || !cont_fstack) {
            if (cont_opstack) am_free(proc->vm_alloc, cont_opstack);
            if (cont_fstack) am_free(proc->vm_alloc, cont_fstack);
            ret = -1;
            break;
        }

        if (gc_root_helper(proc, gcroots, cont->current_closure_handle,
                           cont_opstack, cont_opstack_length,
                           cont_fstack, cont_fstack_length) != 0) {
            am_free(proc->vm_alloc, cont_opstack);
            am_free(proc->vm_alloc, cont_fstack);
            ret = -1;
            break;
        }

        am_free(proc->vm_alloc, cont_opstack);
        am_free(proc->vm_alloc, cont_fstack);
    }

    am_free(proc->vm_alloc, keys);
    return ret;
}


// ===============================================================================
// 标记-清除：递归标记与清除
// ===============================================================================

// 功能说明：从GC根开始，递归标记存活对象。成功返回0，失败返回-1（或更小的负数）
static int32_t gc_mark(am_process_t *proc, am_value_t v) {
    if (!proc || !proc->heap) return -1;

    int32_t ret = 0;

    // 仅处理handle类型的值
    if (!am_value_is_handle(v)) return 0;

    am_handle_t hd = am_value_to_handle(v);
    if (hd == AM_HANDLE_NULL) return 0;

    // handle必须存在于当前进程的堆中
    if (am_heap_has_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd) != 0) return 0;

    am_value_t obj_value = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(obj_value)) return -1;

    am_object_t *obj = am_value_to_ptr(obj_value);
    if (!obj) return -1;

    // 已经标记过，避免循环引用导致无限递归
    if (am_object_check_alive(obj) == 0) return 0;

    // 根据对象类型进行标记和递归
    int32_t obj_type = obj->type;

    if (obj_type == AM_OBJECT_TYPE_LIST) {
        // 标记当前list对象存活
        am_object_set_alive(obj, 0);

        am_list_t *lst = (am_list_t *)obj;
        for (size_t i = 0; i < lst->length; i++) {
            ret += gc_mark(proc, lst->children[i]);
        }
    }
    else if (obj_type == AM_OBJECT_TYPE_WSTRING) {
        am_object_set_alive(obj, 0);
    }
    else if (obj_type == AM_OBJECT_TYPE_MAP) {
        am_object_set_alive(obj, 0);
        am_map_t *m = (am_map_t *)obj;
        for (size_t i = 0; i < m->capacity; i++) {
            am_value_t k = m->slots[i].key;
            if (k == AM_MAP_KEY_EMPTY || k == AM_MAP_KEY_TOMBSTONE) continue;
            if (am_value_is_handle(k)) ret += gc_mark(proc, k);
            am_value_t v = m->slots[i].value;
            if (am_value_is_handle(v)) ret += gc_mark(proc, v);
        }
    }
    else if (obj_type == AM_OBJECT_TYPE_CLOSURE) {
        am_object_set_alive(obj, 0);

        am_obj_closure_t *closure = (am_obj_closure_t *)obj;
        // 递归标记亲闭包
        ret += gc_mark(proc, am_make_value_of_handle(closure->parent));

        // 递归标记变量绑定中的handle
        for (size_t i = 0; i < closure->length; i++) {
            am_value_t value = closure->bindings[i].value;
            if (am_value_is_handle(value)) {
                ret += gc_mark(proc, value);
            }
        }
    }
    else if (obj_type == AM_OBJECT_TYPE_CONTINUATION) {
        // 续体对象本身标记为存活；其stacks中的handle已通过gc_root_helper加入GC根，
        // 因此无需在此递归展开，避免重复遍历。
        am_object_set_alive(obj, 0);
    }

    return ret;
}


// 功能说明：基于存活标记结果，删除所有未被标记存活的非静态对象和对应的handle。成功返回0，失败返回-1
static int32_t gc_sweep(am_process_t *proc) {
    if (!proc || !proc->heap || !proc->heap->table) return -1;

    size_t gcount = 0;
    size_t count = 0;

    size_t heap_count = am_map_length(proc->heap_alloc, proc->heap->table);
    am_value_t *keys = am_map_keys(proc->vm_alloc, proc->heap->table);
    if (!keys && heap_count > 0) return -1;

    for (size_t i = 0; i < heap_count; i++) {
        am_handle_t hd = am_value_to_handle(keys[i]);
        am_value_t value = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (!am_value_is_ptr(value)) continue;

        am_object_t *obj = am_value_to_ptr(value);
        if (!obj) continue;

        count++;

        // 静态对象永不清理
        if (am_object_check_static(obj) == 0) continue;

        // keepalive 对象（如异步回调闭包）应跳过清理
        if (am_object_check_keepalive(obj) == 0) {
            am_object_set_alive(obj, -1);
            continue;
        }

        int32_t obj_type = obj->type;
        if (obj_type == AM_OBJECT_TYPE_LIST ||
            obj_type == AM_OBJECT_TYPE_MAP ||
            obj_type == AM_OBJECT_TYPE_WSTRING ||
            obj_type == AM_OBJECT_TYPE_CLOSURE ||
            obj_type == AM_OBJECT_TYPE_CONTINUATION) {

            if (am_object_check_alive(obj) != 0) {
                // 未被标记为存活：删除handle，同时穿透释放其映射的obj
                am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
                gcount++;
            }
            else {
                // 对于存活对象，将其alive标识清空为否，以便下次gc重新标记
                am_object_set_alive(obj, -1);
            }
        }
    }

    am_free(proc->vm_alloc, keys);

    // printf("[GC] 已清理 %zu / %zu 个对象\n", gcount, count);

    // TODO 暂不实现allocator管理的底层物理内存的整理

    return 0;
}


// 功能说明：对进程执行全量的标记-清除GC。成功返回0，失败返回-1
int32_t am_gc_process(am_process_t *proc) {
    if (!proc || !proc->heap || !proc->heap_alloc || !proc->vm_alloc) return -1;

    // 收集GC根对象 TODO 初始容量可调
    am_list_t *gcroots = am_list_create(proc->vm_alloc, 2048, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!gcroots) return -1;

    int32_t ret = 0;

    if (gc_root(proc, &gcroots) != 0) {
        ret = -1;
        goto cleanup;
    }

    // 将堆中所有 keepalive 对象也加入 GC 根，确保异步回调闭包及其引用的
    // 父闭包链、捕获变量等不会被 GC 回收。
    size_t heap_count = am_map_length(proc->heap_alloc, proc->heap->table);
    am_value_t *keys = am_map_keys(proc->vm_alloc, proc->heap->table);
    if (!keys && heap_count > 0) {
        ret = -1;
        goto cleanup;
    }
    for (size_t i = 0; i < heap_count; i++) {
        am_handle_t hd = am_value_to_handle(keys[i]);
        am_value_t value = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (!am_value_is_ptr(value)) continue;
        am_object_t *obj = am_value_to_ptr(value);
        if (obj && am_object_check_keepalive(obj) == 0) {
            am_list_t *new_roots = am_list_push(proc->vm_alloc, gcroots, am_make_value_of_handle(hd));
            if (new_roots) gcroots = new_roots;
        }
    }
    am_free(proc->vm_alloc, keys);

    // 从GC根对象开始递归标记存活对象
    for (size_t i = 0; i < gcroots->length; i++) {
        am_value_t v = am_list_get(proc->vm_alloc, gcroots, i);
        if (gc_mark(proc, v) != 0) {
            ret = -1;
        }
    }

    // 清除未被标记为存活的非静态对象及其handle
    if (gc_sweep(proc) != 0) {
        ret = -1;
    }

    proc->gc_count++;

cleanup:
    am_list_destroy(proc->vm_alloc, gcroots);
    return ret;
}


// ===============================================================================
// 标记-压缩：存活对象收集、引擎调用与 heap 表指针回写
// ===============================================================================

// payload 指针比较（升序），供排序与二分查找
static int gc_cmp_ptr(const void *a, const void *b) {
    void *const *pa = (void *const *)a;
    void *const *pb = (void *const *)b;
    if ((uintptr_t)*pa < (uintptr_t)*pb) return -1;
    if ((uintptr_t)*pa > (uintptr_t)*pb) return 1;
    return 0;
}

// 重定位记录条目与上下文（引擎回调时按 old_ptr 升序逐条追加）
typedef struct {
    void *old_ptr;
    void *new_ptr;
} gc_reloc_entry_t;

typedef struct {
    gc_reloc_entry_t *entries;
    size_t count;
    size_t capacity;
    bool failed;
} gc_reloc_ctx_t;

// 压缩引擎的重定位回调：记录一次 old_payload -> new_payload 的搬移
static void gc_on_relocate(void *ctx, void *old_payload, void *new_payload) {
    gc_reloc_ctx_t *rc = (gc_reloc_ctx_t *)ctx;
    if (!rc || rc->failed) return;
    if (rc->count >= rc->capacity) {
        // 搬移次数不会超过存活对象数，理论上不会发生
        rc->failed = true;
        return;
    }
    rc->entries[rc->count].old_ptr = old_payload;
    rc->entries[rc->count].new_ptr = new_payload;
    rc->count++;
}

// 在升序重定位表中查找 old_ptr，找到返回对应 new_ptr，未找到返回 NULL
static void *gc_reloc_lookup(const gc_reloc_ctx_t *rc, void *old_ptr) {
    size_t lo = 0, hi = rc->count;
    while (lo < hi) {
        size_t mid = (lo + hi) / 2;
        if ((uintptr_t)rc->entries[mid].old_ptr < (uintptr_t)old_ptr) lo = mid + 1;
        else hi = mid;
    }
    if (lo < rc->count && rc->entries[lo].old_ptr == old_ptr) {
        return rc->entries[lo].new_ptr;
    }
    return NULL;
}

// 对多个进程堆一起执行全局标记-压缩：把所有 heap 中被 handle 引用的存活对象
// 搬到堆区前端，更新所有 heap 表中的指针。
int32_t am_gc_compact(am_allocator_t *heap_alloc, am_heap_t **heaps, size_t heap_count) {
    if (!heap_alloc || !heaps) return -1;

    /* 第一遍：收集所有 heap 表中指向堆对象的 payload 指针 */
    void **live = NULL;
    size_t live_count = 0;
    size_t live_cap = 0;
    for (size_t h = 0; h < heap_count; h++) {
        am_heap_t *heap = heaps[h];
        if (!heap || !heap->table) continue;
        size_t cap = heap->table->capacity;
        for (size_t i = 0; i < cap; i++) {
            am_value_t key = heap->table->slots[i].key;
            if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) continue;
            am_value_t v = heap->table->slots[i].value;
            if (!am_value_is_ptr(v)) continue;

            if (live_count >= live_cap) {
                live_cap = live_cap ? live_cap * 2 : 64;
                void **tmp = (void **)am_allocator_host_realloc(heap_alloc, live,
                                                                live_cap * sizeof(void *));
                if (!tmp) {
                    fprintf(stderr, "[gc] 压缩失败: live realloc 失败 (%zu bytes)\n",
                            live_cap * sizeof(void *));
                    am_allocator_host_free(heap_alloc, live);
                    return -1;
                }
                live = tmp;
            }
            live[live_count++] = am_value_to_ptr(v);
        }
    }

    /* 排序去重，得到压缩引擎要求的升序无重复存活对象数组 */
    if (live_count > 1) {
        qsort(live, live_count, sizeof(void *), gc_cmp_ptr);
    }
    size_t live_n = 0;
    for (size_t i = 0; i < live_count; i++) {
        if (live_n == 0 || live[i] != live[live_n - 1]) {
            live[live_n++] = live[i];
        }
    }

    /* 调用压缩引擎搬移存活对象；搬移次数不超过 live_n，故重定位表按 live_n 预分配 */
    gc_reloc_ctx_t rc = {NULL, 0, 0, false};
    if (live_n > 0) {
        rc.entries = (gc_reloc_entry_t *)am_allocator_host_malloc(heap_alloc,
                                                                  live_n * sizeof(gc_reloc_entry_t));
        if (!rc.entries) {
            fprintf(stderr, "[gc] 压缩失败: reloc malloc 失败 (%zu bytes)\n",
                    live_n * sizeof(gc_reloc_entry_t));
            am_allocator_host_free(heap_alloc, live);
            return -1;
        }
        rc.capacity = live_n;
    }

    int32_t ret = am_allocator_heap_compact(heap_alloc, live, live_n, gc_on_relocate, &rc);
    am_allocator_host_free(heap_alloc, live);
    if (ret != 0 || rc.failed) {
        am_allocator_host_free(heap_alloc, rc.entries);
        return -1;
    }

    /* 第二遍：回写所有 heap 表中仍指向旧地址的指针。
     * 统一在此回写（不区分主/次 slot），重定位表按 old_ptr 升序，二分查找。 */
    if (rc.count > 0) {
        for (size_t h = 0; h < heap_count; h++) {
            am_heap_t *heap = heaps[h];
            if (!heap || !heap->table) continue;
            size_t cap = heap->table->capacity;
            for (size_t i = 0; i < cap; i++) {
                am_value_t key = heap->table->slots[i].key;
                if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) continue;
                am_value_t v = heap->table->slots[i].value;
                if (!am_value_is_ptr(v)) continue;

                void *new_ptr = gc_reloc_lookup(&rc, am_value_to_ptr(v));
                if (new_ptr) {
                    heap->table->slots[i].value = am_make_value_of_ptr((am_object_t *)new_ptr);
                }
            }
        }
    }

    am_allocator_host_free(heap_alloc, rc.entries);
    return 0;
}


// ===============================================================================
// 编排：对进程池执行一轮完整 GC
// ===============================================================================

int32_t am_gc_collect(am_allocator_t *heap_alloc, am_process_t **process_pool,
                      size_t process_count, size_t gc_seq, int32_t force_compact) {
    if (!heap_alloc || !process_pool) return -1;

    /* 标记-清除：对所有现存进程执行 GC。
     * 仅 GC 成功的进程堆纳入压缩列表，避免压缩数组越界。 */
    am_heap_t **heaps = NULL;
    if (process_count > 0) {
        heaps = (am_heap_t **)am_allocator_host_malloc(heap_alloc, process_count * sizeof(am_heap_t *));
    }
    size_t heap_count = 0;
    for (size_t i = 0; i < process_count; i++) {
        am_process_t *proc = process_pool[i];
        if (!proc) continue;
        if (am_gc_process(proc) == 0 && proc->heap && heaps) {
            heaps[heap_count++] = proc->heap;
        }
    }

#if AM_HEAP_COMPACT_INTERVAL > 0
    /* 标记-压缩：在 GC 安全点一次性压缩所有进程的存活对象。
     * 所有进程共享同一个底层 heap_alloc，全局压缩避免互相覆盖。
     * force_compact 非 0 时无视 AM_HEAP_COMPACT_INTERVAL 当轮强制压缩。 */
    if ((force_compact || (gc_seq % AM_HEAP_COMPACT_INTERVAL) == 0) && heap_count > 0) {
        if (am_gc_compact(heap_alloc, heaps, heap_count) == 0) {
            am_allocator_pool_t *pool = am_allocator_pool_current();
            if (pool) {
                (void)am_allocator_pool_auto_adjust(pool);
            }
        }
    }
#else
    (void)gc_seq;
    (void)force_compact;
#endif

    if (heaps) am_allocator_host_free(heap_alloc, heaps);
    return 0;
}

int32_t am_gc_heap_watermark_level(am_allocator_t *heap_alloc) {
    if (!heap_alloc) return -1;

    size_t used = 0, capacity = 0, largest_free = 0;
    if (am_allocator_heap_usage(heap_alloc, &used, &capacity, &largest_free) != 0) return -1;
    if (capacity == 0) return -1;

    double ratio = (double)used / (double)capacity;
    if (ratio >= AM_GC_HEAP_CRITICAL_RATIO) return 2;
    if (ratio >= AM_GC_HEAP_HIGH_WATER_RATIO) return 1;
    // 碎片维度：用量超过下限但最大空闲块已小于容量的 AM_GC_HEAP_FRAG_MIN_BLOCK_RATIO，
    // first-fit 随时可能失败，需要提前压缩整理（标记-清除+强制压缩）。
    if (ratio >= AM_GC_HEAP_FRAG_FLOOR_RATIO &&
        (double)largest_free < (double)capacity * AM_GC_HEAP_FRAG_MIN_BLOCK_RATIO) {
        return 2;
    }
    return 0;
}
