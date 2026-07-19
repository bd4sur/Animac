#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "object.h"
#include "allocator.h"
#include "map.h"
#include "list.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 将列表扩容到新容量，返回新的列表对象指针；失败返回 NULL。
// 原列表对象会被释放，调用者必须使用返回的新指针。
static am_list_t *am_list_resize(am_allocator_t *alloc, am_list_t *lst, size_t new_capacity) {
    if (new_capacity < lst->length) new_capacity = lst->length;

    size_t total_size = sizeof(am_list_t) + new_capacity * sizeof(am_value_t);
    am_list_t *new_lst = (am_list_t *)am_malloc(alloc, total_size);
    if (!new_lst) return NULL;

    new_lst->base = lst->base;
    new_lst->capacity = new_capacity;
    new_lst->length = lst->length;
    new_lst->type = lst->type;
    new_lst->parent = lst->parent;

    if (lst->length > 0) {
        memcpy(new_lst->children, lst->children, lst->length * sizeof(am_value_t));
    }

    am_free(alloc, lst);
    return new_lst;
}


// 若空间不足则扩容。绝大多数情况下不会触发实际分配。
// 返回原指针或新指针；失败返回 NULL。
static am_list_t *am_list_grow_if_needed(am_allocator_t *alloc, am_list_t *lst) {
    if (lst->length < lst->capacity) return lst;

    size_t new_capacity = lst->capacity * 2;
    if (new_capacity < 4) new_capacity = 4;
    return am_list_resize(alloc, lst, new_capacity);
}


// ===============================================================================
// 构造函数
// ===============================================================================

am_list_t *am_list_create(am_allocator_t *alloc, size_t capacity, int32_t type, am_handle_t parent) {
    if (capacity < 4) capacity = 4;

    size_t total_size = sizeof(am_list_t) + capacity * sizeof(am_value_t);
    am_list_t *lst = (am_list_t *)am_calloc(alloc, total_size);
    if (!lst) return NULL;

    lst->base.type = AM_OBJECT_TYPE_LIST;
    lst->capacity = capacity;
    lst->length = 0;
    lst->type = type;
    lst->parent = parent;

    return lst;
}


// ===============================================================================
// 析构
// ===============================================================================

int32_t am_list_destroy(am_allocator_t *alloc, am_list_t *lst) {
    if (!lst) return 0;
    am_free(alloc, lst);
    return 0;
}


// ===============================================================================
// 拷贝
// ===============================================================================

am_list_t *am_list_copy(am_allocator_t *alloc, am_list_t *lst) {
    if (!lst) return NULL;

    am_list_t *copy = am_list_create(alloc, lst->capacity, lst->type, lst->parent);
    if (!copy) return NULL;

    copy->base = lst->base;
    copy->length = lst->length;
    if (lst->length > 0) {
        memcpy(copy->children, lst->children, lst->length * sizeof(am_value_t));
    }
    return copy;
}


// ===============================================================================
// 对象大小
// ===============================================================================

// 功能说明：计算对象所占用的实际字节数（考虑结构体填充和对齐问题）
// 成功返回字节数，失败返回SIZE_MAX
size_t am_list_size(am_allocator_t *alloc, am_list_t *obj) {
    (void)alloc;
    if (!obj) return SIZE_MAX;

    if (obj->capacity > (SIZE_MAX - sizeof(am_list_t)) / sizeof(am_value_t)) {
        return SIZE_MAX;
    }
    return sizeof(am_list_t) + obj->capacity * sizeof(am_value_t);
}


// ===============================================================================
// 遍历
// ===============================================================================

void am_list_iter(am_allocator_t *alloc, am_list_t *lst, am_list_iter_callback_t cb, void *user_data) {
    (void)alloc;
    if (!lst || !cb) return;
    for (size_t i = 0; i < lst->length; i++) {
        cb(i, lst->children[i], user_data);
    }
}


// ===============================================================================
// 对象二进制转储
// ===============================================================================

// 功能说明：将列表对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
//       压缩对象，将capacity压缩到跟length一致，删除多余分配的空闲部分。
size_t am_list_dump(am_allocator_t *alloc, am_list_t *lst, uint8_t *buffer, size_t offset) {
    (void)alloc;
    if (!lst) return SIZE_MAX;

    size_t dump_size = sizeof(am_list_t) + lst->length * sizeof(am_value_t);

    if (buffer != NULL && offset != SIZE_MAX) {
        am_list_t *dump = (am_list_t *)&buffer[offset];
        dump->base = lst->base;
        dump->capacity = lst->length;
        dump->length = lst->length;
        dump->type = lst->type;
        dump->parent = lst->parent;

        if (lst->length > 0) {
            memcpy(dump->children, lst->children, lst->length * sizeof(am_value_t));
        }
    }

    return dump_size;
}


// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的列表对象，构造列表对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_list_t对象的指针，失败则返回NULL。
am_list_t *am_list_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    am_list_t *dump = (am_list_t *)&buffer[offset];
    if (dump->base.type != AM_OBJECT_TYPE_LIST) return NULL;

    size_t total_size = sizeof(am_list_t) + dump->length * sizeof(am_value_t);
    am_list_t *lst = (am_list_t *)am_malloc(alloc, total_size);
    if (!lst) return NULL;

    memcpy(lst, dump, total_size);
    return lst;
}


// ===============================================================================
// 基本操作
// ===============================================================================

am_value_t am_list_get(am_allocator_t *alloc, am_list_t *lst, size_t index) {
    (void)alloc;
    if (!lst || index >= lst->length) return AM_VALUE_UNDEFINED;
    return lst->children[index];
}


int32_t am_list_set(am_allocator_t *alloc, am_list_t *lst, size_t index, am_value_t item) {
    (void)alloc;
    if (!lst || index >= lst->length) return -1;
    lst->children[index] = item;
    return 0;
}


am_list_t *am_list_push(am_allocator_t *alloc, am_list_t *lst, am_value_t item) {
    if (!lst) return NULL;

    lst = am_list_grow_if_needed(alloc, lst);
    if (!lst) return NULL;

    lst->children[lst->length++] = item;
    return lst;
}


am_value_t am_list_pop(am_allocator_t *alloc, am_list_t *lst) {
    (void)alloc;
    if (!lst || lst->length == 0) return AM_VALUE_UNDEFINED;
    return lst->children[--lst->length];
}


am_value_t am_list_shift(am_allocator_t *alloc, am_list_t *lst) {
    (void)alloc;
    if (!lst || lst->length == 0) return AM_VALUE_UNDEFINED;

    am_value_t first = lst->children[0];
    for (size_t i = 1; i < lst->length; i++) {
        lst->children[i - 1] = lst->children[i];
    }
    lst->length--;
    return first;
}


size_t am_list_find(am_allocator_t *alloc, am_list_t *lst, am_value_t item, size_t from_index) {
    (void)alloc;
    if (!lst || from_index >= lst->length) return SIZE_MAX;
    for (size_t i = from_index; i < lst->length; i++) {
        if (am_value_equal(lst->children[i], item)) return i;
    }
    return SIZE_MAX;
}


// ===============================================================================
// Lambda 表相关函数
// ===============================================================================

// Lambda表结构：children[0]='lambda, children[1]=n_param(uint), children[2..2+n)=params, children[2+n..)=bodies

static inline am_uint_t lambda_param_count(am_list_t *lambda) {
    if (!lambda || lambda->length < 2) return 0;
    am_value_t n = lambda->children[1];
    if (!am_value_is_uint(n)) return 0;
    return am_value_to_uint(n);
}


static inline void lambda_set_param_count(am_list_t *lambda, am_uint_t n) {
    if (lambda && lambda->length >= 2) {
        lambda->children[1] = am_make_value_of_uint(n);
    }
}


am_list_t *am_list_lambda_add_parameter(am_allocator_t *alloc, am_list_t *lst, am_value_t param) {
    if (!lst) return NULL;
    if (!am_value_is_varid(param)) {
        // 允许 '...' 作为形式参数出现，用于 syntax-rules 宏模板中的可变参数列表。
        if (!(am_value_is_symbol(param) && am_value_to_symbol(param) == am_value_to_symbol(AM_VALUE_KW_dot3))) {
            return NULL;
        }
    }
    if (lst->type != AM_LIST_TYPE_LAMBDA) return NULL;

    am_uint_t n_param = lambda_param_count(lst);
    size_t insert_pos = 2 + n_param;

    lst = am_list_grow_if_needed(alloc, lst);
    if (!lst) return NULL;

    // 将原有 bodies 后移一位
    for (size_t i = lst->length; i > insert_pos; i--) {
        lst->children[i] = lst->children[i - 1];
    }
    lst->children[insert_pos] = param;
    lst->length++;
    lambda_set_param_count(lst, n_param + 1);

    return lst;
}


am_list_t *am_list_lambda_add_body(am_allocator_t *alloc, am_list_t *lst, am_value_t body) {
    if (!lst || lst->type != AM_LIST_TYPE_LAMBDA) return NULL;
    return am_list_push(alloc, lst, body);
}


size_t am_list_lambda_get_body_number(am_allocator_t *alloc, am_list_t *lst) {
    (void)alloc;
    if (!lst || lst->type != AM_LIST_TYPE_LAMBDA) return 0;
    am_uint_t n_param = lambda_param_count(lst);
    if (lst->length < 2 + n_param) return 0;
    return lst->length - 2 - n_param;
}


am_value_t *am_list_lambda_get_bodies(am_allocator_t *alloc, am_list_t *lst, size_t *n_body) {
    (void)alloc;
    if (!lst || lst->type != AM_LIST_TYPE_LAMBDA) {
        if (n_body) *n_body = 0;
        return NULL;
    }

    am_uint_t n_param = lambda_param_count(lst);
    size_t body_start = 2 + n_param;
    size_t body_count = (lst->length > body_start) ? (lst->length - body_start) : 0;

    if (n_body) *n_body = body_count;
    if (body_count == 0) return NULL;

    am_value_t *bodies = (am_value_t *)malloc(body_count * sizeof(am_value_t));
    if (!bodies) {
        if (n_body) *n_body = 0;
        return NULL;
    }

    memcpy(bodies, &lst->children[body_start], body_count * sizeof(am_value_t));
    return bodies;
}


am_list_t *am_list_lambda_set_bodies(am_allocator_t *alloc, am_list_t *lst, am_value_t *bodies, size_t *n_body) {
    if (!lst || lst->type != AM_LIST_TYPE_LAMBDA || !bodies || !n_body) return NULL;

    am_uint_t n_param = lambda_param_count(lst);
    size_t body_count = *n_body;
    size_t new_length = 2 + n_param + body_count;

    // 若容量不足则扩容
    if (new_length > lst->capacity) {
        size_t new_capacity = lst->capacity * 2;
        while (new_capacity < new_length) new_capacity *= 2;
        lst = am_list_resize(alloc, lst, new_capacity);
        if (!lst) return NULL;
    }

    // 覆盖 bodies
    for (size_t i = 0; i < body_count; i++) {
        lst->children[2 + n_param + i] = bodies[i];
    }
    lst->length = new_length;

    return lst;
}
