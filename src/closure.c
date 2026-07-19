#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "object.h"
#include "allocator.h"

#include "closure.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 在闭包中线性查找指定 varid 与 type 的绑定。
// 返回指向匹配 binding 的指针；未找到返回 NULL。
static am_binding_t *am_closure_find(am_obj_closure_t *closure, am_varid_t varid, int32_t type) {
    for (size_t i = 0; i < closure->length; i++) {
        if (closure->bindings[i].varid == varid && closure->bindings[i].type == type) {
            return &closure->bindings[i];
        }
    }
    return NULL;
}

// 仅按 varid 查找（不区分绑定类型），用于脏标记查询。
// 返回指向匹配 binding 的指针；未找到返回 NULL。
static am_binding_t *am_closure_find_by_varid(am_obj_closure_t *closure, am_varid_t varid) {
    for (size_t i = 0; i < closure->length; i++) {
        if (closure->bindings[i].varid == varid) {
            return &closure->bindings[i];
        }
    }
    return NULL;
}

// 将闭包扩容到新容量，返回新的闭包对象指针；失败返回 NULL。
// 原闭包对象会被释放，调用者必须使用返回的新指针。
static am_obj_closure_t *am_closure_resize(am_allocator_t *alloc, am_obj_closure_t *closure, size_t new_capacity) {
    size_t total_size = sizeof(am_obj_closure_t) + new_capacity * sizeof(am_binding_t);
    am_obj_closure_t *new_closure = (am_obj_closure_t *)am_malloc(alloc, total_size);
    if (!new_closure) return NULL;

    // 拷贝头部与已有 binding（拷贝长度按原 length，而非原 capacity）
    memcpy(new_closure, closure, sizeof(am_obj_closure_t));
    if (closure->length > 0) {
        memcpy(new_closure->bindings, closure->bindings, closure->length * sizeof(am_binding_t));
    }
    new_closure->capacity = new_capacity;

    am_free(alloc, closure);
    return new_closure;
}

// 若空间不足则扩容。绝大多数情况下不会触发实际分配。
// 返回原指针或新指针；失败返回 NULL。
static am_obj_closure_t *am_closure_grow_if_needed(am_allocator_t *alloc, am_obj_closure_t *closure) {
    if (closure->length < closure->capacity) return closure;

    size_t new_capacity = closure->capacity * 2;
    if (new_capacity < 16) new_capacity = 16;
    return am_closure_resize(alloc, closure, new_capacity);
}

// ===============================================================================
// 构造函数
// ===============================================================================

// 创建闭包。capacity 为 0 时默认使用 16。
am_obj_closure_t *am_closure_create(am_allocator_t *alloc, am_iaddr_t iaddr, am_handle_t parent, size_t capacity) {
    if (capacity == 0) capacity = 16;

    size_t total_size = sizeof(am_obj_closure_t) + capacity * sizeof(am_binding_t);
    am_obj_closure_t *closure = (am_obj_closure_t *)am_malloc(alloc, total_size);
    if (!closure) return NULL;

    memset(closure, 0, total_size);

    closure->base.type = AM_OBJECT_TYPE_CLOSURE;
    closure->iaddr = iaddr;
    closure->parent = parent;
    closure->length = 0;
    closure->capacity = capacity;

    return closure;
}

// ===============================================================================
// 析构
// ===============================================================================

// 销毁闭包对象。binding 中的 value 按引用处理，不由闭包释放。
int32_t am_closure_destroy(am_allocator_t *alloc, am_obj_closure_t *closure) {
    am_free(alloc, closure);
    return 0;
}

// ===============================================================================
// 拷贝
// ===============================================================================

// 深拷贝（头部与所有 binding）。value 按位拷贝（与 TS Copy 语义一致，不递归释放对象）。
am_obj_closure_t *am_closure_copy(am_allocator_t *alloc, am_obj_closure_t *closure) {
    am_obj_closure_t *copy = am_closure_create(alloc, closure->iaddr, closure->parent, closure->capacity);
    if (!copy) return NULL;

    copy->length = closure->length;
    if (closure->length > 0) {
        memcpy(copy->bindings, closure->bindings, closure->length * sizeof(am_binding_t));
    }
    return copy;
}

// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_closure_size(am_allocator_t *alloc, am_obj_closure_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->capacity > (SIZE_MAX - sizeof(am_obj_closure_t)) / sizeof(am_binding_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_obj_closure_t) + obj->capacity * sizeof(am_binding_t);
}


// ===============================================================================
// 对象二进制转储 TODO
// ===============================================================================

// 功能说明：将闭包对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
//       压缩对象，将capacity压缩到跟length一致，删除多余分配的空闲部分。
size_t am_closure_dump(am_allocator_t *alloc, am_obj_closure_t *closure, uint8_t *buffer, size_t offset) {
    (void)alloc;
    if (!closure) return SIZE_MAX;

    size_t dump_size = sizeof(am_obj_closure_t) + closure->length * sizeof(am_binding_t);

    if (buffer != NULL && offset != SIZE_MAX) {
        am_obj_closure_t *dump = (am_obj_closure_t *)&buffer[offset];
        dump->base = closure->base;
        dump->iaddr = closure->iaddr;
        dump->parent = closure->parent;
        dump->length = closure->length;
        dump->capacity = closure->length;

        if (closure->length > 0) {
            memcpy(dump->bindings, closure->bindings, closure->length * sizeof(am_binding_t));
        }
    }

    return dump_size;
}


// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的闭包对象，构造闭包对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_obj_closure_t对象的指针，失败则返回NULL。
am_obj_closure_t *am_closure_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    am_obj_closure_t *dump = (am_obj_closure_t *)&buffer[offset];
    if (dump->base.type != AM_OBJECT_TYPE_CLOSURE) return NULL;

    size_t total_size = sizeof(am_obj_closure_t) + dump->length * sizeof(am_binding_t);
    am_obj_closure_t *closure = (am_obj_closure_t *)am_malloc(alloc, total_size);
    if (!closure) return NULL;

    memcpy(closure, dump, total_size);
    return closure;
}


// ===============================================================================
// 约束变量操作
// ===============================================================================

// 初始化约束变量（不加脏标记）。若已存在则更新 value 并清除脏标记。
// 如涉及扩容，返回新闭包对象指针；否则返回原指针。失败返回 NULL。
am_obj_closure_t *am_closure_init_bound_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable, am_value_t value) {
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
    if (binding) {
        binding->value = value;
        binding->dirty_flag = 0;
        // 同一 varid 的自由变量绑定也清除脏标记，保持该变量脏标记一致
        am_binding_t *free_binding = am_closure_find(closure, variable, AM_BINDING_FREE);
        if (free_binding) {
            free_binding->dirty_flag = 0;
        }
        return closure;
    }

    closure = am_closure_grow_if_needed(alloc, closure);
    if (!closure) return NULL;

    closure->bindings[closure->length].varid = variable;
    closure->bindings[closure->length].type = AM_BINDING_BOUND;
    closure->bindings[closure->length].dirty_flag = 0;
    closure->bindings[closure->length].value = value;
    closure->length++;
    // 若已存在同 varid 的自由变量绑定，也将其脏标记清除
    am_binding_t *free_binding = am_closure_find(closure, variable, AM_BINDING_FREE);
    if (free_binding) {
        free_binding->dirty_flag = 0;
    }
    return closure;
}

// 设置约束变量（加脏标记，仅用于 set 指令）。若不存在则插入。
// 返回新指针或原指针；失败返回 NULL。
am_obj_closure_t *am_closure_set_bound_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable, am_value_t value) {
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
    if (binding) {
        binding->value = value;
        binding->dirty_flag = 1;
    }
    else {
        closure = am_closure_grow_if_needed(alloc, closure);
        if (!closure) return NULL;

        closure->bindings[closure->length].varid = variable;
        closure->bindings[closure->length].type = AM_BINDING_BOUND;
        closure->bindings[closure->length].dirty_flag = 1;
        closure->bindings[closure->length].value = value;
        closure->length++;
    }

    // 同一 varid 的自由变量绑定也置脏，保持变量级脏标记一致
    am_binding_t *free_binding = am_closure_find(closure, variable, AM_BINDING_FREE);
    if (free_binding) {
        free_binding->dirty_flag = 1;
        free_binding->value = value;
    }

    return closure;
}

// 获取约束变量。未找到返回 AM_VALUE_UNDEFINED。
am_value_t am_closure_get_bound_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable) {
    (void)alloc;
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
    return binding ? binding->value : AM_VALUE_UNDEFINED;
}

// ===============================================================================
// 自由变量操作
// ===============================================================================

// 初始化自由变量（不加脏标记）。若已存在则更新 value 并清除脏标记。
am_obj_closure_t *am_closure_init_free_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable, am_value_t value) {
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_FREE);
    if (binding) {
        binding->value = value;
        binding->dirty_flag = 0;
        am_binding_t *bound_binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
        if (bound_binding) {
            bound_binding->dirty_flag = 0;
        }
        return closure;
    }

    closure = am_closure_grow_if_needed(alloc, closure);
    if (!closure) return NULL;

    closure->bindings[closure->length].varid = variable;
    closure->bindings[closure->length].type = AM_BINDING_FREE;
    closure->bindings[closure->length].dirty_flag = 0;
    closure->bindings[closure->length].value = value;
    closure->length++;
    am_binding_t *bound_binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
    if (bound_binding) {
        bound_binding->dirty_flag = 0;
    }
    return closure;
}

// 设置自由变量（加脏标记，仅用于 set 指令）。若不存在则插入。
am_obj_closure_t *am_closure_set_free_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable, am_value_t value) {
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_FREE);
    if (binding) {
        binding->value = value;
        binding->dirty_flag = 1;
    }
    else {
        closure = am_closure_grow_if_needed(alloc, closure);
        if (!closure) return NULL;

        closure->bindings[closure->length].varid = variable;
        closure->bindings[closure->length].type = AM_BINDING_FREE;
        closure->bindings[closure->length].dirty_flag = 1;
        closure->bindings[closure->length].value = value;
        closure->length++;
    }

    // 同一 varid 的约束变量绑定也置脏，保持变量级脏标记一致
    am_binding_t *bound_binding = am_closure_find(closure, variable, AM_BINDING_BOUND);
    if (bound_binding) {
        bound_binding->dirty_flag = 1;
        bound_binding->value = value;
    }

    return closure;
}

// 获取自由变量。未找到返回 AM_VALUE_UNDEFINED。
am_value_t am_closure_get_free_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable) {
    (void)alloc;
    am_binding_t *binding = am_closure_find(closure, variable, AM_BINDING_FREE);
    return binding ? binding->value : AM_VALUE_UNDEFINED;
}

// ===============================================================================
// 查询
// ===============================================================================

// 判断变量是否为脏。为脏返回 0，未找到或不为脏返回 -1。
int32_t am_closure_is_dirty_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable) {
    (void)alloc;
    am_binding_t *binding = am_closure_find_by_varid(closure, variable);
    return (binding && binding->dirty_flag != 0) ? 0 : -1;
}

// 是否存在约束变量绑定。存在返回 0，不存在返回 -1。
int32_t am_closure_has_bound_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable) {
    (void)alloc;
    return am_closure_find(closure, variable, AM_BINDING_BOUND) ? 0 : -1;
}

// 是否存在自由变量绑定。存在返回 0，不存在返回 -1。
int32_t am_closure_has_free_var(am_allocator_t *alloc, am_obj_closure_t *closure, am_varid_t variable) {
    (void)alloc;
    return am_closure_find(closure, variable, AM_BINDING_FREE) ? 0 : -1;
}
