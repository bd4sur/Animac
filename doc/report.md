# Animac 技术报告汇编

> **范围说明**：本汇编基于 `doc/`、`include/`、`src/`、`test/` 目录下除 `typescript/` 以外的全部源码、文档与测试用例撰写，**不提出任何代码修改建议**，仅对当前设计与实现状态作描述性、分析性总结。全文以 `src/` 与 `include/` 的实现为准（`animac_core.c/h` 是由 `amalgamate.sh` 生成的同步产物）。
>
> **2026-07 刷新说明**：本次修订以当前 C 语言实现为基准全面刷新。原《内存管理机制技术报告》与《内存管理机制研究》两篇内容高度重叠，合并为一篇《内存管理机制技术报告》；原《宏》一篇写于宏系统实现之前、原为设计方案，现改写为《卫生宏（syntax-rules）实现技术报告》，描述已落地的实现；《进程间通信队列机制技术报告》按当前实现更新（文件名已统一加 `am_` 前缀，测试用例文件名亦已变更）。
>
> 报告采用项目约定前缀：`am_` 函数 / 类型，`AM_` 宏 / 常量，`AM_VALUE_*` / `AM_OBJECT_*` 枚举。

---
---

# 篇一　内存管理机制技术报告

## 一、摘要

Animac 是一个用 C 语言实现的 Scheme 解释器与虚拟机。其内存管理采用“统一内存池 + 双区分配器 + handle 间接寻址 + 标记-清除/标记-压缩 GC”的整体架构：

- **统一内存池**：编译期与运行期共享一整块预先申请的内存（桌面命令行解释器默认 256 MiB、交互式环境默认 16 MiB），内部用一条可动态调整的边界划分为低地址 **heap 区** 与高地址 **VM 工作区**。池的底层内存、控制块与压缩暂存区全部经由宿主注入的 `am_allocator_host_vtable_t` 虚表分配（依赖倒置）。
- **双区分配器**：heap 区使用 first-fit 空闲链表 + 边界标签，服务运行期长生命周期对象，受 GC 管理；VM 区使用 segregated free-list + 边界标签，满足编译期大量小对象、频繁扩容、释放的需求，同时承载运行期的容器元数据与内部设施。
- **handle 抽象堆**：所有运行时对象通过 `am_handle_t` 引用，`am_heap_t` 维护 handle → 物理指针的映射，使 GC 压缩时可以移动对象而不破坏外部引用。
- **GC**：统一由 `gc` 模块（`include/am_gc.h`、`src/am_gc.c`）实现，对外仅 3 个函数——`am_gc_process`（分进程标记-清除）、`am_gc_compact`（全局标记-压缩）、`am_gc_collect`（对进程池的一轮编排，由运行时事件处理器在每轮事件循环后调用）。
- **生命周期切换**：编译完成后模块被转储（dump）为平台无关的二进制格式，随后 VM 区被整体重置，运行时再从缓冲区加载模块到 heap 区执行；REPL 则采用“重放式”会话管理（见 §10.2）。

---

## 二、值与对象的统一表示：TPV 与对象头

### 2.1 TPV（Tagged Pointer Value）

`am_value_t` 定义为 `uintptr_t`，**低 5 位为类型标签**：最低位 0 表示指针、1 表示立即数，其余 4 位进一步区分类型（`include/am_object.h:94-110`）：

| 标签宏 | 值 | 语义 |
|---|---|---|
| `AM_VALUE_TAG_PTR` | `0x00` | 指针，指向对象 |
| `AM_VALUE_TAG_HANDLE` | `0x03` | 堆对象把柄 |
| `AM_VALUE_TAG_IADDR` | `0x05` | 指令地址 |
| `AM_VALUE_TAG_VARID` | `0x07` | 变量 ID |
| `AM_VALUE_TAG_LABEL` | `0x09` | 编译期标签 |
| `AM_VALUE_TAG_BOOLEAN` | `0x0B` | 布尔 |
| `AM_VALUE_TAG_NULL` / `UNDEFINED` | `0x0D` / `0x0F` | 单例立即数 |
| `AM_VALUE_TAG_SYMBOL` | `0x11` | 符号 / 关键字 |
| `AM_VALUE_TAG_WCHAR` | `0x13` | 宽字符（字符串元素） |
| `AM_VALUE_TAG_UINT` / `INT` / `FLOAT` | `0x15` / `0x17` / `0x19` | 数值 |

- 立即数通过 `AM_MAKE_VALUE_OF_UINT_LIKE(x, tag)` 左移 5 位后或上标签得到；相应的类型枚举 `AM_VALUE_TYPE_*`（0x00~0x0C）用于磁盘编码的类型标签（见 §2.3）。
- 浮点打包时**丢弃低 5 位尾数**（保留符号位与指数位），解包时左移 5 位补 0 恢复 IEEE-754 位模式——存在精度损失，是为统一值表示作出的折中。
- 特殊单例：`AM_VALUE_NULL`、`AM_VALUE_UNDEFINED`、`AM_VALUE_TRUE`、`AM_VALUE_FALSE`，以及 28 个关键字符号单例 `AM_VALUE_KW_*`。
- 空把柄为 `AM_HANDLE_NULL = (am_handle_t)(UINTPTR_MAX >> 5)`。注意区分 `AM_VALUE_HANDLE_NULL`（载荷为 `UINTPTR_MAX` 的 TPV 值）：它不是通用空把柄，而是 natives 记录中的占位哨兵（`include/am_ast.h:97` 的注释明确警告不要混淆二者）。

### 2.2 对象基类头

所有堆对象共享 16 字节基类头（`include/am_object.h:286-291`）：

```c
typedef struct am_object_t {
    uint32_t header;  // bit0: static；bit1: keep-alive
    uint32_t hash;
    uint32_t gcmark;  // bit31: alive（GC 标记）
    int32_t  type;    // AM_OBJECT_TYPE_*（0x00 BASE ~ 0x0F STRINDEX）
} am_object_t;
```

三个标志位的掩码定义于 `src/am_object.c:9-11`：

```c
#define AM_OBJECT_STATIC_MASK    0x00000001u   // header 最低位
#define AM_OBJECT_KEEPALIVE_MASK 0x00000002u   // header 次低位
#define AM_OBJECT_ALIVE_MASK     0x80000000u   // gcmark 最高位
```

| 标志 | 作用 |
|---|---|
| `static` | 永生对象，GC sweep 阶段永不清理。用于链接后的 AST 节点、进程加载后的初始堆对象。 |
| `keepalive` | 人为保持存活的对象（如异步定时器回调闭包），sweep 阶段跳过并重置 alive；GC 根收集时会被补入根集合。 |
| `alive` | GC mark 阶段的存活标记，sweep 后重置，供下一轮重新标记。 |

函数语义遵循项目统一约定：check/set 函数**以 0 表示“是 / 设置”，-1 表示“否 / 清除”**。

### 2.3 磁盘编码（dvalue）与序列化原语

模块及各数据结构的 dump/load 采用**平台无关的固定宽度磁盘格式**（2026-07 起），可在 32 位与 64 位宿主之间互导。序列化原语已全部融入 `include/am_object.h`（全部 `static inline`，无独立 diskio 模块）：

- 定长整数一律**小端**按字节显式读写（u16/u32/u64）；
- 计数、索引、把柄等小值整数用 **ULEB128** 变长编码（uvarint）；有符号整数用 **zigzag + ULEB128**（svarint）；浮点统一为 **IEEE-754 double** 的 8 字节小端位模式；
- 对象基类头定宽 16 字节（`AM_DISK_BASE_SIZE`）；
- **TPV 磁盘编码 dvalue = 1 字节类型标签（`AM_VALUE_TYPE_*`）+ 变长负载**：NULL/UNDEFINED 无负载；HANDLE/IADDR/VARID/LABEL/BOOLEAN/SYMBOL/WCHAR/UINT 为 uvarint（运行时值右移 5 位）；INT 为 svarint；FLOAT 固定 8 字节；PTR 仅用于堆转储中的对象相对偏移量（必须保持偶数）；
- 磁盘上绝不出现 `size_t`、原生指针、运行时结构体内存快照、系统 `wchar_t`；字符串一律以 Unicode 码点（uvarint）序列存储；
- 所有写函数允许 `buffer == NULL`，此时仅计算字节数（供“先算大小再写入”的两遍法使用）；读端含值域校验，32 位宿主加载越界值会失败。

---

## 三、统一内存池与双区分配器

### 3.1 抽象分配器接口

`am_allocator_t` 是“虚表 + 状态”的分配器句柄（`include/am_allocator.h:20-32`）：

```c
typedef struct am_allocator_vtable_t {
    void* (*malloc)(void *state, size_t size);
    void* (*calloc)(void *state, size_t size);
    void* (*realloc)(void *state, void *ptr, size_t size);
    void  (*free)(void *state, void *ptr);
    void  (*destroy)(void *state);
} am_allocator_vtable_t;
```

所有上层容器（list / map / vocab / heap / closure 等）都通过 `am_malloc` / `am_calloc` / `am_realloc` / `am_free` 与具体分配策略解耦。分配器返回的指针要求 2 字节对齐（TPV 标签需要）。

### 3.2 宿主虚表与内存池结构

内存池**不直接依赖宿主系统的 malloc 系列**（依赖倒置）：宿主在调用 `am_allocator_pool_create` 时通过 `am_allocator_host_vtable_t`（`include/am_allocator.h:68-73`）注入 `host_malloc` / `host_calloc` / `host_realloc` / `host_free` 四个实现（均为必需，任一为 NULL 则创建失败）。池控制块、池底层内存及堆压缩的临时工作数组均经由该表分配；池仅保存指针不拷贝，宿主须保证其生命周期不短于池。桌面宿主的默认实例为 `am_host_default_vtable`（`src/am_host.c:152-156`；ESP32 版映射到 SPIRAM 的 `heap_caps_*` 系列）。

```c
struct am_allocator_pool_t {                  // src/am_allocator.c:530-542
    uint8_t *base;
    size_t   total_size;
    size_t   boundary;        // [0, boundary)=heap 区；[boundary, total)=VM 区
    const am_allocator_host_vtable_t *host_vtable;
    am_segregated_state_t vm_state;   am_allocator_t vm_alloc;
    am_freelist_state_t   heap_state; am_allocator_t heap_alloc;
};
```

- 创建时 `boundary = total_size / 2`（按指针对齐），两区各放置一个覆盖全区的大空闲块；
- 创建后登记为全局单池 `g_current_pool`（经 `am_allocator_pool_current()` 取用）；
- 低地址 `[base, base+boundary)` 为 **heap 区**，由 `freelist_vtable` 管理；高地址 `[base+boundary, base+total_size)` 为 **VM 工作区**，由 `segregated_vtable` 管理；
- 默认池大小：命令行解释器 256 MiB（`main.c:45-47` 的 `AM_ALLOCATOR_POOL_SIZE`），交互式环境 16 MiB（`main_repl.c:51-52`）。

### 3.3 VM 工作区分配器：Segregated Free-List

设计原因：编译期大量 map/list 扩容、临时缓冲区，`bump pointer` 会快速耗尽 VM 空闲空间。

- **size class**（`src/am_allocator.c:31-38`）：48 B ~ 512 B 按 16 B 递增（30 桶）；1024 B ~ 524288 B 按 2 的幂递增（10 桶）；超过 524288 B 的块进入 `large_free_head` 大块链表。
- **选块与拆分**：每个 class 内选择**地址最高**的空闲块（`vm_find_free_block`/`vm_find_large_block`），并**从块的高端拆分**、低端保留空闲（`segregated_malloc`）。这使已用块向 VM 区顶部聚集，低端留出连续空间，便于边界向 heap 方向移动（heap 扩张）。
- **合并**：释放时通过 `prev_size` 边界标签与前后空闲块双向合并（`vm_coalesce_and_insert`）。
- **`vm_lowest_used_offset`**：线性扫描返回第一个已用块相对 VM 基址的偏移，供边界调整时限制 heap 扩张的最大位置。
- `realloc`：新尺寸不超过旧 payload 时原地返回，否则 alloc-copy-free。

### 3.4 heap 区分配器：First-Fit Free-List

```c
typedef struct am_heap_block_header_t {       // src/am_allocator.c:338-344
    size_t size;       // 最低位 used
    size_t prev_size;
    struct am_heap_block_header_t *next_free;
    struct am_heap_block_header_t *prev_free;
    bool live;         // 保留字段（压缩阶段曾使用，见下）
} am_heap_block_header_t;
```

- 分配时从空闲链表头开始 first-fit，找到首个足够大的块；有剩余时**从低端拆分**（与 VM 区的高端拆分相反），余量过小时整块分配。
- 释放时按 `prev_size` 与相邻空闲块双向合并。
- 堆区分配器本身不整理碎片，碎片化由全局压缩统一解决。`live` 字段当前仅保留、压缩引擎已不再读取它（存活判定靠 `live_payloads` 数组二分查找，见 §7.4）。

### 3.5 动态边界调整

可调宏（`include/am_allocator.h:81-102`，当前值）：

```c
AM_POOL_MIN_HEAP_RATIO        0.1
AM_POOL_MIN_VM_RATIO          0.1
AM_POOL_VM_EXPAND_THRESHOLD   0.75
AM_POOL_HEAP_EXPAND_THRESHOLD 0.75
AM_POOL_VM_SLACK_THRESHOLD    0.30
AM_POOL_HEAP_SLACK_THRESHOLD  0.30
AM_POOL_BOUNDARY_ADJ_STEP     0.05
```

`am_allocator_pool_auto_adjust`（`src/am_allocator.c:863-906`）的触发条件：

- VM 使用率 > 75% 且 heap 使用率 < 30% → heap 比例减小 5%（边界让给 VM）；
- heap 使用率 > 75% 且 VM 使用率 < 30% → heap 比例增大 5%；
- 两区比例均不得小于 10%。

`am_allocator_pool_adjust_boundary` 的限制：

- heap 扩张要求 VM 区低端有足够连续空闲空间（以 `vm_lowest_used_offset` 为界），避免覆盖 VM 对象；
- VM 扩张要求当前已用 heap 字节数不超过新 boundary；
- 调整后由 `pool_reinit_heap_at` / `pool_reinit_vm_at` 按新边界重建两区的空闲块结构。

**调用方**：当前仅 `am_gc_collect` 在全局压缩成功后调用（`src/am_gc.c:656-660`，经 `am_allocator_pool_current()` 取池）；若 `AM_HEAP_COMPACT_INTERVAL` 设为 0（不自动压缩），则边界不会自动调整。

### 3.6 纯物理压缩引擎与暂存接口

`am_allocator_heap_compact`（`include/am_allocator.h:133-143`，`src/am_allocator.c:1104-1199`）是一个**不感知逻辑堆**的纯物理压缩引擎：

- 输入：按指针**升序且无重复**的 `live_payloads` 存活对象数组，以及 `am_allocator_relocate_fn(ctx, old_payload, new_payload)` 重定位回调；
- 按地址升序遍历物理块，对每个已用块用 `bsearch` 判定是否存活；存活块 `memmove` 到前移的 `dest` 游标处（升序保证 `dest <= src`，不会覆盖尚未搬移的对象）；
- **每搬移一个对象触发一次回调**（old/new 均按升序报告，原地不动的对象也回调）；逻辑堆知识（存活判定、handle 表回写）全部在上层 gc 模块；
- 尾部重建单一空闲块并更新 `used_bytes`。

`am_allocator_host_malloc/realloc/free` 暂存接口（`src/am_allocator.c:913-932`）：仅当分配器是池的 heap 分配器时，转发给池的 host 虚表，供 GC 在压缩过程中于池外暂存工作数组（避免在正在被压缩的 heap 区内部分配）。

---

## 四、抽象堆：handle 与物理地址解耦

### 4.1 核心数据结构

```c
typedef struct am_heap_t {          // include/am_heap.h:29-34
    size_t        capacity;         // 固定，不扩容
    am_map_t     *table;            // handle → am_value_t
    am_map_t     *metadata;
    am_handle_t   handle_counter;   // 单调递增
} am_heap_t;
```

- **handle 计数器是“全局 + 每实例缓存”的混合**：静态全局 `g_heap_handle_counter`（`src/am_heap.c:14`）在 `am_heap_create` 时初始化实例计数器，`am_heap_alloc_handle` 自增实例计数器并回写全局，保证同一进程内不同 AST 堆/进程堆的把柄不冲突。
- `am_heap_create` 接收两个分配器：`container_alloc` 管理堆结构本身与 table；`obj_alloc` 管理堆中对象。编译期二者通常相同（VM 分配器）；运行期 `container_alloc = vm_alloc`，`obj_alloc = heap_alloc`。
- `am_heap_set_metadata/get_metadata` 目前是空桩。

### 4.2 关键操作

| 操作 | 说明 |
|---|---|
| `am_heap_alloc_handle` | 分配新 handle，table 中插入 `AM_VALUE_NULL`；table 扩容可能改变指针。 |
| `am_heap_set` | 必须先申请 handle；经 `am_map_set_stable` 写入以保证 table 指针稳定；替换旧值时由 `obj_alloc` 释放旧指针对象。 |
| `am_heap_free_handle` | 删除 handle，并 `am_free` 其指针对象（GC sweep 的释放路径）。 |
| `am_heap_get` | 返回 handle 对应的 `am_value_t`。 |
| `am_heap_dump/load` | 浅转储：uvarint 自描述格式 `[handle_counter][table][metadata]`，capacity 由 table 重建。 |

### 4.3 深转储与加载（含不动点迭代）

`am_heap_deep_dump`（`src/am_heap.c:298-475`）将 heap 及其指向的对象序列化为自描述二进制流：

1. 收集 ptr 型有效条目（跳过 `AM_OBJECT_TYPE_SCOPE` 等编译期对象），按 handle 升序排序；
2. 构造临时 `am_heap_t`，只含要转储的条目；
3. **不动点迭代**：对象偏移量依赖 heap dump 的总字节数，而总字节数又取决于偏移量本身的变长编码长度。实现先以原始指针值估计 `heap_map_size`（其变长编码长度是偏移量编码的上界），然后循环——计算各对象偏移（偶数对齐）→ 把偏移量写回临时表 → 重新计算总大小——直到收敛（单调不增，故必收敛）；
4. 依次 dump 每个对象（仅支持 `LIST`、`WSTRING`），头部写入 `[u32 total_size][u32 heap_size]`。

`am_heap_deep_load`（`src/am_heap.c:481-551`）为逆过程：读头部，加载堆映射，逐槽按对象类型（由对象头判定，仅 LIST/WSTRING）调用对应 load 函数，再把 table 中的偏移值替换为真实指针。

这一机制被模块持久化、进程加载、`System.fork` 深拷贝共同使用。

---

## 五、基础容器对象

所有基础容器都带 `am_object_t` 头，因此既可以是解释器内部数据结构，也可以是 Scheme 层面的数据对象。

### 5.1 线性表 `am_list_t`

```c
typedef struct am_list_t {          // include/am_list.h:29-37
    am_object_t base;
    size_t      capacity;
    size_t      length;
    int32_t     type;       // DEFAULT / LAMBDA / APPLICATION / QUOTE / QUASIQUOTE / UNQUOTE
    am_handle_t parent;
    am_value_t  children[];
} am_list_t;
```

- 创建最小容量 4；`am_list_grow_if_needed` 满则 `capacity × 2`，返回新指针。
- **关键约定**：`am_list_push` / `am_list_lambda_add_parameter` / `am_list_lambda_set_bodies` 扩容后可能返回新指针，调用者必须使用新指针，并通过 `am_heap_set` 写回 heap，以维持 handle → value(ptr) → obj 映射稳定。
- `am_list_dump` 压缩 capacity 到 length。

### 5.2 哈希表 `am_map_t`

```c
typedef struct am_map_t {           // include/am_map.h:32-40
    am_object_t base;
    size_t length, capacity, mask, tombstones;
    am_map_entry_t slots[];
} am_map_t;
```

- 开放寻址 + 线性探测；capacity 恒为 2 的幂（按位与取模）；空槽 `AM_VALUE_NULL`、墓碑 `AM_VALUE_UNDEFINED`。
- `(length + tombstones + 1) × 4 > capacity × 3`（即 75% 负载）时 `am_map_set` 自动翻倍扩容并重哈希，返回新 map 指针；删除后 `tombstones × 2 > capacity` 时原地 rehash。
- `am_map_set_stable` 不扩容（满且 key 不存在时返回 -1），用于需要指针稳定的内部场景（如 `am_heap_set`）。
- `am_map_dump` 压缩为 `length` 个有效条目，丢弃墓碑和空闲槽。

### 5.3 宽字符串 `am_wstring_t` 与驻留索引 `am_strindex_t`

```c
typedef struct am_wstring_t {       // include/am_wstring.h:18-23
    am_object_t base;
    size_t     length;
    am_value_t content[];   // 每个元素是一个 am_wchar_t TPV
} am_wstring_t;
```

- 不可变字符串；内容为 Unicode 码点数组，无 UTF-16 等编码层；dump/load 仅保留实际长度。
- 驻留索引 `am_strindex_t`（多值哈希表）：key 为内容的 FNV-1a 32 位散列，开放寻址 + 线性探测，75% 负载扩容。

字符串驻留分两个层面：

- **编译期**：`am_ast_t.strindex`，字符串字面量按内容去重登记，**无长度阈值**；模块链接时随 AST 合并机械合并；
- **运行期**：`am_process_t.strindex`，进程启动时从模块 AST 的 strindex 拷贝。阈值宏 `AM_PROCESS_STRINDEX_MAX_LEN = 32`：长度 ≤ 32 的新字符串先查索引复用、未命中则登记；超阈值直接新建不驻留。GC 时 strindex 中的全部 handle 作为 GC 根（防止驻留字符串被回收后索引悬空）。

---

## 六、运行时核心对象

### 6.1 闭包 `am_obj_closure_t`

```c
typedef struct am_obj_closure_t {   // include/am_closure.h:31-39
    am_object_t base;
    am_iaddr_t   iaddr;             // 所在 call 指令地址
    am_handle_t  parent;            // 亲闭包把柄
    size_t       length;
    size_t       capacity;
    am_binding_t bindings[];
} am_obj_closure_t;

typedef struct am_binding_t {       // include/am_closure.h:23-28
    am_varid_t  varid;
    int32_t     type;               // AM_BINDING_BOUND=1 / AM_BINDING_FREE=2
    int32_t     dirty_flag;
    am_value_t  value;
} am_binding_t;
```

- 用线性柔性数组模拟 `(varid, type) → (value, dirty_flag)` 映射，线性查找（绝大多数闭包绑定数极少，线性查找常数低于哈希维护成本）。默认 capacity 16，扩容翻倍并整体重分配，返回新指针需写回 heap。
- **脏标记协议仍然存在**：
  - `init_bound_var` / `init_free_var`：不加脏标记；若绑定已存在则更新 value 并**清除**脏标记，同时清除同 varid 另一类型绑定的脏标记；
  - `set_bound_var` / `set_free_var`（仅 set 指令使用）：置 `dirty_flag = 1`，并把同 varid 的另一类型绑定也置脏且同步 value——即“变量级脏标记一致”；
  - 解引用（`am_process_dereference`，`src/am_process.c:545-582`）：先查当前闭包的约束变量；若无，沿 `parent` 闭包链上溯到定义位置——**定义位置脏 → 用定义位置的当前值；不脏 → 用当前闭包捕获的自由变量值**。
- 闭包磁盘格式：16 B 基类头 + uvarint iaddr + uvarint parent + uvarint length（capacity 压缩为 length 不落盘）+ 每项 `(uvarint varid, u8 type, u8 dirty_flag, dvalue value)`。

### 6.2 续体 `am_continuation_t`

```c
typedef struct am_continuation_t {  // include/am_continuation.h:22-34
    am_object_t base;
    size_t        length;
    size_t        fstack_offset;
    am_iaddr_t    cont_return_target;
    am_handle_t   current_closure_handle;
    am_handle_t   dynamic_wind_stack_handle;        // dynamic-wind 栈深拷贝快照
    am_handle_t   dynamic_wind_after_stack_handle;  // after 栈深拷贝快照
    am_handle_t   current_dynamic_wind_entry_handle;
    am_handle_t   current_dynamic_wind_thunk_handle;
    am_value_t    stacks[];
} am_continuation_t;
```

- `stacks[0 .. fstack_offset-1]` 为 opstack 副本，`stacks[fstack_offset .. length-1]` 为 fstack 副本（索引大的一端为栈顶）；
- **捕获时深拷贝**当前运行状态：双栈快照之外，还包括 dynamic-wind 栈（必拷贝）、after 栈（非空时拷贝）与 wind 暂存状态；
- **恢复与 wind 跳板**：进程加载时在 ilcode 末尾追加一条 `AM_VM_OP_wind` 跳板指令。恢复续体时，先按 entry 的 mark 计算当前 dw 栈与目标 dw 栈快照的最长公共前缀；两栈一致则直接恢复快照并压入返回值；否则算出退出路径上的各个 after（从内到外）与进入路径上的各个 before（从外到内）存入暂存区，置 `wind_state`（0=空闲 / 1=执行 afters / 2=执行 befores / 3=恢复续体）并跳转到 wind 跳板，由 VM 依次执行后再恢复快照；
- GC 不递归遍历 `stacks`：续体内部环境（保存的双栈与闭包）已在 GC 根收集阶段显式加入根集合（见 §7.1），避免重复遍历。

### 6.3 进程 `am_process_t`

进程是虚拟机执行单元（`include/am_process.h:51-111`），主要字段：

- 双分配器 `vm_alloc` / `heap_alloc`；`pid` / `parent_pid` / `state`（READY=1 … KILLED=7）；
- `PC`、`ilcode`、`ilcode_length`；私有抽象堆 `heap`；字符串驻留索引 `strindex`；
- 从模块继承的元数据：`var_vocab`、`symbol_vocab`、`var_type`、`natives`、`var_top`、`var_arn_mapping`；
- `current_closure_handle`；`pending_kill`；`gc_count`；
- opstack 三件套（`opstack` / `opstack_top` / `opstack_capacity`）与 fstack 三件套；
- dynamic-wind 五字段（dw 栈、after 栈、mark 计数器、暂存 entry/thunk）与 wind 跳板七字段；
- `host_context`（宿主上下文指针）。

`am_process_load_from_module`（`src/am_process.c:195-345`）流程：

1. 分配进程结构，置 READY、PC=0；
2. 复制 ilcode（多分配 1 条）并**在末尾追加 wind 跳板指令**；
3. 通过 `am_heap_deep_dump` + `am_heap_deep_load` 把 AST 节点堆从编译期分配器迁移到进程私有堆（对象落到 heap 区）；
4. 将堆中所有对象标记为 `static`（永生，防止运行期 GC 误删初始程序结构）；
5. 拷贝 strindex / 双词表 / var_type / natives / var_top / var_arn_mapping；
6. 分配 opstack（容量取 `mod->opstack_depth`，为 0 时取默认值 256）与 fstack（固定容量 **2048**）；
7. 初始化 dynamic-wind 两个列表（容量 8）、mark 计数器与 wind 跳板状态。

操作数栈在 `am_process_push_operand` 中带运行时扩容兜底（容量不足时倍增，最小 16）——这是 opstack 深度静态估计尚不准确时的权宜之计（见 `doc/memo.md` 与 §12）；fstack 无扩容，溢出即失败。

---

## 七、垃圾回收：gc 模块

GC 统一由 `gc` 模块实现（`include/am_gc.h`、`src/am_gc.c`），层级位于 process/heap 之上、runtime 之下（不依赖 runtime.h）。配置宏集中在 `am_gc.h`：`AM_ENABLE_GC = 1`；`AM_HEAP_COMPACT_INTERVAL = 1`（每轮 GC 都压缩；置 0 则不自动压缩）。

### 7.1 GC 根

`am_gc_process` 的根收集（`src/am_gc.c:108-285` 的 `gc_root`）包括：

1. 当前闭包 handle 及其绑定中的所有 handle、opstack 中的所有 handle、fstack 各帧的闭包 handle 及其绑定（统一经 `gc_root_helper` 处理）；
2. `proc->strindex` 中的全部有效 handle（驻留字符串）；
3. `dynamic_wind_stack` / `dynamic_wind_after_stack` 中的 handle；
4. wind 跳板暂存：`pending_cont_handle/value`、`current_dynamic_wind_entry/thunk`、`pending_after/before_entries`；
5. 遍历堆中所有续体对象，加入其 dynamic-wind 相关 handle，并以 `gc_root_helper` 递归处理续体保存的 opstack/fstack/当前闭包；
6. 堆中所有 `keepalive` 对象补入根集合。

### 7.2 标记阶段

从根递归遍历（`gc_mark`）：

- `LIST`：标记自身，递归标记所有 children；
- `MAP`：标记自身，递归标记 key/value 中的 handle；
- `CLOSURE`：标记自身，递归标记 `parent` 闭包与所有 handle 类型的绑定值；
- `WSTRING` / `CONTINUATION`：仅标记自身（字符串内容是立即数；续体的栈已在根收集阶段处理）。

### 7.3 清除阶段

遍历 heap 中所有对象（`gc_sweep`）：

- `static` 对象永不清理；
- `keepalive` 对象跳过，并重置 alive 标记；
- 对 `LIST / MAP / WSTRING / CLOSURE / CONTINUATION`：未标记存活 → `am_heap_free_handle` 删除 handle 并穿透释放对象；已标记 → 重置 alive 标记，供下轮重新标记。

### 7.4 全局标记-压缩

`am_gc_compact`（`src/am_gc.c:538-626`）按“引擎 + 钩子”方式组织（压缩引擎在 allocator，见 §3.6；逻辑堆知识在 gc 模块）：

1. 第一遍扫描所有传入 heap 的 table 槽位，收集 ptr 型 value 的 payload（工作数组经 `am_allocator_host_realloc` 在池外暂存）；
2. `qsort` 升序并去重；
3. 调用 `am_allocator_heap_compact`，经 `gc_on_relocate` 回调按旧地址升序记录重定位表；
4. 第二遍回写所有 heap 表中的旧指针为新指针（二分查找重定位表）。

### 7.5 运行时 GC 触发策略：堆水位为主、周期兜底为辅

`am_gc_collect`（`src/am_gc.c:633-668`）是对进程池的一轮编排：逐进程执行 `am_gc_process`，收集成功进程的 heap 指针数组；当 `force_compact` 为真或 `gc_seq % AM_HEAP_COMPACT_INTERVAL == 0`（当前为 1，即每轮）时执行 `am_gc_compact`，成功后调用 `am_allocator_pool_auto_adjust` 调整池边界。

2026-07 起，触发策略由原先的“每轮事件循环定时 GC”改为**三级触发**：

1. **L0（allocator 层，正确性兜底）**：`freelist_malloc` 分配失败时，先经 `am_allocator_pool_auto_adjust` 向 VM 区让渡边界并重试（最多 4 次）；彻底失败则置 `oom_flag`（由运行期经 `am_allocator_heap_take_oom_flag` 读取清除）并维持原报错语义。分配器层级不允许触发 GC，只能“吃掉 VM 区富余”。
2. **L1（runtime 层，主策略）**：`am_runtime_tick` 内每 `AM_GC_WATERMARK_CHECK_STRIDE`（默认 256）条指令及 tick 末尾，经 `am_gc_heap_watermark_level` 检查堆水位：级别 1（用量 ≥ `AM_GC_HEAP_HIGH_WATER_RATIO`=0.75）执行一轮标记-清除；级别 2（用量 ≥ `AM_GC_HEAP_CRITICAL_RATIO`=0.90，或碎片维度——用量 ≥ `AM_GC_HEAP_FRAG_FLOOR_RATIO`=0.30 且最大空闲块 < max(容量的 `AM_GC_HEAP_FRAG_MIN_BLOCK_RATIO`=1/32, **近期最大分配请求 largest_request**)——防止 first-fit 碎片化失败，包括列表倍增扩容产生的巨型单块分配）当轮强制压缩；发现 `oom_flag` 也强制一轮 GC 以挽救其余进程。`largest_request` 由 freelist 在每次分配时记账、压缩后清零；水位查询分两阶段，用量低于碎片下限时不遍历空闲链表，检查代价可忽略。
3. **L2（事件循环层，慢速兜底）**：`am_runtime_event_handler` 每 `AM_GC_PERIODIC_INTERVAL`（默认 32）轮事件循环执行一轮 GC，保证分配缓慢但持续产生垃圾的程序最终也能回收；置 0 可禁用（纯水位触发）。

上述配置宏集中在 `include/am_gc.h`。

---

## 八、编译、链接与模块持久化中的内存管理

### 8.1 编译期

- AST 节点、作用域、词汇表、辅助 map/list 全部使用 `ast->alloc`（VM 区分配器）；
- Parser 中 list 扩容后需 `am_heap_set` 写回 `ast->nodes`；
- 编译器的 ilcode 与深度分析工作数组使用 `am_malloc` / `am_realloc`（已纳入统一内存池）。

### 8.2 链接期

- `am_linker_import_ref_resolution` 将 `AM_VAR_TYPE_IMPORT_REF` 变量替换为 importee 的全限定变量名（要求恰好唯一匹配）；
- 链接最后将合并后的 AST 所有节点标记为 static，成为编译期永生对象；
- `am_ast_merge` 深拷贝 importee 的 nodes，迁移词汇表、元数据，并修正 parent 关系。

### 8.3 模块持久化

`am_module_t`（`include/am_module.h:23-31`）包含保留头 `header`、`opstack_depth`、`ast`、`ilcode`、`ilcode_length`。其二进制磁盘格式（`src/am_module.c:15-98`）：

- 魔数 `MODULE_MAGIC = "BD4SURAM"`（8 字节）；版本 `MODULE_VERSION = 202607`；flags 的 bit0 = 0 表示小端（其余保留）；
- 头部定宽 **104 字节**，字段顺序：magic[8] / u32 version / u32 flags / u32 total_size / i32 base_type / u32 base_hash / u32 base_gcmark / u64 header / u32 opstack_depth / u32 ilcode_length / **13 个 u32 段偏移**（ilcode、nodes_heap、var_vocab、symbol_vocab、var_type、natives、dependencies、scopes、var_arn_mapping、node_token_mapping、lambda_handles、tailcall_handles、var_top、strindex）；
- 各区段头后紧密排列、无对齐填充；偏移相对转储起点，0 表示段不存在；ilcode 段每条指令为 `[u8 opcode, dvalue operand]`；
- dump 采用两遍法（先算 total_size 再写入）；加载端逐字节解码并校验 magic/version/flags（不匹配则向 stderr 打印原因并失败），不做结构体强制转换；
- 配套 PackBits 压缩/解压（游程 ≥ 3 才编码）。

节点堆区段的转储复用 `am_heap_deep_dump`（含 §4.3 的不动点迭代）。

---

## 九、Native 库与外部内存

### 9.1 System 库

- `System.set_timeout` / `System.set_interval`：注册时对回调闭包设置 `keepalive` 标志——回调闭包在触发前不位于任何 GC 根可达路径上，否则可能在首次触发前就被回收；
- `System.fork`：深拷贝当前进程，包括 IL、vocab、双栈、dynamic-wind 栈，以及整个进程堆（经两遍扫描：先为每个源 handle 分配新 handle 并复制对象，再修正对象内部的 handle 引用；IL 字面量中的 handle 也一并重写）；
- `System.memstat`：返回 VM/heap 两区的容量与已用字节。

### 9.2 Math / String 库

- 数值运算统一转 float，结果为 NaN 时返回 `#null`；
- 字符串函数在 heap 区创建 `am_wstring_t`，经驻留索引去重（≤ 32 字符）后返回 handle。

### 9.3 LLM 库

- 模型权重、词表使用进程全局静态变量 `g_llm`，由宿主 `malloc/free` 管理，**不在 Animac 堆中**；
- `LLM.get_param` 把权重数组打包为 Scheme 列表（heap 区 handle）供 Scheme 代码使用；`LLM.matmul` 直接修改列表中的 float 值；
- 即 Animac 内存管理只负责“指向权重的列表骨架”，模型缓冲区本身由外部原生内存承担——数 MB 级的模型参数不必纳入 GC 范围。

---

## 十、入口与 REPL 的生命周期策略

### 10.1 `main.c`

流程（`test_runtime_load_from_wstring`，`main.c:159-308`）：

1. 创建统一内存池（默认 256 MiB），取 vm/heap 双分配器；
2. `am_parse` → `am_link`（base_dir 为源文件所在目录，经宿主回调 `am_host_read_source_from_file` 读源码）→ `am_compile`；
3. `am_module_dump` 将模块序列化到系统 `malloc` 缓冲区；做 PackBits 压缩/解压/`memcmp` 自校验（落盘 `module.bin` 的代码被 `if (0)` 禁用）；
4. `am_allocator_pool_reset_vm` 彻底清空 VM 区；
5. `am_module_load(vm_alloc, heap_alloc, buffer, 0)` 从缓冲区加载模块（IL 与元数据入 VM 区，AST 节点堆入 heap 区）；
6. 创建 runtime（经 `am_runtime_vtable_t` 注入 on_tick/on_halt/时间函数等），设时间片 8192，注册 5 个 native 库（System、Math、String、LLM、Table），加载为进程并 `am_runtime_start` 运行；
7. 销毁 runtime，释放缓冲区，销毁内存池。

### 10.2 REPL（`main_repl.c` + `src/am_repl.c`）

- 默认池 16 MiB；冷启动建池、建 runtime、注册 native 库，并加载初始模块 `((lambda () (begin)))`；
- **重放式生命周期**：每次提交时，先从历史 session 中剥离顶层自动插入的 `(display ...)`，把新输入追加到 session，然后对整个 session 重新 parse → link → compile（最后一个无副作用的顶层表达式自动包成 `(display ...) (newline)`），**杀掉旧进程**、加载新进程并运行至 IDLE；编译/运行出错则回滚 session；
- **REPL 中不发生 `reset_vm`**；彻底重置只由 `.reset` / `.js` / `.scm` 指令触发：销毁 runtime 并销毁整个内存池后冷启动；
- 输入缓冲区、session 文本等宿主侧数据使用系统 `malloc/realloc` 管理。

---

## 十一、测试用例对内存管理场景的覆盖

`test/` 目录中的用例验证了不同内存管理路径：

| 用例 | 验证的内存管理方面 |
|---|---|
| `llm.scm` | 大数组、长循环、大量列表分配与 GC 压力；LLM 权重缓冲区与 Animac 堆的交互。 |
| `mlp.scm` | 数值计算与较大型列表结构的持续分配。 |
| `church_encoding.scm` | 大量闭包创建与调用，验证闭包绑定、自由变量、脏标记。 |
| `man_or_boy.scm` | 深层递归闭包链与 GC 根收集。 |
| `coroutine.scm` / `yinyang.scm` / `yinyang_cps.scm` / `generator.scm` | 续体捕获与恢复，验证 continuation 深拷贝与 GC 根。 |
| `test_dw_*.scm`（12 个） | dynamic-wind 与续体/fork/GC 的组合，验证 dw 栈快照、wind 跳板与 GC 根（含 `test_dw_gc_stress.scm` 的 GC 压力）。 |
| `sleepsort.scm` | 异步定时器回调，验证 `keepalive` 标志防止闭包被回收。 |
| `quicksort.scm` / `list.scm` | 列表操作与扩容写回 heap。 |
| `test_fork.scm` | `System.fork` 深拷贝进程与堆对象。 |
| `test_table.scm` | 散列表（map）对象与 GC。 |
| `test_macro.scm` / `test_eval.scm` / `test_mec.scm` | 宏展开、动态 eval 产生的 AST/IL 对象生命周期。 |
| `brainfuck.scm` / `interpreter.scm` | 元编程与解释器自举，产生复杂对象图。 |

---

## 十二、关键设计决策、工程约定与已知限制

### 12.1 关键设计决策

1. **无引用计数**：仅使用 tracing GC（分进程标记-清除 + 全局标记-压缩）。对象生命周期由可达性决定。
2. **handle 间接寻址**：所有堆对象通过 `am_handle_t` 引用，GC 压缩可物理移动对象而不影响外部引用。
3. **静态对象与 keepalive**：通过对象头标志位实现两类“不通过可达性也能存活”的对象。
4. **脏标记协议**：支持 `set!` 修改闭包链上的变量，读取时沿链判断使用定义处值还是捕获值。
5. **变长容器扩容写回**：`am_list_push`、`am_closure_*_var`、`am_vocab_insert`、`am_map_set` 扩容后返回新指针，调用者必须用 `am_heap_set` 写回 heap。
6. **编译-运行内存切换**：通过 dump + VM reset + load 实现编译期对象到运行期堆的迁移（`main.c`）；REPL 改用“重放 session + 杀旧进程”的等价策略。
7. **VM 区与 heap 区职责分离**：VM 区服务编译期短生命周期、频繁 realloc/free 的对象与运行期内部设施（容器元数据、队列、定时器等）；heap 区服务运行期长生命周期对象，受 GC 管理。
8. **GC“引擎 + 钩子”拆分**：压缩的纯物理部分（搬移与空闲块重建）在 allocator，逻辑堆部分（存活收集、handle 表回写）在 gc 模块，allocator 不依赖 heap/map/object 等上层模块。
9. **全局压缩**：多进程共享同一个底层 `heap_alloc`，因此必须一次性压缩所有进程堆，避免互相覆盖。

### 12.2 已知限制与 TODO（来自源码与 `doc/memo.md`）

- 浮点 TPV 精度损失 5 位（待 NaN-boxing 等改进）。
- `opstack` 深度静态估计仍有问题，目前依赖运行时倍增扩容兜底；fstack 固定 2048 帧，溢出即失败。
- GC 以堆水位触发为主（另保留周期兜底）；分配失败指令不做重试（op 可能已有栈副作用），靠水位与边界让渡保证正常情况下不可达 OOM。
- `am_heap_deep_load` 仅支持 LIST/WSTRING 两类对象；`am_heap_set_metadata/get_metadata` 为空桩。
- 模块二进制格式尚不含模块 ID 等元信息（memo 中记为 TODO）。
- 长远目标：尽可能减少系统 `malloc` 的使用，完全由统一内存池管理。

---

## 十三、结论

Animac 的内存管理是一套围绕“统一池 + 双分配器 + handle 抽象堆 + 标记-清除/标记-压缩 GC”构建的完整方案。它通过 handle 间接寻址解耦了逻辑引用与物理地址，使全局压缩成为可能；通过 VM/heap 分区与动态边界适应了编译期与运行期截然不同的分配模式；通过宿主虚表注入实现了对底层分配来源的依赖倒置；通过 `static` / `keepalive` / dirty-flag 等对象头与绑定级标志支撑了模块永生对象、异步回调闭包和 `set!` 语义；通过平台无关的磁盘格式与 deep-dump / deep-load 完成了编译期到运行期的内存形态切换，并可在 32 位与 64 位宿主之间互导模块。当前实现已在闭包、续体、dynamic-wind、异步定时器、LLM 推理、fork 等多种复杂测试场景下经受检验，并在 `doc/memo.md` 中记录了若干后续演进方向。

---
---

# 篇二　卫生宏（syntax-rules）实现技术报告

> 本篇前身为宏系统的**设计方案**（写于实现之前）。宏系统已于 `src/am_macro.c`（约 2100 行）与 `include/am_macro.h` 落地，本篇改写为对**当前实现**的描述，并在 §7 对照原设计方案总结实现与方案的差异。

## 摘要

Animac 的卫生宏系统基于 R5RS 的 `syntax-rules`，实现为编译期的一个独立“AST → AST”转换阶段，插入在 Alpha-renaming（ARN）之后、作用域对象清理与尾位置分析之前。核心思想是“**先 ARN、后展开、只对模板内绑定做 freshen**”：ARN 已赋予每个标识符携带作用域信息的唯一 varid，宏模板中自由出现的标识符直接复用 ARN 结果，天然指向宏定义处的绑定；模板内部新引入的绑定（lambda 引数、`define` 左值）在每次展开时换名为 `模块ID.M<展开序号>.原名` 形式的新鲜 varid，保证卫生性。实现支持 `define-syntax`（提升语义）、`let-syntax`/`letrec-syntax`、字面量、`_` 通配符与单层省略号（含前后缀与嵌套模式）；一期不支持跨模块导入/导出宏。

---

## 1 在编译链路中的位置

`am_macro_expand(ast)` 在 `am_parse` 中的确切插入位置（`src/am_parser.c`）：

```
am_lexer
构建符号/变量词表
递归下降解析
preprocess_analysis            ; import/native 预处理
alias_rename_analysis          ; 别名/外部引用更名
alpha_rename_analysis          ; ARN（两趟扫描）
↓↓
am_macro_expand(ast)           ; 卫生宏展开（am_parser.c:2069）
↓↓
cleanup_scope_objects          ; 清理 ARN 遗留的 scope 对象
populate_top_lambda_and_var_top
am_parser_tail_call_analysis   ; 尾位置分析（在宏展开之后重做）
```

尾位置分析不在宏模块内重建，而是由 `am_parse` 末尾与 `am_link` 模块融合后（`src/am_linker.c:669`）统一清空重做——这是宏模块与前端的分工约定（`include/am_macro.h` 头部注释）。

入口含**快速路径**：先全堆扫描是否出现 `define-syntax` / `let-syntax` / `letrec-syntax` / `syntax-rules` 任一关键字，不含则直接返回，不做递归展开。展开过程中若某个 lambda/列表的体没有实际变化，则**复用原 AST 节点**，避免制造冗余节点与重复的元数据刷新。

编译器侧，`compile_application` 对 `define-syntax` / `let-syntax` / `letrec-syntax` / `syntax-rules`（以及 `import` / `native`）直接返回 0、**不生成任何 IL**（`src/am_compiler.c:473-478`）——宏节点在展开阶段已被移除，此处只是防御性处理。

## 2 宏定义的收集与作用域

### 2.1 `define-syntax`（提升语义）

`macro_expand_body_sequence`（`src/am_macro.c:1454-1529`）对每个 body 序列（顶层或任一 lambda 体）分**两趟**处理：

1. 第一趟扫描整个 body，收集所有 `(define-syntax 名字 变换器)`，解析变换器（目前仅支持 `syntax-rules`）并加入为本 body 新建的宏环境帧；
2. 第二趟才展开 body 中的非 `define-syntax` 表达式，并把 `define-syntax` 节点从 body 中**删除**。

因此 `define-syntax` 具有**提升**（hoist）语义：宏对同一 body 内的所有表达式可见，包括文本上位于定义之前的表达式。宏定义在展开后不复存在，不产生运行时代码。

### 2.2 `let-syntax` / `letrec-syntax`

二者都由 `macro_expand_let_syntax`（`src/am_macro.c:1736-1851`）处理：解析所有绑定建立局部宏环境帧，逐个展开体表达式；体为单个表达式时直接以该表达式替换整个节点，多个表达式时包装为 `(begin ...)`。**`isrec` 参数被显式忽略**——当前实现中 `letrec-syntax` 与 `let-syntax` 语义完全相同。

宏环境按词法作用域嵌套：进入 `let-syntax` 时压入新帧，离开时回退。

## 3 模式匹配

`macro_parse_syntax_rules`（`src/am_macro.c:429-532`）校验变换器形状：首元素是 `syntax-rules` 关键字；第二元素是字面量列表（元素必须是标识符或关键字符号）；其后是至少一条 `(模式 模板)` 子句（每条恰好两个元素）。

模式匹配（`macro_match_value` / `macro_match_list`）规则：

| 模式 | 匹配规则 |
|---|---|
| `_` | 匹配任意输入，不绑定 |
| 字面量（literals 中的标识符） | 输入必须是相同的标识符（按值比较） |
| 模式变量 | 绑定到输入；重复出现时要求各次输入相等（`am_value_equal`） |
| symbol / 立即数 | 按 TPV 按位比较 |
| 列表 | 逐元素匹配；遇 `...` 按省略号规则处理 |

省略号（`macro_match_list`，`src/am_macro.c:605-703`）：

- **每层列表只允许一个 `...`**，否则报 `multiple ellipses in macro pattern`；**不能位于列表开头**，否则报 `ellipsis at beginning of macro pattern`；
- 支持 `前缀 + 重复模式 + ... + 后缀` 的结构：前缀逐元素匹配，省略号模式重复匹配 k 次（k 由输入长度减去后缀长度确定；每次迭代用独立的 subst 克隆，避免跨迭代污染），再匹配后缀；省略号区域可以匹配 0 次（预先把其中的模式变量绑定到空列表）；
- **嵌套模式**（如 `((a b) ...)`）通过递归支持：省略号子模式经 `macro_match_value` 递归进入 `macro_match_list`，每层各自允许一个 `...`；
- quote 内的字面 `...` 被保留（不作为省略号标记）。

模式中未声明为字面量、也不是 `_`/`...` 的普通标识符一律视为模式变量；未出现在 literals 中又未被绑定的标识符报 `unbound identifier in macro pattern`。

## 4 模板实例化与卫生

实例化（`macro_instantiate_*`）维护两张表：

- `subst`：模式变量 varid → 匹配到的值（或省略号产生的列表 handle）。每条候选子句使用独立的 subst，匹配失败销毁后再试下一条；
- `fresh_map`：模板内部绑定 varid → 本次展开生成的新鲜 varid。

具体规则：

1. **模式变量**：替换为使用处匹配子树的**深拷贝**（`macro_deep_copy_value/list`；拷贝 lambda 节点时会重新注册作用域），避免多个展开位置共享 `parent` 字段；
2. **模板内部绑定**（lambda 引数与 `define` 左值，由 `macro_collect_template_bindings_*` 预扫描收集；若同时也是模式变量则按模式变量优先）：经 `fresh_map` 换名——同一次展开内同一模板绑定映射到同一新鲜 varid，多次展开互不共享；
3. **新鲜 varid 的格式**：`模块ID.M<展开序号>.原名`（`src/am_macro.c:771`），展开序号取自每个宏的 `expansion_counter`（每次使用自增）；新 varid 插入变量词表并登记为 `AM_VAR_TYPE_NEW`；
4. **自由标识符**（如模板中出现的 `lambda`、`if`、`+`、模块内 helper）：保持 ARN 结果不变，指向宏定义处的绑定；
5. **模板变量规范化**：由于 ARN 可能给模板中与模式变量同名的标识符分配不同 varid，解析 `syntax-rules` 时会按基本名把模板标识符规范化回模式变量的 varid（`macro_canonicalize_template_vars`）；
6. **`quote`/`quasiquote`/`unquote` 内部不做展开**（避免用户 symbol 与关键字 symbol 冲突）；规范化同样跳过 quote；
7. 实例化结果会被**递归再次展开**——宏可以展开出宏。

## 5 展开后的元数据刷新

仅在确有变化（`ctx->changed`）时执行（`src/am_macro.c:2067-2085`）：

1. **`lambda_handles` 重建**：从顶层节点做**可达性遍历**收集 lambda 节点——不能遍历整个 nodes 堆，因为堆中残留着被替换掉的死节点，死 lambda 会被误编译并引用已消除的宏关键字；
2. **`var_top` 重建**：从顶层 lambda 的体重新收集 `(define var ...)`；
3. **尾位置分析**：不在宏模块内做，由 `am_parse` / `am_link` 统一重做（见 §1）。

## 6 测试

- `test/test_macro.scm`：基础 `syntax-rules`、卫生性（模板临时变量不捕获使用处同名变量、多次展开互不冲突）、literals、省略号（含嵌套模式与 quasiquote 模板）、`let-syntax`、宏展开出宏等；
- `test/test_dw_complex_macro.scm`：宏与 `dynamic-wind`、求值顺序的组合场景。

## 7 与原设计方案的对照

宏系统落地时基本遵循了原方案“先 ARN、后展开、只对模板内绑定做 freshen”的主线，主要差异如下：

| 方面 | 原方案 | 当前实现 |
|---|---|---|
| 元数据刷新时机 | 展开后由宏模块重建 `lambda_handles`、尾位置分析、`var_top` | `lambda_handles`/`var_top` 由宏模块重建；尾位置分析移交 `am_parse`/`am_link` 统一重做 |
| 尾部分散模式 `. rest` | 计划支持 dotted 模式 | 未实现（Animac 无点对）；改为“每层一个 `...`、不可在开头、支持前后缀” |
| `letrec-syntax` | 计划支持互递归 transformer | `isrec` 被忽略，与 `let-syntax` 同义（简化） |
| 展开入口 | 直接递归展开 | 增加关键字快速路径与“无变化复用原节点”优化 |
| `define-syntax` 生效范围 | 按顺序遇到即生效 | 两趟收集，提升为整个 body 可见 |
| 模板变量与 ARN 的冲突 | 未预见 | 增加 `macro_canonicalize_template_vars` 规范化 |

一期限制（与 `doc/AGENTS.md` 一致）：不支持跨模块导入/导出宏；模板中引入的 lambda 绑定会做 freshen，但用户需避免在模板中使用本解释器不支持的 `let` 类语法；quote/quasiquote/unquote 内部不做宏展开。

---
---

# 篇三　进程间通信队列机制技术报告

## 摘要

Animac 在“编译器 + 中间语言 VM、多进程事件循环”架构之上，提供了一套基于 FIFO 队列的进程间通信（IPC）机制。该机制以 `src/am_list.c` 中实现的 `am_list_t` 作为队列存储容器，通过 `am_list_push` / `am_list_shift` 完成入队与出队；队列对象本身分配在 VM 工作区，由 `am_runtime_t` 统一管理；任何进程都可以通过队列编号（ID）对队列进行发送或接收操作。发送与接收均为阻塞式，支持超时；收发双方以 `am_value_t` 的按值拷贝方式传递数据，解释器不对数据语义做解释或序列化。本报告阐述该机制的设计目标、数据结构、核心 API、调度与超时实现、与事件循环的集成方式，以及测试验证结果。

---

## 1 设计目标与约束

IPC 队列机制基于以下需求与约束：

1. **基于现有列表实现**：队列的底层存储复用 `am_list_t`，入队使用 `am_list_push`，出队使用 `am_list_shift`，不引入新的动态数组或环形缓冲区。
2. **VM 区分配**：队列对象（包括队列控制结构与数据项列表）均通过 `rt->vm_alloc` 分配，生命周期由运行时管理，不属于单个进程的私有堆。
3. **多生产者/多消费者**：任意进程都可以向同一队列发送或接收；队列内部维护发送等待者与接收等待者链表，实现阻塞同步。
4. **按值拷贝**：队列项类型为 `am_value_t`，通过直接拷贝 TPV 传递；如果是 handle，则拷贝 handle 值本身，解释器不做深拷贝或语义解释。
5. **阻塞式 + 超时**：`System.write` 在队列满时阻塞，`System.read` 在队列空时阻塞；二者均可指定 `timeout_ms`，超时后分别返回 `#f` 与 `#undefined`。
6. **编号访问**：队列通过自增编号 `id` 进行管理，Scheme 层只暴露编号，便于跨进程共享（`fork` 出的进程天然共享队列编号）。

---

## 2 核心数据结构

### 2.1 队列控制结构

队列控制结构定义在 `include/am_runtime.h:156-171`：

```c
struct am_queue_waiter_t {
    am_pid_t pid;                 // 阻塞的进程 ID
    am_value_t value;             // 发送等待者要写入的值（接收等待者忽略）
    am_timestamp_t deadline_ms;   // 超时绝对时间（毫秒）
    bool is_writer;               // true=发送等待者，false=接收等待者
    am_queue_waiter_t *next;      // 链表下一个节点
};

struct am_queue_t {
    size_t id;                    // 队列编号
    size_t capacity;              // 最大容量
    am_list_t *items;             // 数据项列表（FIFO）
    am_queue_waiter_t *send_waiters; // 等待可写的发送者链表
    am_queue_waiter_t *recv_waiters; // 等待可读的接收者链表
};
```

`am_queue_t` 不继承 `am_object_t` 头，因为它不是 Scheme 层面的对象，而是运行时内部设施；其数据项 `items` 虽然是 `am_list_t`，但同样不暴露给 Scheme 程序，仅用于内部存储。

### 2.2 运行时中的队列列表

`am_runtime_t` 中的两个字段（`include/am_runtime.h:105-106`）：

```c
am_list_t *queue_list;   // 队列列表：List<am_queue_t*>
size_t queue_next_id;    // 下一个队列编号，从 1 开始递增（跳过 0）
```

`queue_list` 中每个元素是一个 `am_value_t` 包装的原始指针，指向一个 `am_queue_t`。ID 从 1 开始单调递增，0 保留为无效编号。

---

## 3 Native API 语义

在 `src/am_native_System.c` 中实现并注册了三个函数：`make_queue`、`write`、`read`。

### 3.1 `(System.make_queue len)`

- 参数：`len` 为队列最大容量（必须 > 0）。
- 行为：创建队列，返回队列编号 `id`。
- 返回值：成功返回 `uint` 类型的编号；失败（容量非法、内存不足）返回 `#null`。

### 3.2 `(System.write qid v timeout_ms)`

- 行为：
  - 若存在等待接收者，直接将 `v` 交给最前面的接收者，发送方返回 `#t`；
  - 否则若队列未满，将 `v` 压入 `items`，返回 `#t`；
  - 否则若 `timeout_ms == 0`，立即返回 `#f`；
  - 否则将当前进程阻塞为发送等待者，设置超时绝对时间。
- 返回值：成功 `#t`，失败/超时 `#f`；参数非法或队列不存在返回 `#f`。

### 3.3 `(System.read qid timeout_ms)`

- 行为：
  - 若队列非空，弹出队首值并返回；若此时存在等待发送者，则立即把队首发送者的值入队并唤醒它（保持队列在有等待发送者时处于满状态）；
  - 若队列空且 `timeout_ms == 0`，立即返回 `#undefined`；
  - 否则将当前进程阻塞为接收等待者，设置超时绝对时间。
- 返回值：成功返回读到的值，失败/超时返回 `#undefined`。

参数弹出顺序遵循调用约定：native 函数从操作数栈顶依次弹出，因此 `write` 实际先弹出 `timeout_ms`，再弹出 `v`，最后弹出 `qid`；`read` 先弹出 `timeout_ms`，再弹出 `qid`。

---

## 4 队列生命周期管理

### 4.1 创建

`am_runtime_queue_create`（`src/am_runtime.c:195` 起）：分配 `am_queue_t`（`vm_alloc`），赋自增 ID（跳过 0），创建容量为 `capacity` 的 `items` 列表（同样 `vm_alloc`），初始化两条等待者链表为空，最后把队列指针压入 `rt->queue_list`。

注意：虽然 `am_list_create` 会把 capacity 对齐到内部最小值（默认 4），但 `q->capacity` 才是逻辑上的最大长度，`am_runtime_queue_write` 通过比较 `q->items->length < q->capacity` 决定是否还有空间。

### 4.2 销毁与进程清理

- `am_runtime_queue_destroy` 释放所有等待者节点、数据项列表以及队列控制结构本身；**仅在 `am_runtime_destroy` 中遍历 `queue_list` 统一销毁**——没有面向用户的 `delete_queue` native 函数，队列随运行时整体回收；
- 进程被 kill 时，`runtime_kill_queue_waiters_for_pid` 摘除该 pid 在所有队列两条等待者链表中的节点，防止唤醒一个已不存在的进程；
- 超时扫描时，属于 KILLED 进程的等待者节点也会被直接丢弃（见 §6.2）。

---

## 5 核心操作实现

### 5.1 写入路径

`am_runtime_queue_write`（`src/am_runtime.c:251-294`）的逻辑：

1. **直接交付给等待接收者**：若 `recv_waiters` 非空，取出队首接收者，把待写入值作为结果唤醒该进程（见 §5.3），发送方压入 `#t` 并步进 PC；
2. **常规入队**：若 `items->length < capacity`，调用 `am_list_push` 入队，发送方压入 `#t` 并步进 PC；
3. **立即失败**：队列已满且 `timeout_ms == 0`，压入 `#f` 并步进 PC；
4. **阻塞**：创建一个 `am_queue_waiter_t` 节点，记录当前进程 PID、待写入值、超时截止时间（`now + timeout_ms`），头插入 `send_waiters` 链表，然后将进程状态置为 `AM_PROCESS_STATE_BLOCKED`，**不步进 PC**（PC 停在 native 调用处，待唤醒后由唤醒逻辑步进）。

### 5.2 读取路径

`am_runtime_queue_read`（`src/am_runtime.c:297-338`）的逻辑：

1. **直接出队**：若 `items->length > 0`，调用 `am_list_shift` 弹出队首值。若有发送等待者，则取出队首发送者，将其值入队并唤醒（压 `#t`），从而保持队列始终处于满状态（只要还有发送者）。读取方压入弹出的值并步进 PC；
2. **立即失败**：队列空且 `timeout_ms == 0`，压入 `#undefined` 并步进 PC；
3. **阻塞**：创建接收等待者节点，头插入 `recv_waiters` 链表，进程状态置为 `AM_PROCESS_STATE_BLOCKED`，不步进 PC。

### 5.3 进程唤醒

`runtime_queue_wake_process`（`src/am_runtime.c:100-112`）统一处理被唤醒进程：

```c
static void runtime_queue_wake_process(am_runtime_t *rt, am_pid_t pid, am_value_t result) {
    // 把 result 压入目标进程操作数栈；
    // am_process_step 使 PC 越过 native 调用；
    // 进程状态置 READY，重新加入 process_queue 等待调度。
}
```

唤醒时的结果值约定：发送者被消费 → `#t`，发送者超时 → `#f`；接收者被投递 → 消息值，接收者超时 → `#undefined`。

---

## 6 阻塞状态与事件循环集成

### 6.1 进程状态

`include/am_process.h:29-35` 定义进程状态机：`READY(1)` / `RUNNING(2)` / `SLEEPING(3)` / `SUSPENDED(4)` / `STOPPED(5)` / `BLOCKED(6)` / `KILLED(7)`。

处于 `BLOCKED` 状态的进程不会被 `am_runtime_tick` 重新入队；它只能通过以下两种方式被唤醒：

1. **对端操作**：另一个进程向同一队列写入或读取时，直接将其从等待者链表中移除并唤醒；
2. **超时**：事件循环在每轮扫描所有队列的等待者链表，将已超时的等待者唤醒。

### 6.2 超时扫描

`runtime_queue_check_waiters`（`src/am_runtime.c:116-163`）遍历 `rt->queue_list` 中的每条队列及其 `send_waiters` / `recv_waiters` 链表：`deadline_ms <= now` 的等待者被唤醒（发送者给 `#f`、接收者给 `#undefined`）并释放节点；属于 KILLED 进程的等待者直接丢弃。

**触发点**：每次事件循环 `am_runtime_event_handler` 中，在一轮 GC（`am_gc_collect`）之后、`runtime_fire_expired_timers` 之前调用（`src/am_runtime.c:3047-3048`）。

### 6.3 事件循环不 IDLE

在 `am_runtime_event_handler` 末尾：即使当前没有就绪进程，只要还存在“关联进程未 BLOCKED 的未到期定时器”（`runtime_has_nonblocked_timer`）或“任一队列等待者”（`runtime_queue_has_waiters`），虚拟机就强制保持 RUNNING 状态，继续运转。

### 6.4 睡眠策略

`am_runtime_start` 在 `process_queue` 为空但仍有等待者/定时器时，取“最近到期的定时器时间”与“最近到期的队列等待者 deadline”中的较小者，调用 `runtime_sleep_ms` 睡眠到该时刻（`src/am_runtime.c:3078-3095`）。这避免了空转；当所有等待都无限期时，事件循环保持睡眠（当前实现下无限超时等价于永久阻塞，除非有对端操作唤醒）。

### 6.5 与定时器的互斥

如果一个进程在持有用户定时器的同时因队列操作进入 `BLOCKED` 状态，直接触发定时器回调会破坏队列操作现场（操作数栈已被弹出、PC 仍停在 native 调用处）。因此 `runtime_fire_expired_timers` 对 `BLOCKED` 进程的定时器**跳过不触发**（待进程解除阻塞后再检查），并清理 KILLED 进程的残留定时器（`src/am_runtime.c:2535-2547`）。事件循环的 IDLE 判断与睡眠计算同样使用 `runtime_has_nonblocked_timer` 跳过被阻塞进程的定时器，防止忙等。

---

## 7 多生产者/多消费者模型

队列内部的发送等待者与接收等待者都是单向链表，新等待者插入链表头部，唤醒时也取头部节点。因此：

- 多个发送者可以在队列满时同时阻塞；
- 多个接收者可以在队列空时同时阻塞；
- 当条件满足时，每次只唤醒一个等待者，保证 FIFO 的语义边界在队列数据项层面维持。

需要注意的是，等待者链表本身不是 FIFO（头部插入），但这只影响同一条件下多个阻塞进程被唤醒的先后顺序，不影响队列中数据项的出队顺序。队列项本身严格按照 `am_list_push` / `am_list_shift` 维护。

---

## 8 测试验证

`test/` 目录中的相关用例（均纳入 `testall.sh` 回归）：

- **`test/test_ipc1.scm`**：基础创建/读写、空队列超时读（返回 `#undefined`）、满队列超时写（返回 `#f`）、以及 `System.fork` 后的跨进程双向通信——child 从 `q_to_child` 读到 100 并回写 200，parent 写 100 后从 `q_to_parent` 读到 200（两条 display 的先后次序取决于调度）。
- **`test/test_ipc2.scm`**：多消费者（MPMC）——容量 2 的队列，两次 fork 产生两个消费者各自 `read`，parent 写入 111、222，两个消费者分别读到其中之一（哪个消费者拿到哪个值不保证）。
- **`test/test_deadlock.scm`**：用两个容量 1 的队列模拟两把互斥锁，父/子进程分别持有一把并请求对方，配合屏障构造循环等待形成死锁；通过 200ms 读超时检测死锁并输出 `DEADLOCK detected`。

回归方式：`bash testall.sh` 对上述用例及全部语言核心用例逐个执行（每个限时 30 秒），验证队列机制与运行时、GC、定时器、fork 等功能的组合正确性。

---

## 9 关键设计决策

1. **复用 `am_list_t`**：避免引入新的 FIFO 容器；`am_list_push` / `am_list_shift` 已能满足队列语义。
2. **队列对象放在 VM 区**：队列是运行时全局资源，不随单个进程堆的 GC/压缩而移动；进程间通过编号访问，避免 handle 跨进程语义问题。
3. **等待者链表而非定时器**：为每个阻塞操作记录绝对超时时间，由事件循环统一扫描；这样可以在一个函数中同时处理对端唤醒和超时唤醒，避免定时器回调与队列操作现场冲突。
4. **`BLOCKED` 状态独立**：与 `SLEEPING` 区分开，便于定时器系统识别并跳过，防止异步回调破坏同步阻塞语义。
5. **按值拷贝 `am_value_t`**：不解释 value 语义，也不做深拷贝；handle 值作为 TPV 直接传递，由 Scheme 层自行约定含义。

---

## 10 已知限制

- 等待者链表采用头部插入，严格来说等待者唤醒顺序是 LIFO；对多数 IPC 场景无影响，但对等待者公平性有要求的场景需注意。
- 队列 ID 线性递增，不回收；长时间运行大量创建队列可能耗尽编号空间（`size_t` 范围通常足够大）。
- 没有面向用户的 `delete_queue`：队列随 `am_runtime_destroy` 统一销毁。
- 收发双方自行负责 handle 的跨进程解释；队列项按值拷贝 TPV，解释器不保证跨进程 handle 语义（例如把本进程堆中对象的 handle 发给另一进程，对另一进程没有意义——跨进程共享数据应利用 fork 前的共享队列约定或传递可序列化的值）。
- 用户定时器在进程 `BLOCKED` 期间被暂停，待进程解除阻塞后才会重新检查到期。

---

## 11 结论

Animac 的 IPC 队列机制在保持事件循环与多进程调度架构不变的前提下，通过 `am_queue_t` 控制结构、两条等待者链表、三个 `System.*` native 函数，以及对事件循环超时扫描和睡眠策略的扩展，实现了一套完整的多生产者/多消费者 FIFO 队列。它复用 `am_list_t` 作为底层存储，按 `am_value_t` 按值拷贝传递数据，支持阻塞式读写与超时，并在跨进程通信、多消费者、资源死锁等复杂场景下通过了回归测试验证。
