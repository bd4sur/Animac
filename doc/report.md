# 内存管理机制技术报告

> **范围说明**：本报告基于 `doc/`、`include/`、`src/`、`test/` 目录下除 `typescript/` 以外的全部源码、文档与测试用例进行阅读、整理与归纳，**不提出任何代码修改建议**，仅对当前设计与实现状态作描述性、分析性总结。  
> 报告采用项目约定前缀：`am_` 函数 / 类型，`AM_` 宏 / 常量，`AM_VALUE_*` / `AM_OBJECT_*` 枚举。

---

## 一、摘要

Animac 是一个用 C 语言实现的 Scheme 解释器与虚拟机。其内存管理采用“统一内存池 + 双区分配器 + handle 间接寻址 + 标记-清除-压缩 GC”的整体架构：

- **统一内存池**：编译期与运行期共享一整块预先申请的内存（默认 `main` 200 MiB、`repl` 128 MiB），内部用一条可动态调整的边界划分为低地址 **heap 区** 与高地址 **VM 工作区**。
- **双区分配器**：heap 区使用 first-fit 空闲链表 + 边界标签，供 GC 管理；VM 区使用 segregated free-list + 边界标签，满足编译期大量小对象、频繁扩容、释放的需求。
- **handle 抽象堆**：所有运行时对象通过 `am_handle_t` 引用，`am_heap_t` 维护 handle → 物理指针的映射，使 GC 压缩时可以移动对象而不破坏外部引用。
- **GC**：每个进程独立执行 tracing mark-sweep；运行时在事件循环安全点对所有进程统一执行全局标记-压缩（`am_allocator_heap_compact_global`）。
- **生命周期切换**：编译完成后模块被 deep-dump 到系统缓冲区，随后 VM 区被整体重置，运行时再从缓冲区加载模块到 heap 区执行。

---

## 二、值与对象的统一表示：TPV 与对象头

### 2.1 TPV（Tagged Pointer Value）

`am_value_t` 被定义为 `uintptr_t`，低 5 位为类型标签：

| 标签宏 | 值 | 语义 |
|---|---|---|
| `AM_VALUE_TAG_PTR` | `0x00` | 指针，指向对象 |
| `AM_VALUE_TAG_HANDLE` | `0x03` | 堆对象把柄 |
| `AM_VALUE_TAG_IADDR` | `0x05` | 指令地址 |
| `AM_VALUE_TAG_VARID` | `0x07` | 变量 ID |
| `AM_VALUE_TAG_SYMBOL` | `0x11` | 符号 / 关键字 |
| `AM_VALUE_TAG_UINT` / `INT` / `FLOAT` | `0x15`/`0x17`/`0x19` | 数值 |
| `AM_VALUE_TAG_NULL` / `UNDEFINED` / `BOOLEAN` | … | 单例立即数 |

- 立即数通过 `AM_MAKE_VALUE_OF_UINT_LIKE(x, tag)` 左移 5 位后或上标签得到。
- 浮点打包时丢弃低 5 位尾数（存在精度损失），解包时左移 5 位补 0 恢复 IEEE754 位模式。
- 特殊单例：`AM_VALUE_NULL`、`AM_VALUE_UNDEFINED`、`AM_VALUE_TRUE`、`AM_VALUE_FALSE`。
- 空把柄为 `AM_HANDLE_NULL = UINTPTR_MAX >> 5`。

### 2.2 对象基类头

所有对象共享：

```c
typedef struct am_object_t {
    uint32_t header; // bit0 static, bit1 keep-alive
    uint32_t hash;
    uint32_t gcmark; // bit31 alive
    int32_t  type;   // AM_OBJECT_TYPE_*
} am_object_t;
```

三个标志位通过 `object.c` 中的掩码操作：

```c
#define AM_OBJECT_STATIC_MASK    0x00000001u
#define AM_OBJECT_KEEPALIVE_MASK 0x00000002u
#define AM_OBJECT_ALIVE_MASK     0x80000000u
```

| 标志 | 作用 |
|---|---|
| `static` | 永生对象，GC sweep 阶段跳过。用于链接后的 AST 节点、模块加载后的初始对象。 |
| `keepalive` | 异步回调闭包等人為保持存活的对象，sweep 阶段跳过。 |
| `alive` | GC mark 阶段临时标记，sweep 后清空。 |

函数语义统一为：**返回 / 传入 0 表示“是 / 设置”，-1 表示“否 / 清除”**。

---

## 三、统一内存池与双区分配器

### 3.1 抽象分配器接口

`am_allocator_t` 是一个虚表对象：

```c
typedef struct am_allocator_vtable_t {
    void* (*malloc)(void *state, size_t size);
    void* (*calloc)(void *state, size_t size);
    void* (*realloc)(void *state, void *ptr, size_t size);
    void  (*free)(void *state, void *ptr);
    void  (*destroy)(void *state);
} am_allocator_vtable_t;
```

所有上层容器（list / map / vocab / heap / closure）都通过 `am_malloc` / `am_free` / `am_realloc` 与具体分配策略解耦。

### 3.2 内存池结构

`am_allocator_pool_t` 维护：

```c
struct am_allocator_pool_t {
    uint8_t *base;
    size_t   total_size;
    size_t   boundary;      // heap 区与 VM 区的分界线
    am_segregated_state_t vm_state;
    am_allocator_t        vm_alloc;
    am_freelist_state_t   heap_state;
    am_allocator_t        heap_alloc;
};
```

- 创建时 `boundary = total_size / 2`。
- 低地址 `[base, base+boundary)` 为 **heap 区**，由 `freelist_vtable` 管理。
- 高地址 `[base+boundary, base+total_size)` 为 **VM 工作区**，由 `segregated_vtable` 管理。

### 3.3 VM 工作区分配器：Segregated Free-List

设计原因：编译期大量 `map/list` 扩容、临时缓冲区，`bump pointer` 会快速耗尽 VM 空闲空间。

- 预定义 size class：
  - 48 B ~ 512 B，按 16 B 递增；
  - 1024 B ~ 524288 B，按 2 的幂递增；
  - 更大块进入 `large_free_head` 链表。
- 每个 class 内选择**地址最高**的空闲块，并从块的高端拆分，使已用块向 VM 区顶部聚集，低端留出连续空间，便于边界向 heap 方向移动。
- 释放时通过 `prev_size` 边界标签与前后空闲块合并。

### 3.4 heap 区分配器：First-Fit Free-List

```c
typedef struct am_heap_block_header_t {
    size_t size;       // 最低位 used
    size_t prev_size;
    struct am_heap_block_header_t *next_free;
    struct am_heap_block_header_t *prev_free;
    bool live;         // 压缩阶段临时标记
} am_heap_block_header_t;
```

- 分配时遍历 `free_list_head`，找到首个足够大的块；有剩余时从低端拆分。
- 释放时按 `prev_size` 与相邻空闲块合并。
- `live` 字段仅在全局压缩阶段使用。

### 3.5 动态边界调整

可调宏（`allocator.h`）：

```c
AM_POOL_MIN_HEAP_RATIO        0.1
AM_POOL_MIN_VM_RATIO          0.1
AM_POOL_VM_EXPAND_THRESHOLD   0.75
AM_POOL_HEAP_EXPAND_THRESHOLD 0.75
AM_POOL_VM_SLACK_THRESHOLD    0.30
AM_POOL_HEAP_SLACK_THRESHOLD  0.30
AM_POOL_BOUNDARY_ADJ_STEP     0.05
```

`am_allocator_pool_auto_adjust` 的触发条件：

- VM 使用率高（>75%）且 heap 使用率低于 30% → 边界向 VM 侧移动，heap 比例减小 5%。
- heap 使用率高（>75%）且 VM 使用率低于 30% → 边界向 heap 侧移动，heap 比例增大 5%。

`am_allocator_pool_adjust_boundary` 的限制：

- heap 扩张要求 VM 区低端有足够连续空闲空间（`vm_lowest_used_offset`），避免覆盖 VM 对象。
- VM 扩张要求当前已用 heap 对象能放入新的 heap 容量。

---

## 四、抽象堆：handle 与物理地址解耦

### 4.1 核心数据结构

```c
typedef struct am_heap_t {
    size_t        capacity;       // 固定，不扩容
    am_map_t     *table;          // handle → am_value_t
    am_map_t     *metadata;
    am_handle_t   handle_counter; // 单调递增
} am_heap_t;
```

- 全局静态计数器 `g_heap_handle_counter` 保证同一进程内 handle 不冲突。
- `am_heap_create` 接收两个分配器：`container_alloc` 管理堆结构本身与 table；`obj_alloc` 管理堆中对象。
  - 编译期通常相同；
  - 运行期 `container_alloc = vm_alloc`，`obj_alloc = heap_alloc`。

### 4.2 关键操作

| 操作 | 说明 |
|---|---|
| `am_heap_alloc_handle` | 分配新 handle，table 中插入 `AM_VALUE_NULL`；table 扩容可能改变指针。 |
| `am_heap_set` | 必须先申请 handle；替换旧值时释放旧指针对象；返回新 table 指针。 |
| `am_heap_free_handle` | 删除 handle，并 `am_free` 其指针对象。 |
| `am_heap_get` | 返回 handle 对应的 `am_value_t`。 |

### 4.3 深转储与加载

`am_heap_deep_dump` 将 heap 及其指向对象序列化为自描述二进制流：

1. 收集有效条目（跳过 `AM_OBJECT_TYPE_SCOPE` 等编译期对象），按 handle 升序排序。
2. 构造临时 `am_heap_t`，只含要转储条目。
3. 在 buffer 中先留 16 B（总长度 + heap 映射长度）。
4. 依次 dump 每个对象（仅支持 `LIST`、`WSTRING`），并将临时 table 中的 value 改为对象相对 buffer 起点的偏移量。
5. 写入压缩后的 heap 映射。
6. 返回总字节数。

`am_heap_deep_load` 逆过程：读取 16 B 头，加载 heap 映射，再按偏移量加载对象并替换 table 中的偏移值为真实指针。

这一机制被模块持久化、进程加载、`System.fork` 深拷贝共同使用。

---

## 五、基础容器对象

所有基础容器都带 `am_object_t` 头，因此既可以是解释器内部数据结构，也可以是 Scheme 层面的数据对象。

### 5.1 线性表 `am_list_t`

```c
typedef struct am_list_t {
    am_object_t base;
    size_t      capacity;
    size_t      length;
    int32_t     type;       // DEFAULT / LAMBDA / APPLICATION / QUOTE / ...
    am_handle_t parent;
    am_value_t  children[];
} am_list_t;
```

- 创建默认容量 4；扩容时翻倍，返回新指针。
- **关键约定**：`am_list_push` / `am_list_lambda_add_parameter` / `am_list_lambda_set_bodies` 扩容后可能返回新指针，调用者必须使用返回的新指针，并通过 `am_heap_set` 写回 heap。
- `am_list_dump` 压缩 capacity 到 length。

### 5.2 哈希表 `am_map_t`

```c
typedef struct am_map_t {
    am_object_t base;
    size_t length, capacity, mask, tombstones;
    am_map_entry_t slots[];
} am_map_t;
```

- 开放寻址法；capacity 为 2 的幂；空槽 `AM_VALUE_NULL`、墓碑 `AM_VALUE_UNDEFINED`。
- 哈希函数 `am_value_hash` 对 `am_value_t` 的位模式做 Murmur-like 混合，相等性为按位比较。
- 负载因子 >75% 时 `am_map_set` 自动扩容（capacity ×2），返回新 map 指针。
- `am_map_set_stable` 不扩容，用于需要指针稳定的内部场景（如 closure 内部 map，或所有权复杂时）。
- `am_map_dump` 压缩为 `length` 个有效条目，丢弃墓碑和空闲槽。

### 5.3 宽字符串 `am_wstring_t`

```c
typedef struct am_wstring_t {
    am_object_t base;
    size_t     length;
    am_value_t content[]; // 每个元素是一个 am_wchar_t TPV
} am_wstring_t;
```

- 不可变字符串；内容由 Unicode 码点数组组成，无 UTF-16 等编码。
- dump/load 仅保留实际长度。

---

## 六、运行时核心对象

### 6.1 闭包 `am_obj_closure_t`

```c
typedef struct am_obj_closure_t {
    am_object_t base;
    am_iaddr_t   iaddr;
    am_handle_t  parent;
    size_t       length;
    size_t       capacity;
    am_binding_t bindings[];
} am_obj_closure_t;

typedef struct am_binding_t {
    am_varid_t  varid;
    int32_t     type;        // AM_BINDING_BOUND / AM_BINDING_FREE
    int32_t     dirty_flag;
    am_value_t  value;
} am_binding_t;
```

- 用线性柔性数组模拟 `(varid, type) → (value, dirty_flag)` 映射，线性查找。
- 默认 capacity 16，扩容翻倍，返回新指针需写回 heap。
- `init_bound_var` 不加脏标记，`set_bound_var` 加脏标记。
- `set` 操作会同步更新同 `varid` 的 bound/free 绑定，保持变量级脏标记一致。
- 脏标记协议支持 `set!` 修改闭包链上的约束/自由变量，读取时通过 `am_process_dereference` 根据脏标记决定使用定义处值还是捕获值。

### 6.2 续体 `am_continuation_t`

```c
typedef struct am_continuation_t {
    am_object_t base;
    size_t        length;
    size_t        fstack_offset;
    am_iaddr_t    cont_return_target;
    am_handle_t   current_closure_handle;
    am_value_t    stacks[];
} am_continuation_t;
```

- `stacks[0 .. fstack_offset-1]` 为 opstack 副本；
- `stacks[fstack_offset .. length-1]` 为 fstack 副本。
- 捕获时深拷贝当前运行状态；恢复时把副本写回进程。
- GC 不递归遍历 `stacks`，因为 `am_process_gc_root` 已主动将续体内部环境加入 GC 根。

### 6.3 进程 `am_process_t`

进程是虚拟机执行单元：

```c
typedef struct am_process_t {
    am_object_t base;
    am_allocator_t *vm_alloc, *heap_alloc;
    am_pid_t pid, parent_pid;
    int32_t  state;
    am_iaddr_t PC;
    am_instruction_t *ilcode;
    am_iaddr_t ilcode_length;
    am_heap_t *heap;
    am_vocab_t *var_vocab, *symbol_vocab;
    am_list_t  *var_type;
    am_map_t   *natives;
    am_handle_t current_closure_handle;
    size_t gc_count;
    am_value_t *opstack, *opstack_top; size_t opstack_capacity;
    am_value_t *fstack, *fstack_top;   size_t fstack_capacity;
} am_process_t;
```

- `am_process_load_from_module`：
  - 通过 `am_heap_deep_dump` + `am_heap_deep_load` 将 AST 节点从 VM 区迁移到 heap 区；
  - 拷贝 IL、vocab、`var_type`、`natives`；
  - 分配 opstack（取 `mod->opstack_depth` 或 1024）与 fstack（固定 3000）；
  - 将 heap 中所有对象标记为 `static`。
- 闭包创建：`am_process_make_closure` 在 heap 中分配 handle，复制当前闭包绑定作为自由变量。
- 操作数栈在 `am_process_push_operand` 中带运行时扩容兜底（因为静态深度估计尚有问题，见 `doc/memo.md`）。

---

## 七、垃圾回收：分进程标记-清除 + 全局标记-压缩

### 7.1 GC 根

`am_process_gc_root` 收集以下根：

1. 当前闭包 handle；
2. 当前闭包内所有 handle 类型的变量绑定；
3. 操作数栈内所有 handle；
4. 函数调用栈每一帧的闭包 handle，以及这些闭包内的 handle 绑定；
5. 所有续体对象内部保存的上述环境。

实现上通过 `gc_root_helper` 复用同一套逻辑。

### 7.2 标记阶段 `am_process_gc_mark`

从根递归遍历：

- `LIST`：标记自身，递归标记所有 children。
- `WSTRING`：标记自身（内容都是立即数字符）。
- `CLOSURE`：标记自身；递归标记 `parent` 闭包与所有 handle 类型的绑定值。
- `CONTINUATION`：仅标记自身，不递归展开 `stacks`。

### 7.3 清除阶段 `am_process_gc_sweep`

遍历 heap 中所有对象：

- `static` 对象跳过；
- `keepalive` 对象跳过，并清除 alive 标记；
- 对 `LIST / WSTRING / CLOSURE / CONTINUATION`：
  - 未标记存活 → `am_heap_free_handle` 删除 handle 并释放对象；
  - 已标记存活 → 清除 alive 标记，供下次 GC 重新标记。

### 7.4 全局标记-压缩

`am_allocator_heap_compact_global(heap_alloc, heaps[], heap_count)`：

1. 收集所有 heap 中 handle 指向的存活对象（通过 `block->live` 去重）。
2. 按对象地址排序。
3. 将存活对象依次 `memmove` 到 heap 区前端，紧凑排列。
4. 使用 `reloc_entry_t` 记录旧指针 → 新指针。
5. 第一遍更新主 slot（被排序的 slot）指针；第二遍用 `bsearch` 更新 table 中其他仍指向旧地址的 slot，避免主 slot 被二次更新。
6. 尾部重建一个空闲块。
7. 调用 `am_allocator_pool_auto_adjust` 根据压缩后的使用率调整 VM/heap 边界。

单进程压缩 `am_allocator_heap_compact` 是上述全局压缩的特例（`heap_count = 1`）。

### 7.5 运行时 GC 触发策略

在 `am_runtime_event_handler` 中：

- 每个事件循环周期执行 `AM_COMPUTATION_PHASE_LENGTH` 次 tick；
- 然后对所有现存进程执行 `am_process_gc`；
- 当 `rt->gc_count % AM_HEAP_COMPACT_INTERVAL == 0` 时执行全局压缩（默认 `AM_HEAP_COMPACT_INTERVAL = 1`，即每次 GC 后都压缩）。
- `am_runtime_tick` 末尾还有一个被注释掉的 `runtime_gc_compact_if_needed`（按 50% heap 压力触发），当前未启用。

---

## 八、编译、链接与模块持久化中的内存管理

### 8.1 编译期

- AST 节点、作用域、词汇表、辅助 map/list 全部使用 `ast->alloc`（即 VM 区分配器）。
- Parser 中 list 扩容后需 `am_heap_set` 写回 `ast->nodes`。
- 编译器 `am_compiler_ctx_t` 的 `ilcode` 使用系统 `realloc`，尚未纳入统一内存池（`doc/memo.md` 中的 TODO）。

### 8.2 链接期

- `am_linker_import_ref_resolution` 将 `AM_VAR_TYPE_IMPORT_REF` 变量替换为 importee 的全限定变量名。
- 链接最后调用 `linker_mark_all_nodes_static`，将合并后的 AST 所有节点标记为 static，成为编译期永生对象。
- `am_ast_merge` 深拷贝 importee 的 nodes，迁移词汇表、元数据，并修正 parent 关系。

### 8.3 模块持久化

`am_module_t` 包含：

```c
typedef struct am_module_t {
    am_object_t base;
    uint64_t header;
    size_t   opstack_depth;
    am_ast_t *ast;
    am_instruction_t *ilcode;
    am_iaddr_t ilcode_length;
} am_module_t;
```

二进制头部魔数 `AMMOD`，版本号 1，字段包含：

- `ilcode_offset`
- `nodes_heap_offset`（deep-dump）
- `var_vocab_offset`、`symbol_vocab_offset`
- `var_type_offset`、`natives_offset`、`dependencies_offset`
- `scopes_offset`、`var_arn_mapping_offset`、`node_token_mapping_offset`
- `lambda_handles_offset`、`tailcall_handles_offset`、`var_top_offset`

`am_module_dump` 先计算总大小，再写入；`am_module_load` 按偏移恢复。

---

## 九、Native 库与外部内存

### 9.1 System 库

- `System.set_timeout` / `System.set_interval`：对回调闭包调用 `native_keepalive_closure`，设置 `keepalive` 标志，防止异步回调被 GC 回收。
- `System.fork`：深拷贝当前进程，包括 IL、vocab、栈、堆对象，并通过 `am_fork_heap_deep_copy` 重建 handle 映射。
- `System.memstat`：返回 VM/heap 容量与已用字节。

### 9.2 Math / String 库

- 数值运算统一转 float，NaN 返回 null。
- 字符串函数在 heap 区创建 `am_wstring_t`，返回 handle。
- `String.atom_to_string` 支持 boolean / null / number / symbol / wchar / handle(wstring)。

### 9.3 LLM 库

- 模型权重、词表使用全局静态变量 `g_llm`，由系统 `malloc/free` 管理，**不在 Animac 堆中**。
- `LLM.get_param` 将权重数组打包为 Scheme 列表（heap 区 handle）供 Scheme 代码使用。
- `LLM.matmul` 直接修改 Scheme 列表中的 float 值。
- 这表示 Animac 内存管理只负责“指向权重的列表骨架”，大模型缓冲区本身由外部原生内存承担。

---

## 十、入口与 REPL 的生命周期策略

### 10.1 `main.c`

流程：

1. 创建内存池（默认 200 MiB）。
2. 解析 → 链接 → 编译。
3. `am_module_dump` 将模块序列化到系统 `malloc` 缓冲区。
4. `am_allocator_pool_reset_vm` 彻底清空 VM 区。
5. `am_module_load(vm_alloc, heap_alloc, buffer, 0)` 从缓冲区加载模块到 heap 区。
6. 创建 runtime，注册 native 库，运行。
7. 销毁 runtime，释放缓冲区，销毁内存池。

### 10.2 `repl.c`

- 默认池 128 MiB。
- 每行输入包装为 `((lambda () (display <code>) (newline)))`。
- 每行表达式同样经历 parse → link → compile → dump → reset VM → load → create runtime → start → destroy。
- 因此**每行表达式之间不共享 heap**；定义 / set! / import / native 语句被追加到历史代码 `g_all_code`（系统 `malloc` 管理）。
- 输入缓冲区、历史代码缓冲区、行数组均使用系统 `malloc/realloc`。

---

## 十一、测试用例对内存管理场景的覆盖

`test/` 目录中的用例验证了不同内存管理路径：

| 用例 | 验证的内存管理方面 |
|---|---|
| `nano_llm_infer.scm` | 大数组、长循环、大量列表分配与 GC 压力；LLM 权重缓冲区与 Animac 堆的交互。 |
| `church_encoding.scm` | 大量闭包创建与调用，验证闭包绑定、自由变量、脏标记。 |
| `man_or_boy.scm` | 深层递归闭包链与 GC 根收集。 |
| `coroutine.scm` / `yinyang.scm` / `yinyang_cps.scm` | 续体捕获与恢复，验证 continuation 对象深拷贝与 GC 根。 |
| `sleepsort.scm` | 异步定时器回调，验证 `keepalive` 标志防止闭包被回收。 |
| `quicksort.scm` / `list.scm` / `mlp.scm` | 列表操作、set_item、push/pop/cons/cdr，验证列表扩容写回 heap。 |
| `fork.scm` | `System.fork` 深拷贝进程与堆对象。 |
| `big_int.scm` / `fft.scm` | 数值计算与较大数据结构。 |
| `brainfuck.scm` / `interpreter.scm` | 元编程与解释器自举，产生复杂对象图。 |

---

## 十二、关键设计决策与工程约定

1. **无引用计数**：仅使用 tracing GC（mark-sweep + compact）。对象生命周期由可达性决定。
2. **handle 间接寻址**：所有堆对象通过 `am_handle_t` 引用，GC 压缩可物理移动对象而不影响外部引用。
3. **静态对象与 keepalive**：通过对象头标志位实现两类“不通过可达性也能存活”的对象。
4. **脏标记协议**：支持 `set!` 修改闭包链上的变量，读取时沿链判断使用定义处值还是捕获值。
5. **变长容器扩容写回**：`am_list_push`、`am_closure_*_var`、`am_vocab_insert`、`am_map_set` 扩容后返回新指针，调用者必须用 `am_heap_set` 写回 heap。
6. **编译-运行内存切换**：通过 deep-dump + VM reset + deep-load 实现编译期对象到运行期堆的迁移。
7. **VM 区与 heap 区职责分离**：VM 区服务编译期短生命周期、频繁 realloc/free；heap 区服务运行期长生命周期对象，受 GC 管理。
8. **全局压缩**：多进程共享同一个底层 `heap_alloc`，因此必须一次性压缩所有进程堆，避免互相覆盖。

---

## 十三、已知限制与 TODO（来自源码与 `doc/memo.md`）

- `ilcode` 当前使用系统 `realloc`，未统一进池分配器。
- 浮点 TPV 精度损失 5 位。
- `opstack` 深度静态估计仍有问题，目前依赖运行时扩容兜底。
- `Symbol` 的相等性计划改为按字符串内容比较（目前按 symbol id）。
- 未来可能探索 COW fork、模块作为内置对象、队列 FIFO 等。
- 长远目标：不使用系统 `malloc`，完全由统一内存池管理。

---

## 十四、结论

Animac 的内存管理是一套围绕“统一池 + 双分配器 + handle 抽象堆 + 标记-清除-压缩 GC”构建的完整方案。它通过 handle 间接寻址解耦了逻辑引用与物理地址，使全局压缩成为可能；通过 VM/heap 分区适应了编译期与运行期截然不同的分配模式；通过 `static` / `keepalive` / dirty-flag 等对象头标志支持了模块永生对象、异步回调闭包和 `set!` 语义；通过 deep-dump / deep-load 完成了编译期到运行期的内存形态切换。当前实现已在闭包、续体、异步定时器、LLM 推理、fork 等多种复杂测试场景下经受检验，并在 `doc/memo.md` 中记录了若干后续演进方向。

------

# 内存管理机制研究

## 摘要

Animac 是一个以 C 语言实现的 Scheme 解释器与虚拟机，其内存子系统围绕“统一内存池、双区分配器、抽象堆把柄间接寻址以及分进程标记—清除—全局压缩式垃圾回收”四条主线展开。本文在不对源码做任何修改的前提下，系统梳理其内存管理的设计思想、数据结构、分配策略、垃圾回收算法、编译—运行期内存形态转换、原生库与外部内存的交互，以及测试用例对该机制的验证。研究发现，Animac 通过把柄（handle）将逻辑引用与物理地址解耦，从而在多进程共享的堆区上安全地执行全局对象压缩；通过把编译期高频、短命的 VM 工作对象与运行期受垃圾回收管理的长命堆对象分离到同一内存池的两个可调分区，兼顾了编译器的灵活性与运行时的可控性；同时，对象头中的静态标志与保持存活标志、闭包绑定中的脏标记协议、续体的值拷贝语义等机制，共同支撑了模块永生对象、异步回调闭包、`set!` 变量修改以及 first-class continuation 等高级语言特性。

## 1 引言

解释型语言的内存管理通常需要在两类看似矛盾的需求之间取得平衡：一方面，编译期和链接期会产生大量生命周期短、大小差异大、频繁扩容与释放的临时数据结构；另一方面，运行期需要为闭包、列表、字符串、续体等对象提供相对稳定且可自动回收的堆空间。Animac 的设计者选择了一条相对少见但逻辑自洽的道路：先向操作系统申请一整块固定大小的内存池，然后在池内用一条动态边界将其划分为低地址的“堆区”与高地址的“VM 工作区”，分别采用不同的分配器策略；所有运行期对象再通过一个抽象堆以单调递增的把柄进行间接引用，使得垃圾回收不仅可以在单个进程内执行标记—清除，还可以在安全点对所有进程共享的物理堆区执行全局压缩。本文将逐层剖析这一体系。

## 2 总体设计思想

Animac 内存子系统的核心目标可以概括为三点：逻辑引用的稳定性、物理布局的可调整性、以及编译期与运行期内存使用的可切换性。

逻辑引用的稳定性通过“抽象堆”实现。`am_heap_t` 维护了一个从 `am_handle_t` 到 `am_value_t` 的映射表；运行期代码、操作数栈、闭包绑定、续体快照中保存的都不是对象指针本身，而是把柄。只要把柄在其生命周期内数值不变，底层分配器就可以自由移动对象，而无需逐处修正引用。

物理布局的可调整性来自统一内存池与动态边界。由于编译期和运行期不会同时活跃——编译完成后模块被序列化到外部缓冲区，VM 区即可整体丢弃——二者可以共享同一块物理内存。池内边界根据两区的实际使用率动态滑动：当 VM 工作区压力增大而堆区富余时，边界向堆区移动；反之亦然。

编译期与运行期的切换则依赖“深转储—深加载”机制。AST 节点、词汇表、辅助映射表等编译产物通过 `am_heap_deep_dump` 序列化为自描述二进制流，随后 VM 区被重置，运行时再通过 `am_heap_deep_load` 将对象加载到堆区。这一过程同时完成了对象物理归属的迁移：编译期对象使用 VM 分配器，运行期对象使用堆分配器。

## 3 值的表示与对象头

Animac 中所有值统一编码为 `am_value_t`，即一个带标签的整型。其低五位用作类型标签：最低位为 0 表示指针，最低位为 1 表示立即数，其余四位进一步区分把柄、指令地址、变量编号、符号、各种数值以及空值、未定义值、布尔值等。这种 TPV（Tagged Pointer Value）方案使得列表、闭包等容器可以在同一个数组中存放不同类型的值，同时保持小整数、布尔值、空值等常见值的零额外内存开销。

浮点数的编码是 TPV 中值得注意的细节。为了把 IEEE754 浮点位模式塞入去掉低五位后的空间，编码时丢弃了浮点数的低五位尾数，解包时再左移五位补零恢复。这不可避免地带来精度损失，是设计中为统一值类型所作出的折中。

所有堆对象共享一个四字节的基类头 `am_object_t`，其中包含四个字段：`header` 用于静态标志与保持存活标志，`hash` 用于缓存散列值，`gcmark` 用于垃圾回收的存活标记，`type` 用于区分对象种类。三个标志位分别通过最低位、次低位和最高位管理：静态对象在垃圾回收的清除阶段被永久跳过；保持存活对象则用于被异步定时器引用但暂时不在任何可达路径上的闭包；存活标记仅在标记阶段使用，并在每次清除结束后清空，以便下一轮回收重新判断。

## 4 统一内存池与双区分配器

### 4.1 统一池的整体结构

`am_allocator_pool_t` 是 Animac 内存管理的最底层实体。它在初始化时通过标准库向操作系统申请一整块连续内存，并默认以池容量的一半作为堆区与 VM 区的初始边界。池内维护两个状态机：低地址部分由 `am_freelist_state_t` 管理，对应堆分配器；高地址部分由 `am_segregated_state_t` 管理，对应 VM 分配器。两个分配器共享同一物理内存基址，但通过边界互斥使用各自区域。

这种设计的合理性建立在编译期与运行期交替执行的生命周期之上。编译阶段产生的 AST 节点、作用域、词汇表、映射表、列表等对象数量庞大、生命周期差异显著，且大量调用 `am_realloc` 进行扩容；如果把这些对象直接放在受 GC 管理的堆区，频繁的分裂、合并与碎片将给垃圾回收带来不必要的开销。因此设计者为 VM 工作区单独实现了一个 segregated free-list 分配器，而为运行期对象保留了一个 first-fit free-list 分配器。

### 4.2 VM 工作区分配器

VM 分配器采用 segregated free-list 策略。它预先定义了一系列 size class：从 48 字节到 512 字节按 16 字节递增，随后从 1024 字节到 524288 字节按二的幂次递增，超过最大 class 的块则进入单独的大块空闲链表。每个 class 维护一个空闲块链表，分配时从满足请求大小的最小 class 开始向上查找。

为了配合动态边界调整，VM 分配器在拆分策略上做了专门优化：当一个空闲块大于所需大小时，它从块的**高端**拆分，低端保持空闲。这样，已分配块倾向于聚集在 VM 区顶部，而低端形成尽可能大的连续空闲区。当运行时需要把边界向 VM 方向移动、从而扩大 VM 区时，低端连续空闲块可以直接并入 VM 区；当需要把边界向堆方向移动、从而扩大堆区时，又可以把 VM 区低端尚未使用的部分安全地划分给堆区，而不会影响顶部已分配的 VM 对象。

释放时，VM 分配器通过每个块头部保存的 `prev_size` 边界标签，检查前驱与后继块是否均为空闲，若是则将其从对应 class 链表中移除、合并成更大的块，再重新插入合适的 class。这种边界标签合并机制有效抑制了 VM 区内部碎片。

### 4.3 堆区分配器

堆区使用 first-fit free-list 管理。所有空闲块通过双向链表串接，分配时从链表头部开始顺序查找第一个足够大的空闲块。如果该块在分出请求大小后仍有足够余量，则从块的低端拆分，剩余部分重新插入空闲链表；如果余量过小，则整块标记为已分配。释放时同样通过 `prev_size` 与相邻空闲块合并。

与 VM 分配器不同，堆区对象的生命周期由垃圾回收统一管理，因此堆块头部额外包含一个 `live` 字段，仅在全局压缩阶段用于标记哪些已分配块是存活的。堆区分配器本身不主动整理内存，碎片化问题由全局压缩阶段统一解决。

### 4.4 动态边界调整

边界调整是统一池的核心机制之一。系统通过一组阈值宏控制边界移动：当 VM 区使用率超过 75% 且堆区使用率低于 30% 时，认为 VM 区压力过大而堆区有富余，于是将边界向堆区方向移动 5% 的池容量，即减小堆区比例；反之，当堆区使用率超过 75% 且 VM 区使用率低于 30% 时，边界向 VM 区方向移动，增大堆区比例。同时，边界调整受最小比例限制，确保任一区域不会小于池容量的 10%。

边界移动并非简单的指针加减。向堆区扩张时，必须保证 VM 区低端存在足够的连续空闲空间，不能覆盖任何已分配的 VM 对象；为此系统会扫描 VM 区，找到第一个已用块相对于 VM 基址的偏移，从而确定边界允许移动的最大位置。向 VM 区扩张时，则要求当前已用堆对象能够全部放入新的堆容量之内。边界调整后，两个分配器的状态会按新边界重新初始化：堆区在已用对象之后重建一个尾部空闲块，VM 区则把新增空间作为空闲块并入对应 class 链表。

## 5 抽象堆：把柄与物理地址的解耦

`am_heap_t` 是 Animac 运行时的逻辑堆。它本质上是一个开放寻址哈希表，把 `am_handle_t` 映射到 `am_value_t`。每个 `am_heap_t` 实例拥有独立的把柄计数器，从一个全局单调递增计数器继承初始值，以保证同一进程内不同堆实例的把柄不会冲突。

抽象堆的创建接口区分了“容器分配器”与“对象分配器”两个角色：容器分配器负责堆结构本身以及内部 table、metadata 等元数据；对象分配器负责堆中实际对象。在编译期，二者通常指向同一个 VM 分配器；在运行期，容器分配器使用 VM 分配器，对象分配器使用堆分配器。这一区分使得深加载时可以把元数据放在 VM 区，而用户对象放在 GC 管理的堆区。

把柄的申请、设置、释放遵循严格约定。申请把柄时，系统先在 table 中插入一个空值条目，并返回新把柄；设置把柄时，必须确保该把柄已经存在，否则视为非法使用。设置新值前，系统会保存旧指针值并清空槽位，以避免底层 map 的替换逻辑误释放对象；设置成功后再用对象分配器释放旧对象。释放把柄时，先取出指针对象、清空槽位、删除条目，最后释放对象。这种“先 detach 再释放”的模式在堆操作中反复出现，是避免双重释放或错误分配器释放的关键。

抽象堆的深转储与深加载是连接编译期与运行期的桥梁。深转储时，系统收集 table 中所有指针类型的有效条目，跳过仅用于编译期的作用域对象；然后构造一个临时堆映射，只保留这些条目；接着按把柄升序依次转储每个对象，并将临时映射中的值替换为对象相对于缓冲区起点的偏移量；最后把压缩后的堆映射写入缓冲区头部。深加载则反过来：先读取头部两个长度字段，加载堆映射，再遍历映射中的每个偏移量，按对象类型调用对应的加载函数，最终把 table 中的偏移值替换为新分配的对象指针。

## 6 运行时对象的内存布局与语义

### 6.1 列表、映射与字符串

`am_list_t` 是一个带对象头的动态数组，其柔性数组 `children` 存储 `am_value_t`。列表对象根据 `type` 字段区分普通列表、lambda 节点、应用节点、quote 节点等。由于列表扩容会重新分配整个对象并返回新指针，调用者必须检查返回值是否与旧指针不同，并在必要时通过 `am_heap_set` 把新指针写回抽象堆。这一“扩容后写回”的约定同样适用于映射与闭包。

`am_map_t` 是一个开放寻址哈希表，capacity 恒为二的幂，以支持按位与快速取模。它使用两个特殊空值表示空槽与墓碑，哈希函数基于 `am_value_t` 的位模式做 Murmur 风格的混合，相等性为按位比较。`am_map_set` 在负载因子超过 75% 时自动翻倍扩容并重新哈希，返回新映射指针；而 `am_map_set_stable` 则保证不扩容、指针稳定，用于调用者需要维持容器地址不变的内部场景。深转储时，映射会被压缩为仅含有效条目的紧凑形式。

`am_wstring_t` 是不可变宽字符串，其内容以 `am_value_t` 数组保存 Unicode 码点，没有 UTF-16 等编码层。转储时只保留实际长度，不保留 capacity。

### 6.2 闭包与变量绑定

`am_obj_closure_t` 使用线性柔性数组存储变量绑定，每个绑定记录变量编号、绑定类型（约束变量或自由变量）、脏标记以及值。闭包默认容量为 16，扩容时翻倍，新对象复制头部与已有绑定，旧对象释放。查找采用线性扫描，这是因为绝大多数闭包的绑定数量极少，线性查找的常数开销低于哈希表维护成本。

闭包设计中的关键创新是脏标记协议。初始化约束变量或自由变量时，脏标记为 0；而通过 `set!` 修改变量时，脏标记置 1，并且同一闭包内同变量编号的约束绑定与自由绑定会同步置脏。变量解引用时，系统先在当前闭包查找约束变量；若不存在，则沿 `parent` 闭包链上溯到变量定义处。若定义处脏标记为真，说明该变量已被 `set!` 修改，应使用定义处的当前值；否则使用当前闭包中捕获的自由变量值。这一协议在保持闭包值语义的同时，正确实现了 Scheme 的变量赋值语义。

### 6.3 续体

`am_continuation_t` 捕获进程在某一时刻的运行状态，包括返回地址、当前闭包把柄、操作数栈与函数调用栈的扁平副本。由于操作数栈与函数调用栈在捕获后只读，续体把它们紧密存放在一个柔性数组中，前半段为操作数栈，后半段为函数调用栈。恢复续体时，系统把这些副本写回进程的栈空间，并恢复当前闭包与程序计数器。

在垃圾回收中，续体对象本身被标记为存活，但其内部栈中的把柄不会通过续体递归标记；相反，这些把柄已在 GC 根收集阶段通过 `gc_root_helper` 显式加入根集合。这样可以避免重复遍历，同时保证续体内部环境不被过早回收。

### 6.4 进程

`am_process_t` 是虚拟机调度的基本单位，包含独立的程序计数器、中间语言代码副本、抽象堆、操作数栈、函数调用栈，以及从 AST 继承的词汇表与本地库记录。进程从模块加载时，会执行一次完整的内存形态迁移：先通过深转储把编译期 AST 节点序列化到 VM 区缓冲区，再通过深加载把节点还原到堆区，随后将堆中所有对象标记为静态，从而避免运行期垃圾回收误删初始程序结构。

操作数栈的容量来自编译期静态分析的 `opstack_depth`，但由于当前静态分析对复杂表达式和 `begin` 结构的深度估计仍有偏差，运行时 `am_process_push_operand` 中加入了兜底扩容逻辑：当栈满时按两倍扩展并迁移数据。函数调用栈则采用固定容量 3000，目前不支持动态扩展。

## 7 垃圾回收

Animac 的垃圾回收分为两个层次：每个进程独立执行的标记—清除，以及运行时在安全点对所有进程共享堆区执行的全局标记—压缩。

### 7.1 GC 根的收集

`am_process_gc_root` 负责把进程当前可达对象的全部入口收集到一个临时列表中。根集合包括：当前闭包本身；当前闭包内所有把柄类型的变量绑定；操作数栈中保存的把柄；函数调用栈每一帧保存的闭包把柄，以及这些闭包内部的把柄绑定；最后，所有已保存续体对象内部对应的上述环境也会被递归地加入根集合。通过 `gc_root_helper` 这一统一辅助函数，系统避免了为不同环境分别编写重复逻辑。

### 7.2 标记阶段

标记从根集合出发递归遍历。列表对象标记自身后递归标记所有子元素；宽字符串仅标记自身；闭包标记自身后递归标记父闭包以及所有把柄类型的绑定值；续体仅标记自身，不展开内部栈。系统通过对象头中的 `alive` 标志记录对象是否已被访问，避免循环引用导致无限递归。

### 7.3 清除阶段

清除阶段遍历整个抽象堆。静态对象与保持存活对象被直接跳过，其中保持存活对象还会被清除 `alive` 标记，以便下一轮回收重新判断。对于列表、字符串、闭包、续体四类对象，若未被标记为存活，则调用 `am_heap_free_handle` 删除把柄并释放对象；若已被标记，则清除 `alive` 标记，等待下一轮回收。

### 7.4 全局压缩

全局压缩在运行时的 GC 安全点执行，目标是解决堆区碎片化问题。它收集所有进程堆中 handle 指向的、物理上位于堆区内的存活对象，按地址排序。随后，系统将这些存活对象依次移动到堆区最前端，使已用块紧凑排列。为了避免更新指针时出错，系统记录每对“旧物理地址—新物理地址”的映射关系：主 slot 在移动循环中直接更新；其他 slot 则通过二分查找判断其保存的指针是否落在某个旧地址上，若是再替换为新地址。这种机制确保了一个对象的新地址恰好等于另一个对象旧地址时，不会被二次错误更新。移动完成后，堆区尾部剩余空间被重建为一个空闲块，随后系统调用边界自动调整函数，根据新的使用率重新划分 VM 与堆的边界。

## 8 编译—运行期内存形态转换

编译器输出的是一个 `am_module_t`，其中包含 AST 的抽象堆、中间语言指令序列、以及词汇表等元数据。由于这些对象在编译期使用 VM 分配器，而运行时需要把它们迁移到堆区，Animac 采用“序列化—重置—反序列化”的三段式切换。

在 `main.c` 中，编译完成后首先调用 `am_module_dump` 把模块整体写入由标准库 `malloc` 分配的缓冲区。该函数会先把 AST 节点通过 `am_heap_deep_dump` 序列化，再把 IL 代码、词汇表、各类映射表与列表依次写入，形成一个带有魔数与版本号的二进制模块格式。随后，VM 区被整体重置，所有编译期对象被丢弃。最后，运行时从缓冲区调用 `am_module_load`，把 IL 代码和元数据加载到 VM 区，把 AST 节点加载到堆区，并标记为静态对象。整个切换过程确保运行期启动时拥有一个干净的 VM 区和一个仅含必要初始对象的堆区。

REPL 的生命周期更加激进：每一行输入都会触发完整的编译—转储—重置—加载—运行—销毁流程。行与行之间不共享堆，历史代码通过系统 `malloc` 维护的缓冲区累积。这种设计简化了 REPL 的状态管理，但也意味着每行表达式结束时所有运行时对象都会被释放，定义和赋值语句的持久化依赖历史代码缓冲区的文本累积。

## 9 原生库与外部内存

原生函数与 Animac 堆的交互体现了边界管理的重要性。System 库的 `set_timeout` 与 `set_interval` 在注册定时器回调前，会把回调闭包标记为 `keepalive`，因为回调闭包在触发前并不位于任何 GC 根可达路径上；否则这些异步闭包可能在首次触发前就被回收。`System.fork` 则深拷贝当前进程，包括复制 IL 代码、操作数栈、函数调用栈，并通过两遍扫描深拷贝堆对象：第一遍为每个源把柄分配新把柄并复制对象，第二遍修正对象内部保存的把柄引用。

Math 与 String 库创建的返回值对象都位于堆区，并通过把柄返回给 Scheme 代码。LLM 库是一个特殊案例：模型权重、词表等大规模数据使用全局静态变量 `g_llm` 管理，通过系统 `malloc` 分配，位于 Animac 堆之外；Scheme 程序通过 `LLM.get_param` 获得的是指向这些外部权重数组的列表骨架，列表元素中的浮点值可被 `LLM.matmul` 直接修改。这种安排使得解释器不必把数兆字节级别的模型参数纳入垃圾回收范围，同时仍允许 Scheme 层通过列表抽象访问权重。

## 10 测试验证

`test/` 目录中的用例覆盖了内存管理的关键路径。`church_encoding.scm` 与 `man_or_boy.scm` 通过大量闭包创建与深层闭包链，验证了闭包绑定、自由变量以及 GC 根收集的正确性；`coroutine.scm`、`yinyang.scm` 与 `yinyang_cps.scm` 频繁捕获与恢复续体，检验了续体对象的深拷贝与 GC 根处理；`sleepsort.scm` 利用 `System.set_timeout` 创建大量异步回调，验证了 `keepalive` 标志对闭包存活性的保障；`quicksort.scm`、`list.scm` 与 `mlp.scm` 通过列表的构造、修改、拼接和索引操作，考验了列表扩容与抽象堆写回机制；`fork.scm` 测试了进程深拷贝后堆对象把柄映射的正确性；`nano_llm_infer.scm` 则在长循环、大数组和多次矩阵运算下施加持续内存压力，展示了 GC 与全局压缩在真实工作负载中的行为。

## 11 讨论

Animac 的内存管理在工程上呈现出几个显著特点。第一，把柄间接寻址虽然增加了一次查表开销，但换来了 GC 压缩时对象可移动的优势，也简化了进程 fork、模块加载等需要重建对象图的复杂操作。第二，统一内存池加动态边界的设计有效解决了编译期与运行期内存需求此消彼长的问题，避免了为两个阶段分别预留固定上限空间造成的浪费。第三，对象头标志位与脏标记协议用极小的元数据开销支撑了静态对象、异步保持、变量赋值等语义，体现了对 Scheme 特性的针对性设计。

然而，当前实现也存在可改进之处。中间语言指令序列目前仍使用系统 `malloc/realloc`，未纳入统一池，这与项目长远目标“不使用系统 malloc”相悖。浮点 TPV 的精度损失可能影响对数值敏感的应用。操作数栈深度静态分析的不准确导致运行时依赖兜底扩容，既增加不确定性，也引入了 VM 区内存分配失败的风险。此外，函数调用栈容量固定，深度递归场景下可能溢出。这些限制在 `doc/memo.md` 中已被记录为后续工作。

## 12 结论

Animac 的内存管理是一套围绕统一内存池、双区分配器、把柄抽象堆、标记—清除—压缩垃圾回收构建的完整方案。它通过逻辑引用与物理地址的解耦，使全局对象压缩与多进程共享堆区成为可能；通过 VM 区与堆区的职责分离，兼顾了编译期的灵活分配与运行期的自动回收；通过对象头标志、闭包脏标记、续体快照等机制，正确支撑了 Scheme 的模块、闭包、赋值、续体与异步回调等核心特性。当前代码已在多种复杂测试场景下得到验证，并在文档中明确了进一步优化的方向。

# 宏

下面给出一份基于现有 Animac 实现的 **R5RS `syntax-rules` 卫生宏机制** 的详细设计方案。方案的目标是在不推翻现有编译链路的前提下，把宏展开做成一个“编译期 AST → AST”的转换阶段，并最大限度复用已有的 ARN、节点堆、列表/字符串对象、编译器等基础设施。

---

## 1. 现有架构回顾（与宏机制相关的部分）

- 编译链路：`am_parse`（词法/语法/ARN） → `am_link`（模块合并、import 解析） → `am_compile`（生成 IL） → VM 执行。
- 当前没有宏系统，也没有运行期 `eval`；所有语义分析都在编译期完成。
- AST 以 `am_list_t` 为核心节点，节点之间通过 `am_handle_t` 在 `ast->nodes` 堆中互相引用。
- 变量以 `am_varid_t` 标识，ARN 后格式为 `module_id.lambda_handle.var_name`，具有全局唯一性。
- `am_parser_tail_call_analysis`、`lambda_handles`、`var_top` 都是在 AST 上维护的元数据，供后端使用。
- `quote/quasiquote/unquote` 已被解析成独立的 list 类型，说明 AST 已经具备“同像性”基础。

---

## 2. 总体设计思想

把 `syntax-rules` 宏系统实现为 **“ARN 之后、链接之前”** 的一个独立 AST 转换阶段，核心思路是：

1. **在 ARN 之后做宏展开**。  
   因为 ARN 已经给每个标识符赋予了携带作用域信息的唯一 `varid`，宏模板中那些“非模式变量”的标识符可以直接复用这些 ARN 后的 `varid`，天然指向宏定义处的绑定，从而解决“自由标识符卫生”问题。

2. **仅对模板内部新引入的绑定做换名（freshen）**。  
   模板里的 `lambda` 形参、`define` 左值等“在模板内部被绑定”的标识符，每次展开时都要生成新的 `varid`，保证多次展开不会共享同一个临时变量。

3. **模式变量直接替换为使用处已有的 AST 子树**。  
   由于使用处的代码也已经过 ARN，替换进去的子树自带正确的词法作用域信息。

4. **展开后刷新 AST 元数据**。  
   展开可能产生新的 `lambda` 节点、改变尾调用结构、新增顶层 `define`，因此需要重建 `lambda_handles`、重新运行尾位置分析、重新计算 `var_top`。

---

## 3. 支持的语言特性范围（MVP）

| 特性 | 是否支持 | 说明 |
|------|----------|------|
| `syntax-rules` | ✅ | 核心机制 |
| `define-syntax` | ✅ | 顶层或函数体内部 |
| `let-syntax` / `letrec-syntax` | ✅ | 局部宏绑定 |
| `_` 通配符 | ✅ | 已有关键字 `AM_VALUE_KW_underscore` |
| `...` 省略号 | ✅ | 已有关键字 `AM_VALUE_KW_dot3` |
| literals | ✅ | 关键字、内置变量、普通标识符 |
| 嵌套宏 | ✅ | 展开结果再展开 |
| 跨模块导入/导出宏 | ❌（一期不做） | `import` 目前只导值；宏环境未参与 `am_ast_merge` |
| `syntax-case` / `syntax` 对象 | ❌ | 远超 MVP |
| 非卫生宏 / `define-macro` | ❌ | 不兼容现有 ARN 设计 |

---

## 4. 新增数据结构（建议新增 `macro.h/c`）

### 4.1 宏描述符

```c
typedef struct am_macro_clause_t {
    am_value_t   pattern;        // 模式 AST（handle 或立即数）
    am_value_t   template;       // 模板 AST
    am_varid_t  *pvars;          // 模式变量 varid 数组
    size_t       pvar_count;
} am_macro_clause_t;

typedef struct am_macro_t {
    am_varid_t           name;   // 宏名（ARN 后的 varid）
    am_ast_t            *ast;    // 所属 AST
    am_value_t           literals; // literals 列表（handle 或 AM_VALUE_NULL）
    am_macro_clause_t   *clauses;
    size_t               clause_count;
    size_t               expansion_counter; // 用于生成 fresh varid
} am_macro_t;
```

### 4.2 宏环境

宏环境只在编译期存在，展开结束后即可释放：

```c
typedef struct am_macro_env_frame_t {
    am_map_t *bindings;                 // varid -> am_macro_t*
    struct am_macro_env_frame_t *parent;
} am_macro_env_frame_t;
```

### 4.3 展开上下文

```c
typedef struct am_macro_expand_ctx_t {
    am_ast_t                *ast;
    am_macro_env_frame_t    *env;
    size_t                   expansion_id; // 每次展开自增，用于 fresh varid
    am_map_t                *fresh_map;    // 模板内绑定 varid -> fresh varid
    am_map_t                *subst;        // 模式变量 varid -> 匹配到的 AST 值
    am_handle_t              parent;       // 新节点应挂到的父节点
    int                      error;
    wchar_t                  error_msg[256];
} am_macro_expand_ctx_t;
```

---

## 5. 词法/语法层改动

需要在 `AM_KEYWORDS` 末尾新增 4 个关键字（保持前 24 个不变，避免冲击现有 `AM_VALUE_KW_*` 常量）：

- `define-syntax`
- `let-syntax`
- `letrec-syntax`
- `syntax-rules`

并在 `object.h` 增加对应的 `AM_VALUE_KW_*` 宏（例如 `AM_VALUE_KW_syntax_rules` 取索引 24）。

`...` 和 `_` 已经是关键字，无需改动。

---

## 6. 编译链路中的插入位置

在 `am_parse` 的现有流程中，把宏展开放在 **Alpha-renaming 之后、scope 对象清理之前/之后均可**：

```
am_lexer
am_build_symbol_vocabulary
am_build_variable_vocabulary
递归下降解析
preprocess_analysis
alias_rename_analysis
alpha_rename_analysis
↓↓ 新增 ↓↓
am_macro_expand(ast)          // 宏展开
↓↓ 原有 ↓↓
cleanup_scope_objects
populate_top_lambda_and_var_top
```

`am_macro_expand` 内部完成：

1. 第一次遍历：收集所有 `define-syntax` / `let-syntax` / `letrec-syntax`，构建 `am_macro_t`。
2. 第二次遍历：在宏环境中展开 AST。
3. 展开结束后：
   - 重建 `ast->lambda_handles`；
   - 重新调用 `am_parser_tail_call_analysis(ast)`；
   - 重新计算 `ast->var_top`。

`am_compile` 中在 `compile_application` 里把 `define-syntax`、`let-syntax`、`letrec-syntax`、`syntax-rules` 当作 `import/native` 一样跳过（防御性处理）。

---

## 7. 核心算法

### 7.1 `syntax-rules` 解析

对于节点：

```scheme
(syntax-rules (literal ...)
  (pattern template)
  ...)
```

验证与提取：

- 第 1 子节点是 `syntax-rules` 关键字符号。
- 第 2 子节点是 literals 列表（application 类型，子元素为 `varid` 或 symbol）。
- 从第 3 子节点开始，每个子节点必须是 `(pattern template)`。

对每个 clause：

- `pattern` 和 `template` 是 AST 子树。
- 从 `pattern` 中收集**模式变量**：所有 `varid`，但排除：
  - literals 中列出的 varid；
  - `...` / `_`；
  - symbol 类型的关键字。
- 存入 `am_macro_clause_t.pvars`。

### 7.2 模式匹配

`match(pattern, input, subst)` 递归进行：

| pattern | 匹配规则 |
|---------|----------|
| `_`（symbol） | 总是成功，不绑定 |
| `varid` 且在 literals 中 | input 必须是相同 varid |
| `varid` 且在模式变量中 | 绑定到 input；若已绑定则要求相等 |
| symbol / 立即数 | 按 TPV 按位比较 |
| list | 逐元素匹配；遇到 `P ...` 时按 ellipsis 处理 |
| 尾部的 `. rest` | 支持 dotted 模式 |

**ellipsis 匹配**：

遇到 `(P ... . rest)` 时，设剩余模式需要 `rest_len` 个元素，则对 `k = 0 .. available - rest_len` 尝试把 `P` 匹配 `k` 次，每次把匹配结果追加到对应模式变量的列表绑定中，再继续匹配 `rest`。由于 Animac 的宏用例规模不大，回溯实现即可。

### 7.3 模板实例化与卫生

实例化 `instantiate(template)` 时维护两张表：

- `subst`：模式变量 varid → 使用处匹配到的 AST 值。
- `fresh_map`：模板内部绑定 varid → 本次展开生成的新 varid。

**步骤 1：预扫描模板，找出“模板内部绑定标识符”**

只收集绑定位置：

- `lambda` 节点的参数 varid；
- `(define var ...)` 左值的 varid。

这些标识符需要在每次展开时换名。注意：**如果它们同时也是模式变量，则优先按模式变量替换，不加入绑定集合**。

**步骤 2：实例化**

```c
am_value_t instantiate(ctx, template) {
    if (template 是模式变量 varid) {
        return subst[template];          // 替换为使用处子树
    }
    if (template 是模板内绑定 varid) {
        if (fresh_map 中无) {
            fresh_map[template] = am_ast_make_macro_fresh_varid(
                ast, template, ctx->expansion_id);
        }
        return fresh_map[template];
    }
    if (template 是其它 varid / symbol / 立即数) {
        return template;                 // 保持不变，保留 ARN 结果
    }
    if (template 是 handle) {
        am_list_t *lst = ...;
        am_handle_t new_handle = 深拷贝列表框架;
        // 递归实例化每个 child，注意 ellipsis
        for (i = 0; i < lst->length; ) {
            if (i+1 < len && child[i+1] 是 '...') {
                按 ellipsis 规则展开 child[i]；
                i += 2;
            } else {
                复制 instantiate(child[i]);
                i += 1;
            }
        }
        // lambda 节点要加入 ast->lambda_handles
        return new_handle;
    }
}
```

**生成 fresh varid 的方式**：

```c
am_varid_t am_ast_make_macro_fresh_varid(am_ast_t *ast,
    am_varid_t base, size_t expansion_id)
{
    // 格式：module_id.M<expansion_id>.<原变量名>
}
```

并把 `ast->var_type[new_varid]` 设为 `AM_VAR_TYPE_NEW`。

这样：

- 模板里自由引用的 `lambda`、`if`、`+`、模块内 helper 等标识符保持原 `varid`，指向宏定义环境；
- 模板里引入的临时变量每次展开得到新的 `varid`，不会与使用处或多次展开冲突；
- 模式变量被替换为使用处已经 ARN 过的子树。

### 7.4 Ellipsis 模板展开

在模板列表中遇到 `(T ...)` 时：

1. 收集 `T` 中出现的所有模式变量。
2. 这些模式变量在 `subst` 中必须是列表（由 ellipsis 模式匹配产生），且长度相同，记为 `n`。
3. 对 `i = 0 .. n-1`，用临时替换表 `{pv -> pv[i]}` 实例化 `T`，并把结果依次拼入输出列表。
4. 若 `T` 中没有模式变量，属于非法 `syntax-rules` 用法，报错。

### 7.5 `define-syntax` / `let-syntax` 处理

- **`define-syntax`**：  
  在遍历 body 时按顺序遇到 `(define-syntax name transformer)`，解析 `transformer`，把 `name -> macro` 加入当前宏环境，**不输出该节点**。

- **`let-syntax` / `letrec-syntax`**：  
  解析所有绑定，压入新的宏环境帧，递归展开 body，然后把整个节点替换为 `(begin expanded-body ...)`。

宏环境按词法作用域嵌套：进入子表达式时继承当前环境；进入 `let-syntax` 时扩展；离开时回退。

---

## 8. 深拷贝与节点堆管理

模板实例化必然产生新 AST 节点，需要深拷贝 helper：

```c
am_handle_t am_macro_deep_copy_subtree(am_ast_t *ast,
    am_handle_t src_handle, am_handle_t new_parent);
```

功能：

- 对 `AM_OBJECT_TYPE_LIST`：用 `am_list_copy` 复制框架，递归复制 children；
- 对 `AM_OBJECT_TYPE_WSTRING`：用 `am_wstring_copy` 复制；
- 对 lambda 节点：复制后把新 handle 加入 `ast->lambda_handles`；
- 设置 `new_lst->parent = new_parent`。

被替换进去的“模式变量匹配子树”也要做深拷贝，避免多个展开位置共享同一个 `parent` 字段。

---

## 9. 展开后元数据刷新

宏展开会改变 AST 结构，以下元数据必须重建：

1. **`lambda_handles`**  
   遍历 `ast->nodes` 中所有 `AM_OBJECT_TYPE_LIST` 且 `type == AM_LIST_TYPE_LAMBDA` 的节点，重建列表。

2. **`tailcall_handles`**  
   直接调用已有的 `am_parser_tail_call_analysis(ast)`。

3. **`var_top`**  
   遍历顶层 lambda 的 bodies，找到 `(define var ...)`，把 `var` 加入 `var_top`。

4. **`var_arn_mapping`**  
   宏生成的 fresh varid 不需要再映射回旧名，因此 `var_arn_mapping` 只保留原代码的映射即可，无需更新。

---

## 10. 与现有模块的集成点

| 文件 | 改动 |
|------|------|
| `include/object.h` | 追加 `syntax-rules` 等关键字宏 |
| `src/lexer.c` / `AM_KEYWORDS` | 追加 4 个新关键字 |
| `include/ast.h` | 可新增 `AM_VAR_TYPE_*` 常量；若需要把宏环境挂到 AST 则新增字段（也可不挂） |
| `include/macro.h` + `src/macro.c` | 新增宏展开全部实现 |
| `src/parser.c` | `am_parse` 中在 ARN 后调用 `am_macro_expand(ast)` |
| `src/compiler.c` | `compile_application` 中跳过 `define-syntax` / `let-syntax` / `letrec-syntax` / `syntax-rules` |
| `test/` | 新增测试用例 |

---

## 11. 关键边界情况与处理

- **模式变量与模板绑定同名**：模式变量优先；这样 `(define-syntax foo (syntax-rules () ((_ x) (define x 1))))` 中的 `x` 会被替换为使用处传入的标识符。
- **多次展开共享 helper**：模板中引用的外部 helper 保持原 varid，所有展开共享同一个 helper 绑定，符合 R5RS。
- **宏展开产生新宏定义**：展开是递归的，`define-syntax` 节点会被移除，不会产生运行时代码。
- **宏未匹配**：报编译错误，指出哪个 macro use 没有匹配任何 clause。
- **ellipsis 长度不一致**：如 `(a b ...)` 匹配到不同长度的绑定列表时报错。
- **模块合并**：由于每个模块在链接前已经独立完成宏展开，`am_ast_merge` 无需关心宏环境。但这也意味着**一期不支持导入/导出宏**，若要支持，需要让 `am_ast_merge` 合并宏环境，并把跨模块的宏名 varid 做相应映射。

---

## 12. 测试建议

1. **基础 `syntax-rules`**
   ```scheme
   (define-syntax my-if
     (syntax-rules ()
       ((_ c t f) (if c t f))))
   (my-if #t 1 2)  ; => 1
   ```

2. **卫生性：引入临时变量**
   ```scheme
   (define-syntax swap!
     (syntax-rules ()
       ((_ a b)
        (let ((tmp a))   ; 若 Animac 不支持 let，可用 lambda 包装
          (set! a b)
          (set! b tmp)))))
   ```
   验证多次使用 `swap!` 时 `tmp` 不冲突。

3. **ellipsis**
   ```scheme
   (define-syntax my-begin
     (syntax-rules ()
       ((_ e ...) (begin e ...))))
   ```

4. **literals**
   ```scheme
   (define-syntax my-cond
     (syntax-rules (else)
       ((_ (else e)) e)
       ((_ (c e) rest ...) (if c (begin e) (my-cond rest ...)))))
   ```

5. **局部宏**
   ```scheme
   (let-syntax ((foo (syntax-rules () ((_ x) (+ x 1)))))
     (foo 5))  ; => 6
   ```

---

## 13. 总结

该方案的核心是：

> **“先 ARN、后展开、只对模板内绑定做 freshen”**。

这样做的好处：

- 不改动 VM 和运行时，宏完全是编译期 AST 转换；
- 复用现有 ARN 保证自由标识符卫生；
- 通过 `fresh_map` 保证宏引入的绑定每次展开都新鲜；
- 对 `lambda_handles`、`tailcall_handles`、`var_top` 的刷新保证后端拿到的 AST 仍然一致；
- 新增代码集中在 `macro.h/c`，与现有前端/后端耦合点很少。

如果需要，后续可以在此基础上扩展跨模块宏导入导出、更复杂的 ellipsis 嵌套，以及 `letrec-syntax` 的互递归 transformer 等特性。

# 进程间通信队列机制技术报告

## 摘要

Animac 在已有的编译器+中间语言 VM、多进程事件循环架构之上，新增了一套基于 FIFO 队列的进程间通信（IPC）机制。该机制以 `src/list.c` 中实现的 `am_list_t` 作为队列存储容器，通过 `am_list_push` / `am_list_shift` 完成入队与出队；队列对象本身分配在 VM 工作区，由 `am_runtime_t` 统一管理；任何进程都可以通过队列编号（ID）对队列进行发送或接收操作。发送与接收均为阻塞式，支持超时；收发双方以 `am_value_t` 的按值拷贝方式传递数据，解释器不对数据语义做解释或序列化。本报告详细阐述该机制的设计目标、数据结构、核心 API、调度与超时实现、与现有事件循环的集成方式，以及测试验证结果。

---

## 1 设计目标与约束

新增 IPC 队列机制基于以下需求与约束：

1. **基于现有列表实现**：队列的底层存储复用 `am_list_t`，入队使用 `am_list_push`，出队使用 `am_list_shift`，不引入新的动态数组或环形缓冲区。
2. **VM 区分配**：队列对象（包括队列控制结构与数据项列表）均通过 `rt->vm_alloc` 分配，生命周期由运行时管理，不属于单个进程的私有堆。
3. **多生产者/多消费者**：任意进程都可以向同一队列发送或接收；队列内部维护发送等待者与接收等待者链表，实现阻塞同步。
4. **按值拷贝**：队列项类型为 `am_value_t`，通过直接拷贝 TPV 传递；如果是 handle，则拷贝 handle 值本身，解释器不做深拷贝或语义解释。
5. **阻塞式 + 超时**：`System.write` 在队列满时阻塞，`System.read` 在队列空时阻塞；二者均可指定 `timeout_ms`，超时后分别返回 `#f` 与 `#undefined`。
6. **编号访问**：队列通过自增编号 `id` 进行管理，Scheme 层只暴露编号，便于跨进程共享。

---

## 2 核心数据结构

### 2.1 队列控制结构

队列控制结构定义在 `include/runtime.h`：

```c
typedef struct am_queue_waiter_t am_queue_waiter_t;
typedef struct am_queue_t am_queue_t;

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

`am_runtime_t` 新增两个字段：

```c
typedef struct am_runtime_t {
    // ... 原有字段 ...
    am_list_t *queue_list;   // 队列列表：List<am_queue_t*>
    size_t queue_next_id;    // 下一个队列编号，从 1 开始递增
} am_runtime_t;
```

`queue_list` 中每个元素是一个 `am_value_t` 包装的原始指针（`am_make_value_of_ptr(q)`），指向一个 `am_queue_t`。线性查找函数 `am_runtime_get_queue` 通过遍历该列表实现 ID 到队列的映射。ID 从 1 开始单调递增，0 保留为无效编号。

---

## 3 Native API 语义

在 `src/native_System.c` 中实现并注册了三个函数：

```c
static const am_native_func_entry_t am_native_System_funcs[] = {
    // ... 其他 System 函数 ...
    { L"make_queue", am_native_System_make_queue },
    { L"write",      am_native_System_write },
    { L"read",       am_native_System_read },
};
```

### 3.1 `(System.make_queue len)`

- 参数：`len` 为队列最大容量（必须 > 0）。
- 行为：调用 `am_runtime_queue_create(rt, (size_t)len)` 创建队列，返回队列编号 `id`。
- 返回值：成功返回 `uint` 类型的编号；失败（如容量非法、内存不足）返回 `#null`。

### 3.2 `(System.write qid v timeout_ms)`

- 参数：`qid` 队列编号，`v` 任意值，`timeout_ms` 超时时间（毫秒）。
- 行为：
  - 若存在等待接收者，直接将 `v` 交给最前面的接收者，发送方返回 `#t`。
  - 否则若队列未满，将 `v` 压入 `items`，返回 `#t`。
  - 否则若 `timeout_ms == 0`，立即返回 `#f`。
  - 否则将当前进程阻塞为发送等待者，设置超时绝对时间。
- 返回值：成功 `#t`，失败/超时 `#f`。

### 3.3 `(System.read qid timeout_ms)`

- 参数：`qid` 队列编号，`timeout_ms` 超时时间（毫秒）。
- 行为：
  - 若队列非空，弹出队首值并返回。
  - 若存在等待发送者，则弹出一个元素腾出空间后，立即把该发送者的值入队并唤醒发送者。
  - 若 `timeout_ms == 0`，立即返回 `#undefined`。
  - 否则将当前进程阻塞为接收等待者，设置超时绝对时间。
- 返回值：成功返回读到的值，失败/超时返回 `#undefined`。

参数弹出顺序遵循 Scheme 调用约定：`native` 函数从操作数栈顶依次弹出，因此 `write` 实际先弹出 `timeout_ms`，再弹出 `v`，最后弹出 `qid`；`read` 先弹出 `timeout_ms`，再弹出 `qid`。

---

## 4 队列生命周期管理

### 4.1 创建

`am_runtime_queue_create` 在 `src/runtime.c` 中实现：

```c
am_queue_t *am_runtime_queue_create(am_runtime_t *rt, size_t capacity) {
    if (!rt || capacity == 0) return NULL;

    am_queue_t *q = (am_queue_t *)am_malloc(rt->vm_alloc, sizeof(am_queue_t));
    if (!q) return NULL;

    q->id = rt->queue_next_id++;
    if (q->id == 0) q->id = rt->queue_next_id++; // 跳过 0
    q->capacity = capacity;
    q->items = am_list_create(rt->vm_alloc, capacity, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    q->send_waiters = NULL;
    q->recv_waiters = NULL;

    if (!q->items) { am_free(rt->vm_alloc, q); return NULL; }

    am_list_t *new_list = am_list_push(rt->vm_alloc, rt->queue_list,
                                       am_make_value_of_ptr((am_object_t *)q));
    if (!new_list) { /* 回滚 */ }
    rt->queue_list = new_list;
    return q;
}
```

注意：虽然 `am_list_create` 会把 capacity 对齐到内部最小值（默认 4），但 `q->capacity` 才是逻辑上的最大长度，`am_runtime_queue_write` 通过比较 `q->items->length < q->capacity` 决定是否还有空间。

### 4.2 销毁

`am_runtime_destroy` 在销毁运行时时遍历 `queue_list`，对每个队列调用 `am_runtime_queue_destroy`。该函数释放所有等待者节点、数据项列表以及队列控制结构本身。

---

## 5 核心操作实现

### 5.1 写入路径

`am_runtime_queue_write` 的实现逻辑如下：

1. **直接交付给等待接收者**：若 `recv_waiters` 非空，取出队首接收者，把待写入值作为结果唤醒该进程，发送方压入 `#t` 并步进 PC。
2. **常规入队**：若 `items->length < capacity`，调用 `am_list_push` 入队，发送方压入 `#t` 并步进 PC。
3. **立即失败**：队列已满且 `timeout_ms == 0`，压入 `#f` 并步进 PC。
4. **阻塞**：创建一个 `am_queue_waiter_t` 节点，记录当前进程 PID、待写入值、超时截止时间，插入 `send_waiters` 链表头部，然后将进程状态置为 `AM_PROCESS_STATE_BLOCKED`，**不步进 PC**。

```c
int32_t am_runtime_queue_write(am_runtime_t *rt, am_queue_t *q, am_value_t value,
                               am_timestamp_t timeout_ms, am_process_t *proc) {
    if (q->recv_waiters) {
        // 直接交给等待的接收者
        am_queue_waiter_t *reader = q->recv_waiters;
        q->recv_waiters = reader->next;
        runtime_queue_wake_process(rt, reader->pid, value);
        am_free(rt->vm_alloc, reader);
        am_process_push_operand(proc, AM_VALUE_TRUE);
        am_process_step(proc);
        return 0;
    }
    if (q->items->length < q->capacity) {
        am_list_t *new_items = am_list_push(rt->vm_alloc, q->items, value);
        if (!new_items) return -1;
        q->items = new_items;
        am_process_push_operand(proc, AM_VALUE_TRUE);
        am_process_step(proc);
        return 0;
    }
    if (timeout_ms == 0) {
        am_process_push_operand(proc, AM_VALUE_FALSE);
        am_process_step(proc);
        return 0;
    }
    // 阻塞
    am_queue_waiter_t *w = runtime_queue_waiter_create(rt, proc->pid, value,
                                                         am_runtime_now_ms() + timeout_ms, true);
    w->next = q->send_waiters;
    q->send_waiters = w;
    am_process_set_state(proc, AM_PROCESS_STATE_BLOCKED);
    return 0;
}
```

### 5.2 读取路径

`am_runtime_queue_read` 的逻辑：

1. **直接出队**：若 `items->length > 0`，调用 `am_list_shift` 弹出队首值。若有发送等待者，则取出一个，将其值入队并唤醒，从而保持队列始终处于满状态（只要还有发送者）。读取方返回弹出的值并步进 PC。
2. **立即失败**：队列空且 `timeout_ms == 0`，压入 `#undefined` 并步进 PC。
3. **阻塞**：创建接收等待者节点，插入 `recv_waiters` 链表头部，进程状态置为 `AM_PROCESS_STATE_BLOCKED`。

### 5.3 进程唤醒

`runtime_queue_wake_process` 统一处理被唤醒进程：

```c
static void runtime_queue_wake_process(am_runtime_t *rt, am_pid_t pid, am_value_t result) {
    am_process_t *proc = rt->process_pool[pid];
    if (!proc) return;
    am_process_push_operand(proc, result);
    am_process_step(proc);                 // PC 越过 native 调用
    am_process_set_state(proc, AM_PROCESS_STATE_READY);
    rt->process_queue = am_list_push(rt->vm_alloc, rt->process_queue,
                                     am_make_value_of_uint((am_uint_t)pid));
}
```

被唤醒的进程会将结果压入操作数栈，PC 指向 native 调用之后的下一条指令，然后被重新加入 `process_queue`，等待下一次调度。

---

## 6 阻塞状态与事件循环集成

### 6.1 进程状态扩展

`include/process.h` 新增：

```c
#define AM_PROCESS_STATE_BLOCKED (6)
```

处于 `BLOCKED` 状态的进程不会被 `am_runtime_tick` 重新入队；它只能通过以下两种方式被唤醒：

1. **对端操作**：另一个进程向同一队列写入或读取时，直接将其从等待者链表中移除并唤醒。
2. **超时**：事件循环在每次 tick 后扫描所有队列的等待者链表，将已超时的等待者唤醒。

### 6.2 超时扫描

`runtime_queue_check_waiters` 在 `src/runtime.c` 中实现，它遍历 `rt->queue_list` 中的每条队列及其 `send_waiters` / `recv_waiters` 链表：

```c
static void runtime_queue_check_waiters(am_runtime_t *rt) {
    am_timestamp_t now = am_runtime_now_ms();
    // 对每个队列：
    //   遍历 send_waiters，若 deadline_ms <= now 则唤醒为 #f 并移除
    //   遍历 recv_waiters，若 deadline_ms <= now 则唤醒为 #undefined 并移除
}
```

扫描后，被超时的进程状态变为 `READY` 并重新入队。

### 6.3 事件循环不 IDLE

在 `am_runtime_event_handler` 末尾做了如下调整：

```c
runtime_queue_check_waiters(rt);
runtime_fire_expired_timers(rt);

if (rt->process_queue && rt->process_queue->length > 0) {
    vm_state = AM_VM_STATE_RUNNING;
}
if (vm_state == AM_VM_STATE_IDLE &&
    (runtime_has_nonblocked_timer(rt, NULL) || runtime_queue_has_waiters(rt, NULL))) {
    vm_state = AM_VM_STATE_RUNNING;
}
```

这意味着即使当前没有就绪进程，只要还有阻塞中的队列等待者或未到期且关联进程未阻塞的定时器，虚拟机就继续运转。

### 6.4 睡眠策略

`am_runtime_start` 在 `process_queue` 为空但仍有等待者/定时器时，计算最近的到期时间并睡眠：

```c
if (rt->process_queue && rt->process_queue->length == 0 &&
    (runtime_has_nonblocked_timer(rt, NULL) || runtime_queue_has_waiters(rt, NULL))) {
    am_timestamp_t now = am_runtime_now_ms();
    am_timestamp_t next = 0;
    am_timestamp_t tnext;
    if (runtime_has_nonblocked_timer(rt, &tnext)) next = tnext;
    am_timestamp_t qnext;
    if (runtime_queue_has_waiters(rt, &qnext)) {
        if (next == 0 || qnext < next) next = qnext;
    }
    if (next > now) runtime_sleep_ms(next - now);
}
```

这避免了空转；当所有等待者都使用无限超时时，事件循环会保持睡眠，直到被外部输入或其他机制唤醒（当前实现下无限超时等价于永久阻塞）。

### 6.5 与定时器的互斥

如果一个进程在持有用户定时器的同时因队列操作进入 `BLOCKED` 状态，直接触发定时器回调会破坏队列操作现场（操作数栈已被弹出、PC 仍停在 native 调用处）。因此 `runtime_fire_expired_timers` 做了特殊处理：

```c
if (proc && proc->state == AM_PROCESS_STATE_BLOCKED) {
    // 暂不触发，待进程解除阻塞后再检查
    cur = &timer->next;
    continue;
}
```

同时，事件循环的 IDLE 判断与睡眠计算均使用 `runtime_has_nonblocked_timer`，跳过被阻塞进程的定时器，防止因跳过操作导致忙等。

---

## 7 多生产者/多消费者模型

队列内部的发送等待者与接收等待者都是单向链表，新等待者插入链表头部，唤醒时也取头部节点。因此：

- 多个发送者可以在队列满时同时阻塞；
- 多个接收者可以在队列空时同时阻塞；
- 当条件满足时，每次只唤醒一个等待者，保证 FIFO 的语义边界在队列数据项层面维持。

需要注意的是，等待者链表本身不是 FIFO（头部插入），但这只影响同一条件下多个阻塞进程被唤醒的先后顺序，不影响队列中数据项的出队顺序。队列项本身严格按照 `am_list_push` / `am_list_shift` 维护。

---

## 8 测试验证

新增测试文件：

- `test/queue_ipc_test.scm`：基础创建/读写、空队列超时读、满队列超时写、跨进程双向通信。
- `test/queue_mpmc_test.scm`：一个队列、两个消费者、一个生产者，验证多消费者阻塞与唤醒。
- `test/queue_deadlock_test.scm`：用两个队列模拟两把锁，父/子进程分别持有一把并请求对方，形成死锁；通过超时检测死锁并输出。

### 8.1 基础 IPC 测试结果

```text
queue id=1
write immediate=#t
read immediate=42
read timeout empty=#undefined
write timeout full=#f
child read=100
parent read=200
queue IPC tests done
```

### 8.2 多消费者测试结果

```text
consumer1 read=111
consumer2 read=222
mpmc test done
```

### 8.3 死锁测试结果

```text
parent: A acquired
child: B acquired
child: trying to acquire A (expect deadlock)
parent: trying to acquire B (expect deadlock)
child: DEADLOCK detected, could not acquire A
parent: DEADLOCK detected, could not acquire B
```

### 8.4 回归测试

将队列 IPC 加入后重新编译并运行原有 `test/test.scm`，退出码为 0，所有原有测试用例输出与预期一致，说明新增机制未破坏现有运行时、GC、定时器、fork 等功能。

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
- 队列 ID 线性递增，不回收；长时间运行大量创建/销毁队列可能耗尽编号空间（`size_t` 范围通常足够大）。
- 收发双方自行负责 handle 的跨进程解释；若发送方被 GC 移动对象，handle 是否仍有效取决于具体 heap 实现，解释器不保证跨进程 handle 语义。
- 用户定时器在进程 `BLOCKED` 期间被暂停，待进程解除阻塞后才会重新检查到期。

---

## 11 结论

Animac 的 IPC 队列机制在保持现有事件循环与多进程调度架构不变的前提下，通过新增 `am_queue_t` 控制结构、两条等待者链表、三个 `System.*` native 函数，以及对事件循环超时扫描和睡眠策略的扩展，实现了一套完整的多生产者/多消费者 FIFO 队列。它复用 `am_list_t` 作为底层存储，按 `am_value_t` 按值拷贝传递数据，支持阻塞式读写与超时，并在跨进程通信、资源死锁等复杂场景下通过了测试验证。
