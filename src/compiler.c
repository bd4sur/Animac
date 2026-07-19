#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

#include "object.h"
#include "opcode.h"
#include "ast.h"
#include "list.h"
#include "map.h"
#include "vocab.h"
#include "compiler.h"
#include "module.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// AST节点类型分类（用于编译器内部的节点类型判断）
#define AM_COMPILER_NODE_KIND_UNKNOWN   (-1)
#define AM_COMPILER_NODE_KIND_LAMBDA    (0)
#define AM_COMPILER_NODE_KIND_APPLICATION (1)
#define AM_COMPILER_NODE_KIND_QUOTE     (2)
#define AM_COMPILER_NODE_KIND_QUASIQUOTE (3)
#define AM_COMPILER_NODE_KIND_UNQUOTE   (4)
#define AM_COMPILER_NODE_KIND_STRING    (5)

// 编译器视角的值的类型分类
#define AM_COMPILER_VALUE_TYPE_HANDLE   (0)
#define AM_COMPILER_VALUE_TYPE_VARID    (1)
#define AM_COMPILER_VALUE_TYPE_SYMBOL   (2)
#define AM_COMPILER_VALUE_TYPE_NUMBER   (3)
#define AM_COMPILER_VALUE_TYPE_BOOLEAN  (4)
#define AM_COMPILER_VALUE_TYPE_NULL     (5)
#define AM_COMPILER_VALUE_TYPE_UNDEFINED (6)
#define AM_COMPILER_VALUE_TYPE_WCHAR    (8)
#define AM_COMPILER_VALUE_TYPE_OTHER    (9)


static int32_t compiler_value_type(am_value_t v) {
    if (am_value_is_handle(v))    return AM_COMPILER_VALUE_TYPE_HANDLE;
    if (am_value_is_varid(v))     return AM_COMPILER_VALUE_TYPE_VARID;
    if (am_value_is_symbol(v))    return AM_COMPILER_VALUE_TYPE_SYMBOL;
    if (am_value_is_number(v))    return AM_COMPILER_VALUE_TYPE_NUMBER;
    if (am_value_is_boolean(v))   return AM_COMPILER_VALUE_TYPE_BOOLEAN;
    if (am_value_is_null(v))      return AM_COMPILER_VALUE_TYPE_NULL;
    if (am_value_is_undefined(v)) return AM_COMPILER_VALUE_TYPE_UNDEFINED;
    if (am_value_is_wchar(v))     return AM_COMPILER_VALUE_TYPE_WCHAR;
    return AM_COMPILER_VALUE_TYPE_OTHER;
}


static int32_t compiler_node_kind(am_compiler_ctx_t *ctx, am_handle_t h) {
    am_value_t v = am_ast_get_node(ctx->ast, h);
    if (!am_value_is_ptr(v)) return AM_COMPILER_NODE_KIND_UNKNOWN;

    am_object_t *obj = am_value_to_ptr(v);
    if (obj->type == AM_OBJECT_TYPE_WSTRING) {
        return AM_COMPILER_NODE_KIND_STRING;
    }
    if (obj->type == AM_OBJECT_TYPE_LIST) {
        am_list_t *lst = (am_list_t *)obj;
        switch (lst->type) {
            case AM_LIST_TYPE_LAMBDA:      return AM_COMPILER_NODE_KIND_LAMBDA;
            case AM_LIST_TYPE_APPLICATION: return AM_COMPILER_NODE_KIND_APPLICATION;
            case AM_LIST_TYPE_QUOTE:       return AM_COMPILER_NODE_KIND_QUOTE;
            case AM_LIST_TYPE_QUASIQUOTE:  return AM_COMPILER_NODE_KIND_QUASIQUOTE;
            case AM_LIST_TYPE_UNQUOTE:     return AM_COMPILER_NODE_KIND_UNQUOTE;
            default: break;
        }
    }
    return AM_COMPILER_NODE_KIND_UNKNOWN;
}


static am_uint_t compiler_lambda_param_count(am_list_t *lambda) {
    if (!lambda || lambda->length < 2) return 0;
    am_value_t n = lambda->children[1];
    if (!am_value_is_uint(n)) return 0;
    return am_value_to_uint(n);
}


static int32_t compiler_is_tailcall(am_compiler_ctx_t *ctx, am_handle_t handle) {
    if (!ctx || !ctx->ast || !ctx->ast->tailcall_handles) return -1;
    size_t idx = am_list_find(ctx->ast->alloc, ctx->ast->tailcall_handles,
                               am_make_value_of_handle(handle), 0);
    return (idx != SIZE_MAX) ? 0 : -1;
}


static int32_t compiler_is_native_ref(am_compiler_ctx_t *ctx, am_value_t v) {
    if (!am_value_is_varid(v)) return -1;
    return am_ast_check_native_ref(ctx->ast, am_value_to_varid(v));
}


static int32_t compiler_builtin_opcode_for_varid(am_compiler_ctx_t *ctx, am_varid_t varid) {
    if (!ctx || !ctx->ast || !ctx->ast->var_vocab) return -1;
    wchar_t *name = am_vocab_get(ctx->ast->alloc, ctx->ast->var_vocab, &varid);
    if (!name) return -1;

    // 通过 AM_GLOBAL_BUILTIN_VAR 查找 builtin 下标，再通过 AM_BUILTIN_OPCODE_MAP 取得 opcode。
    // 这样 compiler 与 parser 对 builtin 的认知保持一致。
    for (size_t i = 0; i < AM_GLOBAL_BUILTIN_VAR_NUM; i++) {
        if (wcscmp(name, AM_GLOBAL_BUILTIN_VAR[i]) == 0) {
            return AM_BUILTIN_OPCODE_MAP[i];
        }
    }
    return -1;
}


static int32_t compiler_is_break_continue(am_value_t v, int *is_break) {
    if (!am_value_is_symbol(v)) return -1;
    am_symbol_t sym = am_value_to_symbol(v);
    if (sym == am_value_to_symbol(AM_VALUE_KW_break)) {
        if (is_break) *is_break = 1;
        return 0;
    }
    if (sym == am_value_to_symbol(AM_VALUE_KW_continue)) {
        if (is_break) *is_break = 0;
        return 0;
    }
    return -1;
}


static int32_t compiler_varid_name_equals(am_compiler_ctx_t *ctx, am_varid_t varid, const wchar_t *name) {
    if (!ctx || !ctx->ast || !ctx->ast->var_vocab) return -1;
    wchar_t *vname = am_vocab_get(ctx->ast->alloc, ctx->ast->var_vocab, &varid);
    if (!vname) return -1;
    return wcscmp(vname, name) == 0 ? 0 : -1;
}


// ===============================================================================
// while 标签栈操作
// ===============================================================================

static int32_t while_tag_stack_push(am_compiler_ctx_t *ctx, am_value_t cond_tag, am_value_t end_tag) {
    if (!ctx || !ctx->while_tag_stack) return -1;
    am_list_t *lst = am_list_push(ctx->ast->alloc, ctx->while_tag_stack, cond_tag);
    if (!lst) return -1;
    ctx->while_tag_stack = lst;
    lst = am_list_push(ctx->ast->alloc, ctx->while_tag_stack, end_tag);
    if (!lst) return -1;
    ctx->while_tag_stack = lst;
    return 0;
}


static int32_t while_tag_stack_top(am_compiler_ctx_t *ctx, am_value_t *cond_tag, am_value_t *end_tag) {
    if (!ctx || !ctx->while_tag_stack || ctx->while_tag_stack->length < 2) return -1;
    size_t len = ctx->while_tag_stack->length;
    if (cond_tag) *cond_tag = am_list_get(ctx->ast->alloc, ctx->while_tag_stack, len - 2);
    if (end_tag)  *end_tag  = am_list_get(ctx->ast->alloc, ctx->while_tag_stack, len - 1);
    return 0;
}


static int32_t while_tag_stack_pop(am_compiler_ctx_t *ctx) {
    if (!ctx || !ctx->while_tag_stack || ctx->while_tag_stack->length < 2) return -1;
    ctx->while_tag_stack->length -= 2;
    return 0;
}


// ===============================================================================
// 工具函数：指令添加、标签构造/定位/解析、临时变量
// ===============================================================================

// 功能说明：向am_compiler_ctx_t的ilcode中，增加一个am_instruction_t，并更新icount。
// 实现说明：成功返回0；失败返回-1
static int32_t emit_instruction(am_compiler_ctx_t *ctx, uint32_t opcode, am_value_t operand) {
    if (!ctx) return -1;

    if (ctx->icount >= ctx->ilcode_capacity) {
        am_iaddr_t new_cap = ctx->ilcode_capacity ? ctx->ilcode_capacity * 2 : 64;
        am_instruction_t *new_ilcode = (am_instruction_t *)am_realloc(
            ctx->ast->alloc, ctx->ilcode, new_cap * sizeof(am_instruction_t));
        if (!new_ilcode) return -1;
        ctx->ilcode = new_ilcode;
        ctx->ilcode_capacity = new_cap;
    }

    ctx->ilcode[ctx->icount].opcode = opcode;
    ctx->ilcode[ctx->icount].operand = operand;
    ctx->icount++;
    return 0;
}


// 功能说明：标签构造——根据给定的索引TPV（index_value），构造标签（am_value_t）。
// 实现说明：基于任意TPV（一般是handle、varid，称为“索引”TPV）构造一个新的标签TPV（AM_VALUE_TYPE_LABEL）。如果相同索引TPV的标签已存在，则获取已构造的标签TPV，以便后面加入指令的operand。由于编译过程中存在先使用后出现的情况，因此对于同一索引的标签，第一次调用本函数，是从无到有地创建标签，后续调用则是返回已创建的同一标签。只要用于构造标签的索引TPV相等，则构造出来的标签就是同一个标签，这种判定原则与symbol类似。成功返回标签TPV，失败返回AM_VALUE_NULL。
static am_value_t am_compiler_make_label(am_compiler_ctx_t *ctx, am_value_t index_value) {
    if (!ctx || !ctx->value_label_mapping) return AM_VALUE_NULL;

    am_value_t existing = am_map_get(ctx->ast->alloc, ctx->value_label_mapping, index_value);
    if (am_value_is_label(existing)) {
        return existing;
    }

    am_label_t new_label_id = ctx->label_counter++;
    am_value_t label = am_make_value_of_label(new_label_id);

    am_map_t *new_map = am_map_set(ctx->ast->alloc, ctx->value_label_mapping, index_value, label);
    if (!new_map) return AM_VALUE_NULL;
    ctx->value_label_mapping = new_map;
    return label;
}


// 功能说明：标签定位——为标签指定iaddr。
// 实现说明：标签的功能是指代指令序列中的位置。定位指的是将某个标签TPV与已知的iaddr（过去和当前的iaddr，不可能预知未来的iaddr）进行绑定，将标签->iaddr的映射关系，登记到label_iaddr_mapping中。编译过程中，标签的构造和定位，未必是同时发生的，但必须遵守先构造后定位的原则。成功返回0，失败返回-1。
static int32_t am_compiler_locate_label(am_compiler_ctx_t *ctx, am_value_t index_value, am_iaddr_t iaddr) {
    if (!ctx || !ctx->value_label_mapping || !ctx->label_iaddr_mapping) return -1;

    am_value_t label = am_map_get(ctx->ast->alloc, ctx->value_label_mapping, index_value);
    if (!am_value_is_label(label)) return -1;

    am_map_t *new_map = am_map_set(ctx->ast->alloc, ctx->label_iaddr_mapping,
                                    label, am_make_value_of_iaddr(iaddr));
    if (!new_map) return -1;
    ctx->label_iaddr_mapping = new_map;
    return 0;
}


// 功能说明：标签解析——通过标签TPV，获取对应的iaddr。
// 实现说明：在AST全部编译完成后，编译器收集到全部的label及其与iaddr的映射关系，此时即可通过label_iaddr_mapping，将所有的label解析并成绝对的iaddr。成功返回iaddr，失败返回SIZE_MAX。
static am_iaddr_t am_compiler_parse_label_to_iaddr(am_compiler_ctx_t *ctx, am_value_t label) {
    if (!ctx || !ctx->label_iaddr_mapping || !am_value_is_label(label)) return SIZE_MAX;

    am_value_t iaddr_val = am_map_get(ctx->ast->alloc, ctx->label_iaddr_mapping, label);
    if (!am_value_is_iaddr(iaddr_val)) return SIZE_MAX;
    return am_value_to_iaddr(iaddr_val);
}


// 功能说明：构造一个临时变量，加入AST，返回其varid；或者查询符合给定条件的临时变量的varid。
// 设计说明：编译过程中，某些结构需要引入临时变量，本函数即用于这类过程。
// 实现说明：成功返回varid，失败返回SIZE_MAX
static am_varid_t am_compiler_make_temp_varid(am_compiler_ctx_t *ctx, wchar_t *name, am_value_t label, size_t id) {
    if (!ctx || !ctx->ast || !name) return SIZE_MAX;

    wchar_t buf[256];
    int n = swprintf(buf, 256, L"%ls_%zx_%zx", name, (size_t)label, id);
    if (n <= 0 || (size_t)n >= 256) return SIZE_MAX;

    size_t existing = am_vocab_find(ctx->ast->alloc, ctx->ast->var_vocab, buf);
    if (existing != SIZE_MAX) {
        return (am_varid_t)existing;
    }

    size_t old_len = ctx->ast->var_vocab->length;
    size_t new_varid;
    ctx->ast->var_vocab = am_vocab_insert(ctx->ast->alloc, ctx->ast->var_vocab, buf, &new_varid);
    if (!ctx->ast->var_vocab || new_varid == SIZE_MAX) return SIZE_MAX;

    if (new_varid >= old_len) {
        am_list_t *vt = am_list_push(ctx->ast->alloc, ctx->ast->var_type,
                                      am_make_value_of_uint(AM_VAR_TYPE_ILTEMP));
        if (!vt) return SIZE_MAX;
        ctx->ast->var_type = vt;
    }
    else {
        am_list_set(ctx->ast->alloc, ctx->ast->var_type, new_varid,
                    am_make_value_of_uint(AM_VAR_TYPE_ILTEMP));
    }

    return (am_varid_t)new_varid;
}


// ===============================================================================
// 前向声明
// ===============================================================================

static int32_t compile_value(am_compiler_ctx_t *ctx, am_value_t v);
static int32_t compile_application(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_complex_application(am_compiler_ctx_t *ctx, am_handle_t handle, int32_t is_tail);
static int32_t compile_lambda(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_callcc(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_dynamicwind(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_begin(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_define(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_set(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_cond(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_if(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_while(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_and(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_or(am_compiler_ctx_t *ctx, am_handle_t handle);
static int32_t compile_quasiquote(am_compiler_ctx_t *ctx, am_handle_t handle);


// ===============================================================================
// 值编译
// ===============================================================================

// 编译条件表达式（predicate）：handle application需要求值，其余直接push或load
static int32_t compile_predicate(am_compiler_ctx_t *ctx, am_value_t v) {
    if (!ctx) return -1;

    int32_t vt = compiler_value_type(v);
    if (vt == AM_COMPILER_VALUE_TYPE_HANDLE) {
        int32_t kind = compiler_node_kind(ctx, am_value_to_handle(v));
        if (kind == AM_COMPILER_NODE_KIND_APPLICATION) {
            return compile_application(ctx, am_value_to_handle(v));
        }
        return emit_instruction(ctx, AM_VM_OP_push, v);
    }

    if (vt == AM_COMPILER_VALUE_TYPE_VARID) {
        if (compiler_is_native_ref(ctx, v) == 0) {
            return emit_instruction(ctx, AM_VM_OP_push, v);
        }
        return emit_instruction(ctx, AM_VM_OP_load, v);
    }

    if (vt == AM_COMPILER_VALUE_TYPE_SYMBOL) {
        int is_break;
        if (compiler_is_break_continue(v, &is_break) == 0) return -1; // predicate中不允许break/continue
        return emit_instruction(ctx, AM_VM_OP_push, v);
    }

    if (vt == AM_COMPILER_VALUE_TYPE_NUMBER ||
        vt == AM_COMPILER_VALUE_TYPE_BOOLEAN ||
        vt == AM_COMPILER_VALUE_TYPE_NULL ||
        vt == AM_COMPILER_VALUE_TYPE_UNDEFINED ||
        vt == AM_COMPILER_VALUE_TYPE_WCHAR) {
        return emit_instruction(ctx, AM_VM_OP_push, v);
    }

    return -1;
}


// 编译一般的值：根据类型生成push/load/loadclosure等指令
static int32_t compile_value(am_compiler_ctx_t *ctx, am_value_t v) {
    if (!ctx) return -1;

    int32_t vt = compiler_value_type(v);
    if (vt == AM_COMPILER_VALUE_TYPE_HANDLE) {
        am_handle_t h = am_value_to_handle(v);
        int32_t kind = compiler_node_kind(ctx, h);
        switch (kind) {
            case AM_COMPILER_NODE_KIND_LAMBDA:
                return emit_instruction(ctx, AM_VM_OP_loadclosure, am_compiler_make_label(ctx, v));
            case AM_COMPILER_NODE_KIND_QUOTE:
            case AM_COMPILER_NODE_KIND_STRING:
                return emit_instruction(ctx, AM_VM_OP_push, v);
            case AM_COMPILER_NODE_KIND_QUASIQUOTE:
                return compile_quasiquote(ctx, h);
            case AM_COMPILER_NODE_KIND_APPLICATION:
            case AM_COMPILER_NODE_KIND_UNQUOTE:
                return compile_application(ctx, h);
            default:
                return -1;
        }
    }

    if (vt == AM_COMPILER_VALUE_TYPE_SYMBOL) {
        int is_break;
        if (compiler_is_break_continue(v, &is_break) == 0) {
            am_value_t cond_tag, end_tag;
            if (while_tag_stack_top(ctx, &cond_tag, &end_tag) != 0) return -1;
            return emit_instruction(ctx, AM_VM_OP_goto, is_break ? end_tag : cond_tag);
        }
        return emit_instruction(ctx, AM_VM_OP_push, v);
    }

    if (vt == AM_COMPILER_VALUE_TYPE_VARID) {
        if (compiler_is_native_ref(ctx, v) == 0) {
            return emit_instruction(ctx, AM_VM_OP_push, v);
        }
        am_varid_t varid = am_value_to_varid(v);
        if (compiler_builtin_opcode_for_varid(ctx, varid) >= 0) {
            return emit_instruction(ctx, AM_VM_OP_push, v);
        }
        return emit_instruction(ctx, AM_VM_OP_load, v);
    }

    if (vt == AM_COMPILER_VALUE_TYPE_NUMBER ||
        vt == AM_COMPILER_VALUE_TYPE_BOOLEAN ||
        vt == AM_COMPILER_VALUE_TYPE_NULL ||
        vt == AM_COMPILER_VALUE_TYPE_UNDEFINED ||
        vt == AM_COMPILER_VALUE_TYPE_WCHAR) {
        return emit_instruction(ctx, AM_VM_OP_push, v);
    }

    return -1;
}


// ===============================================================================
// Application 编译
// ===============================================================================

static int32_t compile_complex_application(am_compiler_ctx_t *ctx, am_handle_t handle, int32_t is_tail) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length == 0) return 0;

    size_t n = node->length;
    size_t uid = ctx->unique_id_counter;
    ctx->unique_id_counter += 2;

    am_value_t apply_begin_idx  = am_make_value_of_uint(uid);
    am_value_t temp_lambda_idx  = am_make_value_of_uint(uid + 1);

    am_value_t apply_begin_label  = am_compiler_make_label(ctx, apply_begin_idx);
    am_value_t temp_lambda_label  = am_compiler_make_label(ctx, temp_lambda_idx);

    // goto apply_begin
    if (emit_instruction(ctx, AM_VM_OP_goto, apply_begin_label) != 0) return -1;

    // 临时lambda标签
    if (am_compiler_locate_label(ctx, temp_lambda_idx, ctx->icount) != 0) return -1;

    // 按逆序存储形式参数
    for (size_t i = n; i-- > 0;) {
        am_varid_t p = am_compiler_make_temp_varid(ctx, L"TEMP_LAMBDA_PARAM", temp_lambda_label, i);
        if (p == SIZE_MAX) return -1;
        if (emit_instruction(ctx, AM_VM_OP_store, am_make_value_of_varid(p)) != 0) return -1;
    }

    // 加载参数1..n-1
    for (size_t i = 1; i < n; i++) {
        am_varid_t p = am_compiler_make_temp_varid(ctx, L"TEMP_LAMBDA_PARAM", temp_lambda_label, i);
        if (p == SIZE_MAX) return -1;
        if (emit_instruction(ctx, AM_VM_OP_load, am_make_value_of_varid(p)) != 0) return -1;
    }

    // 尾调用参数0（被调用函数）
    am_varid_t p0 = am_compiler_make_temp_varid(ctx, L"TEMP_LAMBDA_PARAM", temp_lambda_label, 0);
    if (p0 == SIZE_MAX) return -1;
    if (emit_instruction(ctx, AM_VM_OP_tailcall, am_make_value_of_varid(p0)) != 0) return -1;

    // return
    if (emit_instruction(ctx, AM_VM_OP_return, AM_VALUE_UNDEFINED) != 0) return -1;

    // apply_begin标签
    if (am_compiler_locate_label(ctx, apply_begin_idx, ctx->icount) != 0) return -1;

    // 编译实参
    for (size_t i = 0; i < n; i++) {
        if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
    }

    // 调用临时lambda
    uint32_t call_opcode = (is_tail == 0) ? AM_VM_OP_tailcall : AM_VM_OP_call;
    return emit_instruction(ctx, call_opcode, temp_lambda_label);
}


static int32_t compile_application(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length == 0) return 0;

    am_value_t first = am_list_get(ctx->ast->alloc, node, 0);

    // 尾调用判断
    int32_t is_tail = compiler_is_tailcall(ctx, handle);

    // 特殊形式
    if (am_value_is_symbol(first)) {
        am_symbol_t sym = am_value_to_symbol(first);
        if (sym == am_value_to_symbol(AM_VALUE_KW_import))  return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_native))  return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_define_syntax))  return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_let_syntax))     return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_letrec_syntax))  return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_syntax_rules))   return 0;
        if (sym == am_value_to_symbol(AM_VALUE_KW_begin))   return compile_begin(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_define))  return compile_define(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_set))     return compile_set(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_cond))    return compile_cond(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_if))      return compile_if(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_while))   return compile_while(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_and))     return compile_and(ctx, handle);
        if (sym == am_value_to_symbol(AM_VALUE_KW_or))      return compile_or(ctx, handle);
    }

    // 首项是待求值的Application，需要进行η变换。
    // 说明：不能先编译参数、再把首项求值结果存入全局/闭包级临时变量，然后 call 该变量。
    // 因为 call/cc 捕获的续体会保存当时的闭包/栈状态，若函数值放在可变的临时变量里，
    // 续体恢复后会读到错误的函数值；而η变换将函数与实参作为临时lambda的参数（局部绑定），
    // 每次调用都生成新的闭包，续体捕获的是正确的参数绑定，从而保证 yinyang 等用例正确。
    if (am_value_is_handle(first) &&
        compiler_node_kind(ctx, am_value_to_handle(first)) == AM_COMPILER_NODE_KIND_APPLICATION) {
        return compile_complex_application(ctx, handle, is_tail);
    }

    // 首项是合法的可调用项，包括变量、Native、Builtin、Lambda
    if (am_value_is_handle(first) || am_value_is_varid(first) || am_value_is_symbol(first)) {
        // call/cc 与 fork 是全局内置变量形式的特殊形式
        if (am_value_is_varid(first)) {
            am_varid_t first_varid = am_value_to_varid(first);
            // 特殊Builtin：call/cc
            if (compiler_varid_name_equals(ctx, first_varid, L"call/cc") == 0) {
                return compile_callcc(ctx, handle);
            }
            // 特殊Builtin：dynamic-wind
            if (compiler_varid_name_equals(ctx, first_varid, L"dynamic-wind") == 0) {
                return compile_dynamicwind(ctx, handle);
            }
        }

        // 处理参数列表
        for (size_t i = 1; i < node->length; i++) {
            if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
        }

        // 一般Builtin：对应特定VM指令
        if (am_value_is_varid(first)) {
            int32_t opcode = compiler_builtin_opcode_for_varid(ctx, am_value_to_varid(first));
            if (opcode >= 0) {
                return emit_instruction(ctx, (uint32_t)opcode, AM_VALUE_UNDEFINED);
            }
        }

        uint32_t call_opcode = (is_tail == 0) ? AM_VM_OP_tailcall : AM_VM_OP_call;

        if (am_value_is_handle(first) &&
            compiler_node_kind(ctx, am_value_to_handle(first)) == AM_COMPILER_NODE_KIND_LAMBDA) {
            return emit_instruction(ctx, call_opcode, am_compiler_make_label(ctx, first));
        }
        else if (am_value_is_varid(first)) {
            return emit_instruction(ctx, call_opcode, first);
        }

        return -1;
    }

    return -1;
}


// ===============================================================================
// Lambda 编译
// ===============================================================================

// TODO 处理pop问题
static int32_t compile_lambda(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);

    // 定位lambda开始标签
    if (am_compiler_locate_label(ctx, am_make_value_of_handle(handle), ctx->icount) != 0) return -1;

    // 按参数列表逆序，插入store指令
    am_uint_t n_param = compiler_lambda_param_count(node);
    for (am_int_t i = (am_int_t)n_param - 1; i >= 0; i--) {
        am_value_t param = am_list_get(ctx->ast->alloc, node, (size_t)(2 + i));
        if (emit_instruction(ctx, AM_VM_OP_store, param) != 0) return -1;
    }

    // 逐个编译函数体
    for (size_t i = 2 + n_param; i < node->length; i++) {
        if (compile_value(ctx, node->children[i]) != 0) return -1;
        // 除最后一个子表达式外，其余表达式的结果都pop掉
        // if (i < node->length - 1) {
        //     if (emit_instruction(ctx, AM_VM_OP_pop, AM_VALUE_UNDEFINED) != 0) return -1;
        // }
    }

    return emit_instruction(ctx, AM_VM_OP_return, AM_VALUE_UNDEFINED);
}


// ===============================================================================
// 特殊形式编译
// ===============================================================================

static int32_t compile_callcc(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length < 2) return -1;

    am_value_t thunk = am_list_get(ctx->ast->alloc, node, 1);

    // 用于标识此call/cc的唯一标签
    am_value_t thunk_label = am_compiler_make_label(ctx, thunk);
    am_varid_t cont_varid = am_compiler_make_temp_varid(ctx, L"CC", thunk_label,
                                                         ctx->unique_id_counter++);
    if (cont_varid == SIZE_MAX) return -1;
    am_value_t cont_idx = am_make_value_of_varid(cont_varid);

    // capturecc cont_varid
    if (emit_instruction(ctx, AM_VM_OP_capturecc, cont_idx) != 0) return -1;
    // load cont_varid
    if (emit_instruction(ctx, AM_VM_OP_load, cont_idx) != 0) return -1;

    // 调用thunk
    if (am_value_is_handle(thunk) && compiler_node_kind(ctx, am_value_to_handle(thunk)) == AM_COMPILER_NODE_KIND_LAMBDA) {
        if (emit_instruction(ctx, AM_VM_OP_call, am_compiler_make_label(ctx, thunk)) != 0) return -1;
    }
    else if (am_value_is_varid(thunk)) {
        if (emit_instruction(ctx, AM_VM_OP_call, thunk) != 0) return -1;
    }
    else {
        return -1;
    }

    // 续体返回点标签
    am_value_t cont_label = am_compiler_make_label(ctx, cont_idx);
    (void)cont_label;
    return am_compiler_locate_label(ctx, cont_idx, ctx->icount);
}


static int32_t compile_dynamicwind(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length != 4) return -1;

    am_value_t before = am_list_get(ctx->ast->alloc, node, 1);
    am_value_t thunk  = am_list_get(ctx->ast->alloc, node, 2);
    am_value_t after  = am_list_get(ctx->ast->alloc, node, 3);

    if (compile_value(ctx, before) != 0) return -1;
    if (compile_value(ctx, thunk) != 0) return -1;
    if (compile_value(ctx, after) != 0) return -1;

    if (emit_instruction(ctx, AM_VM_OP_dynamicwind, AM_VALUE_UNDEFINED) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_dynamicwind_after_before, AM_VALUE_UNDEFINED) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_dynamicwind_before_after, AM_VALUE_UNDEFINED) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_dynamicwind_done, AM_VALUE_UNDEFINED) != 0) return -1;
    return 0;
}


static int32_t compile_define(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length < 3) return -1;

    am_value_t left = am_list_get(ctx->ast->alloc, node, 1);
    am_value_t right = am_list_get(ctx->ast->alloc, node, 2);

    if (!am_value_is_varid(left)) return -1;

    // 编译右值：lambda节点直接push其标签，其他按普通值编译
    if (am_value_is_handle(right) && compiler_node_kind(ctx, am_value_to_handle(right)) == AM_COMPILER_NODE_KIND_LAMBDA) {
        if (emit_instruction(ctx, AM_VM_OP_push, am_compiler_make_label(ctx, right)) != 0) return -1;
    }
    else {
        if (compile_value(ctx, right) != 0) return -1;
    }

    return emit_instruction(ctx, AM_VM_OP_store, left);
}


static int32_t compile_set(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length < 3) return -1;

    am_value_t left = am_list_get(ctx->ast->alloc, node, 1);
    am_value_t right = am_list_get(ctx->ast->alloc, node, 2);

    if (!am_value_is_varid(left)) return -1;

    // 编译右值：lambda节点生成闭包实例，其他按普通值编译
    if (am_value_is_handle(right) && compiler_node_kind(ctx, am_value_to_handle(right)) == AM_COMPILER_NODE_KIND_LAMBDA) {
        if (emit_instruction(ctx, AM_VM_OP_loadclosure, am_compiler_make_label(ctx, right)) != 0) return -1;
    }
    else {
        if (compile_value(ctx, right) != 0) return -1;
    }

    return emit_instruction(ctx, AM_VM_OP_set, left);
}


// 编译begin节点：依次求值并保留最后一个表达式的结果
// TODO 处理pop问题
static int32_t compile_begin(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length <= 1) return 0;

    for (size_t i = 1; i < node->length; i++) {
        if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
        // 除最后一个子表达式外，其余表达式的结果都pop掉
        // if (i < node->length - 1) {
        //     if (emit_instruction(ctx, AM_VM_OP_pop, AM_VALUE_UNDEFINED) != 0) return -1;
        // }
    }
    return 0;
}


static int32_t compile_cond(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    size_t n = node->length;
    if (n < 2) return -1;

    // COND_END 标签：使用临时变量作为索引，确保同一 cond 的结束标签唯一
    am_varid_t end_lbl_varid = am_compiler_make_temp_varid(
        ctx, L"COND_END", am_make_value_of_handle(handle), 0);
    if (end_lbl_varid == SIZE_MAX) return -1;
    am_value_t end_lbl_idx = am_make_value_of_varid(end_lbl_varid);
    am_value_t end_lbl = am_compiler_make_label(ctx, end_lbl_idx);

    for (size_t i = 1; i < n; i++) {
        // 插入分支开始标签（第一个分支的标签实际上不会被引用，但为统一逻辑仍定位）
        am_varid_t branch_lbl_varid = am_compiler_make_temp_varid(
            ctx, L"COND_BRANCH", am_make_value_of_handle(handle), i);
        if (branch_lbl_varid == SIZE_MAX) return -1;
        am_value_t branch_lbl_idx = am_make_value_of_varid(branch_lbl_varid);
        am_value_t branch_lbl = am_compiler_make_label(ctx, branch_lbl_idx);
        (void)branch_lbl;
        if (am_compiler_locate_label(ctx, branch_lbl_idx, ctx->icount) != 0) return -1;

        am_value_t clause_handle = am_list_get(ctx->ast->alloc, node, i);
        if (!am_value_is_handle(clause_handle)) return -1;
        am_value_t clause_val = am_ast_get_node(ctx->ast, am_value_to_handle(clause_handle));
        if (!am_value_is_ptr(clause_val)) return -1;
        am_list_t *clause = (am_list_t *)am_value_to_ptr(clause_val);
        if (clause->length < 2) return -1;

        am_value_t predicate = am_list_get(ctx->ast->alloc, clause, 0);
        am_value_t branch = am_list_get(ctx->ast->alloc, clause, 1);

        int32_t is_else = am_value_is_symbol(predicate) &&
                          am_value_to_symbol(predicate) == am_value_to_symbol(AM_VALUE_KW_else);

        if (!is_else) {
            if (compile_predicate(ctx, predicate) != 0) return -1;
            if (i == n - 1) {
                if (emit_instruction(ctx, AM_VM_OP_iffalse, end_lbl) != 0) return -1;
            }
            else {
                am_varid_t next_branch_lbl_varid = am_compiler_make_temp_varid(
                    ctx, L"COND_BRANCH", am_make_value_of_handle(handle), i + 1);
                if (next_branch_lbl_varid == SIZE_MAX) return -1;
                am_value_t next_branch_lbl_idx = am_make_value_of_varid(next_branch_lbl_varid);
                am_value_t next_branch_lbl = am_compiler_make_label(ctx, next_branch_lbl_idx);
                if (emit_instruction(ctx, AM_VM_OP_iffalse, next_branch_lbl) != 0) return -1;
            }
        }

        if (compile_value(ctx, branch) != 0) return -1;

        if (is_else || i == n - 1) {
            return am_compiler_locate_label(ctx, end_lbl_idx, ctx->icount);
        }
        else {
            if (emit_instruction(ctx, AM_VM_OP_goto, end_lbl) != 0) return -1;
        }
    }

    return 0;
}


static int32_t compile_if(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length < 3) return -1; // 至少需要predicate和true分支

    am_value_t predicate = am_list_get(ctx->ast->alloc, node, 1);
    am_value_t true_branch = am_list_get(ctx->ast->alloc, node, 2);

    size_t uid = ctx->unique_id_counter;
    ctx->unique_id_counter += 2;
    am_value_t true_label_idx = am_make_value_of_uint(uid);
    am_value_t true_label = am_compiler_make_label(ctx, true_label_idx);
    am_value_t end_label_idx = am_make_value_of_uint(uid + 1);
    am_value_t end_label = am_compiler_make_label(ctx, end_label_idx);

    if (compile_predicate(ctx, predicate) != 0) return -1;

    if (node->length > 3) {
        am_value_t false_branch = am_list_get(ctx->ast->alloc, node, 3);
        if (emit_instruction(ctx, AM_VM_OP_iftrue, true_label) != 0) return -1;
        if (compile_value(ctx, false_branch) != 0) return -1;
        if (emit_instruction(ctx, AM_VM_OP_goto, end_label) != 0) return -1;
        if (am_compiler_locate_label(ctx, true_label_idx, ctx->icount) != 0) return -1;
        if (compile_value(ctx, true_branch) != 0) return -1;
    }
    else {
        if (emit_instruction(ctx, AM_VM_OP_iffalse, end_label) != 0) return -1;
        if (compile_value(ctx, true_branch) != 0) return -1;
    }

    return am_compiler_locate_label(ctx, end_label_idx, ctx->icount);
}


static int32_t compile_while(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    if (node->length < 3) return -1;

    size_t uid = ctx->unique_id_counter;
    ctx->unique_id_counter += 2;
    am_value_t cond_label_idx = am_make_value_of_uint(uid);
    am_value_t cond_label = am_compiler_make_label(ctx, cond_label_idx);
    am_value_t end_label_idx = am_make_value_of_uint(uid + 1);
    am_value_t end_label = am_compiler_make_label(ctx, end_label_idx);

    if (while_tag_stack_push(ctx, cond_label, end_label) != 0) return -1;

    if (am_compiler_locate_label(ctx, cond_label_idx, ctx->icount) != 0) return -1;
    if (compile_predicate(ctx, am_list_get(ctx->ast->alloc, node, 1)) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_iffalse, end_label) != 0) return -1;
    for (size_t i = 2; i < node->length; i++) {
        if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
    }
    if (emit_instruction(ctx, AM_VM_OP_goto, cond_label) != 0) return -1;
    if (am_compiler_locate_label(ctx, end_label_idx, ctx->icount) != 0) return -1;

    return while_tag_stack_pop(ctx);
}


static int32_t compile_and(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    size_t n = node->length;

    size_t uid = ctx->unique_id_counter;
    ctx->unique_id_counter += 2;
    am_value_t end_label_idx = am_make_value_of_uint(uid);
    am_value_t end_label = am_compiler_make_label(ctx, end_label_idx);
    am_value_t false_label_idx = am_make_value_of_uint(uid + 1);
    am_value_t false_label = am_compiler_make_label(ctx, false_label_idx);

    for (size_t i = 1; i < n; i++) {
        if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
        if (emit_instruction(ctx, AM_VM_OP_iffalse, false_label) != 0) return -1;
    }

    if (emit_instruction(ctx, AM_VM_OP_push, AM_VALUE_TRUE) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_goto, end_label) != 0) return -1;
    if (am_compiler_locate_label(ctx, false_label_idx, ctx->icount) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_push, AM_VALUE_FALSE) != 0) return -1;
    return am_compiler_locate_label(ctx, end_label_idx, ctx->icount);
}


static int32_t compile_or(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);
    size_t n = node->length;

    size_t uid = ctx->unique_id_counter;
    ctx->unique_id_counter += 2;
    am_value_t end_label_idx = am_make_value_of_uint(uid);
    am_value_t end_label = am_compiler_make_label(ctx, end_label_idx);
    am_value_t true_label_idx = am_make_value_of_uint(uid + 1);
    am_value_t true_label = am_compiler_make_label(ctx, true_label_idx);

    for (size_t i = 1; i < n; i++) {
        if (compile_value(ctx, am_list_get(ctx->ast->alloc, node, i)) != 0) return -1;
        if (emit_instruction(ctx, AM_VM_OP_iftrue, true_label) != 0) return -1;
    }

    if (emit_instruction(ctx, AM_VM_OP_push, AM_VALUE_FALSE) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_goto, end_label) != 0) return -1;
    if (am_compiler_locate_label(ctx, true_label_idx, ctx->icount) != 0) return -1;
    if (emit_instruction(ctx, AM_VM_OP_push, AM_VALUE_TRUE) != 0) return -1;
    return am_compiler_locate_label(ctx, end_label_idx, ctx->icount);
}


static int32_t compile_quasiquote(am_compiler_ctx_t *ctx, am_handle_t handle) {
    am_value_t node_val = am_ast_get_node(ctx->ast, handle);
    if (!am_value_is_ptr(node_val)) return -1;
    am_list_t *node = (am_list_t *)am_value_to_ptr(node_val);

    for (size_t i = 0; i < node->length; i++) {
        am_value_t child = am_list_get(ctx->ast->alloc, node, i);
        int32_t vt = compiler_value_type(child);

        if (vt == AM_COMPILER_VALUE_TYPE_HANDLE) {
            int32_t kind = compiler_node_kind(ctx, am_value_to_handle(child));
            if (kind == AM_COMPILER_NODE_KIND_APPLICATION ||
                kind == AM_COMPILER_NODE_KIND_UNQUOTE) {
                if (compile_application(ctx, am_value_to_handle(child)) != 0) return -1;
            }
            else if (kind == AM_COMPILER_NODE_KIND_QUASIQUOTE) {
                if (compile_quasiquote(ctx, am_value_to_handle(child)) != 0) return -1;
            }
            else {
                if (emit_instruction(ctx, AM_VM_OP_push, child) != 0) return -1;
            }
        }
        else if (vt == AM_COMPILER_VALUE_TYPE_SYMBOL) {
            int is_break;
            if (compiler_is_break_continue(child, &is_break) == 0) return -1;
            if (emit_instruction(ctx, AM_VM_OP_push, child) != 0) return -1;
        }
        else if (vt == AM_COMPILER_VALUE_TYPE_VARID) {
            if (compiler_is_native_ref(ctx, child) == 0) {
                if (emit_instruction(ctx, AM_VM_OP_push, child) != 0) return -1;
            }
            else {
                if (emit_instruction(ctx, AM_VM_OP_load, child) != 0) return -1;
            }
        }
        else if (vt == AM_COMPILER_VALUE_TYPE_NUMBER ||
                 vt == AM_COMPILER_VALUE_TYPE_BOOLEAN ||
                 vt == AM_COMPILER_VALUE_TYPE_NULL ||
                 vt == AM_COMPILER_VALUE_TYPE_UNDEFINED ||
                 vt == AM_COMPILER_VALUE_TYPE_WCHAR) {
            if (emit_instruction(ctx, AM_VM_OP_push, child) != 0) return -1;
        }
        else {
            return -1;
        }
    }

    if (emit_instruction(ctx, AM_VM_OP_push, am_make_value_of_uint((am_uint_t)node->length)) != 0) return -1;
    return emit_instruction(ctx, AM_VM_OP_concat, AM_VALUE_UNDEFINED);
}


// ===============================================================================
// opstack 最大深度的静态分析
// ===============================================================================

// 分析上下文：记录一个函数入口点（iaddr）及其初始栈深度
typedef struct compiler_depth_entry_t {
    am_iaddr_t iaddr;
    size_t init_depth;
} compiler_depth_entry_t;


// 单条指令对操作数栈的净影响（保守估计）。
// 返回值：正数表示压栈，负数表示出栈，0 表示不变。
static int32_t compiler_stack_effect(am_compiler_ctx_t *ctx, am_iaddr_t iaddr) {
    if (!ctx || iaddr >= ctx->icount) return 0;

    uint32_t op = ctx->ilcode[iaddr].opcode;
    switch (op) {
        case AM_VM_OP_nop:         return 0;
        case AM_VM_OP_store:       return -1;
        case AM_VM_OP_load:        return 1;
        case AM_VM_OP_loadclosure: return 1;
        case AM_VM_OP_push:        return 1;
        case AM_VM_OP_pop:         return -1;
        case AM_VM_OP_swap:        return 0;
        case AM_VM_OP_set:         return -1;
        case AM_VM_OP_call:        return 0;
        case AM_VM_OP_callnative:  return 0;
        case AM_VM_OP_tailcall:    return 0;
        case AM_VM_OP_return:      return 0;
        case AM_VM_OP_capturecc:   return 0;
        case AM_VM_OP_iftrue:      return -1;
        case AM_VM_OP_iffalse:     return -1;
        case AM_VM_OP_goto:        return 0;
        case AM_VM_OP_read:        return 1;
        case AM_VM_OP_write:       return -2;
        case AM_VM_OP_pause:       return 0;
        case AM_VM_OP_halt:        return 0;
        case AM_VM_OP_fork:        return 0;
        case AM_VM_OP_display:     return 0;
        case AM_VM_OP_newline:     return 0;
        case AM_VM_OP_add:
        case AM_VM_OP_sub:
        case AM_VM_OP_mul:
        case AM_VM_OP_div:
        case AM_VM_OP_mod:
        case AM_VM_OP_pow:
        case AM_VM_OP_eq:
        case AM_VM_OP_eqv:
        case AM_VM_OP_equal:
        case AM_VM_OP_ge:
        case AM_VM_OP_le:
        case AM_VM_OP_gt:
        case AM_VM_OP_lt:
        case AM_VM_OP_and:
        case AM_VM_OP_or:
        case AM_VM_OP_cons:
        case AM_VM_OP_get_item:
        case AM_VM_OP_list_push:
            return -1;
        case AM_VM_OP_not:
        case AM_VM_OP_isnull:
        case AM_VM_OP_isundef:
        case AM_VM_OP_isatom:
        case AM_VM_OP_islist:
        case AM_VM_OP_isnumber:
        case AM_VM_OP_isnan:
        case AM_VM_OP_typeof:
        case AM_VM_OP_car:
        case AM_VM_OP_cdr:
        case AM_VM_OP_list_pop:
        case AM_VM_OP_length:
        case AM_VM_OP_duplicate:
            return 0;
        case AM_VM_OP_set_item:
            return -2;
        case AM_VM_OP_concat:
            return -1;
        case AM_VM_OP_dynamicwind:
            return -2;
        case AM_VM_OP_dynamicwind_after_before:
            return 1;
        case AM_VM_OP_dynamicwind_before_after:
            return 0;
        case AM_VM_OP_dynamicwind_done:
            return -1;
        case AM_VM_OP_wind:
            return 0;
        default:
            return 0;
    }
}


static int32_t compiler_depth_add_entry(am_allocator_t *alloc, compiler_depth_entry_t **entries,
                                         size_t *count, size_t *capacity,
                                         am_iaddr_t iaddr, size_t init_depth) {
    if (iaddr == SIZE_MAX) return 0;

    // 去重
    for (size_t i = 0; i < *count; i++) {
        if ((*entries)[i].iaddr == iaddr) return 0;
    }

    if (*count >= *capacity) {
        size_t new_cap = *capacity ? *capacity * 2 : 16;
        compiler_depth_entry_t *new_entries = (compiler_depth_entry_t *)am_realloc(
            alloc, *entries, new_cap * sizeof(compiler_depth_entry_t));
        if (!new_entries) return -1;
        *entries = new_entries;
        *capacity = new_cap;
    }

    (*entries)[*count].iaddr = iaddr;
    (*entries)[*count].init_depth = init_depth;
    (*count)++;
    return 0;
}


typedef struct {
    am_iaddr_t iaddr;
    size_t depth;
} compiler_depth_frame_t;


// 使用显式栈的迭代 DFS，避免循环体净压栈导致 C 调用栈溢出。
static void compiler_depth_search(am_compiler_ctx_t *ctx, am_iaddr_t entry, size_t init_depth,
                                   size_t *best_depth, size_t *global_max) {
    if (!ctx || entry >= ctx->icount) return;

    compiler_depth_frame_t *stack = (compiler_depth_frame_t *)am_malloc(
        ctx->ast->alloc, ctx->icount * 4 * sizeof(compiler_depth_frame_t));
    if (!stack) return;

    size_t stack_capacity = ctx->icount * 4;
    size_t stack_top = 0;
    stack[stack_top].iaddr = entry;
    stack[stack_top].depth = init_depth;
    stack_top++;

    while (stack_top > 0) {
        compiler_depth_frame_t frame = stack[--stack_top];
        am_iaddr_t iaddr = frame.iaddr;
        size_t depth = frame.depth;

        if (iaddr >= ctx->icount) continue;
        if (best_depth[iaddr] != SIZE_MAX && depth <= best_depth[iaddr]) continue;
        // 防止循环体净压栈导致无限展开：深度超过指令数时停止跟随该路径
        if (depth > ctx->icount + 16) continue;

        best_depth[iaddr] = depth;
        if (depth > *global_max) *global_max = depth;

        uint32_t op = ctx->ilcode[iaddr].opcode;
        int32_t effect = compiler_stack_effect(ctx, iaddr);
        size_t next_depth;
        if (effect >= 0) {
            next_depth = depth + (size_t)effect;
        }
        else {
            size_t abs_effect = (size_t)(-effect);
            next_depth = (depth >= abs_effect) ? depth - abs_effect : 0;
        }

        // 辅助宏：将后继状态压栈
        #define DEPTH_PUSH(addr, d) do { \
            if (stack_top < stack_capacity) { \
                stack[stack_top].iaddr = (addr); \
                stack[stack_top].depth = (d); \
                stack_top++; \
            } \
        } while (0)

        switch (op) {
            case AM_VM_OP_goto: {
                am_iaddr_t target = am_compiler_parse_label_to_iaddr(ctx, ctx->ilcode[iaddr].operand);
                if (target != SIZE_MAX) DEPTH_PUSH(target, next_depth);
                break;
            }
            case AM_VM_OP_iftrue:
            case AM_VM_OP_iffalse: {
                am_iaddr_t target = am_compiler_parse_label_to_iaddr(ctx, ctx->ilcode[iaddr].operand);
                if (target != SIZE_MAX) DEPTH_PUSH(target, next_depth);
                DEPTH_PUSH(iaddr + 1, next_depth);
                break;
            }
            case AM_VM_OP_call: {
                // 不进入被调用函数；假设被调用函数净栈效果为 0，继续在调用点之后执行
                DEPTH_PUSH(iaddr + 1, next_depth);
                break;
            }
            case AM_VM_OP_tailcall: {
                // 尾调用不返回，停止当前路径
                break;
            }
            case AM_VM_OP_return:
            case AM_VM_OP_halt: {
                break;
            }
            default: {
                DEPTH_PUSH(iaddr + 1, next_depth);
                break;
            }
        }

        #undef DEPTH_PUSH
    }

    am_free(ctx->ast->alloc, stack);
}


size_t am_compiler_opstack_depth_analysis(am_compiler_ctx_t *ctx) {
    if (!ctx || !ctx->ilcode || ctx->icount == 0) return SIZE_MAX;

    size_t global_max = 0;
    compiler_depth_entry_t *entries = NULL;
    size_t entry_count = 0;
    size_t entry_capacity = 0;

    // 程序入口
    if (compiler_depth_add_entry(ctx->ast->alloc, &entries, &entry_count, &entry_capacity, 0, 0) != 0) {
        am_free(ctx->ast->alloc, entries);
        return SIZE_MAX;
    }

    // 真实 lambda 入口
    if (ctx->ast && ctx->ast->lambda_handles) {
        for (size_t i = 0; i < ctx->ast->lambda_handles->length; i++) {
            am_value_t h = am_list_get(ctx->ast->alloc, ctx->ast->lambda_handles, i);
            if (!am_value_is_handle(h)) continue;

            am_value_t label = am_compiler_make_label(ctx, h);
            if (!am_value_is_label(label)) continue;

            am_iaddr_t iaddr = am_compiler_parse_label_to_iaddr(ctx, label);
            if (iaddr == SIZE_MAX) continue;

            am_value_t node_val = am_ast_get_node(ctx->ast, am_value_to_handle(h));
            am_uint_t n_param = 0;
            if (am_value_is_ptr(node_val)) {
                am_list_t *lambda = (am_list_t *)am_value_to_ptr(node_val);
                n_param = compiler_lambda_param_count(lambda);
            }

            if (compiler_depth_add_entry(ctx->ast->alloc, &entries, &entry_count, &entry_capacity,
                                          iaddr, (size_t)n_param) != 0) {
                am_free(ctx->ast->alloc, entries);
                return SIZE_MAX;
            }
        }
    }

    // 临时 lambda 入口（η 变换等编译器生成的临时 lambda）
    for (am_iaddr_t i = 0; i < ctx->icount; i++) {
        uint32_t op = ctx->ilcode[i].opcode;
        if (op != AM_VM_OP_call && op != AM_VM_OP_tailcall) continue;

        am_value_t operand = ctx->ilcode[i].operand;
        if (!am_value_is_label(operand)) continue;

        am_iaddr_t target = am_compiler_parse_label_to_iaddr(ctx, operand);
        if (target == SIZE_MAX || target >= ctx->icount) continue;
        if (ctx->ilcode[target].opcode != AM_VM_OP_store) continue;

        size_t n_param = 0;
        for (am_iaddr_t j = target; j < ctx->icount && ctx->ilcode[j].opcode == AM_VM_OP_store; j++) {
            n_param++;
        }

        if (compiler_depth_add_entry(ctx->ast->alloc, &entries, &entry_count, &entry_capacity,
                                      target, n_param) != 0) {
            am_free(ctx->ast->alloc, entries);
            return SIZE_MAX;
        }
    }

    size_t *best_depth = (size_t *)am_malloc(ctx->ast->alloc, ctx->icount * sizeof(size_t));
    if (!best_depth) {
        am_free(ctx->ast->alloc, entries);
        return SIZE_MAX;
    }

    for (size_t i = 0; i < entry_count; i++) {
        for (am_iaddr_t j = 0; j < ctx->icount; j++) {
            best_depth[j] = SIZE_MAX;
        }
        compiler_depth_search(ctx, entries[i].iaddr, entries[i].init_depth, best_depth, &global_max);
    }

    am_free(ctx->ast->alloc, best_depth);
    am_free(ctx->ast->alloc, entries);

    return global_max > 0 ? global_max : 1;
}


// ===============================================================================
// 编译器入口与标签解析
// ===============================================================================

int32_t am_compile_all(am_compiler_ctx_t *ctx) {
    if (!ctx || !ctx->ast) return -1;

    // 程序入口：调用顶级lambda
    am_handle_t top_lambda = ctx->ast->top_lambda_handle;
    if (top_lambda == AM_HANDLE_NULL) {
        top_lambda = am_ast_get_top_lambda_node_handle(ctx->ast);
    }
    if (top_lambda == AM_HANDLE_NULL) return -1;

    if (emit_instruction(ctx, AM_VM_OP_call,
                        am_compiler_make_label(ctx, am_make_value_of_handle(top_lambda))) != 0) {
        return -1;
    }
    // ret 为 0 时程序结束使用 halt；否则跳转到返回目标
    if (ctx->ret > 0) {
        if (emit_instruction(ctx, AM_VM_OP_goto, am_make_value_of_iaddr(ctx->ret)) != 0) return -1;
    }
    else {
        if (emit_instruction(ctx, AM_VM_OP_halt, AM_VALUE_UNDEFINED) != 0) return -1;
    }

    // 顺序编译所有lambda节点
    if (!ctx->ast->lambda_handles) return -1;

    // 预创建所有 lambda 标签，避免 lambda_handles 顺序导致内层 lambda 标签未创建
    for (size_t i = 0; i < ctx->ast->lambda_handles->length; i++) {
        am_value_t h = am_list_get(ctx->ast->alloc, ctx->ast->lambda_handles, i);
        if (!am_value_is_handle(h)) continue;
        if (am_value_is_null(am_compiler_make_label(ctx, h))) return -1;
    }

    for (size_t i = 0; i < ctx->ast->lambda_handles->length; i++) {
        am_value_t h = am_list_get(ctx->ast->alloc, ctx->ast->lambda_handles, i);
        if (!am_value_is_handle(h)) continue;
        if (compile_lambda(ctx, am_value_to_handle(h)) != 0) return -1;
    }

    return 0;
}


int32_t am_compiler_label_resolution(am_compiler_ctx_t *ctx, am_iaddr_t offset) {
    if (!ctx || !ctx->ilcode) return -1;

    for (am_iaddr_t i = 0; i < ctx->icount; i++) {
        if (am_value_is_label(ctx->ilcode[i].operand)) {
            am_iaddr_t addr = am_compiler_parse_label_to_iaddr(ctx, ctx->ilcode[i].operand);
            if (addr == SIZE_MAX) return -1;
            ctx->ilcode[i].operand = am_make_value_of_iaddr(addr + offset);
        }
    }
    return 0;
}


am_module_t *am_compile(am_ast_t *ast, am_iaddr_t offset, am_iaddr_t ret) {
    if (!ast || !ast->alloc) return NULL;

    am_compiler_ctx_t *ctx = am_compiler_ctx_create(ast);
    if (!ctx) return NULL;

    ctx->offset = offset;
    ctx->ret = ret;

    if (am_compile_all(ctx) != 0) {
        am_compiler_ctx_destroy(ctx);
        return NULL;
    }

    size_t opstack_depth = am_compiler_opstack_depth_analysis(ctx);
    if (opstack_depth == SIZE_MAX) {
        am_compiler_ctx_destroy(ctx);
        return NULL;
    }

    if (am_compiler_label_resolution(ctx, offset) != 0) {
        am_compiler_ctx_destroy(ctx);
        return NULL;
    }

    am_module_t *mod = (am_module_t *)am_calloc(ast->alloc, sizeof(am_module_t));
    if (!mod) {
        am_compiler_ctx_destroy(ctx);
        return NULL;
    }

    mod->base.type = AM_OBJECT_TYPE_MODULE;
    mod->opstack_depth = opstack_depth;
    mod->ast = ast;
    mod->ilcode = ctx->ilcode;
    mod->ilcode_length = ctx->icount;

    // ilcode所有权转移给module，避免ctx销毁时释放ilcode
    ctx->ilcode = NULL;
    ctx->ilcode_capacity = 0;

    am_compiler_ctx_destroy(ctx);
    return mod;
}


// ===============================================================================
// 上下文创建与销毁
// ===============================================================================

am_compiler_ctx_t *am_compiler_ctx_create(am_ast_t *ast) {
    if (!ast || !ast->alloc) return NULL;

    am_compiler_ctx_t *ctx = (am_compiler_ctx_t *)am_calloc(ast->alloc, sizeof(am_compiler_ctx_t));
    if (!ctx) return NULL;

    ctx->ast = ast;
    ctx->icount = 0;
    ctx->ilcode_capacity = 0;
    ctx->ilcode = NULL;
    ctx->label_counter = 0;
    ctx->unique_id_counter = 0;

    ctx->value_label_mapping = am_map_create(ast->alloc, 64);
    ctx->label_iaddr_mapping = am_map_create(ast->alloc, 64);
    ctx->while_tag_stack = am_list_create(ast->alloc, 16, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    ctx->offset = 0;
    ctx->ret = 0;

    if (!ctx->value_label_mapping || !ctx->label_iaddr_mapping || !ctx->while_tag_stack) {
        am_compiler_ctx_destroy(ctx);
        return NULL;
    }

    return ctx;
}


void am_compiler_ctx_destroy(am_compiler_ctx_t *ctx) {
    if (!ctx) return;

    am_allocator_t *alloc = ctx->ast ? ctx->ast->alloc : NULL;
    if (!alloc) return;

    if (ctx->ilcode) am_free(alloc, ctx->ilcode);
    if (ctx->value_label_mapping) am_map_destroy(alloc, ctx->value_label_mapping);
    if (ctx->label_iaddr_mapping) am_map_destroy(alloc, ctx->label_iaddr_mapping);
    if (ctx->while_tag_stack) am_list_destroy(alloc, ctx->while_tag_stack);
    am_free(alloc, ctx);
}
