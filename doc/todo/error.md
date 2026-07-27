# Animac 计算引擎错误/异常情况全面梳理

> 调研范围：解释器全部 C 语言源码（`src/`、`include/`、`main.c`、`main_repl.c`），不含 TypeScript 原型与 amalgamation 产物（`animac_core.*` 与 `src/` 重复）。
> 本文梳理的是**计算引擎自身的错误/异常**（OOM、类型错误、越界、崩溃、静默失败、诊断缺失等），不包括 Scheme 语言层面的异常处理机制（语言中本就没有 `error`/`raise`/`guard`）。
> 行号基于 2026-07-27 的工作区版本。文中标注【实测】的条目已通过 WSL 构建运行验证实际行为。

---

## 0. 总体错误处理机制现状

### 0.1 错误通道（目前有四条，互不统一）

1. **哨兵返回值**：绝大多数内部函数遵循 doc/AGENTS.md 的返回值约定（int 负值为失败、`NULL`、`AM_HANDLE_NULL`、`SIZE_MAX`），错误沿调用链逐层上抛，**全程无消息**。
2. **stderr 直接打印**：`[Parser Error]`、`[Macro Error]`、`[Compiler]`、`[module_dump]`、`[module_load]`、`[System.eval]`、`[allocator]`、`[gc]`、`[gc_root_helper]`、`[REPL]` 等前缀消息，经 `fprintf(stderr, ...)` 输出。**没有统一的错误记录设施，消息不含行列号，宿主无法程序化获取错误原因**。
3. **error_fifo + on_error 回调**（仅运行时）：`am_runtime_error`（src/am_runtime.c:3306-3319）把消息逐字符压入 `rt->error_fifo` 并触发 `vtable->on_error`；宿主自行排空 fifo 输出。fifo 的 `am_list_push` 失败时静默丢字符——**OOM 时错误消息本身可能丢失**（am_runtime.c:3313-3315；output_fifo 同样在 3297-3299 丢字符）。
4. **软性失败值**：部分失败以特殊值传给 Scheme 层——`#undefined`（get_item 越界、表查无此键、队列读超时、String.parseNumber 失败）、`#null`（数学函数 NaN、make_queue 失败）、`#f`（kill/gc/write 失败）、`-1`（System.exec 后段失败）、`0.0`/空串（String 越界）。进程不死。

### 0.2 运行时错误的统一处置（VM 层唯一的错误收口）

指令（含 native 函数）返回 -1 后的传播链（am_runtime.c:3047-3105 `am_runtime_tick`）：

1. 先做一轮 GC 水位检查作为 OOM 补救（3066）；
2. `proc->state = STOPPED`——**只终止出错进程**，其余进程继续；
3. 调 `on_error` 一次（3068），再经 `am_runtime_error` 输出兜底消息 `[Runtime] 指令执行异常: PID=%zu PC=%zu`（3070）——**一次指令失败 on_error 最多触发 2~3 次**（op 内部若自己调过 `am_runtime_error` 还会再多一次），宿主回调需幂等；
4. 出错进程从此不再被调度，但**资源不回收**（heap/opstack/fstack 等留存到 kill 或 runtime 销毁）。

指令级错误分两类：**带消息**（op 内部调 `am_runtime_error` 给出具体原因，全项目仅约 20 条 `[Runtime]` 消息，见 §4.2.1）与**静默 -1**（大多数类型检查/分配失败，用户只能看到 PID/PC 兜底消息）。【实测】对空表取 `car` 只有 `[Runtime] 指令执行异常: PID=0 PC=3`，无任何"空表"提示；且 **main 的退出码仍为 0**（main.c 不把运行时错误反映到退出码）。

### 0.3 编译期错误的处置

`am_parse` 失败返回 `NULL`（语法/宏错误已打 `[Parser Error]`/`[Macro Error]`；词法错误**完全静默**）；`am_link` 失败返回 `NULL`（**全程零诊断**）；`am_compile` 失败返回 `NULL`（仅 1 处 `[Compiler]` 消息，其余全静默）。三个入口都不带错误码与位置信息，调用方无法区分失败原因。

### 0.4 与 manual.md §1.1.1 三档语义的对照

manual 承诺的三档（报错=终止进程 / 结果是未规定的 / 实现定义）在实现层面基本存在，但分布随意、同类情形策略不一（详见各模块条目与 §6 横切问题）。

---

## 1. 基础设施层

### 1.1 src/am_allocator.c（内存池：VM 区 segregated + 堆区 freelist）

**OOM 路径（有消息的少数派）**

- VM 区分配彻底失败（am_allocator.c:253-257）：打印 `[allocator] VM segregated 分配失败: 请求 %zu bytes (含头部对齐后 %zu), 已用 %zu / %zu bytes`，返回 NULL。**不置任何标志**——运行时的 GC 水位机制感知不到 VM 区 OOM（观测盲区）。
- 堆区分配彻底失败（478-495）：先经 L0 兜底（最多 4 次 `am_allocator_pool_auto_adjust` 向 VM 区让渡边界重试），仍失败则**置位 `oom_flag`**、打印 `[allocator] heap freelist 分配失败: ...`、返回 NULL。`oom_flag` 唯一读取点在 am_runtime.c:3036（读到即清除并强制一轮压缩 GC）。
- 内存池创建失败（607-623）：host_vtable 缺失返回 NULL（静默）；控制块/底层内存失败各有一条 stderr 消息。
- `size == 0` 的分配请求（239、472）：静默返回 NULL 且**不置 oom_flag**。

**边界与溢出缺口**

- 头部对齐计算 `HEADER_SIZE + size` 的 size_t 溢出无检查（241、474）：`size` 接近 SIZE_MAX 时回绕，静默分配过小的块 → 调用方按原尺寸写入造成堆损坏。
- `total_size` 无下限校验（626）：过小的池使堆区出现 size=0 空闲块，后续物理块遍历 `p += 0` **死循环**。
- VM 区容量 < 最小块时静默不插入任何空闲块（596-602、786-791）——VM 区可用空间为 0 而无任何提示。
- 压缩引擎遍历物理块时对 `sz == 0` 的损坏块无防御（1207，同类 714、1014）→ 死循环。
- VM 收缩时 `removed > first_sz` 的防御分支**静默截断**（817，注释"理论上不会发生"），掩盖潜在不一致。
- `pool_reinit_heap_at` 的三种边界冲突（733、738、747）返回 -1 上抛给 L0 重试，无消息。
- 压缩报告系列（1010-1154）受 `AM_ALLOCATOR_PRINT_COMPACT_REPORT`（默认 0）控制，默认为 no-op；开启时快照 realloc 失败有 stderr 消息（1184-1188）。
- double free（294、509）：**静默忽略**。

### 1.2 src/am_heap.c（handle 表 / 逻辑堆）

- 【确定的 bug】`am_heap_destroy`（88-91）：`am_map_keys` OOM 返回 NULL 但 `count > 0` 时**直接解引用 NULL → 崩溃**。
- `am_heap_alloc_handle`（567-574）：参数 NULL 或 `am_map_set` OOM → `AM_HANDLE_NULL`（调用方约 30 处，多数有检查）。**`handle_counter++` 溢出无检查**（569）：递增至与 `AM_HANDLE_NULL` 哨兵冲突，理论极端情况。
- `am_heap_set`（646-676）：handle 未申请/`am_map_set_stable` 失败 → -1；**不检查返回值的调用点**：am_runtime.c:355, 509, 610, 625, 976, 1313, 1352, 1618, 1665, 1695（裸调用）。
- `am_heap_free_handle`（583-605）：失败返回 -1；不检查的调用点：am_gc.c:406、am_ast.c:813-814、am_runtime.c:1885、am_native_System.c:1700。
- `am_heap_get` 对 NULL 堆返回 `AM_VALUE_UNDEFINED`，与 `am_map_get` 的"未找到返回 `AM_VALUE_NULL`"**哨兵不一致**（640）。
- `am_heap_set_metadata`/`am_heap_get_metadata`（615-631）：**未实现的静默桩**，恒返回 0，调用方无法感知功能缺失。
- dump/load：`am_heap_load` 直接信任磁盘上的 `table_size` 推进偏移（269）；`am_heap_deep_load` 读出 `total_size`/`heap_size` 后 `(void)` 丢弃不校验（484-487），`obj_rel_offset` 无范围校验即取地址读类型（510-512）——**截断/篡改的模块文件导致缓冲区越界读**。
- `am_heap_deep_dump` 的不动点迭代（401-428）无迭代次数上限，不变量被破坏即死循环。

### 1.3 src/am_gc.c（垃圾回收）

- 有消息的失败：fstack 槽位非闭包 handle（68-71）、对象非闭包（80-83）打印 `[gc_root_helper] ...` 返回 -1；压缩的工作数组 malloc/realloc 失败（559-564、587-592）打印 `[gc] 压缩失败: ...`。
- 严重级别不一致：`gc_root_helper` 按 handle 取不到闭包对象时打印消息后 **continue 不视为致命**（76-79），而相邻两种损坏返回 -1。
- `gc_mark` 对不在当前进程堆中的 handle（悬空/跨堆）**静默返回 0 容忍**（305）；对不在白名单（LIST/WSTRING/MAP/CLOSURE/CONTINUATION）的对象类型**静默不标记**（317-361）——SCOPE/VOCAB/STRINDEX 等类型永不回收（设计性泄漏，无告警）。
- `am_gc_process` 对 keepalive 根 push 失败**静默忽略**（455-457，与同函数其余 OOM 路径返回 -1 不一致）；某根标记失败置 -1 但继续标记其余根并照常 sweep（462-467）。
- `am_gc_compact` 引擎失败时**不执行 heap 表指针回写**（596-601）——若引擎已部分搬移则留下不一致。
- `am_gc_collect` 的多处静默：`heaps` 数组 malloc 失败 → 所有进程堆不进压缩列表但函数仍返回 0（641-642）；某进程 GC 失败静默跳过仍返回 0（647-649）；压缩失败静默忽略（657-662）；两个调用点（am_runtime.c:3039、3184）`(void)` 显式丢弃返回值——**GC 整体失败在运行时层无感知、无日志**。
- `am_gc_heap_watermark_level` 查询失败返回 -1，被调用方当作"水位正常"（level<1 不触发 GC）静默处理（674-690 → am_runtime.c:3035-3036）。

### 1.4 容器与基础数据结构（am_list.c / am_map.c / am_wstring.c / am_vocab.c / am_scope.c / am_object.c）

共同特征：**全部无消息**，纯哨兵返回值；均不校验 `alloc` 参数（NULL 会在内联 `am_malloc` 里解引用崩溃）。

- **size_t 溢出检查缺口**（构造/扩容总字节数与容量倍增 `*2` 均无防护）：am_list.c:20, 44, 57；am_map.c:97, 140, 390；am_wstring.c:16, 44, 253, 298, 489, 513；am_vocab.c:19, 39, 52；am_scope.c:17, 40, 53。
- **2 的幂取整死循环**：`am_map_round_up_capacity`（am_map.c:15-18）与 strindex 同款（am_wstring.c:167-170）——`cap <<= 1` 回绕为 0 后 `while (cap < capacity)` 永不退出。
- **开放寻址探查死循环**（表内无 EMPTY 槽且 key 不存在时，依赖 set 维持 75% 负载的外部契约，函数自身不防御）：am_map.c:24-43、am_heap.c:34-48、am_wstring.c:174-181, 190-198。
- **墓碑重哈希 OOM 静默吞掉**：am_map.c:432-436、am_wstring.c:544-547（仅有注释，删除本身视为成功）。
- **哨兵同值多义**：错误与"未找到"同为 -1（am_map_contains、am_heap_has_handle、am_scope_has_var、am_object_check_*）；同为 SIZE_MAX（am_list_find、am_vocab_find、am_strindex_*）；同为 NULL（`am_map_keys` 表空 vs OOM——正是 §1.2 崩溃的成因；`am_list_lambda_get_bodies` 无 body vs OOM；`am_scope_add_var` 重复定义 vs OOM）。
- 越界访问的软哨兵：`am_list_get`/`pop`/`shift` 越界或空表返回 `AM_VALUE_UNDEFINED`（am_list.c:216, 242, 249）——调用方无法区分"越界"与"存储的 undefined 值"。
- load 路径的溢出校验总体完备（良好实践），但有两处不一致：`am_list_load` 把磁盘上的 `type` 强转 `(int32_t)` 无范围检查（am_list.c:191）；`am_wstring_load` 不像 `am_vocab_load` 那样按宿主 wchar_t 宽度校验码点（am_wstring.c:132-136 vs am_vocab.c:161, 179）——16 位 wchar_t 宿主（Windows）下 >0xFFFF 的码点被**静默截断**。
- `am_scope_dump`（am_scope.c:102-107）：未实现的 TODO 桩，恒返回 NULL、*size=0，无"未实现"提示。
- `am_vocab_copy`/`am_vocab_dump` 对 NULL word 直接 `wcslen` 崩溃（am_vocab.c:92-98, 132），而 `am_vocab_destroy` 却校验——不一致。
- `am_list_dump`/`am_map_dump` 契约陷阱：`buffer != NULL` 且 `offset == SIZE_MAX` 时越界写（am_list.c:150），"仅计算大小"模式要求 buffer 为 NULL 但函数不防御。
- `am_object_set_*`（am_object.c:20-77）对非法参数返回 -1，GC 调用点不检查。
- 磁盘编码原语（include/am_object.h:413-608）：`am_disk_read_uvarint` 有 10 字节/64 位上限检查，但**所有解码函数都不接收缓冲区长度参数**——截断输入会越界读；`am_disk_read_value` 对未知标签、32 位宿主值域越界、奇数 PTR 有拒绝（良好）。

---

## 2. 前端层

### 2.1 src/am_lexer.c（词法分析）

- **词法错误完全静默**：`am_lexer` 出错只返回 -1（未闭合字符串、字符串内未转义换行，am_lexer.c:58-70, 241-242），`am_parse` 拿到负数后**不打印任何消息**直接返回 NULL（am_parser.c:2062-2066）——用户无法区分"词法错误"与"内存失败"，且无行列号（token 结构里有 line/column 但错误不带出）。
- 【高危】**tokens 数组容量上界不成立**：am_parser.c:2058 按 `wcslen(code)+1` 分配 tokens 数组（假设每个 token 至少占 1 字符），但 `{` 会被展开为 2 个 token（`(` + 虚拟 `begin`，am_lexer.c:250-262），`EMIT` 宏写 `tokens[tok_cnt++]` **不做容量检查**（172-182）——大量 `{` 的源码造成**堆缓冲区越界写**。
- 非法 `#...` 字面值（`#ta`、`#undefinedX` 等，120-151, 193-200）：不报错，标为 `AM_TOKEN_TYPE_UNEXPECTED(99)` 照常进入 token 流，由 parser 后续以 `unexpected token in term` / `illegal identifier token` 拒绝。
- 数字格式非法（`is_number`，74-104）：不报错，**静默降级为标识符**参与解析。
- `token_text`（323-334）：返回 256 宽字符静态缓冲（非线程安全），超长 token **静默截断**。

### 2.2 src/am_parser.c（语法分析 + ARN + 尾调用分析）

机制：`parser_set_error`（95-100）只记录**第一个**错误；出错后各函数逐层回传，**无错误恢复**；`am_parse` 统一打印 `[Parser Error] %ls` 后返回 NULL（2097, 2110, 2123, 2136, 2160, 2173 六处同模式）。

- **语法错误消息**（均有消息，硬编码宽字符串）：括号未闭合系列（`quote/unquote/unquote-splicing/quasiquote/slist/lambda/arglist 右侧括号未闭合`，:502-705）、`unexpected end of input in ...` 系列（:486, 615, 716, 766, 795, 824, 857, 913, 961）、`unexpected token in term`（:565）、`lambda parameter must be variable`（:729）、`illegal identifier token`（:1139，UNEXPECTED token 的最终拒绝点）、`trailing tokens after parse`（:2095）。
- **数字字面量无溢出检查**（280-312）：`wcstoll` 饱和为 LLONG_MAX/MIN、`wcstod` 溢出得 ±inf，均**静默接受**；超 TPV 位宽在 `am_make_value_of_uint` 处静默截断。【实测】`1e999` → 显示 `inf`；`99999999999999999999999999` → 显示 `576460752303423487`（2^59-1，截断值），无任何错误。
- **import/native 形式校验不全**（1157-1219）：只识别严格三元 `(import A P)` / 二元 `(native X)`；参数个数不符（如 `(import)`、`(import A)`）**静默忽略**，问题推迟到链接/运行期。`invalid import syntax`、`import path must be string`、`invalid native syntax` 有消息。
- **ARN 阶段**：未定义变量**宽松处理不报错**（1516-1530：全局内置保持原名；keep_free 模式标 GLOBAL_FREE；否则静默保持原 varid 推迟到运行期）。OOM 类失败有消息（`out of memory collecting lambda handles` :1306、`failed to create unique variable` :1534 等十余处）。`define outside lambda scope`（:1433）。
- **ext_ref 判别规则不一致**：`am_ast_check_ext_ref`（am_ast.c:911-925）要求恰一个点号；`am_ast_check_import_ref` 按最后一个点号切分——`a.b.c` 形式在两阶段行为不一致（潜在歧义）。未注册的 native 前缀被静默判为"非 native ref"（am_ast.c:947），错误推迟到运行期。
- **尾调用分析**：全程不设 error_msg，OOM 静默 -1（:1931, :1992）；失败只报笼统的 `[Parser Error] tail call analysis failed`（:2186）；`am_list_lambda_get_bodies` 返回 NULL 时静默按成功处理（:2016）。
- **未检查返回值**：`am_ast_set_node_token_index` 的 -1 在 parser 四处调用点（:597, :667, :900, :984）全部未检查——token 位置映射静默丢失（错误消息无法给出行列号的间接原因）。
- 栈管理/树构建的内部不变量错误均有消息（`node stack underflow` :318、`parent is not a list` :340、`failed to append child` :347 等），正常只会在 OOM 时触发。
- `am_parse` 入口的参数/分配/词法/AST 创建失败（:2055-2073）全部**静默**返回 NULL。

### 2.3 src/am_ast.c（AST 节点堆）

- 全程无消息：构造函数失败返回 `AM_HANDLE_NULL`，由 parser 转译为对应消息。
- `am_ast_make_slist_node` 类型白名单拒绝（1036-1042）：非法 type（含 LAMBDA，须走专用构造函数）静默返回空把柄。
- `am_ast_make_wstring_node` 对 strindex 登记失败**刻意容忍**（1168-1172，注释"即使登记失败仍返回 handle"）——字符串驻留去重静默失效。
- `ast_unescape_string`（1069-1086）：未知转义序列（`\x`、`\u` 等）**静默保留反斜杠**，不报词法错误（只识别 `\" \\ \n \t \r`）。
- `am_ast_merge`（链接器模块融合核心，378-829）：约 30 处失败点全部静默 `return -1`；**不检测符号语义冲突**（同名 varid 按字符串合并）；var_top 重复静默跳过（442-450）；handle/strindex/dependencies 映射失败静默丢条目（:494, :509, :528, :551, :622, :680 等 `continue` 分支）。
- 【隐患】`am_ast_copy` 与原 AST 共享 code/tokens 指针，但 destroy 会 free tokens（:225）——双重释放隐患。

### 2.4 src/am_macro.c（syntax-rules 卫生宏展开）

机制：`macro_set_error`（68-73）记录首个错误；`am_macro_expand` 打印 `[Macro Error] %ls`（:2033, :2040, :2062, :2077）返回 -1；`am_parse` 不再重复打印。

- 【高危】**宏展开无递归/深度上限**：`macro_expand_value` → 实例化 → 再 `macro_expand_value`（:1724）无限递归，**自引用宏导致 C 栈溢出 core dump**；`macro_match_list`/`macro_instantiate` 递归同样无深度限制。
- **有消息的用户级错误**：`multiple ellipses in macro pattern`（:614）、`ellipsis at beginning of macro pattern`（:618）、`unbound identifier in macro pattern`（:736）、`macro use did not match any clause`（:1732，模式不匹配的最终报错点）、模板实例化系列（`ellipsis template contains no pattern variables` :1280、`ellipsis pattern variables have inconsistent lengths` :1305、`unbound pattern variable in template` :1380 等约 20 条）、let-syntax 形式校验系列（:1743-1788）。
- 单个 clause 匹配失败全部静默（:627-750 多处 `return -1`），仅全部失败才报 :1732；嵌套 ellipsis 不支持但无专门报错（表现为匹配失败）。
- syntax-rules 解析（429-532）所有格式非法统一返回 NULL 无细化消息，上层笼统报 `failed to parse syntax-rules`。`define-syntax` 的 name **未检查 is_varid** 就直接转换（:1479，潜在缺陷）。
- 静默点：快速路径（:2016-2024）；顶层 bodies 为 NULL 静默成功（:2047）；`macro_rebuild_lambda_handles` push 失败**静默丢 lambda handle**（:1924-1942）；`macro_rebuild_var_top` 的 `am_ast_add_var_top` 未检查（:1945-1976）。
- 【缺陷】iter_ctx 错误回传 `wcsncpy(..., 256)` 拷满不补 NUL（:1151-1155, :1225-1230, :1338-1342）——error_msg 可能无终止符。

### 2.5 src/am_js2scm.c（JS 子集 → Scheme）

- 机制独特：`setjmp/longjmp` 全局错误跳转（:19）；消息写入 256 字节全局缓冲 `g_am_js_last_error`（超长截断）供 REPL 取用，同时手写 UTF-8 编码打印到 stderr。
- 有消息：OOM（:56-63 `js2scm: out of memory`）、词法错误带行列号（`词法错误 @ %d:%d: ...`；`未终止的字符串` :289、`非法数字` :261、`非法字符` :364）、语法错误带行列号（:477-505；但 expect 的 `%d` 打印的是 token 枚举值数字，可读性差）、`意外的 "%ls"`（:888）。
- 静默/未检查：括号深度计数器只为隐式分号服务，**括号不匹配不报错**（负值钳到 0，:188, :337-342）；`xstrdup`（:112-118）与 `new_node`（:407-411）失败不检查，下游 `wcslen(NULL)` 崩溃。

### 2.6 src/am_linker.c（模块链接）

- **全文件没有任何 fprintf——所有失败静默返回 NULL**，`am_link` 的调用方只能笼统报告。具体静默失败点：
  - import 文件读取失败（read_source 回调返回 NULL，:235-239）——**用户不知道哪个文件读不到**；
  - 依赖模块 `am_parse` 失败（:262-267，依赖的 [Parser Error] 已打但不指明是哪个模块）；
  - **模块数超 `AM_LINKER_MAX_MODULES`(32)**（:19, :211；doc 记载的设计上限是 1024，实现为 32）；
  - **循环导入**（拓扑排序 :401-404 检测 `result_idx != node_count`）——无任何诊断；
  - **外部引用解析失败**（:421-560：:549 `match_count != 1` 是唯一检测点——0 个=符号不存在/未导出，>1 个=符号冲突/歧义，**不区分两种情况，无消息**）；
  - `am_ast_merge` 失败（:657-663）、合并后尾分析失败（:669-672）。
- native 库是否注册完全推迟到运行期查表，前端不检查。

### 2.7 src/am_module.c（模块 dump/load 磁盘格式）

- dump 有消息（`[module_dump] invalid module` :217、`module too large` :224、`... size mismatch` :347, :354、`exceeds 4GiB` :337）；load 有消息（`bad magic` :104、`unsupported version %u` :110、`unsupported flags %u` :115、`ilcode too large` :440、`failed to decode ilcode` :453 等）。
- 【高危】**load 无缓冲区长度校验**：`module_header_read`（:101-141）与 `am_heap_deep_load` 均不接收缓冲区长度，全部读取基于头部自报的 offset/length，且 `total_size`/`heap_size` 读出即弃——**截断或篡改的模块文件引起越界读**（配合 §1.2 的 heap 越界读与 §1.4 的解码原语无长度防护）。
- dump 的不对称：各区段**大小计算**阶段严格检查（十余处 SIZE_MAX 直接返回，但无消息），**实际写入阶段（:358-405）所有 `_dump` 调用的返回值完全不检查**——写坏不发现。
- 子对象 load 失败共用一条 `[module_load] failed to load AST sub-object`（:547），不区分是哪个区段。
- PackBits：`am_packbits_decompress`（:605-633）校验 src 边界但**不校验 dst 容量**（越界写依赖调用方预算）；main.c 的调用全部用 assert 兜底。
- 32 位宿主适配检查（ilcode too large、`am_disk_read_value` 值域拒绝、handle_counter 上限、码点 cp_max）完备，属良好实践。

---

## 3. 编译器与调试层

### 3.1 src/am_compiler.c（AST → 中间语言）

- **全编译器只有 1 处诊断消息**：`[Compiler] 编译错误: unquote-splicing 仅允许出现在 quasiquote 内`（:364）。其余约 60+ 处失败全部静默 `return -1`，传播链：`compile_*` -1 → `am_compile_all` -1 → `am_compile` 返回 NULL——**无错误码、无位置，所有失败压扁为同一个 NULL**。
- 【缺陷】**`am_compiler_make_label` 返回值普遍未检查**（:421-422, 538, 610, 620, 661, 684, 725, 733, 760, 791-793, 823-825, 851-853, 877-879 等十余处）：失败时把 `AM_VALUE_NULL` 当 operand 发射进指令，而 `am_compiler_label_resolution`（:1337-1338）只检查 LABEL 类型 operand——NULL 非 LABEL，**绕过悬空 label 检查**，留下含非法 operand 的指令。
- 悬空 label 的唯一防线（:1337-1338）：检出后返回 -1 但**不报告是哪条指令、哪个 label**。
- **非法位置 break/continue 静默失败**：predicate 中（:326）、while 之外（:375，while_tag_stack_top 失败）、quasiquote 中（:958）——均无"break/continue 必须在 while 内"提示。
- **静默吞掉可疑输入**：空 application（:412, :470）与空 begin（:700）静默 return 0 不产生任何指令和值；import/native/define-syntax 等关键字形式静默丢弃（:480-485，设计如此但无提示）。
- **编译期不检测的错误**（全部推迟到运行期）：未定义变量（varid 一律生成 load）、define/set! 左值非法（:657, :680 静默 -1）、参数个数不符（无 arity 检查，`compiler_lambda_param_count` 对畸形 lambda 静默按 0 处理，:79-84）。
- 语法形式校验失败均静默：`call/cc` 无 thunk（:592）、dynamic-wind 参数个数（:630）、cond 无分支/分支畸形（:718, :742）、if 缺分支（:783）、while 畸形（:818）等。
- 【缺陷】`compile_while` 失败路径不 pop while_tag_stack（:827 之后）——栈失衡遗留。
- **操作数栈深度静态分析的多处静默降级**（:986-1283）：未知 opcode 栈效应按 0 估计（:1076-1077，新增 opcode 忘登记即失准）；DFS 栈满静默丢弃后继（:1155）；label 解析失败静默跳过路径（:1164, :1170, :1251）；入口分配失败静默跳过（:1121）；防循环截断静默丢路径（:1137）；`icount == 0` 与失败同返 SIZE_MAX（:1202）；分析结果为 0 静默返回 1（:1282）。**后果：深度估计可能低估且无任何告警**（运行期靠 opstack 动态扩容兜底，见 §4.3）。
- emit_instruction（:178-194）与 ilcode 扩容失败静默 -1。

### 3.2 src/am_debug.c（反汇编 / dump 打印）

- 【真实的内存安全 bug】`debug_ast_print` 的 visited 缓冲扩容失败后打印消息但**不扩容**，调用方无感知继续 `(*visited)[(*visited_count)++]` **越界写旧缓冲**（:44-47 → :87）。
- `tmpfile()`/malloc 失败用 **`assert` 兜底**（:585-586, :594）——release（NDEBUG）下 NULL 解引用。
- 反汇编遇**未知 opcode 静默打印 `?`**（:680 `am_debug_opcode_name` default），不报错；vocab 查不到名字打印 `?`/裸编号（:694, :708）；非法操作数打印 `?`（:728-730）。
- 其余全部是打印时的防御性降级：`(invalid)`、`(unknown type %d)`、`UNKNOWN(%d)`、`<varid=%zu>` 等（:56-99, 291, 387-407）；`collect_handles` 扩容失败静默丢 handle（:465）。

---

## 4. 运行时 / VM 层

### 4.1 错误机制（详见 §0.2）

- `am_runtime_error` 不终止进程、不设置状态，仅写 fifo + 回调；终止由 tick 统一执行。
- tick 正常结束但**进程重新入队失败**（am_runtime.c:3087-3092）：进程置 STOPPED、返回 IDLE，**无任何错误消息**（静默）。
- 调度队列条目损坏（pid_val 非 uint、pid 越界、进程指针 NULL）→ IDLE **静默丢弃**（3047-3057）。

### 4.2 src/am_runtime.c 指令错误

#### 4.2.1 带具体消息的错误（全部 [Runtime] 消息一览）

- `load: 变量 %ls 未定义`（:527）；`call: 变量 %ls 未定义`（:796）——变量名查不到时显示 `?`。
- `call: 目标对象类型错误`（:864，调用不可调用的 handle 对象）；`call: 错误的调用目标`（:882）。
- `callnative: 错误的native变量名`（:911）；`callnative: native变量名包含多个点号`（:915）；`callnative: 未找到native函数 %ls.%ls`（:932）。
- `return: 函数调用栈为空`（:949）。
- dynamic-wind 系列：`dynamic-wind: 参数必须是闭包`（:996, :1005）、`dynamicwind_after_before: 无当前条目`（:1042）、`... 无当前 thunk`（:1059）、`dynamicwind_before_after: dynamic_wind_stack 为空`（:1075）、`dynamicwind_done: dynamic_wind_after_stack 为空`（:1109）、`op_wind: after 条目与栈顶不一致`（:1145）、`op_wind: 非法 wind_state`（:1213）。
- `unquote-splicing 的参数必须是列表`（:1563, :1570, :1579）。
- `除零错误`（:1996）——**唯一被拦截的算术错误**（除法一律转 float 后判 `fa == 0.0`）。
- `fork 指令已废弃`（:2304）。注意 **op_read/op_write 也已废弃却静默成功**（:2354-2369）——残留指令悄悄什么都不做，与 fork 的报错策略不一致。
- `未知指令: %u`（:3005）。
- 兜底：`指令执行异常: PID=%zu PC=%zu`（:3070）。

#### 4.2.2 静默 -1 的指令错误（用户只能看到 PID/PC 兜底消息）

- **类型检查失败**：store/load/push/pop/swap/set 的 operand 校验（:498-635）；car/cdr/cons/length 的非列表参数（:1267-1503）；get_item/set_item 的类型错（:1366-1410）；list_push/list_pop 类型错（:1447-1482）；算术/比较指令的非数值参数（:1907-2123）。
- **对空表 car/cdr**（:1276, :1298）——无专用消息。【实测】只有兜底消息。
- **set! 到未定义变量完全静默成功**（:616-631：沿闭包链找不到绑定就什么都不做，正常步进）。【实测】`(set! undeff 1)` 无错误，程序继续。
- **get_item 越界 → 压 `#undefined` 静默成功**（:1392-1394，含下标类型不可识别 :1386-1390）；而 **set_item 越界 → 静默 -1 杀进程**（:1433）——【实测】两者策略不一致已验证。
- **数值问题**：`mod` 零无检查——【实测】`(mod 1 0)` 显示 `-nan`，进程继续；`pow` 域错产生 NaN 静默压栈；整数加减乘溢出无检查（C 层 UB）；float→int 强转溢出未定义（:25-46）；NaN 参与比较全假静默；无 isinf 指令（isnan 是唯一观测口）。
- **调用栈溢出（fstack 固定 2048 值=1024 帧）**：`am_process_push_stack_frame` 失败（am_process.c:461-472）→ call/continuation/定时器回调/dynamic-wind 各调用点静默 -1 → 进程 STOPPED——**没有"栈溢出"专用提示**。
- **VM 层完全没有 arity（参数个数）检查**：`var_arn_mapping` 在 am_runtime.c 全文中零引用。【实测】`((lambda (x) x) 1 2 3)` 显示 `3`——参数错位静默产生错误结果。
- **op_return 弹出的帧不做类型校验**（:953-954）：fstack 被污染时跳转到任意 PC，靠下一条取指失败兜底。
- **跳转目标无边界检查**（`am_process_goto` 直接写 PC）：越界跳转要等下一条 `am_process_current_instruction` 返回 -1（am_process.c:590-597）兜底，只有通用消息。
- **条件跳转 pop 未检查**（:1224, :1239）：空栈时 condition = UINTPTR_MAX（≠ #f），iftrue 按"真"跳转——静默错误分支。
- **大量 push/pop/heap_set 返回值未检查**：op_load :538, 541；op_swap :587-588；op_pop 的 pop 未检查；op_car :1278；op_cdr :1316；op_cons :1354；op_list_pop 的 `am_list_pop` 未检查（:1485，空表 pop 结果直接压栈）；op_concat :1637；op_splice :1668；各算术/谓词指令。heap_set 未检查点：op_store :509、op_set :610, :625、copy_bindings :355、op_capturecc :976——**闭包 resize 后 heap_set 失败会留下指向已释放旧闭包的悬垂指针**（am_closure.c 的 resize 会 free 旧闭包）。
- **op_duplicate 对不支持的对象类型（闭包、续体等）静默返回原 handle**（:1712-1715）——浅拷贝语义无任何提示。
- **op_capturecc 硬编码 `ret_target = PC + 3`**（:965）：依赖编译器固定布局，无运行时校验。
- **op_pause 置 SUSPENDED**（:2380）：无外部唤醒则永久挂起，无消息。
- **op_concat/op_splice 及 unquote-splicing 错误路径清理正确**（近期新增代码，属良好范例）。

#### 4.2.3 队列 IPC / 定时器 / 生命周期

- 【缺陷】`runtime_queue_wake_process` 唤醒时 push_operand 失败（:105）——**静默 return，进程永久停留 BLOCKED**。
- `am_runtime_queue_write/read`：数据已入队但 push_operand 失败时返回 -1（:262, :273, :280）——**数据已写入但指令报失败，状态不一致**；read 侧注释承认"即使 push 失败，发送者仍视为成功"（:310-313，有意的静默）。
- 【缺陷】定时器回调 `am_runtime_call_async` 返回值未检查（:2664-2665）：回调可静默丢失，进程状态仍被无条件置 RUNNING；STOPPED 进程重新入队 push 失败静默忽略（:2656-2657）。
- 【泄漏】`runtime_process_gut`（:2687-2749）未释放 `dynamic_wind_stack`、`dynamic_wind_after_stack`、`pending_after_entries`、`pending_before_entries`（对照 am_process.c:387-402 的完整清单）——kill 处于 dynamic-wind 状态的进程泄漏这几个 VM 区列表。
- `am_runtime_create` 对 `working_dir` malloc 失败**静默忽略**（:2428-2434），运行时可以 NULL working_dir 继续工作。
- GC 编排：`am_gc_collect` 返回值两处 `(void)` 丢弃（:3039, :3184）；指令失败时的 GC 补救仅一轮，**GC 后内存仍不足则进程 STOPPED，无"GC 后重试指令"机制**。
- `am_native_register_lib`：库数超 `AM_NATIVE_MAX_LIBS`(16) 静默 -1（:3334-3339）。

### 4.3 src/am_process.c（进程 / 栈）

- **opstack 溢出策略**：容量不足时**自动 2 倍扩容**（:426-435，原有"容量不足报错"代码已注释掉），只有 VM 内存耗尽才 -1——**失控递归以指数扩容吞掉 VM 内存后才收场，且深度静态估计失准无任何告警**（与 §3.1 的静默降级呼应）。
- **fstack 固定 2048 值不可扩容**（:300-309），溢出唯一检查点 :467（见 §4.2.2）。
- `am_process_pop_operand` 空栈返回 `(am_value_t)UINTPTR_MAX` 哨兵（:442-446），**绝大多数调用点不检查**。
- `am_process_dereference`：无当前闭包也返回与"未定义变量"相同的哨兵（:551-552）——op_load 会误报"变量未定义"而非"无闭包"。
- 续体：`restore_continuation_snapshot`（:747-794）在 opstack/fstack 已被 memcpy 覆盖、after_stack 已被销毁**之后才返回失败**——进程状态被部分改写（进程已死所以无害，但属状态一致性缺陷）；续体保存的栈长超当前容量按固定容量拒绝（:747-751，opstack 一侧属过度保守）。
- 值打印：`am_process_append_list_to_strbuf`（:987-1017）与 `runtime_value_equal`（am_runtime.c:445-489）**递归无深度限制**——环状/超深结构在 display 或 equal? 时**耗尽 C 栈真崩溃**（非受控错误）。
- 资源清理链整体完整（load_from_module 的多级回滚 :216-330、destroy :350-410），属良好实践。

### 4.4 src/am_closure.c / src/am_continuation.c

- 两文件**无任何消息、无回调**，纯返回值传播（NULL / -1 / SIZE_MAX / AM_HANDLE_NULL），分配失败向上传递。
- `am_closure_get_bound_var/get_free_var` 未找到返回 `AM_VALUE_UNDEFINED`（:294-298, :361-365）——与 dereference 的 UINTPTR_MAX 哨兵不同，**无法区分"绑定为 undefined"与"变量不存在"**。
- `am_closure_resize` 会 free 旧闭包（:38-62）——配合 §4.2.2 的 heap_set 未检查点构成悬垂指针风险。

---

## 5. 宿主适配、本地库与上层程序

### 5.1 main.c（命令行入口）

- 【core dump 根因】Makefile 未定义 `NDEBUG`，**assert 全部生效**：文件读取失败（main.c:318）、`am_parse` 失败（:174）、`am_link` 失败（:187）、`am_compile` 失败（:194）、dump/load 失败（:203, :206, :272）、runtime 创建失败（:278）、JS 翻译失败（:372, :376）——任何编译期错误 = `[Parser Error]` 消息 + `abort()`（退出码 134），而非干净的错误退出。【实测】源文件不存在直接 core dump。
- **运行时错误不影响退出码**：`test_halt_called` 置位后从未被读取（:60）；error_fifo 只打印到 **stdout**（:83-88，不是 stderr），程序出错退出码仍为 0。【实测】已验证。
- 未检查：`am_runtime_load_module` 返回的 pid（:294）、`get_process_by_pid` 返回 NULL（:297）、`am_mbstowcs` 返回值与 256 宽字符路径截断（:170-171, 266, 316, 370）、`wcstombs` 对不可转换路径返回 -1（:121，中文路径在错误 locale 下必崩）。
- 静默回退：`am_path_dirname` 对不含 `/` 的路径（**Windows 反斜杠路径必然如此**）返回 NULL，静默回退 `base_dir = "."`（:164-165）——相对 import 基准目录错误但不报错。
- `fread` 短读不视为错误（:140，与 am_host.c 的严格检查不一致）；argc<2 的 Usage 打到 **stdout**（:351-354）。
- `on_error` 是空 TODO（:67-71）；`on_halt` 只置无人读取的标志（:62-65）。

### 5.2 src/am_host.c（桌面宿主适配，ESP32 版同构）

- `am_read_file_to_wchar`：6 处静默失败点（:30-60，fopen/fseek/calloc/fread 短读），无任何消息；**`ftell` 失败未检查**（:43）强转 size_t 成天量。
- 编码转换：**非法 UTF-8 静默替换 `?` 并提前终止整个字符串**（:204-266），调用方普遍不检查返回值——源码内容被静默改写；`am_wcstombs` 对非法码点写 `?`、缓冲满静默截断（:166-199）。
- 时间函数：`clock_gettime` 失败静默回退 `time()`（:19-25）；`nanosleep` 被信号中断返回值忽略（:11-16）。
- host malloc 系列失败原样透传 NULL，无日志（:135-157）。

### 5.3 本地库（native）

共同特征：**native 函数自身零消息**——参数类型/个数错误一律 `return -1` 硬错误（杀进程，Scheme 层只见 PID/PC 兜底消息）；域错误/查无此项多为软失败值。

- **Math**（am_native_Math.c）：`sqrt(-1)`/`log(-1)` 等 NaN → 压 `#null`（软）；`exp(1000)` → +Inf 原样压栈（**Inf 未统一处理**）；`to_fixed` 位数静默钳制 [0,15]；移位计数静默钳到位宽；`native_pop_uint` 只接受 uint（比算术更严，int/float 也硬错误）。
- **String**（am_native_String.c）：越界/NaN 索引 → `0.0` 或空串（软）；`parseNumber` 空串/部分解析/NaN → `#undefined`，但 **`"1e999"` 溢出为 Infinity 被当作合法数字**（:334-368，不查 errno）；`atom_to_string` 不支持的类型静默返回空串（:180）。
- **System**（am_native_System.c）：
  - **语义不一致**：`System.exec` 前段失败硬 -1、后段（parse/link/compile/进程替换）压 int `-1` 软失败进程存活；`System.eval` 几乎全部失败都是硬 -1 杀进程——二者正好相反。
  - eval 有 7 条自有 stderr 消息（`[System.eval] 未定义的变量：%ls` :1174、`编译失败` :1638、`无法插入 evalcleanup 指令` :1668 等）——**绕过 error_fifo**，REPL 捕获不到。
  - 【缺陷】**eval 中途失败时 evalcleanup 不执行**（am_runtime.c:1726-1890 假定 eval 成功到末尾）——ilcode/var_vocab/static 标记全部残留（进程已死暂无后续影响，但无回滚路径）。
  - 软失败值：kill 失败 `#f`；set_timeout/clear 参数非法 `0.0`/静默忽略；make_queue 失败 `#null`；队列 write 失败 `#f`、read 超时 `#undefined`；gc 失败 `#f`。
  - `System.fork` 深拷贝链失败无原因消息（:256）；队列 push 失败时子进程已入池、父进程已压 pid——**状态部分提交**（:919/926）。
  - `System.test` 完全不做类型检查，打印原始 TPV 位模式（:1023-1029）。
- **Table**（am_native_Table.c）：get 查无此键 `#undefined`；set 超长 wstring key（> `AM_PROCESS_STRINDEX_MAX_LEN`）是**硬错误**而非截断（:69）；delete 对不存在的 key 静默成功。
- **LLM**（am_native_LLM.c，无网络，模型 Base64 内联）：
  - 【高危】**十余处 malloc/calloc 不检查**（map/trie/tokenizer/模型解析 :242-279, :325-331, :373-421, :506-531, :642-655）——OOM 时 NULL 解引用。
  - 【高危】`am_llm_decode_nano` 的 `token_list[ids[i]]` **无上界检查**（:513-526）——`LLM.decode` 传越界 token_id 越界读。
  - 未先 `LLM.init` 调用其他函数 → 硬 -1 无提示（:799, :831, :877, :907）；字符不在词表静默映射为 id 0；matmul 越界读静默得 0.0、越界写静默跳过、`d<=0` 静默成功无操作。
  - 全局可变状态 `g_llm` 多进程共享无保护。

### 5.4 src/am_repl.c / main_repl.c

- REPL 是**唯一有完整错误处理的上层**：编译期错误分阶段报告（`[REPL] 语法解析失败` :380、`模块链接失败` :388、`编译失败` :396）并**回滚 session**（:558-566）；运行时错误（on_error 置位 `ctx->runtime_error`）杀新进程 + 回滚（:1164-1170）——"运行时错误等价于该行没输入过"。但回滚只撤文本，已产生的输出/定时器等副作用不撤销。
- parser 的 `[Parser Error]` 直接打进程 stderr，**不进 REPL 的错误缓冲**——REPL 前端只能看到笼统的"语法解析失败"。
- 输入处理：`[REPL] 括号不匹配`（:1332-1336）、`输入编码失败`（:1341-1344）、`内存不足`（:1106-1110, :1354-1358）；表达式未完成走多行续输入。
- JS 模式：`[JS] <err>`（取 `am_js_last_error()`）或 `[REPL] JS 翻译失败`（:799-810）。
- 静默丢弃：输出缓冲 realloc 失败**静默丢弃该次输出**（:453-454, :471-472）；`repl_session_strip_display` 失败静默沿用旧 session（:1097-1102）；`repl_ctx_feed(NULL)` 分支漏设 `res.error`（:1421-1427，未初始化栈值，潜伏 bug）。
- reset 失败后 ctx 处于半初始化状态（:1182-1232 各失败点清理粒度不同），继续使用有隐患。
- 【缺陷】**Ctrl+C 无法打断正在求值的死循环**：main_repl.c 的信号 handler 从不调用 `am_repl_ctx_interrupt`，`ctx->should_stop` 每次 feed 开始还被清 0（am_repl.c:1434）——只能强杀进程。tty 上 Ctrl+D 不退出（main_repl.c:79-92，重新提示）。

### 5.5 src/am_highlight.c（终端高亮）

- 【潜伏 bug】`tokens == NULL` 未检查（:81-82）——`count > 0` 时解引用段错误（当前唯一调用点在 main.c 注释掉的代码中，未爆）。
- 其余均为安全降级：非法 token type → 默认色/`COLOR_ERROR`；越界 token 不越界读；非 tty 不输出颜色码。

---

## 6. 横切问题汇总（核心发现）

### A. 崩溃类风险（core dump / 越界 / 死循环）

1. **main.c 全程 assert 兜底**（:174, :187, :194, :203, :272, :318, :372, :376）——任何编译期错误 abort（退出码 134）。【实测】
2. **tokens 数组容量上界错误**：`{` 一字符产 2 token，`EMIT` 无容量检查（am_parser.c:2058 vs am_lexer.c:172-182, 250-262）——堆越界写。
3. **宏展开无递归上限**（am_macro.c:1724）——自引用宏 C 栈溢出。
4. **display/equal? 递归无深度限制**（am_process.c:987-1017、am_runtime.c:445-489）——环状结构 C 栈溢出。
5. **模块 load 全链路无缓冲区长度校验**（am_module.c、am_heap.c:484-512、am_object.h 解码原语）——截断/篡改文件越界读。
6. 确定的 NULL 解引用：am_heap.c:88-91（keys OOM）；am_debug.c:44-47→87（扩容失败后越界写）；LLM 库十余处 malloc 不检查；am_vocab.c:92-98, 132（NULL word）。
7. 死循环风险：2 的幂取整回绕（am_map.c:15-18、am_wstring.c:167-170）；开放寻址探查（am_map.c:24-43 等）；物理块遍历 sz=0（am_allocator.c:714, 1014, 1207）；heap deep_dump 不动点迭代无上限（am_heap.c:401-428）。
8. `am_llm_decode_nano` 越界读（am_native_LLM.c:513-526）。

### B. 诊断能力缺失（消息通道不统一）

- 四类通道并存（哨兵/stderr/error_fifo/软失败值），无统一错误码与结构化错误对象；消息普遍**不含行列号**。
- **零诊断模块**：am_linker.c（整个链接器）、am_compiler.c（仅 1 条消息）、全部容器、am_closure/continuation；**词法错误完全静默**。
- native 函数零消息——参数错误只有 PID/PC 兜底消息；`[System.eval]` 消息绕过 error_fifo，REPL 捕获不到；REPL 收不到 `[Parser Error]` 的具体内容。
- 一次指令失败 on_error 触发 2~3 次；运行时错误不影响 main 退出码（仍为 0），错误消息打到 stdout。

### C. 静默失败 / 未检查返回值（重点调用点清单）

- am_runtime.c：`am_heap_set` 裸调用 10 处（:355, :509, :610, :625, :976, :1313, :1352, :1618, :1665, :1695）；`am_process_push_operand` 未检查 10+ 处；`(void)am_gc_collect` 2 处（:3039, :3184）；定时器回调未检查（:2664）；队列唤醒失败进程永久 BLOCKED（:105）。
- am_compiler.c：`am_compiler_make_label` 未检查 10+ 处（绕过悬空 label 检查）。
- am_parser.c：`am_ast_set_node_token_index` 未检查 4 处（:597, :667, :900, :984）。
- am_gc.c：keepalive push（:455-457）、free_handle（:406）、进程级失败静默跳过仍返回 0（:647-662）。
- am_macro.c：rebuild_lambda_handles 丢 lambda（:1924-1942）。
- am_module.c：dump 写阶段返回值全部不检查（:358-405）。
- 错误消息自身会丢：error_fifo/output_fifo push 失败静默丢字符（am_runtime.c:3297-3315）。

### D. 哨兵值语义不一致

- 错误与"未找到/否"同值：-1（map_contains、heap_has_handle、scope_has_var、object_check_*）、SIZE_MAX（list_find、vocab_find、strindex_*）、NULL（map_keys、list_lambda_get_bodies、scope_add_var）。
- "空值"哨兵三种并存：`AM_VALUE_UNDEFINED`（list_get/pop、heap_get）vs `AM_VALUE_NULL`（map_get）vs `AM_HANDLE_NULL`。
- 同类情形策略不一：get_item 越界软（#undefined）vs set_item 越界硬（杀进程）【实测】；System.exec 前硬后软 vs System.eval 全硬；op_fork 废弃报错 vs op_read/op_write 废弃静默成功；gc_root_helper 同类损坏一处 continue 两处 -1；am_wstring_load 与 am_vocab_load 的码点校验宽严不一。

### E. 数值问题

- 数字字面量溢出静默饱和/截断（parser :297-308）【实测：1e999→inf、26 位整数→2^59-1】；整数算术溢出无检查（UB）；`mod` 零 → NaN 静默【实测】；`pow` 域错 → NaN 静默；Inf 无统一处理、无 isinf；float→int 强转溢出未定义；`parseNumber` 不查 errno（"1e999" 合法化）。
- VM 层无 arity 检查【实测：多传参静默错位得错误结果】。

### F. 资源管理与状态一致性

- 出错 STOPPED 进程资源不回收（am_runtime.c:3072 后）；`runtime_process_gut` 泄漏 dynamic-wind 相关 4 个结构（:2687-2749）；闭包 resize 后 heap_set 失败 → 悬垂指针；队列写"数据已入队但指令失败"状态不一致（:262-280）；eval 失败无回滚（evalcleanup 不执行）；`restore_continuation_snapshot` 部分改写后返回失败（am_process.c:779-794）；REPL reset 后半初始化状态；REPL Ctrl+C 不能中断求值。
- GC 系统性静默：进程级失败跳过仍返回 0、压缩失败忽略、水位查询失败当正常、VM 区 OOM 无标志（观测盲区）、非白名单对象类型永不回收（设计性泄漏无告警）。

### G. 实测验证记录（2026-07-27，WSL/gcc 构建）

| 场景 | 实际行为 |
|---|---|
| 源文件不存在 | assert abort，core dump（退出码 134） |
| `(car '())` | 仅 `[Runtime] 指令执行异常: PID=0 PC=3`，退出码 0 |
| `(set! undeff 1)` | 静默成功，程序继续 |
| `(mod 1 0)` | 显示 `-nan`，进程继续 |
| `((lambda (x) x) 1 2 3)` | 显示 `3`（无 arity 检查，静默错位） |
| `(get_item '(1 2) 99)` | `#undefined`（软） |
| `(set_item! '(1 2) 99 0)` | 杀进程（硬） |
| `1e999` | 显示 `inf` |
| `99999999999999999999999999` | 显示 `576460752303423487`（截断） |

---

## 7. 结语

引擎当前的错误处理呈现"**机制存在但覆盖随意**"的面貌：返回值约定在 doc/AGENTS.md 中有明确定义且多数函数遵守，运行时层有统一的错误收口（tick → STOPPED + 兜底消息 + on_error），少数模块（module dump/load、allocator、parser、macro）有较好的消息覆盖；但**链接器与编译器几乎零诊断、词法错误完全静默、native 库零消息、大量关键返回值未检查、若干确定的崩溃与越界风险点**（§6-A），且缺少统一的错误码/错误对象/位置信息设施。以上清单可按 §6 的分类作为后续完善诊断、观测与错误处理机制的工作底稿。
