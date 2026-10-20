# 闭包变量访问效率改进方案：帧描述符 + 静态槽位寻址

> 缘起：sky3 性能专项归因显示，解释器 CPU 的 **~84%** 花在"闭包绑定数组线性查找"与"每次函数调用复制全部绑定"上（`am_closure_init_free_var` 39.1% + `am_process_dereference` 32.6% + `am_closure_set_bound_var` 6.5% + `am_closure_init_bound_var` 3.7% + `am_process_get_closure` 2.6%），而散射物理本体（`Math.exp/sqrt/pow`）只占 ~1%。每次 Scheme 调用平均复制 **253 条绑定**。
>
> 本文只输出设计方案，**不修改任何仓库代码**。行号基于当前工作区版本（HEAD `0f5e9d4`）。

---

## 0. 结论摘要

| 项 | 现状 | 目标 | 手法 |
|---|---|---|---|
| 每次调用的绑定复制量 | 253 条（= 当前闭包全部绑定） | 个位数（= 被调 λ 真正引用的自由变量） | 编译期自由变量集合（闭包转换） |
| 复制实现复杂度 | O(N²)（每条做 2 次线性 find + grow 检查） | O(k) 纯 gather/memcpy | 帧描述符驱动的批量填充 |
| 单次变量访问 | 线性扫 253 条 ×1~3 次，沿父链逐层重复 | `bindings[slot]` 一次索引 | 编译期 varid→槽位静态解析 |
| `set!` | 3 次全表扫描 + 沿父链扫描 | `bindings[slot]` 直写 | 同上 |
| 每次指令的 `current_closure` 取用 | 1 次堆 map 查找 → 指针 | 进程内缓存指针 | 缓存 + GC/替换点刷新 |
| 帧大小对调用成本的影响 | 线性（复制量 ∝ 局部变量数） | **零**（只有被捕获的才进帧） | 自由变量过滤 |

预期（sky3，宿主 x86-64，与专项报告同口径）：**P0 −8~12%，P1 累计 −30~40%，P2 累计 −50~65%**；收益在 wasm 上按 2~2.5× 放大。物理计算、指令派发与栈搬运会成为新的热点，届时杠杆转移到报告的业务侧 B1/B2 与超级指令。

---

## 1. 事实基线：代码级复核

### 1.1 闭包对象与绑定表

`am_obj_closure_t`（`include/am_closure.h:29-36`）是"柔性数组 + 线性表"，每个 `am_binding_t` 携带 `varid / type(BOUND|FREE) / dirty_flag / value`。全部查找都是线性扫描：

- `am_closure_find`（`src/am_closure.c:16`）：按 `(varid, type)` 扫；
- `am_closure_find_by_varid`（`:27`）：只按 `varid` 扫；
- `am_closure_grow_if_needed`（`:56`）→ `am_closure_resize`（`:38`）：**对象会被重新分配**（malloc + memcpy + free 旧对象），即闭包指针在运行期会失效。

> 沿用约定：`type` 的 BOUND 即"约束变量"（形参、内部 `define`、`capturecc`），FREE 即"自由变量"（创建闭包时从父闭包复制进来的快照）。

### 1.2 三条"复制全部绑定"的路径

`copy_current_closure_bindings_as_free_vars`（`src/am_runtime.c:348-365`）被三处调用：

| 调用点 | 触发场景 |
|---|---|
| `op_loadclosure`（`:554-566`） | `(lambda ...)` 作为值求值 |
| `op_load` 的 iaddr 分支（`:538-544`） | 变量值为 lambda 地址 |
| `op_call_async` 的 iaddr 分支（`:817-836`） | 直接调用 lambda 字面量、η 变换临时 lambda |

它把 **当前闭包的全部绑定**（BOUND + FREE 混合、可能含同一 varid 的两个条目）逐条 `am_closure_init_free_var` 到新闭包。目标闭包刚由 `am_process_make_closure`（`src/am_process.c:500`）创建、容量 16、必然为空，因此：

- 每条插入的 2 次 `am_closure_find` **必然落空**（纯浪费），但仍要扫 `length` 次；
- 每次插入都要 `grow_if_needed`，容量从 16 起按 2 倍增长，前 16 条之后每次都触发 `am_closure_resize`（**malloc + memcpy 整个已有数组 + free**）→ 严格 O(N²) 且带 N 次重新分配。

这就是 `am_closure_init_free_var` 站上 39.1%、调用次数 ≈ 指令数 ×1.1 的原因。

### 1.3 变量解析路径

`am_process_dereference`（`src/am_process.c:550-584`）：

1. `has_bound_var(当前闭包)` — 全表扫描（`:557`）；
2. `get_bound_var(当前闭包)` — **再扫一遍**（`:558`）；
3. 未命中则沿父链循环：每层 `has_bound_var`（`:567`）→ 命中后再 `is_dirty_var`（`:569`，第三次扫）→ 再 `get_bound_var`（`:571`）或 `get_free_var(当前闭包)`（`:575`，第四次扫）。

调用链是"嵌套创建"的：`render_chunk → shade → scatter_v → march → …`，每层把上层的全部绑定继承下来，于是**绑定数随嵌套深度累积到 253**，每层解析都要在这个数组里扫。`op_call_async` 对 `call varid`（`:797`）也走同一条路径。

`op_set`（`src/am_runtime.c:599-640`）与 `op_store`（`:500-519`）同样是"扫 + 沿父链扫"：`set!` 要 `has_free_var` → `set_free_var`（内含 2 次扫）→ 沿链 `has_bound_var` + `set_bound_var`（内含 2 次扫）。

`am_process_get_current_closure`（`src/am_process.c:541`）→ `am_process_get_closure`（`:527`）→ `am_heap_get`（`src/am_heap.c:638`）→ `am_map_get`：**每条指令都要一次哈希查找**才能拿到闭包指针。

### 1.4 现语义模型还原（改进必须等价保持的东西）

把 BOUND/FREE 双条目 + 脏标记连起来读，其真实语义是一个**"创建时快照 + 写穿透失效"**的平坦闭包模型：

- **读**：先看本帧 BOUND（局部绑定，遮蔽外层）→ 否则沿父链找 BOUND 定义点 → 若该定义点 `dirty` 则用定义点的值，否则用**本帧的 FREE 快照**。
- **`set!`**：既更新本帧 FREE 条目（置脏），也沿链找到 BOUND 定义点更新其值并置脏 —— 即"写穿透 + 让所有旧快照失效"。
- **`define`/形参绑定**（`init_bound_var`）：只写本帧 BOUND 并**清除**脏标记 —— 即"`define` 是重新绑定，不是变异"，历史快照依旧有效。这是 `set!` 与 `define` 的关键区别，也是最容易被优化改坏的地方。

### 1.5 必须满足的既有约束

| 约束 | 出处 | 对设计的影响 |
|---|---|---|
| GC 标记会遍历 `bindings[0..length)` 的 value | `src/am_gc.c:39-48, 91-95, 342-355` | 帧内每个槽位都必须是可标记的合法 TPV（预填 `#undefined`） |
| **GC 压缩会搬移对象** | `src/am_gc.c:538-626`（`am_allocator_heap_compact` + 指针回写） | 任何缓存的闭包**指针**都必须可失效 |
| `am_closure_resize` 也会搬移对象 | `src/am_closure.c:38-54` | 同上；静态帧设计应彻底避免 resize |
| 闭包对象需要 dump/load | `src/am_closure.c:141-232` | 帧布局信息要能落盘，缺信息时退化为旧行为 |
| `System.eval` 在运行期**追加 ilcode** | `src/am_native_System.c:1632`（`offset = proc->ilcode_length`）、`:1501-1512`、`:1667-1680` | 描述符表必须可增长；eval 可能 `set!` 已有 varid |
| 续体/`dynamic-wind`/`fork` 会切换"当前闭包" | `src/am_runtime.c:948-967`、`:970-993`、`src/am_process.c:686, 766` | 缓存刷新点必须与 `am_process_set_current_closure` 对齐 |
| 尾调用自复用（同 iaddr 不新建闭包） | `src/am_runtime.c:811-818` | 复用后帧内 BOUND 槽位由序言重新 `store` 覆盖 |
| module 的 ilcode 在 `offset` 处重定位 | `src/am_compiler.c:1502-1515, 1516-1560` | 描述符按**绝对 entry iaddr** 索引 |
| 新增解释器核心头文件须登记进 `include/animac.h` | `doc/AGENTS.md` | `am_frame.h` 需注册，并随 amalgamation 生成 |

---

## 2. 设计目标与语义不变量

**目标**：单次调用的开销与"帧大小"解耦；单次变量访问为常数时间。

**必须保持的不变量**（每一条都是实现与测试的验收点）：

- **I1 快照语义**：闭包创建时捕获自由变量的值；此后父帧的 `define` 重新绑定**不**影响已存在的快照。
- **I2 写穿透语义**：`set!` 之后，所有存活的子闭包读到新值（通过脏标记或等价机制）。
- **I3 局部遮蔽**：本帧 BOUND 优先于外层同名（注意：**项目当前并无生效的 ARN**，`ast->var_arn_mapping` 只创建/复制/销毁，从未填充，见 `src/am_ast.c:200,234,271`；因此"同名不同作用域共用一个 varid"是常态，遮蔽必须靠"本帧优先"实现）。
- **I4 未定值可见性**：`define` 尚未执行时读取该变量，必须**穿透到外层**或报"变量未定义"，不能被预填槽位"接住"成 `#undefined`。
- **I5 指针失效**：GC 压缩、闭包 resize、堆替换之后，任何缓存指针必须已失效。
- **I6 退化安全**：任何"分析不了"的代码/闭包一律退化为旧路径，且退化**只能变慢，不能变错**。
- **I7 度量可比**：改后指令流仍可解释、可对照，保留开关以做 A/B。

---

## 3. 总体设计

三层，逐层可独立落地：

```
① 编译期：帧描述符（frame descriptor）  —— "这个 λ 的帧由哪些槽位组成、每个自由变量从父帧哪一槽取"
② 运行期：索引帧（indexed frame）      —— 闭包对象按描述符一次成型，槽位即下标，永不 resize
③ 编码层：槽位指令（load/store/set/call_slot） + 进程级"当前帧"缓存
```

### 3.1 数据结构

新模块 `include/am_frame.h` + `src/am_frame.c`（层级：在 `am_compiler` 之上、`am_process` 之下；`am_process` 依赖它，它不依赖 runtime/process）。

```c
// 绑定类型位（在既有 AM_BINDING_BOUND/FREE 之外追加帧标志位）
#define AM_BINDING_DEFINED (4)   // 该槽位已执行过 store/capturecc
#define AM_BINDING_DIRTY   (8)   // 沿用既有脏标记语义

// 一个槽位
typedef struct am_frame_slot_t {
    am_varid_t varid;   // 槽位对应的变量（快路径校验兜底、慢路径回退、错误信息都用它）
    uint32_t   type;    // AM_BINDING_BOUND / AM_BINDING_FREE
    uint32_t   src;     // FREE 槽位：在【词法父帧】中的槽号；BOUND 槽位：无意义
} am_frame_slot_t;

// 一个 λ 的帧描述符（按 entry iaddr 索引）
typedef struct am_frame_desc_t {
    am_iaddr_t entry_iaddr;   // λ 入口（= 闭包的 iaddr 字段）
    am_iaddr_t end_iaddr;     // λ 代码区间终点（仅编译期使用）
    uint32_t   nparam;        // 引数个数（槽 0..nparam-1 依序对应形参）
    uint32_t   nbound;        // BOUND 槽位数
    uint32_t   nfree;         // FREE 槽位数
    uint32_t   flags;         // AM_FRAME_OPAQUE / AM_FRAME_NOFREE
    am_frame_slot_t slots[];  // length = nbound + nfree；BOUND 在前、FREE 在后
} am_frame_desc_t;
```

闭包对象扩展（`include/am_closure.h`）：

```c
typedef struct am_obj_closure_t {
    am_object_t base;
    am_iaddr_t   iaddr;
    am_handle_t  parent;
    size_t       length;
    size_t       capacity;
    size_t       static_len;   // 【新增】索引帧的静态槽位数；0 = 传统布局
    am_binding_t bindings[];
} am_obj_closure_t;
```

- `static_len > 0` 表示"该闭包按描述符一次成型"，槽位下标语义固定、`capacity == length == static_len`、**永不 resize**；
- `static_len == 0` 表示传统布局（旧 dump、`AM_FRAME_OPAQUE` 的 λ、动态构造），走既有代码路径，行为完全不变。

进程扩展（`include/am_process.h`）：

```c
am_obj_closure_t *current_closure_obj;  // 缓存：避免每条指令一次堆 map 查找
am_frame_desc_t  *current_frame_desc;   // 缓存：当前 λ 的描述符（慢路径回退取 varid 用）
am_frame_desc_t **frame_table;          // iaddr → desc（稀疏表，长度随 ilcode 增长）
bool closure_fast;                      // 降级开关：eval 检测到"改只读变量"时置假（见 §4.2）
size_t closure_slow_hits, closure_fast_hits; // 计数器，供度量与自检
```

### 3.2 指令集扩展（追加式，不动旧 opcode）

`include/am_ast.h` 末尾追加（该文件已有"追加到枚举末尾，勿插入中间"的约定）：

```c
#define AM_VM_OP_load_slot   (63)  // 操作数：AM_VALUE_TYPE_UINT 槽号
#define AM_VM_OP_store_slot  (64)
#define AM_VM_OP_set_slot    (65)
#define AM_VM_OP_call_slot   (66)
```

理由（三选一，推荐 A）：

| 方案 | 操作数编码 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）新增 4 条指令** | `AM_VALUE_TYPE_UINT = 槽号` | 不消耗 TPV 标签预算（`doc/todo/nan_boxing.md` §15.2：4 位标签仅剩 3 个空位）；快路径是独立函数，不污染 `op_load` 热函数；旧模块/dump 零影响 | 派发 switch 多 4 个 case（派发仅 7.4%，可忽略） |
| B 复用 `load/store/set` + 新 TPV 标签 `VARSLOT` | 槽号 | 指令序列不变 | 烧掉 1 个 TPV 标签；每指令多一次 tag 判断 |
| C 保留 varid + 每指令旁表 | 无变化 | 完全兼容 | 每条指令多一次旁表随机访问，收益打折 |

### 3.3 编译期分析（`src/am_frame.c`）

在 `am_compile`（`src/am_compiler.c:1516`）里，于 `am_compiler_label_resolution`（`:1502`）之后增加一个 pass：`am_frame_analysis(ctx)`。它由 5 步组成，**完全复用 `am_compiler_opstack_depth_analysis`（`:1371-1451`）已验证的"λ 入口发现"套路**。

**(1) 记录 λ 代码区间。** 现有 `compile_lambda`（`:645`）与 `compile_complex_application`（`:495`，η 变换临时 lambda 是内联展开的）都不知道自己的区间终点。新增一个轻量栈（`ctx->frame_scope_stack`）：进入 `compile_lambda`/临时 lambda 时 push `(entry_iaddr, nparam, kind)`，退出时回填 `end_iaddr`。此外登记顶层 thunk（entry 0）。得到表 `λ[] = {entry, end, nparam, parent_λ, kind}`：区间两两嵌套，可 O(icount) 建出 `owner[iaddr] → λ`。

> 这一步是**唯一需要改编译器前端的部分**，净增 ~30 行，不改变任何代码生成。

**(2) 逐 λ 收集三张集合**（只扫 `owner[i]==本λ` 的指令）：

| 集合 | 来源 | 说明 |
|---|---|---|
| `BOUND` | 形参（`store` 序言）、区间内所有 `store`/`capturecc` 的 varid | 槽 0..nparam-1 固定给形参，其余按 iaddr 顺序 |
| `REF` | 所有 `load` / `call` / `tailcall` 的 varid 操作数、所有 `set` 的 varid | `call varid` 也会 `am_process_dereference`（`src/am_runtime.c:797`），必须算引用 |
| `CHILD_FV` | 各子 λ 的自由变量集合 | 见 (3) |

**(3) 自由变量传递闭包（按记录顺序逆序处理 = 子先父后）：**

```
FV(λ) = ( REF(λ) \ BOUND(λ) ) ∪ ( ⋃_{子 λ m} FV(m) \ BOUND(λ) )
```

必须做这一步的原因：闭包只从**当前闭包**复制，祖父级变量若不在父帧里出现，子帧就取不到。这也是"253 条"的成因——现实现用"全复制"粗暴地绕开了这个传递计算。

**(4) 槽位分配与 `src` 解析。** 对 `FV(λ)` 中每个 varid，在**词法父 λ** 的帧里找到它的槽号作为 `src`（父帧必然是它的超集：要么是父的 BOUND 槽，要么是父的 FREE 槽）。为了让复制循环顺序访问内存，**子帧的 FREE 槽按 `src` 升序排列**——则"子帧 FREE 段 ← 父帧的子序列"是一个单调合并，顺序遍历父帧即可完成填充。

**(5) 只读判定（决定读路径形态）。** varid `v` 判为 `READ_ONLY`，当且仅当在**整个链接后模块**里没有任何 `set`（`compile_set`，`src/am_compiler.c:773`）或 `capturecc` 指向 `v`。
- `define`/`store` 的重复执行**不**破坏只读性：按 I1，`define` 不置脏，历史快照仍有效，快照直读与旧路径结果一致（§4.1 有证明）。
- 只读 varid 的读 = 直读本帧槽位（无需沿父链查脏）。
- 非只读 varid 的读/写：**不下发槽位指令**，保留 varid 操作数走旧 `dereference`/`op_set`。这是刻意取舍：`set!` 是少数派（sky3 指令占比 7.2%），用它换掉快路径上的所有校验成本很划算。

**(6) 操作数改写。** 对每个 λ 区间内的指令：

| 原指令 | 改后 | 条件 |
|---|---|---|
| `load v` | `load_slot slot(v)` | `v ∈ BOUND(λ)` 或（`v ∈ FV(λ)` 且只读）且 `slot < AM_FRAME_SLOT_MAX` |
| `store v` | `store_slot slot(v)` | `v ∈ BOUND(λ)` |
| `set v` | `set_slot slot(v)` | `v ∈ BOUND(λ)`（局部 accumulater，sky3 绝大多数 `set!` 属此类） |
| `call v` / `tailcall v` | `call_slot slot(v)` | 同 `load` 条件，且 `v` 不是 native_ref/builtin |

不可判定的情形（`v` 既不在 BOUND 也不在 FV —— 说明分析漏了引用）→ **不改写**，并在 debug 构建里打印告警。该 λ 若含任何不可判定引用，则整帧标记 `AM_FRAME_OPAQUE`：创建时退回"全复制"旧行为，其内部指令全部保持 varid 形态 ⇒ I6。

**(7) 描述符表。** 结果为一个按 `entry_iaddr` 排序的 `(iaddr, desc)` 数组（二分查找，只在**创建闭包**时查，不在每条指令上查）。

### 3.4 运行期路径

#### 3.4.1 闭包创建（四条创建路径统一）

```c
// src/am_runtime.c 内部
static am_handle_t make_closure_desc(am_process_t *proc, am_iaddr_t iaddr, am_handle_t parent_hd) {
    am_frame_desc_t *d = am_frame_lookup(proc, iaddr);        // 二分；无则 NULL
    if (!d || (d->flags & AM_FRAME_OPAQUE)) {                 // ← 旧路径，行为不变
        return make_closure_legacy(proc, iaddr, parent_hd);
    }
    size_t n = d->nbound + d->nfree;
    am_handle_t hd = am_heap_alloc_handle(...);               // 与现状一致
    am_obj_closure_t *c = am_closure_create_frame(alloc, iaddr, parent_hd, d->slots, n);
    if (!c) { ...回滚... }

    // FREE 段：从父帧按 src 单调拉取，一次成型（O(k)，无 find、无 grow、无 resize）
    am_obj_closure_t *p = am_process_get_closure(proc, parent_hd);
    for (uint32_t i = d->nbound; i < n; i++) {
        uint32_t src = d->slots[i].src;
        if (p && src < p->static_len && p->bindings[src].varid == d->slots[i].varid) {
            c->bindings[i].value = p->bindings[src].value;                // 快：父帧索引帧
            c->bindings[i].type  = AM_BINDING_FREE
                                 | (p->bindings[src].type & AM_BINDING_DEFINED)
                                 | (p->bindings[src].type & AM_BINDING_DIRTY);   // 保 I4
        }
        else {
            am_value_t v; int32_t st = closure_lookup_generic(proc, parent_hd, d->slots[i].varid, &v);
            c->bindings[i].type  = AM_BINDING_FREE | (st == 0 ? AM_BINDING_DEFINED : 0);
            c->bindings[i].value = (st == 0) ? v : AM_VALUE_UNDEFINED;             // 慢：旧链查找
        }
    }
    am_heap_set(...);
    return hd;
}
```

要点：
- BOUND 槽位在创建时就**预置**（varid 已填、`value = #undefined`、**不带 DEFINED 位**），`store` 序言直接写槽 → 全生命周期无 resize；
- FREE 段是"子序列复制"，顺序访问、无分支预测失败重灾区；
- 逐槽 `varid` 校验使**动态父链**（异步回调、`fork`、续体恢复）也安全：取不到就逐槽退回旧查找 ⇒ I6；
- 250 条 → 个位数条，单次分配从 ~6 KB 降到 ~250 B，同时把 GC 压力与缓存足迹一并砍掉。

#### 3.4.2 `load_slot`

```c
static int32_t op_load_slot(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    size_t slot = (size_t)am_value_to_uint(operand);
    am_obj_closure_t *cl = proc->current_closure_obj;      // 缓存，非堆查找
    const am_binding_t *b = &cl->bindings[slot];
    if (slot < cl->static_len && (b->type & AM_BINDING_DEFINED)) {
        am_value_t v = b->value;
        if (am_value_is_iaddr(v)) return load_iaddr_to_closure(rt, proc, v);  // lambda 值：创建闭包
        am_process_push_operand(proc, v);
        am_process_step(proc);
        return 0;
    }
    // 未定义 / 布局不匹配 → 用描述符里的 varid 走旧路径（保 I4/I6）
    return op_load(rt, proc, am_make_value_of_varid(proc->current_frame_desc->slots[slot].varid));
}
```

热路径 = 一次索引 + 一次位测试 + 一次 push，与帧大小无关。

#### 3.4.3 `store_slot` / `set_slot`

```c
// store（形参绑定、内部 define）：O(1)，不再有"查找 + 可能插入"
b->value = v; b->type = AM_BINDING_BOUND | AM_BINDING_DEFINED;   // 清脏（= 旧 init_bound_var 语义）
// set!（局部变量）：O(1)，不再有"沿父链扫两遍"
b->value = v; b->type |= AM_BINDING_DIRTY;                        // 子闭包沿链查脏仍能见到新值（I2）
```

若槽位校验失败（`slot >= static_len` 或 `b->varid` 不符），退回原 `op_store`/`op_set`。

> 注意不存在"预填槽 + 追加同名条目"的混用：分析阶段把区间内**所有** `store`/`capturecc` 的 varid 都收进 `BOUND` 集，因此索引帧内的 `store` 必然能被解析成 `store_slot`（解析不了 ⇒ 该 λ 已标 `AM_FRAME_OPAQUE`，根本不建索引帧）。`AM_CLOSURE_VERIFY` 模式下对此加断言。

#### 3.4.4 `call_slot`

同 `load_slot` 取值，然后复用 `op_call_async` 的 handle 分支；不能直达时退回 `op_call_async(proc, varid)`。

#### 3.4.5 缓存维护（唯一需要全局排查的改动点）

新增/改造两个内部入口（`am_process_set_current_closure` 目前是 `include/am_process.h:186` 的 `static inline`，缓存刷新可以直接内联在里面；`am_runtime.c` 仅有 5 处调用，排查量很小）：

```c
int32_t am_process_set_current_closure(proc, hd);   // 同时刷新 current_closure_obj / current_frame_desc
void    am_process_replace_current_closure(proc, obj); // resize/替换后刷新指针
void    am_process_invalidate_closure_cache(proc);     // GC 压缩后（am_gc_collect 内）+ 销毁前
```

排查清单（`src/am_runtime.c` 内 5 处 `set_current_closure`：`:764, 833, 852, 958, 2575`；外加所有"替换当前闭包对象"的 `am_heap_set`、`src/am_process.c:766` 的续体恢复）：`op_call_async`、`op_return`、`op_load`(iaddr)、`op_loadclosure`、`op_capturecc`、`op_dynamicwind*`、`op_fork`、续体恢复（`src/am_process.c:766`）、异步回调入口。

### 3.5 与既有机制的接口

| 机制 | 处理 |
|---|---|
| **GC 标记** | 不改：仍遍历 `bindings[0..length)`；预填值一律 `#undefined`（立即数） |
| **GC 压缩** | `am_gc_collect`（`src/am_gc.c:634`）在压缩后对每个 proc 调 `am_process_invalidate_closure_cache`（置 NULL，下次用到时重建） |
| **continuation / dynamic-wind** | 不改结构：续体只存闭包 handle；恢复时走 `set_current_closure` → 缓存自动刷新 |
| **闭包 dump/load** | 追加一个 uvarint `static_len`；旧数据缺该字段则 `static_len = 0`（§5 给出格式兼容策略） |
| **`System.eval`** | ① `am_compile` 已生成该段 ilcode 的描述符（entry 已含 `offset` 重定位），`eval_append_ilcode`（`src/am_native_System.c:1501`）同时把描述符追加进 `proc->frame_table`；② eval 代码的顶层 thunk 词法父帧不可静态知晓 → FREE 段 `src` 记为 `AM_FRAME_SRC_DYNAMIC`，创建时逐槽走通用查找；③ 若 eval 的代码里出现对"只读 varid"的 `set`/`capturecc`，置 `proc->closure_fast = false`（全局降级，见 §4.2） |
| **`fork`** | 新进程从模块重新加载 → 描述符表重建；父子堆独立，无共享 |
| **调试/反汇编** | `src/am_debug.c` 增加 4 条新指令的反汇编（打印 `槽号(varid)`），便于对齐旧报告里的 PC 热区 |

---

## 4. 正确性论证

### 4.1 逐条等价性

1. **局部读（OWN 槽）**：旧路径第一步就是 `has_bound_var(当前)` 命中即返回本帧值。新路径直接读本帧槽。**等价**（含"局部遮蔽外层"I3）。
2. **只读自由变量读**：旧路径沿链找到 BOUND 定义点，因全模块无 `set`/`capturecc` 指向该 varid ⇒ 该定义点 `dirty` 恒为 0 ⇒ 旧路径走"返回本帧 FREE 快照"分支。新路径读同一槽。**等价**（并自动满足 I1：`define` 重绑定不改快照）。
3. **重复 `define`**：旧 `init_bound_var` 找 BOUND 命中 → 原地更新并清脏；新 `store_slot` 原地写槽并清 DEFINED 之外的位置为 DEFINED。对子闭包：旧路径 dirty=0 → 用快照；新路径不回写子帧 ⇒ 子闭包仍用快照。**等价**。
4. **未定值（I4）**：预填槽不带 `DEFINED` 位；`am_closure_find*`（`src/am_closure.c:16,27`）统一加一条 `type & AM_BINDING_DEFINED` 过滤，使"未执行 define"的槽对所有查找**不可见** ⇒ 旧路径照旧穿透到外层/报未定义；快路径的 `DEFINED` 测试失败也会回退。**等价**（这也是唯一需要触碰旧查找函数的改动，逐处可审计）。
5. **`set!` 局部**：`set_slot` 写值与置脏。子闭包读该 varid 时因为"非只读"而走旧路径（沿链查脏）⇒ 读到新值。**等价**。
6. **动态父链（异步回调、fork、续体）**：FREE 段逐槽 `varid` 校验 + 通用查找回退 ⇒ 与旧"全复制 + 沿链查找"结果一致。**等价**。
7. **尾调用自复用**（`src/am_runtime.c:811-818`）：不新建闭包，帧内 BOUND 槽被序言重新 `store`；未重新执行的内部 `define` 槽保留上一轮值 —— 与旧行为一致（旧实现同样复用同一闭包对象）。

### 4.2 唯一需要显式降级的地方：`System.eval`

`eval` 可能在**已经存在快照之后**对某个被判为只读的 varid 执行 `set!`，从而破坏"快照恒新鲜"的前提。处理：

- `am_compile` 产出的描述符附带"本段 ilcode 中被 `set`/`capturecc` 命中的 varid 集合"；
- `System.eval` 在追加 ilcode 时比对该集合与 `proc` 的只读集，一旦相交 → `proc->closure_fast = false`；
- `load_slot`/`call_slot` 的快路径前置一个 `proc->closure_fast` 判断（一次 well-predicted 分支，proc 已在 L1）⇒ 之后整个进程走旧路径，**正确但变慢**。
- 之后新建的闭包天然是"索引帧"，其 FREE 段填充同样逐槽校验，与降级无关。

极端保守的备选：只要进程执行过 `System.eval` 就永久降级（把"该程序的热循环里用 eval 改全局"视为反模式）。

### 4.3 影子验证模式（开发期）

编译时定义 `AM_CLOSURE_VERIFY` 后，4 条槽位指令同时执行"快路径取值"与"旧 `dereference` 取值"，不相等即 `abort()` 并打印 `(PC, slot, varid, 两值)`。以此在完整回归集（`testall.sh` + `testall_errors.sh` + `test/` 全量）上把 §4.1 的论证变成机器证据。**发布构建不包含该代码**。

---

## 5. 分阶段实施计划

| 阶段 | 内容 | 改动面 | 预期 | 验收 |
|---|---|---|---|---|
| **P0 无风险速赢**（不碰编译器） | ① `copy_current_closure_bindings_as_free_vars` 改批量：目标闭包必然为空，一次 `grow` 到 `capacity = length + src_len`，`memcpy` 后做一次 O(N) 去重（保持"首位置、末值"，与旧 `init_free_var` 循环语义一致）；② 新增 `am_closure_find3`（一次扫描同时给出 found/dirty/value），`am_process_dereference` 由 3~4 次扫降为 1 次/层；③ `proc->current_closure_obj` 缓存；④ 编译器 peephole 消除 `push #undefined; pop` 相邻对（`compile_define:768` / `compile_set:793` 的尾随 `push #undefined` 被外层非末尾语句的 `pop` 立刻弹掉；消除时须确认该 `push` 不是任何跳转目标） | `am_closure.c` / `am_process.c` / `am_runtime.c` / `am_compiler.c`，~150 行 | **−8~12%** | 回归逐字节一致；`gprof` 中 `init_free_var` 占比从 39% 掉到 <10% |
| **P1 帧描述符 + 自由变量过滤**（A1+A2） | §3.3 全部分析 + `am_closure_create_frame` + `make_closure_desc`；**暂不改指令**（`load`/`store` 仍用 varid，只是帧变小、槽位已被预置、`find` 命中更快） | 新增 `am_frame.{h,c}`（~600 行）+ 编译器记录 λ 区间（~30 行）+ 创建路径（~100 行） | 累计 **−30~40%** | 计数器 `copy_len` 直方图：sky3 每次调用复制量 < 15；253→k |
| **P2 槽位指令 + 静态寻址**（A3+A4） | 4 条新指令 + 操作数改写 + 缓存刷新点全量排查 + `AM_CLOSURE_VERIFY` 影子验证 | `am_runtime.c`（~250 行）、`am_process.{h,c}`、`am_debug.c` | 累计 **−50~65%** | 影子验证在全量用例零差异；`closure_slow_hits` 占比 < 5% |
| **P3 分配池化 / 帧复用** | 按 `static_len` 分档的闭包对象空闲链表（或 bump 分配）+ `fstack` 帧对象复用；降低 malloc 与 GC 频率 | `am_closure.c` / `am_process.c` | 再 −5~10% | 分配次数与 GC 轮次统计 |
| **P4 栈流量压缩**（可选） | 报告 §3.4：`load/push/pop/set/store` 占指令 70.7%。做 `load_slot,load_slot,mul` 之类的超级指令 | `am_compiler.c` / `am_runtime.c` | −5~15% | 指令数下降与时间下降同向 |

**每个阶段都必须可独立回滚**：`AM_FRAME_MODE`（0=全旧 / 1=仅描述符 / 2=槽位指令）+ `proc->closure_fast` 运行期降级。

**为什么 P1 与 P2 拆开**：P1 只改数据布局、不改指令流，可用"指令数不变、时间下降"直接证明收益来自绑定复制（正好回答专项报告 §3.5"指令数不是好指标"）；P2 才动寻址，风险与收益都更大。

---

## 6. 度量与验证

1. **基线固化**：沿用 `/tmp/prof` 的冻结虚拟时钟（`--wrap=am_current_timestamp_in_ms` / `--wrap=time`）与同一二进制口径，改造前后各跑 60 帧，记录墙钟、指令数、`gprof` 占比。
2. **新增计数器**（`AM_VM_PROBE` 构建）：`copy_len` 直方图、`load/store/set_slot` 命中数、`closure_slow_hits`、`opaque_frame_count`、帧大小直方图、闭包分配字节数。目标：`copy_len` 中位数 < 10，`slow_hits / total < 5%`。
3. **回归**：`testall.sh`、`testall_errors.sh`、`testall_amalg.sh` 与基线输出**逐字节 diff**（amalgamation 形态必须同样通过，`amalgamate.sh` 会自动收录新源文件，新头文件需登记 `include/animac.h`）。
4. **语义专项用例**（新增 `test/` 用例，覆盖 §2 的 I1~I4）：
   - 快照 vs `define` 重绑定（循环内 `define` + 闭包捕获）；
   - `set!` 后子闭包读新值（含跨 3 层嵌套、兄弟闭包）；
   - 遮蔽：内层 `define` 与外层同名（当前无 ARN，必须靠"本帧优先"）；
   - use-before-define 穿透到外层；
   - 异步定时器回调闭包、`fork` 后自由变量隔离、`dynamic-wind` + `call/cc` 往返、`eval` 内 `set!` 全局；
   - `test_gc_stress.scm` / `test_gc_watermark.scm`（缓存失效路径）。
5. **性能门槛**（sky3，宿主）：P0 后 < 3.6 s；P1 后 < 2.6 s；P2 后 < 1.8 s（同 60 帧）。wasm 侧同步验证不劣化。

---

## 7. 预期收益（sky3，60 帧，基准 3.91 s / 17.49 M 指令）

| 项 | 改造前 | 改造后 | 依据 |
|---|---|---|---|
| 每次调用的绑定复制 | 253 条 / ~26 µs / O(N²) | 个位数条 / ~0.1 µs / O(k) | 自由变量传递闭包 |
| `am_closure_init_free_var` CPU 占比 | 39.1% | → 0（该函数在索引帧路径上消失） | — |
| `am_process_dereference` 占比 | 32.6% | < 5% | 槽位直读 + 单次扫描慢路径 |
| `init/set_bound_var` 占比 | 10.2% | < 1% | `store_slot`/`set_slot` |
| `am_process_get_closure` 占比 | 2.6% | ~0.2% | 指针缓存 |
| 单闭包字节数 | ~6 KB | ~250 B | 253×24 B → k×24 B |
| 总墙钟 | 3.91 s | **1.4 ~ 2.0 s** | 绑定/闭包 84% 中消掉 70~85% |

之后新增热点会是：指令派发、`load/push/pop` 栈搬运（70.7% 指令）、`Math.exp` 本体 —— 此时业务侧杠杆（报告 B1 内联 `phase_*`、B2 二阶降采样）才成为主导。

---

## 8. 风险与反直觉提醒

1. **`copy_len` 变小的同时，代码风格约束消失**：专项报告 C-2 的"不要增加局部变量"在 P1 之后不再成立——局部变量只占槽位，不再抬高调用成本。这条要同步写进 `doc/manual.md`，否则开发者会继续按旧成本模型写代码。
2. **不要顺手引入 ARN**：本方案特意不依赖 Alpha-renaming（当前它并未生效）。若将来实现 ARN，`BOUND`/`REF` 集合的判定会更干净，但**不是前置条件**。
3. **不要用"每指令旁表"图省事**：那会把 39% 的 O(N²) 换成每指令一次随机访存，收益直接腰斩。
4. **不要为 `set!` 设计广播**：广播需要反向引用表，代价远高于"少数派走慢路径"。
5. **GC 指针缓存是这个方案唯一的"隐蔽杀手"**：压缩会搬移对象。任何新增的闭包指针缓存都必须列入 §3.4.5 的清单，并在 `test_gc_stress.scm` 下验证。
6. **不要为了快而删 `DEFINED` 位**：它同时承担 I4（穿透）与"布局见证"两个职责。

---

## 9. 不在本方案范围内

- NaN 装箱 / 寄存器化（`doc/todo/nan_boxing.md` 的长线议题）；
- 栈平衡与依赖消除（`doc/todo/stack_bal.md`）；
- 业务侧优化（B1~B5）：与本方案正交，且本方案落地后它们的绝对收益会缩小、但仍必要（报告结论：交互式刷新需两侧同时做）；
- 把闭包改成"盒化捕获（boxed captured variables）"：脏标记模型已够用，改盒化会牵动 `dump`/GC/反射语义，收益不抵风险。

---

## 10. 与 2026-07-15「嵌套环境帧」方案（`doc/prompt.md:6030`，未实现）的对比

### 10.1 两个方案的坐标

| | **E 方案**（`doc/prompt.md` 2026-07-15 路线 A） | **F 方案**（本文） |
|---|---|---|
| 改什么 | **表示法**：扁平闭包 → 嵌套环境帧链（`am_env_frame_t`），闭包只存 `env_handle` | **寻址**：仍是扁平闭包，改编译期闭包转换 + 槽位寻址 |
| 编译器 | 0 行 | λ 区间记录 + 分析 pass + 4 条新指令（~1000 行） |
| 变量定位 | 沿帧链按 varid 线性查找 `O(depth × 帧大小)` | `bindings[slot]` 直接索引 `O(1)` |
| 绑定复制 | 消除（`O(1)` 挂一个 handle） | 从 253 条降到 `k` 条（`O(k)` gather） |
| 脏标记 | 彻底消除（共享帧，写入即全局可见） | 保留，但只用于少数可变 varid |
| 可回滚 | 难（表示法已换，无法开关） | 易（`AM_FRAME_MODE` + `proc->closure_fast`） |

两者都在解决 report（性能专项）里的同一个根因，只是下手的位置不同：E 方案换"存储结构"，F 方案换"访问地址"。

### 10.2 关键洞察：同一份信息的两种"摊薄位置"

两个方案都需要同一份信息：**"变量 v 在哪个帧的哪个槽位"**。区别只在"什么时候支付这份解析成本"：

- **E 方案**：每次**访问**都重新解析一遍（沿帧链按 varid 扫）。
- **F 方案**：在**创建闭包**时解析一次（填描述符 + `src` gather），之后每次访问都是定址。

用 report 的数字算这个比值：

```
每帧变量访问数 ≈ 17.49M × (load 29.4% + set 7.2% + store 5.0% + call 2.4%) / 60 ≈ 128k
每帧函数调用数 =  31,900 / 60 ≈ 532
              ⇒  访问 : 调用 ≈ 241 : 1
```

即使只看 `load` 也是一组 **161 : 1**（85.7k : 532）。而本次优化的核心就是"把解析成本摊到次数最少的那一端"——**摊在创建端（每次调用一次）比摊在访问端便宜两个数量级**。这是 F 方案在成本模型上占优的根本原因，也是 E 方案"不改编译器"这一优势的代价所在。

### 10.3 成本模型定量对比（sky3，同口径）

| | 现在 | E 方案 | F 方案（P2） |
|---|---|---|---|
| 每次调用 | 253 条插入 × 2 次全表扫 ≈ 128k 次比较（O(N²)） | 写 1 个 `env_handle`（+1 次小帧分配） | `k`(~10) 次带索引 gather（+1 次小帧分配） |
| 每次变量访问 | `253 × 1~3` 次比较 × `depth` | `depth` 跳 × 每帧线性扫（帧只含**本 λ** 局部变量：小函数 1~3、`scatter_v` ~40；**每跳还要一次堆 map 查找取帧对象**） | 1 次索引 + 1 次位测试 |
| 51% 的"复制" | — | → 0 | → ~2% |
| 33% 的"解析" | — | → 降到 ~8~12%（帧变小、深度小，但仍是线性 + 每跳一次哈希） | → < 5% |
| 预估总墙钟（3.91 s） | — | **~2.2~2.4 s（−40~45%）** | **~1.4~2.0 s（−50~65%）** |

补充说明一个反直觉点：E 方案的"每次调用零复制"看起来比 F 的"复制 k 条"更优，但 k≈10 只是 10 次顺序内存访问，**相对于一次 malloc 完全可忽略**；真正常量级成本在"沿帧链 hops"上。所以"消除复制"本身不是终点，"消除查找"才是。

### 10.4 语义影响：这是两者最大的实质差异

| | E 方案 | F 方案 |
|---|---|---|
| 语义模型 | 快照 + 写穿透 → **共享环境（引用语义）** | **保持现状**（快照 + 写穿透） |
| `define` 重绑定后，已存在的子闭包读到什么 | 新值（帧槽被覆写） | 旧快照（与现在一致） |
| `test_dw_*` / coroutine / generator / 循环内建闭包用例 | 输出可能变化，需人工裁决"哪些差异是语义升级、哪些是回归" | 要求**逐字节一致** |
| `doc/ISSUES.md:169`（while 体不是独立作用域，闭包不保存每步绑定） | **不能修**（循环体没有新帧） | 同（本方案不碰作用域划分） |
| 顺带收益 | 脏标记机制彻底消失，闭包对象更小、代码更简单 | 保留 dirty 位（仅可变 varid 用） |

E 方案本质上是做了一次"向标准 Scheme 的语义迁移"，这是它无法用开关回滚的根本原因。F 方案的验收标准是均等性（§4.1 + `AM_CLOSURE_VERIFY`），不需要语义裁决。

### 10.5 工作量与风险分布

| | E 方案 | F 方案 |
|---|---|---|
| 新增堆对象类型及其序列化/驻留 | `am_env_frame_t` 的 `create/size/dump/load/copy` 全套 | 复用 `am_obj_closure_t`（加 1 个 `static_len` 字段） |
| GC | 标记 + root + 压缩回写 + fstack/续体/opstack 中的帧追踪（面很宽） | 仅"压缩后清缓存"一处 |
| 闭包 API | `am_closure_*` 10 个函数语义全部重写 | 新增 `create_frame`，其余不动 |
| 续体 / `dynamic-wind` / `fork` | 全部要保存/恢复/深拷贝帧链 | 结构不变（仍存闭包 handle） |
| 尾调用 | **必须**做帧复用/替换，否则帧链无限增长（新增风险点） | 沿用现有"同 iaddr 自复用" |
| 内存/生命周期 | 闭包持有定义帧 → **整条祖先帧链必须保活**；逃逸闭包（全局表/定时器/REPL 历史）会让整条链连同临时局部变量无法回收；缓解手段帧闭合（一旦闭合就退化为复制 = F 方案） | 闭包只持有 `k` 条值副本，无祖先依赖；**内存下降**（6 KB → 250 B） |
| 回滚成本 | 高（表示法已换） | 低（开关 + 运行期降级） |

E 方案把风险集中在"运行时对象图 + 生命周期 + 序列化"——正是本仓库最难回归验证的部分；F 方案把风险集中在"编译期分析的完备性"，而这一部分可以靠影子验证机器化证伪。

### 10.6 两者其实在同一条演进链上

```
现状（flat + 全复制 + 脏标记）
  ├─ E 方案：环境帧链，按 varid 查找          ← 换表示，不动编译器，−40~45%
  │        └─ + 编译期 (depth, slot)  ← prompt.md 的"路线 B"，这才是主流终极形态
  └─ F 方案：flat + 描述符 + 槽位寻址          ← 换寻址，不动表示，−50~65%
             └─ 再把 FREE 值副本换成 upvalue 引用 → 与 E+B 收敛
```

关键事实：**E+B 的编译期部分与本文 §3.3 的分析完全同构**（λ 区间 → `BOUND`/`REF` 集合 → 作用域链解析 → 槽位分配），差别只在"帧是共享的还是每闭包一份副本"，以及 `src` 是"值 gather"还是"upvalue 引用"。因此：

- 若决定"最终一定走环境帧"，应跳过本文 P2，直接做 E + 路线 B，避免分析做两遍、槽位语义返工一次；
- 若还没定，则本文 P0/P1 **两条路线都需要**：
  - P0（批量复制、单次扫描、指针缓存、peephole）在 E 方案落地前同样有效，且是 E 方案的独立前置收益；
  - P1 的描述符分析可直接复用为 E+B 的"绑定/引用集"分析。

### 10.7 结论与建议

1. **E 方案的核心优势是"不动编译器"（报价最低），核心代价是"不可回滚的语义迁移"** + 尾调用帧增长 + 逃逸帧保活三项长期负债。
2. **F 方案的优势是"零语义变化 + 访问 O(1) + 可开关"**，代价是必须做编译期闭包转换。
3. 推荐顺序：**先 F-P0/P1（锁定语义基线与性能基线，−30~40%，无风险）→ 再决策是否走 E+B**。理由：先确立"语义不变的可信基线"，之后任何差异都能归因于语义迁移而不是 bug；反过来先做 E 方案，则所有回归差异都要人工裁决。
4. 如果已被明确要求"迁到嵌套环境帧"，那么**不要只做 E（路线 A）**：路线 A 的残留成本仍是 `O(depth × 帧大小)` 的按 varid 查找，而访存/调用比是 161:1~241:1，天花板很低；应当直接做 **E + 路线 B**，并把本文 §3.3 的分析作为它的编译期前端。
5. 无论选哪条，**P0 段的四项（尤其"批量复制去 O(N²)"与"`dereference` 单次扫描"）都应当先落地**：它们是纯局部改动、零语义风险、对 E 方案也有等价收益（E 方案下 `am_closure_*` 会被重写，但"一次扫描拿到 found/dirty/value"的思路同样适用于帧链查找）。
---

## 11. 实施结果（P0–P2 已落地）

> 本节把上面的设计与实际代码对应起来。行号/文件均为当前工作区实况。

### 11.1 落地清单

| 阶段 | 内容 | 落点 |
|---|---|---|
| **P0-1** | 批量继承自由变量：目标闭包必然为空，单次容量确保 + 顺序拷贝（O(n²) → O(n)，去掉逐条 `find` 与逐条 `resize`） | `am_closure_fill_free_vars`（src/am_closure.c）、`copy_current_closure_bindings_as_free_vars`（src/am_runtime.c） |
| **P0-2** | `dereference` 由 3~4 轮全表扫描合并为每层一次扫描；新增 `am_closure_find_binding` 公开接口 | src/am_process.c `deref_impl` |
| **P0-3** | 当前闭包对象指针缓存（免去每指令一次堆 map 查找），GC 压缩后失效、扩容/替换点刷新 | `proc->current_closure_obj` + `am_process_set_current_closure` / `am_process_refresh_current_closure_obj` |
| **P0-4** | peephole 消除相邻 `push #undefined; pop`（带跳转目标保护） | src/am_compiler.c `emit_instruction` + `ilcode_posflags` |
| **P0-5** | 同一闭包内"每个 varid 至多一个绑定项"不变量（同名的自由绑定就地升级为约束绑定） | `am_closure_init_bound_var` 等 |
| **P1** | λ 代码区间记录 → 帧描述符分析（BOUND/REF 收集、自由变量传递闭包、槽位分配、src 解析）→ 模块序列化 → 进程帧表 → 按描述符建帧 | `am_lambda_region_t`（include/am_compiler.h）、`src/am_frame.c`、`am_module_t.frames`（模块格式版本 202608）、`am_process_make_closure_desc` |
| **P2** | `AM_BINDING_DEFINED` 位与查找过滤、`frame_len` 见证、5 条槽位指令（63–67）与快路径、操作数改写、`closure_fast` 降级、fork 帧表继承、eval 帧表 shift/merge/varid 重映射 | src/am_closure.c、src/am_runtime.c、src/am_frame.c、src/am_native_System.c |
| **加做** | 取指内联（`am_runtime_execute` 不再经函数调用 + 两次边界检查取指） | src/am_runtime.c |
| **工具** | `AM_FRAME_TABLE/TRACE/STATS/DEBUG` 环境变量探针；`-DAM_CLOSURE_VERIFY` 影子验证；`test/closure_sem.scm`（语义 21 项，已入 testall.sh）、`test/closure_perf.scm`（sky3 类基准） | — |

**未做（按约定留给后续）**：P3 闭包对象池化、P4 超级指令 / 线程化派发。

### 11.2 实测收益（宿主 x86-64，取 3 次最优；同一台机器、同一份基准）

微观基准（`/tmp/prof/bench`，与原专项报告同一套）：

| 基准 | 基线 | 现在 | 变化 |
|---|---|---|---|
| b1_loop（紧凑循环） | 212 ms | 95 ms | −55.2% |
| b2_arith | 410 ms | 163 ms | −60.2% |
| b3_sqrt | 126 ms | 63 ms | −50.0% |
| b4_exp | 116 ms | 66 ms | −43.1% |
| b5_call（调 200 万次一元函数） | 641 ms | 357 ms | −44.3% |
| b6_getitem | 348 ms | 147 ms | −57.8% |
| c_var_K4/K24/K64_first | 39/47/67 ms | 21/28/41 ms | −46%/−40%/−39% |
| c_var_K4/K24/K64_last | 40/55/84 ms | 21/27/42 ms | −48%/−51%/−50% |
| c_call_K8/K20/K44（大帧下调用） | 16/24/46 ms | 12/13/14 ms | −25%/−46%/**−70%** |

sky3 类成本结构基准（`test/closure_perf.scm`：深层嵌套 + 40 个局部 define 的大帧 + 每采样点约 200 次调用 + 二阶循环；输出一致 `311.18`）：

| | 基线 | 现在 | 变化 |
|---|---|---|---|
| 600 次渲染 | **7932 ms** | **1068 ms** | **−86.5%（7.4×）** |

帧统计（`AM_FRAME_STATS=1`）：

| 用例 | 闭包创建数 | 描述符路径 | 旧路径 | 平均槽位 | 平均自由变量 |
|---|---|---|---|---|---|
| closure_perf.scm | 808,802 | 100% | 0 | **4.7**（原为全部绑定，`march` 帧约 50） | 0.4 |
| test/json.scm | 65,501 | 100% | 0 | 4.9 | 4.2 |
| test/closure_sem.scm | 9,139 | 100% | 0 | 1.9 | 1.0 |

分析完备性：全部大用例的 `analysis_gaps`（引用既不在 BOUND 也不在 FV 的变量）均为 **0**。

### 11.3 正确性验证

1. **逐字节回归**：`testall.sh`（含新增 closure_sem.scm）0 个 `[FAIL]`；`testall_errors.sh` 10/10；对 40 个 `.scm` 用例做"基线跑两次取稳定行"的对照，差异仅剩三类已知噪声：main.c 断言行号（因新增调试代码）、VM 工作区占用百分比、mlp 自身的非确定性输出。
2. **影子验证**：`-DAM_CLOSURE_VERIFY` 构建下，20 个大用例 + 5 个微观基准的"槽位直读 vs 通用解引用"对比 **零不一致**。
3. **语义专项**：`test/closure_sem.scm` 21 项覆盖快照（含尾调用自复用导致同帧重复 `define` 的场景）、`set!` 写穿透、兄弟/多层闭包、局部遮蔽、跨 GC 存活、尾递归、高阶函数、相互递归、call/cc、dynamic-wind。与基线输出逐字节一致。
4. **amalgamation 形态**：`make amalg` + `main_amalg` 构建通过，`testall_amalg.sh` 通过。

### 11.4 已知限制

- **动态父链的填充**走沿链通用解析（`fill_generic` 计数）：`(define f (lambda ...))` 存的是 iaddr，调用点才建闭包，此时运行时父闭包不是词法父闭包，`src` 索引失配。语义正确（退化为等价查找），常数项略高。若要消除，可在描述符里加"父帧身份校验 + 回退起点表"。
- **`System.eval` 会关闭自由变量快照直读**（`closure_fast=false`）：保正确但不保性能。改进方向是把"只读集合"细化为 per-varid 位图。
- **VM 工作区占用上升约 0.3~1.3 个百分点**：帧描述符表常驻 vm_alloc（每个 λ 约 24B + 24B/槽）。相对运行期堆的收益（闭包从数百条绑定降到个位数槽位）是净赚的。
- 剩余热点（b5_call，gprof）：`am_runtime_op_dispatch` 30%、取指 14%（已改善）、`am_map_find_slot` 12%（heap 的 handle→对象映射）、GC 约 6%。即：**闭包机制已不再是热点**，后续杠杆在派发/超级指令（P4）与 heap 表示（handle 直接索引化）。

### 11.5 结论回填

原预期"P0 −8~12%、P1 累计 −30~40%、P2 累计 −50~65%"在实测中分别为 **约 −20~−30%**、**约 −30~−40%**、**−40~−70%（sky3 类负载 −86%）**。P0 超出预期的部分来自 peephole（去掉约 5% 的指令）与"绑定项合并"（把每层扫描的条目数减半）；P2 超出预期的部分来自把 `set!` 的三轮扫描也一并消掉。
