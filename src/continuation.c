#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "object.h"
#include "allocator.h"
#include "continuation.h"


// ===============================================================================
// 构造函数
// ===============================================================================

// 创建续体对象。成功返回指针，失败返回NULL。
// opstack 与 fstack 按值拷贝到柔性数组 stacks 中；传入的数组指针在拷贝后不再被引用。
am_continuation_t *am_continuation_create(
    am_allocator_t *alloc, am_iaddr_t cont_return_target, am_handle_t current_closure_handle,
    am_value_t *opstack, size_t opstack_length, am_value_t *fstack, size_t fstack_length,
    am_handle_t dynamic_wind_stack_handle) {
    if (!alloc) return NULL;

    size_t total_length = opstack_length + fstack_length;
    size_t total_size = sizeof(am_continuation_t) + total_length * sizeof(am_value_t);

    am_continuation_t *cont = (am_continuation_t *)am_malloc(alloc, total_size);
    if (!cont) return NULL;

    memset(cont, 0, total_size);

    cont->base.type = AM_OBJECT_TYPE_CONTINUATION;
    cont->length = total_length;
    cont->fstack_offset = opstack_length;
    cont->cont_return_target = cont_return_target;
    cont->current_closure_handle = current_closure_handle;
    cont->dynamic_wind_stack_handle = dynamic_wind_stack_handle;
    cont->dynamic_wind_after_stack_handle = AM_HANDLE_NULL;
    cont->current_dynamic_wind_entry_handle = AM_HANDLE_NULL;
    cont->current_dynamic_wind_thunk_handle = AM_HANDLE_NULL;

    if (opstack_length > 0) {
        memcpy(&cont->stacks[0], opstack, opstack_length * sizeof(am_value_t));
    }
    if (fstack_length > 0) {
        memcpy(&cont->stacks[opstack_length], fstack, fstack_length * sizeof(am_value_t));
    }

    return cont;
}


// ===============================================================================
// 析构
// ===============================================================================

// 销毁续体对象。stacks 中的 value 按引用处理，不由续体释放。
int32_t am_continuation_destroy(am_allocator_t *alloc, am_continuation_t *obj) {
    if (!alloc || !obj) return -1;
    am_free(alloc, obj);
    return 0;
}


// ===============================================================================
// 拷贝
// ===============================================================================

// 深拷贝（头部与整个 stacks 数组）。value 按位拷贝（与 TS Copy 语义一致，不递归释放对象）。
am_continuation_t *am_continuation_copy(am_allocator_t *alloc, am_continuation_t *obj) {
    if (!alloc || !obj) return NULL;

    size_t opstack_length = obj->fstack_offset;
    size_t fstack_length = obj->length - obj->fstack_offset;

    am_continuation_t *copy = am_continuation_create(
        alloc, obj->cont_return_target, obj->current_closure_handle,
        &obj->stacks[0], opstack_length,
        &obj->stacks[obj->fstack_offset], fstack_length,
        obj->dynamic_wind_stack_handle);

    if (!copy) return NULL;

    // 拷贝基类元数据（type 已在 create 中设置）
    copy->base.header = obj->base.header;
    copy->base.hash = obj->base.hash;
    copy->base.gcmark = obj->base.gcmark;

    return copy;
}


// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_continuation_size(am_allocator_t *alloc, am_continuation_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->length > (SIZE_MAX - sizeof(am_continuation_t)) / sizeof(am_value_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_continuation_t) + obj->length * sizeof(am_value_t);
}


// ===============================================================================
// 查询
// ===============================================================================

// 获取 opstack 数组的副本。成功返回新数组指针（通过 alloc 分配，由调用者负责释放），失败返回NULL。
am_value_t *am_continuation_get_opstack(am_allocator_t *alloc, am_continuation_t *obj, size_t *length) {
    if (!alloc || !obj || !length) return NULL;

    size_t opstack_length = obj->fstack_offset;
    *length = opstack_length;

    // 即使长度为 0 也分配至少一个元素大小，避免 malloc(0) 行为不确定导致误判失败
    size_t alloc_size = opstack_length > 0 ? opstack_length * sizeof(am_value_t) : sizeof(am_value_t);
    am_value_t *result = (am_value_t *)am_malloc(alloc, alloc_size);
    if (!result) return NULL;

    if (opstack_length > 0) {
        memcpy(result, &obj->stacks[0], opstack_length * sizeof(am_value_t));
    }

    return result;
}

// 获取 fstack 数组的副本。成功返回新数组指针（通过 alloc 分配，由调用者负责释放），失败返回NULL。
am_value_t *am_continuation_get_fstack(am_allocator_t *alloc, am_continuation_t *obj, size_t *length) {
    if (!alloc || !obj || !length) return NULL;

    size_t fstack_length = obj->length - obj->fstack_offset;
    *length = fstack_length;

    // 即使长度为 0 也分配至少一个元素大小，避免 malloc(0) 行为不确定导致误判失败
    size_t alloc_size = fstack_length > 0 ? fstack_length * sizeof(am_value_t) : sizeof(am_value_t);
    am_value_t *result = (am_value_t *)am_malloc(alloc, alloc_size);
    if (!result) return NULL;

    if (fstack_length > 0) {
        memcpy(result, &obj->stacks[obj->fstack_offset], fstack_length * sizeof(am_value_t));
    }

    return result;
}
