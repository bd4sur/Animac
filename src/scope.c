#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "object.h"
#include "allocator.h"
#include "scope.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

static am_scope_t *am_scope_resize(am_allocator_t *alloc, am_scope_t *scope, size_t new_capacity) {
    if (new_capacity < scope->length) new_capacity = scope->length;

    size_t total_size = sizeof(am_scope_t) + new_capacity * sizeof(am_scope_binding_t);
    am_scope_t *new_scope = (am_scope_t *)am_malloc(alloc, total_size);
    if (!new_scope) return NULL;

    new_scope->base = scope->base;
    new_scope->parent_scope_handle = scope->parent_scope_handle;
    new_scope->parent_lambda_handle = scope->parent_lambda_handle;
    new_scope->current_lambda_handle = scope->current_lambda_handle;
    new_scope->capacity = new_capacity;
    new_scope->length = scope->length;

    if (scope->length > 0) {
        memcpy(new_scope->bindings, scope->bindings, scope->length * sizeof(am_scope_binding_t));
    }

    am_free(alloc, scope);
    return new_scope;
}


static am_scope_t *am_scope_grow_if_needed(am_allocator_t *alloc, am_scope_t *scope) {
    if (scope->length < scope->capacity) return scope;

    size_t new_capacity = scope->capacity * 2;
    if (new_capacity < 16) new_capacity = 16;
    return am_scope_resize(alloc, scope, new_capacity);
}


// ===============================================================================
// 构造函数
// ===============================================================================

am_scope_t *am_scope_create(am_allocator_t *alloc, am_handle_t parent_scope_handle, am_handle_t parent_lambda_handle, am_handle_t current_lambda_handle, size_t capacity) {
    if (capacity == 0) capacity = 16;

    size_t total_size = sizeof(am_scope_t) + capacity * sizeof(am_scope_binding_t);
    am_scope_t *scope = (am_scope_t *)am_calloc(alloc, total_size);
    if (!scope) return NULL;

    scope->base.type = AM_OBJECT_TYPE_SCOPE;
    scope->parent_scope_handle = parent_scope_handle;
    scope->parent_lambda_handle = parent_lambda_handle;
    scope->current_lambda_handle = current_lambda_handle;
    scope->capacity = capacity;
    scope->length = 0;

    return scope;
}


// ===============================================================================
// 析构
// ===============================================================================

int32_t am_scope_destroy(am_allocator_t *alloc, am_scope_t *scope) {
    if (!scope) return 0;
    am_free(alloc, scope);
    return 0;
}


// ===============================================================================
// 拷贝
// ===============================================================================

am_scope_t *am_scope_copy(am_allocator_t *alloc, am_scope_t *scope) {
    if (!scope) return NULL;

    am_scope_t *copy = am_scope_create(alloc, scope->parent_scope_handle, scope->parent_lambda_handle, scope->current_lambda_handle, scope->capacity);
    if (!copy) return NULL;

    copy->base = scope->base;
    copy->length = scope->length;
    if (scope->length > 0) {
        memcpy(copy->bindings, scope->bindings, scope->length * sizeof(am_scope_binding_t));
    }
    return copy;
}


// ===============================================================================
// 对象二进制转储 TODO
// ===============================================================================

uint8_t *am_scope_dump(am_allocator_t *alloc, am_scope_t *scope, size_t *size) {
    (void)alloc;
    (void)scope;
    if (size) *size = 0;
    return NULL;
}


// ===============================================================================
// 查询与新增
// ===============================================================================

int32_t am_scope_has_var(am_allocator_t *alloc, am_scope_t *scope, am_varid_t variable) {
    (void)alloc;
    if (!scope) return -1;
    for (size_t i = 0; i < scope->length; i++) {
        if (scope->bindings[i].varid == variable) return 0;
    }
    return -1;
}


am_scope_t *am_scope_add_var(am_allocator_t *alloc, am_scope_t *scope, am_varid_t variable, am_value_t value) {
    if (!scope) return NULL;
    if (am_scope_has_var(alloc, scope, variable) >= 0) return NULL;

    scope = am_scope_grow_if_needed(alloc, scope);
    if (!scope) return NULL;

    scope->bindings[scope->length].varid = variable;
    scope->bindings[scope->length].value = value;
    scope->length++;

    return scope;
}
