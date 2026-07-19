#include "ast.h"
#include "opcode.h"

// 全局内置变量到 VM opcode 的映射表。
// 下标与 AM_GLOBAL_BUILTIN_VAR 一一对应；-1 表示该 builtin 没有对应 opcode。
// AM_GLOBAL_BUILTIN_VAR_NUM 定义在 ast.h
const int32_t AM_BUILTIN_OPCODE_MAP[AM_GLOBAL_BUILTIN_VAR_NUM] = {
    [0]  = AM_VM_OP_add,         // +
    [1]  = AM_VM_OP_sub,         // -
    [2]  = AM_VM_OP_mul,         // *
    [3]  = AM_VM_OP_div,         // /
    [4]  = AM_VM_OP_mod,         // mod
    [5]  = AM_VM_OP_pow,         // pow
    [6]  = AM_VM_OP_not,         // not
    [7]  = AM_VM_OP_gt,          // >
    [8]  = AM_VM_OP_lt,          // <
    [9]  = AM_VM_OP_ge,          // >=
    [10] = AM_VM_OP_le,          // <=
    [11] = AM_VM_OP_eqv,         // ==
    [12] = AM_VM_OP_eq,          // eq?
    [13] = AM_VM_OP_eqv,         // eqv?
    [14] = AM_VM_OP_equal,       // equal?
    [15] = AM_VM_OP_isnull,      // null?
    [16] = AM_VM_OP_isundef,     // undefined?
    [17] = AM_VM_OP_isatom,      // atom?
    [18] = AM_VM_OP_islist,      // list?
    [19] = AM_VM_OP_isnumber,    // number?
    [20] = AM_VM_OP_isnan,       // nan?
    [21] = AM_VM_OP_typeof,      // typeof
    [22] = AM_VM_OP_car,         // car
    [23] = AM_VM_OP_cdr,         // cdr
    [24] = AM_VM_OP_cons,        // cons
    [25] = AM_VM_OP_get_item,    // get_item
    [26] = AM_VM_OP_set_item,    // set_item!
    [27] = AM_VM_OP_list_push,   // push
    [28] = AM_VM_OP_list_pop,    // pop
    [29] = AM_VM_OP_length,      // length
    [30] = AM_VM_OP_display,     // display
    [31] = AM_VM_OP_newline,     // newline
    [32] = AM_VM_OP_write,       // write
    [33] = AM_VM_OP_read,        // read
    [34] = -1,                   // call/cc
    [35] = AM_VM_OP_fork,        // fork
    [36] = -1,                   // dynamic-wind
};
