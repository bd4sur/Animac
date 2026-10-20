#ifndef __AM_FRAME_H__
#define __AM_FRAME_H__

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "am_object.h"
#include "am_allocator.h"
#include "am_closure.h"

#ifdef __cplusplus
extern "C" {
#endif

///////////////////////////////////////////
// 闭包帧描述符（编译期产物）
// 说明：一个有 λ 的帧由哪些槽位组成、每个自由变量从父帧的哪一槽取。
//       它把"变量在闭包中的位置"从运行期的线性查找，前移为编译期的静态布局。
///////////////////////////////////////////

// 描述符标志
#define AM_FRAME_FLAG_OPAQUE (0x01) // 含无法静态封闭的引用，创建时退化为"复制全部绑定"
#define AM_FRAME_FLAG_TEMP   (0x02) // η 变换等编译期合成的临时 λ
#define AM_FRAME_FLAG_TOP    (0x04) // 顶层 thunk

// 自由变量的来源槽号：无来源（顶层 λ 的未绑定引用）
#define AM_FRAME_SRC_NONE (0xFFFFFFFFu)

// 槽位
typedef struct am_frame_slot_t {
    am_varid_t varid; // 槽位对应的变量
    uint32_t   type;  // AM_BINDING_BOUND / AM_BINDING_FREE
    uint32_t   src;   // FREE：在词法父帧中的槽号；BOUND：AM_FRAME_SRC_NONE
} am_frame_slot_t;

// 描述符：slots[0..nbound-1] 为约束变量槽，slots[nbound..nbound+nfree-1] 为自由变量槽
typedef struct am_frame_desc_t {
    am_iaddr_t entry_iaddr; // λ 入口（= 闭包对象的 iaddr 字段）
    uint32_t   nparam;      // 引数个数
    uint32_t   nbound;      // 约束变量槽数
    uint32_t   nfree;       // 自由变量槽数
    uint32_t   flags;
    am_frame_slot_t slots[];
} am_frame_desc_t;

// 帧表：按 iaddr 索引的稀疏数组，frames[i] != NULL 表示指令 i 是某个 λ 的入口
typedef struct am_frame_table_t {
    am_frame_desc_t **frames;
    size_t length; // == ilcode 长度（含 wind 跳板）
} am_frame_table_t;


// 编译期记录的 λ 代码区间（帧分析的输入）
typedef struct am_lambda_region_t {
    am_iaddr_t  entry;  // 入口 iaddr（= 闭包 iaddr）
    am_iaddr_t  end;    // 区间终点（不含）
    size_t      parent; // 父区间下标；SIZE_MAX = 无父
    am_handle_t handle; // λ 的 AST 节点把柄；编译期合成的临时 λ 为 AM_HANDLE_NULL
    uint32_t    nparam; // 引数个数
    uint32_t    flags;  // AM_FRAME_FLAG_TEMP / AM_FRAME_FLAG_TOP
} am_lambda_region_t;


///////////////////////////////////////////
// 编译期分析
///////////////////////////////////////////

// 说明：编译期分析入口 am_frame_analysis 需要编译器上下文，声明见 am_compiler.h
//       （避免本头文件反向依赖编译器头文件造成循环包含）。

// 功能说明：销毁帧表。
void am_frame_table_destroy(am_allocator_t *alloc, am_frame_table_t *table);

// 功能说明：深拷贝帧表。
am_frame_table_t *am_frame_table_copy(am_allocator_t *alloc, am_frame_table_t *table);

// 功能说明：把帧表整体右移 offset（用于 System.eval 在运行期追加 ilcode 的场景）。
// 说明：描述符的 entry 与数组下标都是"模块内相对 iaddr"，而 ilcode 里的 lambda 地址
//       已按 offset 重定位，因此追加代码时必须同步右移，二者才能对齐。
//       成功返回新的帧表（旧表已释放），失败返回 NULL。
am_frame_table_t *am_frame_table_shift(am_allocator_t *alloc, am_frame_table_t *table, size_t offset);

// 功能说明：把 src 帧表合并进 *pdst（dst 长度至少为 new_length，按需扩容）。
// 说明：用于 System.eval 追加代码后，把新代码的描述符并入进程帧表。
int32_t am_frame_table_merge(am_allocator_t *alloc, am_frame_table_t **pdst,
                             am_frame_table_t *src, size_t new_length);

// 功能说明：按 iaddr 查描述符。未找到返回 NULL。
static inline am_frame_desc_t *am_frame_lookup(am_frame_table_t *table, am_iaddr_t iaddr) {
    if (!table || !table->frames || iaddr >= table->length) return NULL;
    return table->frames[iaddr];
}


///////////////////////////////////////////
// 序列化（模块持久化用）
///////////////////////////////////////////

// 返回转储所需字节数；失败返回 SIZE_MAX。
size_t am_frame_table_dump_size(am_frame_table_t *table);

// 转储到 buffer[offset]，返回新增字节数；buffer 为 NULL 时仅计算大小。
size_t am_frame_table_dump(am_allocator_t *alloc, am_frame_table_t *table, uint8_t *buffer, size_t offset);

// 从 buffer[offset] 加载帧表，table_length 为 ilcode 长度。
am_frame_table_t *am_frame_table_load(am_allocator_t *alloc, const uint8_t *buffer, size_t offset, size_t table_length);


///////////////////////////////////////////
// 调试
///////////////////////////////////////////

// 将帧表摘要打印到 stdout（调试用）。
void am_frame_table_print(am_frame_table_t *table);


#ifdef __cplusplus
}
#endif

#endif