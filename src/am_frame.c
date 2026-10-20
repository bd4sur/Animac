#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "am_object.h"
#include "am_allocator.h"
#include "am_closure.h"
#include "am_ast.h"
#include "am_list.h"
#include "am_heap.h"
#include "am_map.h"
#include "am_scope.h"
#include "am_compiler.h"
#include "am_frame.h"


// ===============================================================================
// 内部数据结构
// ===============================================================================

// 一个 λ 的帧分析中间状态
typedef struct frame_region_t {
    am_iaddr_t entry;
    am_iaddr_t end;
    size_t     parent;      // 父区间下标；SIZE_MAX 表示无父（顶层 λ）
    am_handle_t handle;     // λ 的 AST 节点把柄；临时 λ 为 AM_HANDLE_NULL
    uint32_t   nparam;
    uint32_t   flags;

    // 变量集合（均为去重集合，用简单线性查找；λ 规模小，编译期一次性开销可忽略）
    am_varid_t *bound;  size_t nbound, cbound;
    am_varid_t *ref;    size_t nref,  cref;
    am_varid_t *fv;     size_t nfv,   cfv;

    am_frame_desc_t *desc;
} frame_region_t;

static int32_t varid_set_add(am_allocator_t *alloc, am_varid_t **set, size_t *len, size_t *cap, am_varid_t v) {
    for (size_t i = 0; i < *len; i++) {
        if ((*set)[i] == v) return 0; // 已存在
    }
    if (*len >= *cap) {
        size_t new_cap = *cap ? *cap * 2 : 16;
        am_varid_t *p = (am_varid_t *)am_realloc(alloc, *set, new_cap * sizeof(am_varid_t));
        if (!p) return -1;
        *set = p;
        *cap = new_cap;
    }
    (*set)[(*len)++] = v;
    return 0;
}

static int32_t varid_set_contains(am_varid_t *set, size_t len, am_varid_t v) {
    for (size_t i = 0; i < len; i++) {
        if (set[i] == v) return 0;
    }
    return -1;
}


// ===============================================================================
// 操作数重写（P2）
// 说明：把可静态定位的变量访问改写成槽位寻址指令。改写条件严格保守：
//   - load / call / tailcall / store / set 的目标 varid 必须在该 λ 的帧描述符里有槽位；
//   - 自由变量（快照）只有在该 varid **全局从未被 set!/capturecc 触碰**时才直读，
//     否则保留 varid 走通用解引用（保证脏标记/写穿透语义）；
//   - call/tailcall 跳过 native 引用（它们由 op_call_async 分流到 op_callnative）。
// 不可判定的情况一律不改写：保持 varid 形态 → 走旧路径，只会慢不会错。
// ===============================================================================

static int32_t frame_collect_mutated(am_allocator_t *alloc, am_compiler_ctx_t *ctx,
                                     am_varid_t **set, size_t *len, size_t *cap) {
    for (am_iaddr_t i = 0; i < ctx->icount; i++) {
        uint32_t op = ctx->ilcode[i].opcode;
        if (op != AM_VM_OP_set && op != AM_VM_OP_capturecc) continue;
        am_value_t operand = ctx->ilcode[i].operand;
        if (!am_value_is_varid(operand)) continue;
        if (varid_set_add(alloc, set, len, cap, am_value_to_varid(operand)) != 0) return -1;
    }
    return 0;
}

// 在描述符中查找 varid 对应的槽位。找到返回槽号，否则返回 SIZE_MAX。
static size_t frame_find_slot(am_frame_desc_t *d, am_varid_t varid, int32_t type) {
    if (!d) return SIZE_MAX;
    uint32_t nslots = d->nbound + d->nfree;
    for (uint32_t s = 0; s < nslots; s++) {
        if (d->slots[s].varid != varid) continue;
        if ((d->slots[s].type & (uint32_t)type) != 0) return (size_t)s;
    }
    return SIZE_MAX;
}

static void am_frame_rewrite_operands(am_compiler_ctx_t *ctx, am_frame_table_t *table,
                                      size_t *owner, frame_region_t *regions, size_t count) {
    (void)count;
    am_allocator_t *alloc = ctx->ast->alloc;

    size_t n_load = 0, n_store = 0, n_set = 0, n_call = 0, n_tcall = 0, n_gap = 0;
    am_varid_t *mutated = NULL;
    size_t nmut = 0, cmut = 0;
    if (frame_collect_mutated(alloc, ctx, &mutated, &nmut, &cmut) != 0) {
        if (mutated) am_free(alloc, mutated);
        return;
    }

    for (am_iaddr_t i = 0; i < ctx->icount; i++) {
        if (owner[i] == SIZE_MAX) continue;
        size_t entry = regions[owner[i]].entry;
        if (entry >= table->length) continue;
        am_frame_desc_t *d = table->frames[entry];
        if (!d || (d->flags & AM_FRAME_FLAG_OPAQUE)) continue;

        uint32_t op = ctx->ilcode[i].opcode;
        am_value_t operand = ctx->ilcode[i].operand;
        if (!am_value_is_varid(operand)) continue;
        am_varid_t varid = am_value_to_varid(operand);

        switch (op) {
            case AM_VM_OP_store: {
                size_t slot = frame_find_slot(d, varid, AM_BINDING_BOUND);
                if (slot == SIZE_MAX) break;
                ctx->ilcode[i].opcode = AM_VM_OP_store_slot;
                ctx->ilcode[i].operand = am_make_value_of_uint((am_uint_t)(slot << 2));
                n_store++;
                break;
            }
            case AM_VM_OP_set: {
                size_t slot = frame_find_slot(d, varid, AM_BINDING_BOUND);
                if (slot == SIZE_MAX) break;
                ctx->ilcode[i].opcode = AM_VM_OP_set_slot;
                ctx->ilcode[i].operand = am_make_value_of_uint((am_uint_t)(slot << 2));
                n_set++;
                break;
            }
            case AM_VM_OP_load:
            case AM_VM_OP_call:
            case AM_VM_OP_tailcall: {
                if (op != AM_VM_OP_load && am_ast_check_native_ref(ctx->ast, varid) == 0) break;

                size_t slot = frame_find_slot(d, varid, AM_BINDING_BOUND);
                uint32_t flags = 0;
                if (slot == SIZE_MAX) {
                    slot = frame_find_slot(d, varid, AM_BINDING_FREE);
                    if (slot == SIZE_MAX) { n_gap++; break; }   // 分析缺口：保留 varid 走通用路径
                    if (varid_set_contains(mutated, nmut, varid) == 0) break; // 可变：保留通用路径
                    flags = 1; // 自由变量快照
                }
                am_uint_t enc = (am_uint_t)((slot << 2) | flags);
                ctx->ilcode[i].opcode = (op == AM_VM_OP_load)    ? AM_VM_OP_load_slot
                                      : (op == AM_VM_OP_call)    ? AM_VM_OP_call_slot
                                                                 : AM_VM_OP_tailcall_slot;
                ctx->ilcode[i].operand = am_make_value_of_uint(enc);
                if (op == AM_VM_OP_load) n_load++;
                else if (op == AM_VM_OP_call) n_call++;
                else n_tcall++;
                break;
            }
            default:
                break;
        }
    }

    if (mutated) am_free(alloc, mutated);

    const char *tr = getenv("AM_FRAME_TRACE");
    if (tr && tr[0] == '1') {
        printf("[frame-rewrite] load_slot=%zu store_slot=%zu set_slot=%zu call_slot=%zu "
               "tailcall_slot=%zu mutated_varids=%zu analysis_gaps=%zu\n",
               n_load, n_store, n_set, n_call, n_tcall, nmut, n_gap);
    }
}

// ===============================================================================
// 编译期分析
// ===============================================================================

// 从 ilcode 的 owner 数组中找出 λ 区间；同时计算可变变量集合。
// owner[i] = 该指令所属区间的下标（SIZE_MAX 表示不属于任何 λ，如入口存根）。

// 词法父子关系：从 AST 节点的父链接出发，找到最近的祖先 λ。
// 说明：编译器的 λ 编译是"平铺"的（每个 λ 独立成块），本身不携带嵌套信息；
//       而 parser 的 scope 对象在宏展开后会被清理（arn cleanup_scope_objects），
//       不能再作为帧分析的输入（否则 parent 恒为"无"，自由变量 src 全部退化为动态查找）。
//       AST 节点的 parent 链接在宏展开后仍然有效，且与帧分析所需的词法父子关系一致。
static int32_t frame_link_parents(am_ast_t *ast, frame_region_t *regions, size_t count) {
    if (!ast) return 0;

    for (size_t i = 0; i < count; i++) {
        if (regions[i].handle == AM_HANDLE_NULL) continue; // 临时 λ：父区间在编译期已记录

        am_value_t node_val = am_ast_get_node(ast, regions[i].handle);
        if (!am_value_is_ptr(node_val)) continue;
        am_object_t *obj = am_value_to_ptr(node_val);
        if (obj->type != AM_OBJECT_TYPE_LIST) continue;

        am_handle_t parent_lambda = am_ast_find_nearest_lambda_handle(ast, ((am_list_t *)obj)->parent);
        if (parent_lambda == AM_HANDLE_NULL || parent_lambda == regions[i].handle) continue;

        // 由把柄找到对应区间
        for (size_t j = 0; j < count; j++) {
            if (regions[j].handle == parent_lambda) {
                regions[i].parent = j;
                break;
            }
        }
    }
    return 0;
}

// 计算区间深度（用于"父先子后"的处理顺序）
static size_t frame_region_depth(frame_region_t *regions, size_t count, size_t idx) {
    size_t d = 0;
    size_t cur = idx;
    while (regions[cur].parent != SIZE_MAX && d <= count) {
        cur = regions[cur].parent;
        d++;
    }
    return d;
}

// 在给定区间内按 ilcode 收集 BOUND / REF 集合
static int32_t frame_collect_sets(am_allocator_t *alloc, am_compiler_ctx_t *ctx,
                                  frame_region_t *rgn, size_t *owner, size_t owner_of_tag) {
    for (am_iaddr_t i = 0; i < ctx->icount; i++) {
        if (owner[i] != owner_of_tag) continue;
        uint32_t op = ctx->ilcode[i].opcode;
        am_value_t operand = ctx->ilcode[i].operand;

        switch (op) {
            case AM_VM_OP_store:
            case AM_VM_OP_capturecc:
                if (am_value_is_varid(operand) &&
                    varid_set_add(alloc, &rgn->bound, &rgn->nbound, &rgn->cbound,
                                  am_value_to_varid(operand)) != 0) return -1;
                break;
            case AM_VM_OP_load:
            case AM_VM_OP_call:
            case AM_VM_OP_tailcall:
            case AM_VM_OP_set:
                if (am_value_is_varid(operand) &&
                    varid_set_add(alloc, &rgn->ref, &rgn->nref, &rgn->cref,
                                  am_value_to_varid(operand)) != 0) return -1;
                break;
            default:
                break;
        }
    }
    (void)owner;
    return 0;
}

am_frame_table_t *am_frame_analysis(am_compiler_ctx_t *ctx) {
    if (!ctx || !ctx->ilcode || ctx->icount == 0) return NULL;
    if (!ctx->lambda_regions || ctx->lambda_region_count == 0) return NULL;

    am_allocator_t *alloc = ctx->ast->alloc;
    size_t count = ctx->lambda_region_count;
    frame_region_t *regions = (frame_region_t *)am_calloc(alloc, count * sizeof(frame_region_t));
    if (!regions) return NULL;

    size_t *owner = (size_t *)am_malloc(alloc, (size_t)ctx->icount * sizeof(size_t));
    if (!owner) {
        am_free(alloc, regions);
        return NULL;
    }
    for (am_iaddr_t i = 0; i < ctx->icount; i++) owner[i] = SIZE_MAX;

    am_frame_table_t *table = NULL;
    size_t *order = NULL;
    size_t *slot_of = NULL;

    for (size_t i = 0; i < count; i++) {
        regions[i].entry = ctx->lambda_regions[i].entry;
        regions[i].end = ctx->lambda_regions[i].end;
        regions[i].parent = ctx->lambda_regions[i].parent;
        regions[i].handle = ctx->lambda_regions[i].handle;
        regions[i].nparam = ctx->lambda_regions[i].nparam;
        regions[i].flags = ctx->lambda_regions[i].flags;
    }

    // 1. 词法父子关系（临时 λ 的父子关系已在编译期记录）
    if (frame_link_parents(ctx->ast, regions, count) != 0) goto done;

    // 2. owner：区间可能嵌套（临时 λ 内嵌于所属 λ），按 entry 降序填充使内层优先
    order = (size_t *)am_malloc(alloc, count * sizeof(size_t));
    if (!order) goto done;
    for (size_t i = 0; i < count; i++) order[i] = i;
    // 插入排序（按 entry 降序；λ 数量小）
    for (size_t i = 1; i < count; i++) {
        size_t key = order[i];
        size_t j = i;
        while (j > 0 && regions[order[j - 1]].entry < regions[key].entry) {
            order[j] = order[j - 1];
            j--;
        }
        order[j] = key;
    }
    for (size_t k = 0; k < count; k++) {
        size_t r = order[k];
        am_iaddr_t begin = regions[r].entry;
        am_iaddr_t end = regions[r].end;
        if (end > ctx->icount) end = ctx->icount;
        for (am_iaddr_t i = begin; i < end; i++) {
            if (owner[i] == SIZE_MAX) owner[i] = r;
        }
    }

    // 调试：打印区间划分与指令归属
    {
        const char *tr = getenv("AM_FRAME_TRACE");
        if (tr && tr[0] == '1') {
            for (size_t r = 0; r < count; r++) {
                printf("[frame-trace] region %zu entry=%zu end=%zu nparam=%u parent=%zu flags=%u\n",
                       r, (size_t)regions[r].entry, (size_t)regions[r].end,
                       regions[r].nparam, regions[r].parent, regions[r].flags);
            }
            for (am_iaddr_t i = 0; i < ctx->icount; i++) {
                if (owner[i] == SIZE_MAX) continue;
                am_value_t op = ctx->ilcode[i].operand;
                printf("[frame-trace] i=%zu owner_entry=%zu op=%u operand=%s%zu\n",
                       (size_t)i, (size_t)regions[owner[i]].entry,
                       ctx->ilcode[i].opcode,
                       am_value_is_varid(op) ? "varid:" : (am_value_is_iaddr(op) ? "iaddr:" : "other:"),
                       am_value_is_varid(op) ? (size_t)am_value_to_varid(op)
                                             : (am_value_is_iaddr(op) ? (size_t)am_value_to_iaddr(op) : 0));
            }
        }
    }

    // 3. 逐区间收集 BOUND / REF
    for (size_t r = 0; r < count; r++) {
        if (frame_collect_sets(alloc, ctx, &regions[r], owner, r) != 0) goto done;
    }

    // 4. FV 传递闭包：按深度降序（子先父后）计算
    //    FV(λ) = (REF(λ) \ BOUND(λ)) ∪ (⋃ 子 λ FV \ BOUND(λ))
    {
        size_t *by_depth = (size_t *)am_malloc(alloc, count * sizeof(size_t));
        if (!by_depth) goto done;
        for (size_t i = 0; i < count; i++) by_depth[i] = i;
        // 稳定排序：深度降序
        for (size_t i = 1; i < count; i++) {
            size_t key = by_depth[i];
            size_t dk = frame_region_depth(regions, count, key);
            size_t j = i;
            while (j > 0 && frame_region_depth(regions, count, by_depth[j - 1]) < dk) {
                by_depth[j] = by_depth[j - 1];
                j--;
            }
            by_depth[j] = key;
        }

        for (size_t k = 0; k < count; k++) {
            size_t r = by_depth[k];
            // 4.1 先放入 REF \ BOUND
            for (size_t i = 0; i < regions[r].nref; i++) {
                am_varid_t v = regions[r].ref[i];
                if (varid_set_contains(regions[r].bound, regions[r].nbound, v) == 0) continue;
                if (varid_set_add(alloc, &regions[r].fv, &regions[r].nfv, &regions[r].cfv, v) != 0) {
                    am_free(alloc, by_depth);
                    goto done;
                }
            }
            // 4.2 再把子 λ 的 FV 上提（已被本 λ 绑定的除外）
            for (size_t c = 0; c < count; c++) {
                if (regions[c].parent != r) continue;
                for (size_t i = 0; i < regions[c].nfv; i++) {
                    am_varid_t v = regions[c].fv[i];
                    if (varid_set_contains(regions[r].bound, regions[r].nbound, v) == 0) continue;
                    if (varid_set_add(alloc, &regions[r].fv, &regions[r].nfv, &regions[r].cfv, v) != 0) {
                        am_free(alloc, by_depth);
                        goto done;
                    }
                }
            }
        }
        am_free(alloc, by_depth);
    }

    // 5. 分配槽位并解析 src（按深度升序：父先子后，保证父帧槽位已就绪）
    {
        size_t *by_depth = (size_t *)am_malloc(alloc, count * sizeof(size_t));
        if (!by_depth) goto done;
        for (size_t i = 0; i < count; i++) by_depth[i] = i;
        for (size_t i = 1; i < count; i++) {
            size_t key = by_depth[i];
            size_t dk = frame_region_depth(regions, count, key);
            size_t j = i;
            while (j > 0 && frame_region_depth(regions, count, by_depth[j - 1]) > dk) {
                by_depth[j] = by_depth[j - 1];
                j--;
            }
            by_depth[j] = key;
        }

        for (size_t k = 0; k < count; k++) {
            size_t r = by_depth[k];
            size_t nslots = regions[r].nbound + regions[r].nfv;
            size_t total = sizeof(am_frame_desc_t) + nslots * sizeof(am_frame_slot_t);
            am_frame_desc_t *d = (am_frame_desc_t *)am_malloc(alloc, total);
            if (!d) {
                am_free(alloc, by_depth);
                goto done;
            }
            memset(d, 0, total);
            d->entry_iaddr = regions[r].entry;
            d->nparam = regions[r].nparam;
            d->nbound = (uint32_t)regions[r].nbound;
            d->nfree = (uint32_t)regions[r].nfv;
            d->flags = regions[r].flags;

            // 约束变量槽
            for (size_t i = 0; i < regions[r].nbound; i++) {
                d->slots[i].varid = regions[r].bound[i];
                d->slots[i].type = AM_BINDING_BOUND;
                d->slots[i].src = AM_FRAME_SRC_NONE;
            }
            // 自由变量槽：src = 父帧中的槽号
            size_t base = regions[r].nbound;
            for (size_t i = 0; i < regions[r].nfv; i++) {
                am_varid_t v = regions[r].fv[i];
                d->slots[base + i].varid = v;
                d->slots[base + i].type = AM_BINDING_FREE;
                d->slots[base + i].src = AM_FRAME_SRC_NONE;

                size_t p = regions[r].parent;
                if (p == SIZE_MAX || !regions[p].desc) continue;
                am_frame_desc_t *pd = regions[p].desc;
                for (uint32_t s = 0; s < pd->nbound + pd->nfree; s++) {
                    if (pd->slots[s].varid == v) {
                        d->slots[base + i].src = s;
                        break;
                    }
                }
            }
            regions[r].desc = d;
        }
        am_free(alloc, by_depth);
    }

    // 6. 汇总成按 iaddr 索引的帧表
    {
        table = (am_frame_table_t *)am_calloc(alloc, sizeof(am_frame_table_t));
        if (!table) goto done;
        table->length = (size_t)ctx->icount;
        table->frames = (am_frame_desc_t **)am_calloc(alloc, table->length * sizeof(am_frame_desc_t *));
        if (!table->frames) {
            am_free(alloc, table);
            table = NULL;
            goto done;
        }
        for (size_t r = 0; r < count; r++) {
            if (!regions[r].desc) continue;
            if (regions[r].entry >= table->length) continue;
            table->frames[regions[r].entry] = regions[r].desc;
            regions[r].desc = NULL; // 所有权移交给帧表
        }
    }

    // 7. 操作数重写：把可静态定位的变量访问改写成槽位寻址指令
    if (table) am_frame_rewrite_operands(ctx, table, owner, regions, count);

done:
    for (size_t i = 0; i < count; i++) {
        if (regions[i].bound) am_free(alloc, regions[i].bound);
        if (regions[i].ref) am_free(alloc, regions[i].ref);
        if (regions[i].fv) am_free(alloc, regions[i].fv);
        if (regions[i].desc) am_free(alloc, regions[i].desc);
    }
    if (order) am_free(alloc, order);
    if (slot_of) am_free(alloc, slot_of);
    am_free(alloc, owner);
    am_free(alloc, regions);
    return table;
}


// ===============================================================================
// 销毁 / 拷贝
// ===============================================================================

void am_frame_table_destroy(am_allocator_t *alloc, am_frame_table_t *table) {
    if (!table) return;
    if (table->frames) {
        for (size_t i = 0; i < table->length; i++) {
            if (table->frames[i]) am_free(alloc, table->frames[i]);
        }
        am_free(alloc, table->frames);
    }
    am_free(alloc, table);
}

am_frame_table_t *am_frame_table_copy(am_allocator_t *alloc, am_frame_table_t *table) {
    if (!table || !table->frames) return NULL;

    am_frame_table_t *copy = (am_frame_table_t *)am_calloc(alloc, sizeof(am_frame_table_t));
    if (!copy) return NULL;
    copy->length = table->length;
    copy->frames = (am_frame_desc_t **)am_calloc(alloc, copy->length * sizeof(am_frame_desc_t *));
    if (!copy->frames) {
        am_free(alloc, copy);
        return NULL;
    }
    for (size_t i = 0; i < table->length; i++) {
        am_frame_desc_t *src = table->frames[i];
        if (!src) continue;
        size_t total = sizeof(am_frame_desc_t) +
                       (size_t)(src->nbound + src->nfree) * sizeof(am_frame_slot_t);
        am_frame_desc_t *d = (am_frame_desc_t *)am_malloc(alloc, total);
        if (!d) {
            am_frame_table_destroy(alloc, copy);
            return NULL;
        }
        memcpy(d, src, total);
        copy->frames[i] = d;
    }
    return copy;
}


am_frame_table_t *am_frame_table_shift(am_allocator_t *alloc, am_frame_table_t *table, size_t offset) {
    if (!table || offset == 0) return table;

    am_frame_table_t *shifted = (am_frame_table_t *)am_calloc(alloc, sizeof(am_frame_table_t));
    if (!shifted) return NULL;
    shifted->length = table->length + offset;
    shifted->frames = (am_frame_desc_t **)am_calloc(alloc, shifted->length * sizeof(am_frame_desc_t *));
    if (!shifted->frames) {
        am_free(alloc, shifted);
        return NULL;
    }
    for (size_t i = 0; i < table->length; i++) {
        am_frame_desc_t *d = table->frames[i];
        if (!d) continue;
        d->entry_iaddr += (am_iaddr_t)offset;
        shifted->frames[i + offset] = d;
    }
    am_free(alloc, table->frames);
    am_free(alloc, table);
    return shifted;
}

int32_t am_frame_table_merge(am_allocator_t *alloc, am_frame_table_t **pdst,
                             am_frame_table_t *src, size_t new_length) {
    if (!pdst) return -1;
    if (!src || !src->frames) {
        // 没有新描述符：仅确保 dst 长度足够（不足则扩容，内容为 NULL）
        if (*pdst && (*pdst)->length >= new_length) return 0;
    }

    am_frame_table_t *dst = *pdst;
    if (!dst) {
        dst = (am_frame_table_t *)am_calloc(alloc, sizeof(am_frame_table_t));
        if (!dst) return -1;
        dst->length = new_length;
        dst->frames = (am_frame_desc_t **)am_calloc(alloc, (new_length ? new_length : 1) * sizeof(am_frame_desc_t *));
        if (!dst->frames) { am_free(alloc, dst); return -1; }
        *pdst = dst;
        if (!src || !src->frames) return 0;
    }
    else if (dst->length < new_length) {
        size_t old = dst->length;
        am_frame_desc_t **grown = (am_frame_desc_t **)am_calloc(alloc, (new_length ? new_length : 1) * sizeof(am_frame_desc_t *));
        if (!grown) return -1;
        memcpy(grown, dst->frames, old * sizeof(am_frame_desc_t *));
        am_free(alloc, dst->frames);
        dst->frames = grown;
        dst->length = new_length;
    }

    for (size_t i = 0; i < src->length && i < dst->length; i++) {
        am_frame_desc_t *s = src->frames[i];
        if (!s) continue;
        size_t total = sizeof(am_frame_desc_t) + (size_t)(s->nbound + s->nfree) * sizeof(am_frame_slot_t);
        am_frame_desc_t *d = (am_frame_desc_t *)am_malloc(alloc, total);
        if (!d) return -1;
        memcpy(d, s, total);
        if (dst->frames[i]) am_free(alloc, dst->frames[i]); // 覆盖同一入口的旧描述符
        dst->frames[i] = d;
    }
    return 0;
}

// ===============================================================================
// 序列化
// ===============================================================================

// 格式：[uvarint 描述符个数]
//       每项：[uvarint entry][uvarint nparam][uvarint nbound][uvarint nfree][uvarint flags]
//             随后 (nbound+nfree) 项 [uvarint varid][u8 type][uvarint src]
size_t am_frame_table_dump_size(am_frame_table_t *table) {
    return am_frame_table_dump(NULL, table, NULL, 0);
}

size_t am_frame_table_dump(am_allocator_t *alloc, am_frame_table_t *table, uint8_t *buffer, size_t offset) {
    (void)alloc;
    size_t pos = offset;

    size_t count = 0;
    if (table && table->frames) {
        for (size_t i = 0; i < table->length; i++) {
            if (table->frames[i]) count++;
        }
    }

    pos += am_disk_write_uvarint(buffer, pos, (uint64_t)count);
    if (count == 0) return pos - offset;

    for (size_t i = 0; i < table->length; i++) {
        am_frame_desc_t *d = table->frames[i];
        if (!d) continue;
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->entry_iaddr);
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->nparam);
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->nbound);
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->nfree);
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->flags);

        uint32_t nslots = d->nbound + d->nfree;
        for (uint32_t s = 0; s < nslots; s++) {
            pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->slots[s].varid);
            if (buffer != NULL && offset != SIZE_MAX) {
                buffer[pos] = (uint8_t)(d->slots[s].type & 0xFF);
            }
            pos += 1;
            pos += am_disk_write_uvarint(buffer, pos, (uint64_t)d->slots[s].src);
        }
    }
    return pos - offset;
}

am_frame_table_t *am_frame_table_load(am_allocator_t *alloc, const uint8_t *buffer, size_t offset, size_t table_length) {
    if (!alloc || !buffer) return NULL;

    size_t pos = offset;
    uint64_t count = 0;
    size_t n = am_disk_read_uvarint(buffer, pos, &count);
    if (!n) return NULL;
    pos += n;

    am_frame_table_t *table = (am_frame_table_t *)am_calloc(alloc, sizeof(am_frame_table_t));
    if (!table) return NULL;
    table->length = table_length;
    table->frames = (am_frame_desc_t **)am_calloc(alloc, (table_length ? table_length : 1) * sizeof(am_frame_desc_t *));
    if (!table->frames) {
        am_free(alloc, table);
        return NULL;
    }

    for (uint64_t k = 0; k < count; k++) {
        uint64_t entry = 0, nparam = 0, nbound = 0, nfree = 0, flags = 0;
        if (!(n = am_disk_read_uvarint(buffer, pos, &entry))) goto fail;
        pos += n;
        if (!(n = am_disk_read_uvarint(buffer, pos, &nparam))) goto fail;
        pos += n;
        if (!(n = am_disk_read_uvarint(buffer, pos, &nbound))) goto fail;
        pos += n;
        if (!(n = am_disk_read_uvarint(buffer, pos, &nfree))) goto fail;
        pos += n;
        if (!(n = am_disk_read_uvarint(buffer, pos, &flags))) goto fail;
        pos += n;

        if (entry >= table_length) goto fail;
        size_t nslots = (size_t)nbound + (size_t)nfree;
        size_t total = sizeof(am_frame_desc_t) + nslots * sizeof(am_frame_slot_t);
        am_frame_desc_t *d = (am_frame_desc_t *)am_malloc(alloc, total);
        if (!d) goto fail;
        memset(d, 0, total);
        d->entry_iaddr = (am_iaddr_t)entry;
        d->nparam = (uint32_t)nparam;
        d->nbound = (uint32_t)nbound;
        d->nfree = (uint32_t)nfree;
        d->flags = (uint32_t)flags;

        for (size_t s = 0; s < nslots; s++) {
            uint64_t varid = 0, src = 0;
            if (!(n = am_disk_read_uvarint(buffer, pos, &varid))) { am_free(alloc, d); goto fail; }
            pos += n;
            uint32_t type = (uint32_t)buffer[pos];
            pos += 1;
            if (!(n = am_disk_read_uvarint(buffer, pos, &src))) { am_free(alloc, d); goto fail; }
            pos += n;
            d->slots[s].varid = (am_varid_t)varid;
            d->slots[s].type = type;
            d->slots[s].src = (uint32_t)src;
        }
        table->frames[entry] = d;
    }
    return table;

fail:
    am_frame_table_destroy(alloc, table);
    return NULL;
}


// ===============================================================================
// 调试
// ===============================================================================

void am_frame_table_print(am_frame_table_t *table) {
    if (!table || !table->frames) {
        printf("[frame] (empty table)\n");
        return;
    }
    size_t count = 0;
    size_t max_slots = 0;
    size_t total_slots = 0;
    for (size_t i = 0; i < table->length; i++) {
        am_frame_desc_t *d = table->frames[i];
        if (!d) continue;
        count++;
        size_t nslots = (size_t)d->nbound + d->nfree;
        total_slots += nslots;
        if (nslots > max_slots) max_slots = nslots;
        printf("[frame] iaddr=%zu nparam=%u nbound=%u nfree=%u flags=%u\n",
               (size_t)d->entry_iaddr, d->nparam, d->nbound, d->nfree, d->flags);
    }
    printf("[frame] frames=%zu total_slots=%zu max_slots=%zu avg=%.1f\n",
           count, total_slots, max_slots,
           count ? (double)total_slots / (double)count : 0.0);
}