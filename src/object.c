#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "object.h"

#define AM_OBJECT_STATIC_MASK    ((uint32_t)0x00000001u)
#define AM_OBJECT_KEEPALIVE_MASK ((uint32_t)0x00000002u)
#define AM_OBJECT_ALIVE_MASK     ((uint32_t)0x80000000u)

int32_t am_object_check_static(am_object_t *obj) {
    if (obj == NULL) {
        return -1;
    }
    return (obj->header & AM_OBJECT_STATIC_MASK) ? 0 : -1;
}

int32_t am_object_set_static(am_object_t *obj, int32_t is_static) {
    if (obj == NULL) {
        return -1;
    }
    if (is_static == 0) {
        obj->header |= AM_OBJECT_STATIC_MASK;
        return 0;
    }
    if (is_static == -1) {
        obj->header &= ~AM_OBJECT_STATIC_MASK;
        return 0;
    }
    return -1;
}

int32_t am_object_check_keepalive(am_object_t *obj) {
    if (obj == NULL) {
        return -1;
    }
    return (obj->header & AM_OBJECT_KEEPALIVE_MASK) ? 0 : -1;
}

int32_t am_object_set_keepalive(am_object_t *obj, int32_t is_keepalive) {
    if (obj == NULL) {
        return -1;
    }
    if (is_keepalive == 0) {
        obj->header |= AM_OBJECT_KEEPALIVE_MASK;
        return 0;
    }
    if (is_keepalive == -1) {
        obj->header &= ~AM_OBJECT_KEEPALIVE_MASK;
        return 0;
    }
    return -1;
}

int32_t am_object_check_alive(am_object_t *obj) {
    if (obj == NULL) {
        return -1;
    }
    return (obj->gcmark & AM_OBJECT_ALIVE_MASK) ? 0 : -1;
}

int32_t am_object_set_alive(am_object_t *obj, int32_t is_alive) {
    if (obj == NULL) {
        return -1;
    }
    if (is_alive == 0) {
        obj->gcmark |= AM_OBJECT_ALIVE_MASK;
        return 0;
    }
    if (is_alive == -1) {
        obj->gcmark &= ~AM_OBJECT_ALIVE_MASK;
        return 0;
    }
    return -1;
}
