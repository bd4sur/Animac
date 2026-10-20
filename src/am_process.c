#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>

#include "am_process.h"
#include "am_wstring.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 将proc->heap中所有对象标记为静态对象（通常用于从模块加载的初始AST数据）
static void set_all_heap_objects_static(am_handle_t handle, am_value_t value, void *user_data) {
    (void)handle;
    (void)user_data;
    if (am_value_is_ptr(value)) {
        am_object_t *obj = am_value_to_ptr(value);
        if (obj != NULL) {
            am_object_set_static(obj, 0);
        }
    }
}




// ===============================================================================
// dynamic-wind 内部辅助函数
// ===============================================================================

// 从 dynamic-wind 条目中读取 before/after/mark/saved
static inline am_handle_t dynamic_wind_entry_before(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_HANDLE_NULL;
    return am_value_to_handle(entry->children[0]);
}

static inline am_handle_t dynamic_wind_entry_after(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_HANDLE_NULL;
    return am_value_to_handle(entry->children[1]);
}

static inline am_uint_t dynamic_wind_entry_mark(am_list_t *entry) {
    if (!entry || entry->length < 4) return 0;
    return am_value_to_uint(entry->children[2]);
}

static inline am_value_t dynamic_wind_entry_saved(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_VALUE_UNDEFINED;
    return entry->children[3];
}

static inline void dynamic_wind_entry_set_saved(am_list_t *entry, am_value_t v) {
    if (!entry || entry->length < 4) return;
    entry->children[3] = v;
}

// 根据 handle 获取条目对象指针
static am_list_t *dynamic_wind_get_entry(am_process_t *proc, am_handle_t entry_hd) {
    if (!proc || !proc->heap || entry_hd == AM_HANDLE_NULL) return NULL;
    am_value_t v = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, entry_hd);
    if (!am_value_is_ptr(v)) return NULL;
    am_object_t *obj = am_value_to_ptr(v);
    if (!obj || obj->type != AM_OBJECT_TYPE_LIST) return NULL;
    return (am_list_t *)obj;
}

// 计算两个 dynamic-wind 栈（list of entry handles）的最长公共前缀长度（按 mark 比较）
static size_t dynamic_wind_common_prefix(am_process_t *proc, am_list_t *target) {
    if (!proc) return 0;
    am_list_t *current = proc->dynamic_wind_stack;
    size_t cur_len = current ? current->length : 0;
    size_t tgt_len = target ? target->length : 0;
    size_t min_len = cur_len < tgt_len ? cur_len : tgt_len;
    size_t prefix = 0;
    for (size_t i = 0; i < min_len; i++) {
        am_handle_t cur_hd = am_value_to_handle(current->children[i]);
        am_handle_t tgt_hd = am_value_to_handle(target->children[i]);
        am_list_t *cur_entry = dynamic_wind_get_entry(proc, cur_hd);
        am_list_t *tgt_entry = dynamic_wind_get_entry(proc, tgt_hd);
        if (!cur_entry || !tgt_entry) break;
        if (dynamic_wind_entry_mark(cur_entry) != dynamic_wind_entry_mark(tgt_entry)) break;
        prefix++;
    }
    return prefix;
}


// ===============================================================================
// 字符串驻留
// ===============================================================================

// 功能说明：根据 wchar_t 缓冲区和长度创建/复用字符串堆对象，并返回其 handle。
// 实现说明：当 len <= AM_PROCESS_STRINDEX_MAX_LEN 时，会先查询 proc->strindex；
//         若已存在内容相同的字符串则复用其 handle，否则新建并登记。
//         超过阈值的字符串直接新建，不参与驻留。
//         失败返回 AM_HANDLE_NULL。
am_handle_t am_process_make_wstring_handle(am_process_t *proc, const wchar_t *str, size_t len) {
    // 注意：str 为 NULL 且 len 为 0 是合法的空字符串；仅拒绝无缓冲区的非空串
    if (!proc || !proc->heap || !proc->heap_alloc || (!str && len > 0)) return AM_HANDLE_NULL;

    // 构造以 L'\0' 结尾的临时缓冲区，供 hash 计算和 strindex 查询使用
    wchar_t *tmp = (wchar_t *)am_malloc(proc->vm_alloc, (len + 1) * sizeof(wchar_t));
    if (!tmp) return AM_HANDLE_NULL;
    if (len > 0) {
        memcpy(tmp, str, len * sizeof(wchar_t));
    }
    tmp[len] = L'\0';

    uint32_t hash = am_strindex_hash_string(tmp);
    am_handle_t result = AM_HANDLE_NULL;

    if (proc->strindex && len <= AM_PROCESS_STRINDEX_MAX_LEN) {
        size_t n_candidates = am_strindex_get_all(proc->vm_alloc, proc->strindex, tmp, NULL, 0);
        if (n_candidates != SIZE_MAX && n_candidates > 0) {
            am_value_t *candidates = (am_value_t *)am_malloc(proc->vm_alloc,
                                                              n_candidates * sizeof(am_value_t));
            if (candidates) {
                size_t got = am_strindex_get_all(proc->vm_alloc, proc->strindex, tmp,
                                                 candidates, n_candidates);
                for (size_t i = 0; i < got; i++) {
                    am_handle_t cand_h = am_value_to_handle(candidates[i]);
                    am_value_t cand_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, cand_h);
                    if (!am_value_is_ptr(cand_val)) continue;
                    am_object_t *obj = am_value_to_ptr(cand_val);
                    if (obj->type != AM_OBJECT_TYPE_WSTRING) continue;
                    am_wstring_t *ws = (am_wstring_t *)obj;
                    if (ws->length != len) continue;

                    bool match = true;
                    for (size_t j = 0; j < len; j++) {
                        am_wchar_t wc = am_value_to_wchar(ws->content[j]);
                        if (wc != (am_wchar_t)tmp[j]) {
                            match = false;
                            break;
                        }
                    }
                    if (match) {
                        result = cand_h;
                        break;
                    }
                }
                am_free(proc->vm_alloc, candidates);
            }
        }
    }

    if (result == AM_HANDLE_NULL) {
        am_wstring_t *ws = am_wstring_create(proc->heap_alloc, tmp, len);
        if (!ws) {
            am_free(proc->vm_alloc, tmp);
            return AM_HANDLE_NULL;
        }
        ws->base.hash = hash;

        am_handle_t hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
        if (hd == AM_HANDLE_NULL) {
            am_wstring_destroy(proc->heap_alloc, ws);
            am_free(proc->vm_alloc, tmp);
            return AM_HANDLE_NULL;
        }

        if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, hd,
                        am_make_value_of_ptr((am_object_t *)ws)) != 0) {
            am_wstring_destroy(proc->heap_alloc, ws);
            am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
            am_free(proc->vm_alloc, tmp);
            return AM_HANDLE_NULL;
        }

        result = hd;

        // 短字符串登记到 strindex
        if (proc->strindex && len <= AM_PROCESS_STRINDEX_MAX_LEN) {
            am_strindex_t *new_si = am_strindex_set(proc->vm_alloc, proc->strindex, tmp,
                                                     am_make_value_of_handle(hd));
            if (new_si) {
                proc->strindex = new_si;
            }
        }
    }

    am_free(proc->vm_alloc, tmp);
    return result;
}


// ===============================================================================
// 生命周期
// ===============================================================================

// 功能说明：从模块构造并初始化一个新的进程数据结构
// 实现说明：成功返回新进程对象指针；失败返回NULL
am_process_t *am_process_load_from_module(am_allocator_t *vm_alloc, am_allocator_t *heap_alloc, am_module_t *mod) {
    if (!vm_alloc || !heap_alloc || !mod || !mod->ast || !mod->ilcode) {
        return NULL;
    }

    am_process_t *proc = (am_process_t *)am_calloc(vm_alloc, sizeof(am_process_t));
    if (!proc) return NULL;

    proc->base.type = AM_OBJECT_TYPE_BASE;
    proc->vm_alloc = vm_alloc;
    proc->heap_alloc = heap_alloc;
    proc->pid = 0;
    proc->parent_pid = 0;
    proc->state = AM_PROCESS_STATE_READY;
    proc->PC = 0;
    proc->current_closure_handle = AM_HANDLE_NULL;
    proc->host_context = NULL;

    // 【P1】复制闭包帧描述符表（与 ilcode 同源，随进程存活）
    proc->frames = am_frame_table_copy(vm_alloc, mod->frames);

    // 复制中间语言代码到进程
    proc->ilcode_length = mod->ilcode_length;
    proc->ilcode = (am_instruction_t *)am_malloc(vm_alloc, (mod->ilcode_length + 1) * sizeof(am_instruction_t));
    if (!proc->ilcode) {
        am_free(vm_alloc, proc);
        return NULL;
    }
    memcpy(proc->ilcode, mod->ilcode, mod->ilcode_length * sizeof(am_instruction_t));

    // 在 ilcode 末尾追加 wind 跳板指令
    proc->wind_trampoline_iaddr = proc->ilcode_length;
    proc->ilcode[proc->ilcode_length].opcode = AM_VM_OP_wind;
    proc->ilcode[proc->ilcode_length].operand = AM_VALUE_UNDEFINED;
    proc->ilcode_length += 1;

    // 将mod->ast->nodes深拷贝到proc->heap
    // 先通过deep_dump计算大小并序列化，再用deep_load到进程堆
    size_t dump_size = am_heap_deep_dump(mod->ast->alloc, mod->ast->alloc, mod->ast->nodes, NULL, 0);
    if (dump_size == SIZE_MAX) {
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }

    uint8_t *buffer = (uint8_t *)am_malloc(vm_alloc, dump_size);
    if (!buffer) {
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }
    memset(buffer, 0, dump_size);

    size_t written = am_heap_deep_dump(mod->ast->alloc, mod->ast->alloc, mod->ast->nodes, buffer, 0);
    if (written != dump_size) {
        am_free(vm_alloc, buffer);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }

    proc->heap = am_heap_deep_load(vm_alloc, heap_alloc, buffer, 0);
    am_free(vm_alloc, buffer);
    if (!proc->heap) {
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }

    // 将拷贝进来的AST节点全部标记为静态对象，避免被GC回收
    am_heap_iter(vm_alloc, heap_alloc, proc->heap, set_all_heap_objects_static, NULL);

    // 拷贝 strindex（用于运行时字符串驻留）
    proc->strindex = am_strindex_copy(proc->vm_alloc, mod->ast->strindex);

    // 拷贝符号表
    proc->var_vocab = am_vocab_copy(proc->vm_alloc, mod->ast->var_vocab);
    proc->symbol_vocab = am_vocab_copy(proc->vm_alloc, mod->ast->symbol_vocab);
    proc->var_type = am_list_copy(proc->vm_alloc, mod->ast->var_type);
    proc->natives = am_map_copy(proc->vm_alloc, mod->ast->natives);
    proc->var_top = am_list_copy(proc->vm_alloc, mod->ast->var_top);
    proc->var_arn_mapping = am_map_copy(proc->vm_alloc, mod->ast->var_arn_mapping);
    if (!proc->strindex || !proc->var_vocab || !proc->symbol_vocab || !proc->var_type || !proc->natives || !proc->var_top || !proc->var_arn_mapping) {
        if (proc->strindex) am_strindex_destroy(proc->vm_alloc, proc->strindex);
        if (proc->var_vocab) am_vocab_destroy(proc->vm_alloc, proc->var_vocab);
        if (proc->symbol_vocab) am_vocab_destroy(proc->vm_alloc, proc->symbol_vocab);
        if (proc->var_type) am_list_destroy(proc->vm_alloc, proc->var_type);
        if (proc->natives) am_map_destroy(proc->vm_alloc, proc->natives);
        if (proc->var_top) am_list_destroy(proc->vm_alloc, proc->var_top);
        if (proc->var_arn_mapping) am_map_destroy(proc->vm_alloc, proc->var_arn_mapping);
        am_heap_destroy(vm_alloc, heap_alloc, proc->heap);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }

    // 分配操作数栈
    proc->opstack_capacity = (size_t)(mod->opstack_depth > 0 ? mod->opstack_depth : 256);
    proc->opstack = (am_value_t *)am_calloc(vm_alloc, proc->opstack_capacity * sizeof(am_value_t));
    if (!proc->opstack) {
        am_heap_destroy(vm_alloc, heap_alloc, proc->heap);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }
    proc->opstack_top = proc->opstack;

    // 分配函数调用栈
    proc->fstack_capacity = 2048;
    proc->fstack = (am_value_t *)am_calloc(vm_alloc, proc->fstack_capacity * sizeof(am_value_t));
    if (!proc->fstack) {
        am_free(vm_alloc, proc->opstack);
        am_heap_destroy(vm_alloc, heap_alloc, proc->heap);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }
    proc->fstack_top = proc->fstack;

    // 初始化 dynamic-wind 状态
    proc->dynamic_wind_stack = am_list_create(vm_alloc, 8, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!proc->dynamic_wind_stack) {
        am_free(vm_alloc, proc->fstack);
        am_free(vm_alloc, proc->opstack);
        am_heap_destroy(vm_alloc, heap_alloc, proc->heap);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }
    proc->dynamic_wind_after_stack = am_list_create(vm_alloc, 8, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!proc->dynamic_wind_after_stack) {
        am_list_destroy(vm_alloc, proc->dynamic_wind_stack);
        am_free(vm_alloc, proc->fstack);
        am_free(vm_alloc, proc->opstack);
        am_heap_destroy(vm_alloc, heap_alloc, proc->heap);
        am_free(vm_alloc, proc->ilcode);
        am_free(vm_alloc, proc);
        return NULL;
    }
    proc->dynamic_wind_mark_counter = 1;
    proc->current_dynamic_wind_entry = AM_HANDLE_NULL;
    proc->current_dynamic_wind_thunk = AM_HANDLE_NULL;

    // 初始化 wind 跳板状态
    proc->wind_state = 0;
    proc->pending_cont_handle = AM_HANDLE_NULL;
    proc->pending_cont_value = AM_VALUE_UNDEFINED;
    proc->pending_after_entries = NULL;
    proc->pending_after_count = 0;
    proc->pending_before_entries = NULL;
    proc->pending_before_count = 0;

    return proc;
}


// 功能说明：销毁进程数据结构，释放其占用的全部资源
// 实现说明：成功返回0，失败返回-1
int32_t am_process_destroy(am_process_t *proc) {
    if (!proc) return 0;

    // 【P1】度量输出（AM_FRAME_STATS=1 时打印闭包帧统计）
    {
        const char *stats_env = getenv("AM_FRAME_STATS");
        if (stats_env && stats_env[0] == '1') {
            size_t n_frame = proc->stat_frame_closures;
            size_t n_legacy = proc->stat_legacy_closures;
            size_t n_all = n_frame + n_legacy;
            printf("[frame-stats] pid=%zu closures=%zu (descriptor=%zu legacy=%zu) "
                   "avg_slots=%.1f avg_free=%.1f fill_generic=%zu\n",
                   (size_t)proc->pid, n_all, n_frame, n_legacy,
                   n_frame ? (double)proc->stat_slots_total / (double)n_frame : 0.0,
                   n_frame ? (double)proc->stat_free_slots_total / (double)n_frame : 0.0,
                   proc->stat_fill_generic);
        }
    }

    if (proc->frames) {
        am_frame_table_destroy(proc->vm_alloc, proc->frames);
        proc->frames = NULL;
    }
    if (proc->ilcode) {
        am_free(proc->vm_alloc, proc->ilcode);
        proc->ilcode = NULL;
    }
    if (proc->opstack) {
        am_free(proc->vm_alloc, proc->opstack);
        proc->opstack = NULL;
        proc->opstack_top = NULL;
    }
    if (proc->fstack) {
        am_free(proc->vm_alloc, proc->fstack);
        proc->fstack = NULL;
        proc->fstack_top = NULL;
    }
    if (proc->var_type) {
        am_list_destroy(proc->vm_alloc, proc->var_type);
        proc->var_type = NULL;
    }
    if (proc->natives) {
        am_map_destroy(proc->vm_alloc, proc->natives);
        proc->natives = NULL;
    }
    if (proc->var_top) {
        am_list_destroy(proc->vm_alloc, proc->var_top);
        proc->var_top = NULL;
    }
    if (proc->var_arn_mapping) {
        am_map_destroy(proc->vm_alloc, proc->var_arn_mapping);
        proc->var_arn_mapping = NULL;
    }
    if (proc->strindex) {
        am_strindex_destroy(proc->vm_alloc, proc->strindex);
        proc->strindex = NULL;
    }
    if (proc->dynamic_wind_stack) {
        am_list_destroy(proc->vm_alloc, proc->dynamic_wind_stack);
        proc->dynamic_wind_stack = NULL;
    }
    if (proc->dynamic_wind_after_stack) {
        am_list_destroy(proc->vm_alloc, proc->dynamic_wind_after_stack);
        proc->dynamic_wind_after_stack = NULL;
    }
    if (proc->pending_after_entries) {
        am_free(proc->vm_alloc, proc->pending_after_entries);
        proc->pending_after_entries = NULL;
    }
    if (proc->pending_before_entries) {
        am_free(proc->vm_alloc, proc->pending_before_entries);
        proc->pending_before_entries = NULL;
    }
    if (proc->heap) {
        am_heap_destroy(proc->vm_alloc, proc->heap_alloc, proc->heap);
        proc->heap = NULL;
    }

    am_free(proc->vm_alloc, proc);
    return 0;
}


// ===============================================================================
// 操作数栈操作
// ===============================================================================

// 功能说明：向操作数栈中压入值。成功返回0，失败返回-1
int32_t am_process_push_operand(am_process_t *proc, am_value_t v) {
    if (!proc || !proc->opstack || !proc->opstack_top) return -1;
    size_t used = (size_t)(proc->opstack_top - proc->opstack);
    // if (used >= proc->opstack_capacity) {
    //     fprintf(stderr, "[Process] am_process_push_operand OPSTACK容量不足\n");
    //     return -1;
    // }
    // 注：以下是opstack深度估计不准或者无估计时的权宜之计
    if (used >= proc->opstack_capacity) {
        size_t new_capacity = proc->opstack_capacity * 2;
        if (new_capacity < 16) new_capacity = 16;
        am_value_t *new_opstack = (am_value_t *)am_realloc(proc->vm_alloc, proc->opstack,
                                                             new_capacity * sizeof(am_value_t));
        if (!new_opstack) return -1;
        proc->opstack_top = new_opstack + used;
        proc->opstack = new_opstack;
        proc->opstack_capacity = new_capacity;
    }
    *proc->opstack_top++ = v;
    return 0;
}


// 功能说明：从操作数栈中弹出一个值。成功返回弹出值，失败返回UINTPTR_MAX
am_value_t am_process_pop_operand(am_process_t *proc) {
    if (!proc || !proc->opstack || !proc->opstack_top) return (am_value_t)UINTPTR_MAX;
    if (proc->opstack_top <= proc->opstack) return (am_value_t)UINTPTR_MAX;
    return *--proc->opstack_top;
}


// 功能说明：根据栈顶指针计算opstack中有多少个am_value_t。成功返回长度值，失败返回SIZE_MAX
size_t am_process_length_of_opstack(am_process_t *proc) {
    if (!proc || !proc->opstack || !proc->opstack_top) return SIZE_MAX;
    return (size_t)(proc->opstack_top - proc->opstack);
}


// ===============================================================================
// 函数调用栈操作
// ===============================================================================

// 功能说明：向fstack中压入栈帧（两个值）。成功返回0，失败返回-1
int32_t am_process_push_stack_frame(am_process_t *proc, am_value_t closure_handle_value, am_value_t return_target_iaddr_value) {
    if (!proc || !proc->fstack || !proc->fstack_top) return -1;
    if (!am_value_is_handle(closure_handle_value)) return -1;
    /* 工单#36：return_target 允许普通 iaddr 或异步帧标记（定时器回调帧） */
    if (!am_value_is_iaddr(return_target_iaddr_value) && !AM_VALUE_IS_ASYNC_RET(return_target_iaddr_value)) return -1;

    size_t used = (size_t)(proc->fstack_top - proc->fstack);
    if (used + 2 > proc->fstack_capacity) return -1;

    *proc->fstack_top++ = closure_handle_value;
    *proc->fstack_top++ = return_target_iaddr_value;
    return 0;
}


// 功能说明：从fstack中弹出栈帧的两个值，通过两个指针传出。成功返回0，失败返回-1
int32_t am_process_pop_stack_frame(am_process_t *proc, am_value_t *closure_handle_value, am_value_t *return_target_iaddr_value) {
    if (!proc || !proc->fstack || !proc->fstack_top || !closure_handle_value || !return_target_iaddr_value) return -1;
    if (proc->fstack_top - proc->fstack < 2) return -1;

    *return_target_iaddr_value = *--proc->fstack_top;
    *closure_handle_value = *--proc->fstack_top;
    return 0;
}


// 功能说明：根据栈顶指针计算fstack中有多少个am_value_t（因为是成对push/pop，所以正常情况下必为偶数）。成功返回长度值，失败返回SIZE_MAX
size_t am_process_length_of_fstack(am_process_t *proc) {
    if (!proc || !proc->fstack || !proc->fstack_top) return SIZE_MAX;
    return (size_t)(proc->fstack_top - proc->fstack);
}


// ===============================================================================
// 闭包操作
// ===============================================================================

// 功能说明：新建闭包并返回其handle。成功返回handle，失败返回AM_HANDLE_NULL
am_handle_t am_process_make_closure(am_process_t *proc, am_iaddr_t iaddr, am_handle_t parent) {
    if (!proc || !proc->heap || !proc->heap_alloc) return AM_HANDLE_NULL;

    // 首先在proc->heap中申请一个新的handle
    am_handle_t hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (hd == AM_HANDLE_NULL) return AM_HANDLE_NULL;

    // 新建闭包对象
    am_obj_closure_t *closure_obj = am_closure_create(proc->heap_alloc, iaddr, parent, 16);
    if (!closure_obj) {
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    // 将闭包对象的指针绑定到hd上
    am_value_t closure_value = am_make_value_of_ptr((am_object_t *)closure_obj);
    if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, hd, closure_value) != 0) {
        am_closure_destroy(proc->heap_alloc, closure_obj);
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    return hd;
}


// 功能说明：按帧描述符创建闭包（一次性成型）。
// 实现说明：槽位在创建时全部就位（varid + 类型），其中
//   1) BOUND 槽：值为 #undefined、未定状态，等序言的 store 写入；
//   2) FREE 槽：从父闭包按 src 索引拉取（逐槽 varid 校验；不匹配或 src 缺失时
//      退回“以父闭包为起点”的通用链式解析，保证动态父链下也正确）。
// 由此闭包创建后帧大小固定、槽位下标语义固定，变量访问不再需要跨帧线性查找。
am_handle_t am_process_make_closure_desc(am_process_t *proc, am_iaddr_t iaddr,
                                        am_handle_t parent, am_frame_desc_t *desc) {
    if (!proc || !proc->heap || !proc->heap_alloc || !desc) return AM_HANDLE_NULL;

    size_t nslots = (size_t)desc->nbound + (size_t)desc->nfree;

    am_handle_t hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (hd == AM_HANDLE_NULL) return AM_HANDLE_NULL;

    // 容量一次到位：静态槽位 + 少量余量（供运行期动态追加绑定使用）
    am_obj_closure_t *closure_obj = am_closure_create(proc->heap_alloc, iaddr, parent,
                                                      nslots + 8);
    if (!closure_obj) {
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    for (size_t i = 0; i < nslots; i++) {
        closure_obj->bindings[i].varid = desc->slots[i].varid;
        // 约束变量槽：预置但**未定义**（等序言的 store 写入，以保持“未定义穿透外层”的语义）
        // 自由变量槽：DEFINED 由下面的填充过程按父帧继承
        closure_obj->bindings[i].type = (int32_t)desc->slots[i].type;
        closure_obj->bindings[i].dirty_flag = 0;
        closure_obj->bindings[i].value = AM_VALUE_UNDEFINED;
    }
    closure_obj->length = nslots;
    closure_obj->frame_len = nslots; // 索引帧见证：槽位下标语义固定

    // 自由变量槽：从父闭包拉取快照
    if (desc->nfree > 0) {
        am_obj_closure_t *parent_obj = am_process_get_closure(proc, parent);
        for (uint32_t k = 0; k < desc->nfree; k++) {
            size_t idx = (size_t)desc->nbound + k;
            am_varid_t varid = desc->slots[idx].varid;
            uint32_t src = desc->slots[idx].src;

            int done = 0;
            if (parent_obj && src != AM_FRAME_SRC_NONE && (size_t)src < parent_obj->length &&
                parent_obj->bindings[src].varid == varid) {
                const am_binding_t *pb = &parent_obj->bindings[src];
                closure_obj->bindings[idx].value = pb->value;
                closure_obj->bindings[idx].dirty_flag = 0;
                closure_obj->bindings[idx].type =
                    AM_BINDING_FREE | (pb->type & AM_BINDING_DEFINED);
                done = 1;
            }
            if (!done) {
                am_value_t v = am_process_dereference_from(proc, parent, varid);
                if (v != (am_value_t)UINTPTR_MAX) {
                    closure_obj->bindings[idx].value = v;
                    closure_obj->bindings[idx].type = AM_BINDING_FREE | AM_BINDING_DEFINED;
                }
            }
        }
    }

    am_value_t closure_value = am_make_value_of_ptr((am_object_t *)closure_obj);
    if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, hd, closure_value) != 0) {
        am_closure_destroy(proc->heap_alloc, closure_obj);
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    proc->stat_frame_closures++;
    proc->stat_slots_total += nslots;
    proc->stat_free_slots_total += desc->nfree;
    return hd;
}


// 功能说明：根据闭包handle获取闭包对象。成功返回指针，失败返回NULL
am_obj_closure_t *am_process_get_closure(am_process_t *proc, am_handle_t hd) {
    if (!proc || !proc->heap) return NULL;

    am_value_t v = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(v)) return NULL;

    am_object_t *obj = am_value_to_ptr(v);
    if (!obj || obj->type != AM_OBJECT_TYPE_CLOSURE) return NULL;

    return (am_obj_closure_t *)obj;
}


// 功能说明：获取进程的当前闭包对象。成功返回指针，失败返回NULL
// 实现说明：带指针缓存（proc->current_closure_obj）。缓存为 NULL 时惰性重建，
//           因此 GC 压缩后只需把缓存置 NULL 即可保证正确性。
am_obj_closure_t *am_process_get_current_closure(am_process_t *proc) {
    if (!proc) return NULL;
    if (!proc->current_closure_obj) {
        proc->current_closure_obj = am_process_get_closure(proc, proc->current_closure_handle);
    }
    return proc->current_closure_obj;
}


// 功能说明：以指定闭包为起点做变量解引用（语义同 am_process_dereference）。
// 设计说明：先在起点闭包查找约束变量；若不存在，则沿闭包链查找约束变量定义位置，
//          根据脏标记决定使用定义位置的约束变量值，还是使用起点闭包中的自由变量值。
// 实现说明：P0 起每个闭包内同一 varid 至多一个绑定项，因此原来"先 has_bound_var、
//          再 get_bound_var、再 is_dirty_var"的三四轮全表扫描合并为每层一次扫描。
//          P1 起帧变小（不再复制全部绑定），同样代码的常数项随之下降。
static am_value_t deref_impl(am_process_t *proc, am_handle_t start_handle,
                             am_obj_closure_t *start_obj, am_varid_t varid) {
    if (!proc || !start_obj) return (am_value_t)UINTPTR_MAX;

    // 查找起点闭包的约束变量
    am_binding_t *binding = am_closure_find_binding(start_obj, varid, AM_BINDING_BOUND);
    if (binding) {
        return binding->value;
    }

    // 查找起点闭包的自由变量（如果存在）对应的词法定义环境
    am_handle_t closure_handle = start_handle;
    while (closure_handle != AM_HANDLE_NULL) {
        am_obj_closure_t *closure_obj = am_process_get_closure(proc, closure_handle);
        if (!closure_obj) break;

        am_binding_t *def_binding = am_closure_find_binding(closure_obj, varid, AM_BINDING_BOUND);
        if (def_binding) {
            // 找到约束变量定义位置
            if (def_binding->dirty_flag) {
                // 脏标记为真：使用约束变量定义位置的新值
                return def_binding->value;
            }
            // 脏标记为假：使用起点闭包中的自由变量值
            am_binding_t *free_binding = am_closure_find_binding(start_obj, varid, AM_BINDING_FREE);
            if (free_binding) return free_binding->value;

            // 安全兜底：起点闭包未持有该自由变量快照（帧描述符分析不完备时的情形），
            // 退而使用定义位置的值（比返回 #undefined 更接近正确语义）。
            proc->stat_fill_generic++;
            if (proc->stat_fill_generic <= 40) {
                const char *dbg = getenv("AM_FRAME_DEBUG");
                if (dbg && dbg[0] == '1') {
                    wchar_t *nm = am_vocab_get(proc->vm_alloc, proc->var_vocab, &varid);
                    printf("[frame-gap] pc=%zu op=%u il_op=%zu cur_hd=%zu from_hd=%zu from_iaddr=%zu varid=%zu name=%ls start_len=%zu | slots:",
                           (size_t)proc->PC, (unsigned)proc->ilcode[proc->PC].opcode,
                           am_value_is_varid(proc->ilcode[proc->PC].operand) ? (size_t)am_value_to_varid(proc->ilcode[proc->PC].operand) : (size_t)0,
                           (size_t)proc->current_closure_handle, (size_t)start_handle,
                           (size_t)start_obj->iaddr, (size_t)varid,
                           nm ? nm : L"?", start_obj->length);
                    for (size_t z = 0; z < start_obj->length; z++) {
                        wchar_t *sn = am_vocab_get(proc->vm_alloc, proc->var_vocab,
                                                   &start_obj->bindings[z].varid);
                        printf(" [%zu v=%zu/%ls t=%d]", z, (size_t)start_obj->bindings[z].varid,
                               sn ? sn : L"?", (int)start_obj->bindings[z].type);
                    }
                    printf("\n");
                }
            }
            return def_binding->value;
        }

        closure_handle = closure_obj->parent;
    }

    // 未找到变量定义
    return (am_value_t)UINTPTR_MAX;
}


// 功能说明：以指定闭包为起点做变量解引用（先查闭包对象，再进入通用实现）。
am_value_t am_process_dereference_from(am_process_t *proc, am_handle_t start_handle, am_varid_t varid) {
    if (!proc) return (am_value_t)UINTPTR_MAX;
    am_obj_closure_t *start_obj = am_process_get_closure(proc, start_handle);
    return deref_impl(proc, start_handle, start_obj, varid);
}


// 功能说明：变量解引用（当前闭包）。成功返回TPV，失败返回UINTPTR_MAX
// 实现说明：走 current_closure_obj 指针缓存，避免每条 load/call 指令一次堆 map 查找。
am_value_t am_process_dereference(am_process_t *proc, am_varid_t varid) {
    if (!proc) return (am_value_t)UINTPTR_MAX;
    am_obj_closure_t *cur = am_process_get_current_closure(proc);
    return deref_impl(proc, proc->current_closure_handle, cur, varid);
}


// ===============================================================================
// 程序流程控制
// ===============================================================================

// 功能说明：获取当前指令，并取出opcode和operand。成功返回0，失败返回-1
int32_t am_process_current_instruction(am_process_t *proc, uint32_t *opcode, am_value_t *operand) {
    if (!proc || !opcode || !operand) return -1;
    if (!proc->ilcode || proc->PC >= proc->ilcode_length) return -1;

    *opcode = proc->ilcode[proc->PC].opcode;
    *operand = proc->ilcode[proc->PC].operand;
    return 0;
}


// 功能说明：前进一步（PC加1）
void am_process_step(am_process_t *proc) {
    if (!proc) return;
    proc->PC++;
}


// 功能说明：无条件跳转（PC置数iaddr）
void am_process_goto(am_process_t *proc, am_iaddr_t iaddr) {
    if (!proc) return;
    proc->PC = iaddr;
}


// 功能说明：设置进程状态
void am_process_set_state(am_process_t *proc, int32_t s) {
    if (!proc) return;
    proc->state = s;
}


// ===============================================================================
// 计算续体（continuation）的捕获和恢复
// ===============================================================================

// 功能说明：捕获当前续体，保存为堆对象，并返回其handle。成功返回handle，失败返回AM_HANDLE_NULL
am_handle_t am_process_capture_continuation(am_process_t *proc, am_iaddr_t cont_return_target_iaddr) {
    if (!proc || !proc->heap || !proc->heap_alloc) return AM_HANDLE_NULL;

    size_t opstack_length = am_process_length_of_opstack(proc);
    size_t fstack_length = am_process_length_of_fstack(proc);
    if (opstack_length == SIZE_MAX || fstack_length == SIZE_MAX) return AM_HANDLE_NULL;

    // 深拷贝当前 dynamic_wind_stack 到堆中，作为续体快照
    am_handle_t dw_snapshot_handle = AM_HANDLE_NULL;
    if (proc->dynamic_wind_stack) {
        am_list_t *dw_snapshot = am_list_copy(proc->heap_alloc, proc->dynamic_wind_stack);
        if (!dw_snapshot) return AM_HANDLE_NULL;
        dw_snapshot_handle = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
        if (dw_snapshot_handle == AM_HANDLE_NULL) {
            am_list_destroy(proc->heap_alloc, dw_snapshot);
            return AM_HANDLE_NULL;
        }
        am_value_t snapshot_value = am_make_value_of_ptr((am_object_t *)dw_snapshot);
        if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle, snapshot_value) != 0) {
            am_list_destroy(proc->heap_alloc, dw_snapshot);
            am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle);
            return AM_HANDLE_NULL;
        }
    }

    // 深拷贝当前 dynamic_wind_after_stack 到堆中（after 内捕获续体时需要）
    am_handle_t dw_after_snapshot_handle = AM_HANDLE_NULL;
    if (proc->dynamic_wind_after_stack && proc->dynamic_wind_after_stack->length > 0) {
        am_list_t *dw_after_snapshot = am_list_copy(proc->heap_alloc, proc->dynamic_wind_after_stack);
        if (!dw_after_snapshot) {
            if (dw_snapshot_handle != AM_HANDLE_NULL) {
                am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle);
            }
            return AM_HANDLE_NULL;
        }
        dw_after_snapshot_handle = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
        if (dw_after_snapshot_handle == AM_HANDLE_NULL) {
            am_list_destroy(proc->heap_alloc, dw_after_snapshot);
            if (dw_snapshot_handle != AM_HANDLE_NULL) {
                am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle);
            }
            return AM_HANDLE_NULL;
        }
        am_value_t snapshot_value = am_make_value_of_ptr((am_object_t *)dw_after_snapshot);
        if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_after_snapshot_handle, snapshot_value) != 0) {
            am_list_destroy(proc->heap_alloc, dw_after_snapshot);
            am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_after_snapshot_handle);
            if (dw_snapshot_handle != AM_HANDLE_NULL) {
                am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle);
            }
            return AM_HANDLE_NULL;
        }
    }

    // 创建续体对象，深拷贝当前opstack和fstack
    am_continuation_t *cont = am_continuation_create(
        proc->heap_alloc,
        cont_return_target_iaddr,
        proc->current_closure_handle,
        proc->opstack, opstack_length,
        proc->fstack, fstack_length,
        dw_snapshot_handle
    );
    if (!cont) {
        if (dw_snapshot_handle != AM_HANDLE_NULL) {
            am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_snapshot_handle);
        }
        if (dw_after_snapshot_handle != AM_HANDLE_NULL) {
            am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, dw_after_snapshot_handle);
        }
        return AM_HANDLE_NULL;
    }

    // 保存 dynamic-wind 的 transient 状态，使得在 before/after 内捕获的续体也能正确恢复
    cont->current_dynamic_wind_entry_handle = proc->current_dynamic_wind_entry;
    cont->current_dynamic_wind_thunk_handle = proc->current_dynamic_wind_thunk;
    cont->dynamic_wind_after_stack_handle = dw_after_snapshot_handle;

    // 在堆中分配handle并绑定续体对象
    am_handle_t hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (hd == AM_HANDLE_NULL) {
        am_continuation_destroy(proc->heap_alloc, cont);
        return AM_HANDLE_NULL;
    }

    am_value_t cont_value = am_make_value_of_ptr((am_object_t *)cont);
    if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, hd, cont_value) != 0) {
        am_continuation_destroy(proc->heap_alloc, cont);
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    return hd;
}


// 功能说明：直接恢复续体快照（opstack/fstack/closure），不执行 wind 调整。成功返回 cont_return_target，失败返回 SIZE_MAX
am_iaddr_t am_process_restore_continuation_snapshot(am_process_t *proc, am_handle_t hd) {
    if (!proc || !proc->heap) return SIZE_MAX;

    am_value_t v = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(v)) return SIZE_MAX;

    am_object_t *obj = am_value_to_ptr(v);
    if (!obj || obj->type != AM_OBJECT_TYPE_CONTINUATION) return SIZE_MAX;

    am_continuation_t *cont = (am_continuation_t *)obj;

    // 获取续体中保存的opstack和fstack副本
    size_t cont_opstack_length = 0;
    size_t cont_fstack_length = 0;
    am_value_t *cont_opstack = am_continuation_get_opstack(proc->vm_alloc, cont, &cont_opstack_length);
    am_value_t *cont_fstack = am_continuation_get_fstack(proc->vm_alloc, cont, &cont_fstack_length);

    if (!cont_opstack || !cont_fstack) {
        if (cont_opstack) am_free(proc->vm_alloc, cont_opstack);
        if (cont_fstack) am_free(proc->vm_alloc, cont_fstack);
        return SIZE_MAX;
    }

    // 检查容量是否足够
    if (cont_opstack_length > proc->opstack_capacity || cont_fstack_length > proc->fstack_capacity) {
        am_free(proc->vm_alloc, cont_opstack);
        am_free(proc->vm_alloc, cont_fstack);
        return SIZE_MAX;
    }

    // 恢复运行时状态
    if (cont_opstack_length > 0) {
        memcpy(proc->opstack, cont_opstack, cont_opstack_length * sizeof(am_value_t));
    }
    proc->opstack_top = proc->opstack + cont_opstack_length;

    if (cont_fstack_length > 0) {
        memcpy(proc->fstack, cont_fstack, cont_fstack_length * sizeof(am_value_t));
    }
    proc->fstack_top = proc->fstack + cont_fstack_length;

    am_process_set_current_closure(proc, cont->current_closure_handle);
    proc->current_dynamic_wind_entry = cont->current_dynamic_wind_entry_handle;
    proc->current_dynamic_wind_thunk = cont->current_dynamic_wind_thunk_handle;

    // 恢复 dynamic_wind_after_stack（after 内捕获续体时可能需要）
    if (proc->dynamic_wind_after_stack) {
        am_list_destroy(proc->vm_alloc, proc->dynamic_wind_after_stack);
        proc->dynamic_wind_after_stack = NULL;
    }
    if (cont->dynamic_wind_after_stack_handle != AM_HANDLE_NULL) {
        am_value_t after_stack_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap,
                                                  cont->dynamic_wind_after_stack_handle);
        if (am_value_is_ptr(after_stack_val)) {
            am_list_t *after_stack_obj = (am_list_t *)am_value_to_ptr(after_stack_val);
            am_list_t *restored = am_list_copy(proc->vm_alloc, after_stack_obj);
            if (!restored) {
                am_free(proc->vm_alloc, cont_opstack);
                am_free(proc->vm_alloc, cont_fstack);
                return SIZE_MAX;
            }
            proc->dynamic_wind_after_stack = restored;
        }
    }
    if (!proc->dynamic_wind_after_stack) {
        proc->dynamic_wind_after_stack = am_list_create(proc->vm_alloc, 8, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
        if (!proc->dynamic_wind_after_stack) {
            am_free(proc->vm_alloc, cont_opstack);
            am_free(proc->vm_alloc, cont_fstack);
            return SIZE_MAX;
        }
    }

    am_free(proc->vm_alloc, cont_opstack);
    am_free(proc->vm_alloc, cont_fstack);

    return cont->cont_return_target;
}


// 功能说明：恢复指定的计算续体到当前进程。成功返回其返回目标位置的iaddr，失败返回SIZE_MAX
// 实现说明：传入的 value 为调用续体时传入的值；若需要 wind 调整，则 value 暂存于 proc，待跳板恢复时压栈。
am_iaddr_t am_process_load_continuation(am_process_t *proc, am_handle_t hd, am_value_t value) {
    if (!proc || !proc->heap) return SIZE_MAX;

    am_value_t v = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(v)) return SIZE_MAX;

    am_object_t *obj = am_value_to_ptr(v);
    if (!obj || obj->type != AM_OBJECT_TYPE_CONTINUATION) return SIZE_MAX;

    am_continuation_t *cont = (am_continuation_t *)obj;

    // 获取续体捕获时的 dynamic-wind 栈快照
    am_list_t *target_dw_stack = NULL;
    if (cont->dynamic_wind_stack_handle != AM_HANDLE_NULL) {
        am_value_t dw_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, cont->dynamic_wind_stack_handle);
        if (am_value_is_ptr(dw_val)) {
            am_object_t *dw_obj = am_value_to_ptr(dw_val);
            if (dw_obj && dw_obj->type == AM_OBJECT_TYPE_LIST) {
                target_dw_stack = (am_list_t *)dw_obj;
            }
        }
    }

    size_t prefix = dynamic_wind_common_prefix(proc, target_dw_stack);
    size_t current_len = proc->dynamic_wind_stack ? proc->dynamic_wind_stack->length : 0;
    size_t target_len = target_dw_stack ? target_dw_stack->length : 0;

    // 如果当前栈与目标栈完全一致，直接恢复续体
    if (prefix == current_len && prefix == target_len) {
        am_iaddr_t cont_target = am_process_restore_continuation_snapshot(proc, hd);
        if (cont_target == SIZE_MAX) return SIZE_MAX;
        if (am_process_push_operand(proc, value) != 0) return SIZE_MAX;
        return cont_target;
    }

    // 需要 wind 调整：计算 afters（当前栈中多出部分，从内到外）和 befores（目标栈中多出部分，从外到内）
    size_t after_count = current_len - prefix;
    size_t before_count = target_len - prefix;

    am_handle_t *after_entries = NULL;
    am_handle_t *before_entries = NULL;
    if (after_count > 0) {
        after_entries = (am_handle_t *)am_malloc(proc->vm_alloc, after_count * sizeof(am_handle_t));
        if (!after_entries) return SIZE_MAX;
        for (size_t i = 0; i < after_count; i++) {
            size_t idx = current_len - 1 - i;
            after_entries[i] = am_value_to_handle(proc->dynamic_wind_stack->children[idx]);
        }
    }
    if (before_count > 0) {
        before_entries = (am_handle_t *)am_malloc(proc->vm_alloc, before_count * sizeof(am_handle_t));
        if (!before_entries) {
            if (after_entries) am_free(proc->vm_alloc, after_entries);
            return SIZE_MAX;
        }
        for (size_t i = 0; i < before_count; i++) {
            size_t idx = prefix + i;
            before_entries[i] = am_value_to_handle(target_dw_stack->children[idx]);
        }
    }

    // 释放旧的 pending 数组（如果存在）
    if (proc->pending_after_entries) {
        am_free(proc->vm_alloc, proc->pending_after_entries);
    }
    if (proc->pending_before_entries) {
        am_free(proc->vm_alloc, proc->pending_before_entries);
    }

    proc->pending_cont_handle = hd;
    proc->pending_cont_value = value;
    proc->pending_after_entries = after_entries;
    proc->pending_after_count = after_count;
    proc->pending_before_entries = before_entries;
    proc->pending_before_count = before_count;
    proc->wind_state = 1;

    return proc->wind_trampoline_iaddr;
}


// ===============================================================================
// 列表字符串化辅助结构
// ===============================================================================

typedef struct {
    am_allocator_t *alloc;
    wchar_t *buf;
    size_t len;
    size_t cap;
} am_process_strbuf_t;


static int32_t am_process_strbuf_init(am_allocator_t *alloc, am_process_strbuf_t *sb, size_t initial_cap) {
    if (!alloc || !sb || initial_cap == 0) return -1;
    sb->alloc = alloc;
    sb->buf = (wchar_t *)am_malloc(alloc, initial_cap * sizeof(wchar_t));
    if (!sb->buf) return -1;
    sb->buf[0] = L'\0';
    sb->len = 0;
    sb->cap = initial_cap;
    return 0;
}


static int32_t am_process_strbuf_ensure(am_process_strbuf_t *sb, size_t needed) {
    if (!sb || !sb->buf) return -1;
    if (needed <= sb->cap) return 0;

    size_t new_cap = sb->cap;
    while (new_cap < needed) {
        new_cap *= 2;
    }

    wchar_t *new_buf = (wchar_t *)am_malloc(sb->alloc, new_cap * sizeof(wchar_t));
    if (!new_buf) return -1;

    memcpy(new_buf, sb->buf, (sb->len + 1) * sizeof(wchar_t));
    am_free(sb->alloc, sb->buf);
    sb->buf = new_buf;
    sb->cap = new_cap;
    return 0;
}


static int32_t am_process_strbuf_append_char(am_process_strbuf_t *sb, wchar_t c) {
    if (!sb) return -1;
    if (am_process_strbuf_ensure(sb, sb->len + 2) != 0) return -1;
    sb->buf[sb->len++] = c;
    sb->buf[sb->len] = L'\0';
    return 0;
}


static int32_t am_process_strbuf_append_string(am_process_strbuf_t *sb, const wchar_t *s) {
    if (!sb || !s) return -1;
    size_t slen = wcslen(s);
    if (am_process_strbuf_ensure(sb, sb->len + slen + 1) != 0) return -1;
    memcpy(&sb->buf[sb->len], s, slen * sizeof(wchar_t));
    sb->len += slen;
    sb->buf[sb->len] = L'\0';
    return 0;
}


static int32_t am_process_append_value_to_strbuf(am_process_strbuf_t *sb, am_process_t *proc, am_value_t value, bool in_quote);


static int32_t am_process_append_lambda_to_strbuf(am_process_strbuf_t *sb, am_process_t *proc, am_list_t *lambda, bool in_quote) {
    if (!sb || !proc || !lambda) return -1;

    if (am_process_strbuf_append_string(sb, L"(lambda (") != 0) return -1;

    size_t n_param = 0;
    if (lambda->length >= 2) {
        am_value_t n_param_val = am_list_get(proc->vm_alloc, lambda, 1);
        if (am_value_is_uint(n_param_val)) {
            n_param = (size_t)am_value_to_uint(n_param_val);
        }
    }

    for (size_t i = 0; i < n_param; i++) {
        if (i > 0) {
            if (am_process_strbuf_append_char(sb, L' ') != 0) return -1;
        }
        am_value_t param = am_list_get(proc->vm_alloc, lambda, 2 + i);
        if (am_process_append_value_to_strbuf(sb, proc, param, in_quote) != 0) return -1;
    }
    if (am_process_strbuf_append_char(sb, L')') != 0) return -1;

    size_t n_body = am_list_lambda_get_body_number(proc->vm_alloc, lambda);
    for (size_t i = 0; i < n_body; i++) {
        if (am_process_strbuf_append_char(sb, L' ') != 0) return -1;
        am_value_t body = am_list_get(proc->vm_alloc, lambda, 2 + n_param + i);
        if (am_process_append_value_to_strbuf(sb, proc, body, in_quote) != 0) return -1;
    }

    if (am_process_strbuf_append_char(sb, L')') != 0) return -1;
    return 0;
}


static int32_t am_process_append_list_to_strbuf(am_process_strbuf_t *sb, am_process_t *proc, am_list_t *lst, bool in_quote) {
    if (!sb || !proc || !lst) return -1;

    const wchar_t *prefix = L"(";
    if (lst->length == 0) {
        // 空列表无论位于何处都显示前导单引号
        prefix = L"'(";
    }
    else if (lst->type == AM_LIST_TYPE_QUOTE) {
        // quote 列表（无论最外层还是嵌套内层）不显示前导单引号
        prefix = L"(";
    }
    else if (lst->type == AM_LIST_TYPE_QUASIQUOTE) prefix = L"`(";
    else if (lst->type == AM_LIST_TYPE_UNQUOTE)    prefix = L",(";
    else if (lst->type == AM_LIST_TYPE_UNQUOTE_SPLICING) prefix = L",@(";

    if (am_process_strbuf_append_string(sb, prefix) != 0) return -1;

    bool child_in_quote = in_quote || (lst->type == AM_LIST_TYPE_QUOTE) || (lst->type == AM_LIST_TYPE_QUASIQUOTE);

    for (size_t i = 0; i < lst->length; i++) {
        if (i > 0) {
            if (am_process_strbuf_append_char(sb, L' ') != 0) return -1;
        }
        am_value_t child = am_list_get(proc->vm_alloc, lst, i);
        if (am_process_append_value_to_strbuf(sb, proc, child, child_in_quote) != 0) return -1;
    }

    if (am_process_strbuf_append_char(sb, L')') != 0) return -1;
    return 0;
}


static int32_t am_process_append_value_to_strbuf(am_process_strbuf_t *sb, am_process_t *proc, am_value_t value, bool in_quote) {
    if (!sb || !proc) return -1;

    if (am_value_is_handle(value)) {
        am_handle_t h = am_value_to_handle(value);
        if (h == AM_HANDLE_NULL) {
            return am_process_strbuf_append_string(sb, L"#<null-handle>");
        }
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, h);
        if (!am_value_is_ptr(obj_val)) {
            return am_process_strbuf_append_string(sb, L"#<handle>");
        }
        am_object_t *obj = am_value_to_ptr(obj_val);
        if (obj->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *lst = (am_list_t *)obj;
            if (lst->type == AM_LIST_TYPE_LAMBDA) {
                return am_process_append_lambda_to_strbuf(sb, proc, lst, in_quote);
            }
            return am_process_append_list_to_strbuf(sb, proc, lst, in_quote);
        }
        else if (obj->type == AM_OBJECT_TYPE_WSTRING) {
            am_wstring_t *ws = (am_wstring_t *)obj;
            for (size_t i = 0; i < ws->length; i++) {
                am_value_t cv = ws->content[i];
                if (!am_value_is_wchar(cv)) continue;
                if (am_process_strbuf_append_char(sb, (wchar_t)am_value_to_wchar(cv)) != 0) return -1;
            }
            return 0;
        }
        return am_process_strbuf_append_string(sb, L"#<object>");
    }
    else if (am_value_is_varid(value)) {
        am_varid_t varid = am_value_to_varid(value);
        wchar_t *text = am_vocab_get(proc->vm_alloc, proc->var_vocab, &varid);
        if (!text) return am_process_strbuf_append_string(sb, L"#<var>");
        return am_process_strbuf_append_string(sb, text);
    }
    else if (am_value_is_symbol(value)) {
        am_symbol_t sym = am_value_to_symbol(value);
        wchar_t *text = am_vocab_get(proc->vm_alloc, proc->symbol_vocab, &sym);
        if (!text) return am_process_strbuf_append_string(sb, L"#<sym>");
        if (*text == L'\'') {
            // symbol 字面量（词汇表中已带前导单引号）
            // if (in_quote) {
                // 在 quote 列表内部：去掉前导单引号
                while (*text == L'\'') text++;
            // }
            return am_process_strbuf_append_string(sb, text);
        }
        // 关键字等不带前导单引号的 symbol：原样输出
        return am_process_strbuf_append_string(sb, text);
    }
    else if (am_value_is_uint(value)) {
        wchar_t tmp[64];
        swprintf(tmp, 64, L"%llu", (unsigned long long)am_value_to_uint(value));
        return am_process_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_int(value)) {
        wchar_t tmp[64];
        swprintf(tmp, 64, L"%lld", (long long)am_value_to_int(value));
        return am_process_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_float(value)) {
        wchar_t tmp[128];
        swprintf(tmp, 128, L"%g", (double)am_value_to_float(value));
        return am_process_strbuf_append_string(sb, tmp);
    }
    else if (am_value_is_boolean(value)) {
        return am_process_strbuf_append_string(sb, am_value_to_boolean(value) ? L"#t" : L"#f");
    }
    else if (am_value_is_null(value)) {
        return am_process_strbuf_append_string(sb, L"#null");
    }
    else if (am_value_is_undefined(value)) {
        return am_process_strbuf_append_string(sb, L"#undefined");
    }

    return am_process_strbuf_append_string(sb, L"#<value>");
}


// 功能说明：将进程堆中的列表对象转换为可显示宽字符串。成功返回新分配的 wchar_t*，失败返回 NULL。
// 实现说明：从 proc->heap 中取得对象，从 proc->var_vocab / proc->symbol_vocab 中解析变量名和符号名。
//          symbol 的处理规则：不在 quote 列表内时带前导单引号；在 quote 列表内时不带前导单引号。
wchar_t *am_process_list_to_string(am_process_t *proc, am_handle_t hd, size_t *length) {
    if (!proc || !proc->heap || hd == AM_HANDLE_NULL) return NULL;

    am_value_t value = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(value)) return NULL;

    am_object_t *obj = am_value_to_ptr(value);
    if (obj->type != AM_OBJECT_TYPE_LIST) return NULL;

    am_process_strbuf_t sb;
    if (am_process_strbuf_init(proc->vm_alloc, &sb, 256) != 0) return NULL;

    am_list_t *lst = (am_list_t *)obj;
    bool in_quote = (lst->type == AM_LIST_TYPE_QUOTE);
    if (lst->type == AM_LIST_TYPE_LAMBDA) {
        if (am_process_append_lambda_to_strbuf(&sb, proc, lst, in_quote) != 0) {
            am_free(proc->vm_alloc, sb.buf);
            return NULL;
        }
    }
    else {
        if (am_process_append_list_to_strbuf(&sb, proc, lst, in_quote) != 0) {
            am_free(proc->vm_alloc, sb.buf);
            return NULL;
        }
    }

    if (length) *length = sb.len;
    return sb.buf;
}


