# Animac 2026 通用研发规范

以下是Animac项目的通用研发规范。该规范尚未编写完毕，仍在持续补充，供AI编码代理参考。

## 项目概述

Animac（灵机）是一款Scheme解释器，支持Scheme语言的子集和某些自定义特性，并不完全遵守R5RS。

## 目录结构

- doc/：文档
- include/：C语言头文件
- src/：C语言实现（代码）文件
- test/：C语言测试实现文件
- typescript/：本项目早期原型项目，由TypeScript实现。除非明确要求，否则应忽略该目录，不要主动阅读 typescript 目录下的内容，以免干扰上下文。
- amalgamate.sh：Amalgamation 脚本，将解释器核心（伞形头文件收录范围，不含宿主相关文件）合并为单文件分发形态（见“架构设计”）。
- animac_core.h / animac_core.c：由 amalgamate.sh 生成的单文件头文件/实现（勿手工编辑）。

## 术语约定

- 逻辑长度称length，物理长度称size，容器最大容量称capacity。
- parameter形式参数称“引数”，argument实际参数称“参数”。
- Alpha-renaming过程，也就是通过换名来消除嵌套词法作用域中同名变量的混淆的过程，简称为ARN。
- 内置函数和运算符，值分类上属于变量，统称为“内建变量”builtin，不叫“primitive”。

## 环境与工具

- 禁止执行任何删除命令，如`rm`。
- 禁止通过Python、Node.js、bash等脚本间接执行具有删除副作用的函数或命令，例如`unlink`等。
- 禁止执行对Git状态产生修改的命令，如`git add`、`git push`、`git pull`、`git stash`等。但可以查看Git状态。如果确有需要，则必须停止对话，立刻向我请示如何处理。
- 当前开发环境是Windows系统，但部署了WSL（Ubuntu）。你可以使用WSL，通过WSL使用make、gcc等构建工具进行构建、测试。

## 架构设计

公开 API 伞形头文件（仿 CPython 的 Python.h）：`include/animac.h` 汇总解释器核心（基础设施、前端、运行时）的全部公开头文件。上层程序（REPL、解释器入口、debugger 等）只应直接包含 `animac.h`，另按需包含被明确排除的 host.h（宿主适配）、native_*.h（native 库）、highlight.h（终端呈现）。新增解释器核心头文件时，必须登记进 animac.h 对应分组。


关于解释器的工作目录、模块全局ID：

- 任何解释器实例都必须指定一个基准工作目录(base_dir)。
- 若工作在REPL模式下，则以终端cwd为base_dir，给模块一个临时文件名
- 若运行代码文件，则以该文件所在目录为base_dir，即该文件绝对路径的目录部分（约定不带斜杠）。
- 所有的import文件路径，要么是绝对路径，要么是相对于base_dir的相对路径。
- 链接器搜索import模块的算法：
  - 判断import文件路径是绝对路径还是相对路径。如果是绝对路径，直接读取。
  - 如果是相对路径，则将base_dir与相对路径拼接成绝对路径再读取。
- 模块ID的构造规则：
  - 将模块绝对路径中的斜杠替换为点、空白字符替换成下划线、冒号去掉。
  - 去掉第一个点；若文件名有.scm后缀则去掉
  - 例如："/home/a/b.scm" -> home.a.b
- 链接器（src/linker.c）不直接依赖宿主API获取模块源码（依赖倒置）：调用方通过 `am_link` 的引数注入 `am_linker_read_source_fn` 回调（见 include/linker.h），回调用传入的 allocator 分配返回的源码缓冲区（由链接器用 am_free 释放）。宿主侧的文件系统默认实现为 `am_host_read_source_from_file`（include/host.h，src/host.c 与 src/host_esp32.cpp 各有一份实现）。
- 垃圾回收（GC）统一由 gc 模块实现（include/gc.h、src/gc.c），层级位于 process/heap 之上、runtime 之下（不依赖 runtime.h）：对外函数——`am_gc_process`（分进程标记-清除）、`am_gc_compact`（全局标记-压缩：收集各 heap 表存活对象、调用压缩引擎、回写 heap 表指针）、`am_gc_collect`（对进程池的一轮编排，含 force_compact 参数，由 runtime 调用）、`am_gc_heap_watermark_level`（堆水位查询：0 正常 / 1 高水位 / 2 临界水位）。GC 配置宏集中在 gc.h：`AM_ENABLE_GC`、`AM_HEAP_COMPACT_INTERVAL`、`AM_GC_HEAP_HIGH_WATER_RATIO`(0.75)、`AM_GC_HEAP_CRITICAL_RATIO`(0.90)、`AM_GC_HEAP_FRAG_FLOOR_RATIO`(0.30)、`AM_GC_HEAP_FRAG_MIN_BLOCK_RATIO`(0.03125)、`AM_GC_PERIODIC_INTERVAL`(32)、`AM_GC_WATERMARK_CHECK_STRIDE`(256)。压缩职责按“引擎+钩子”拆分：allocator 提供纯物理压缩引擎 `am_allocator_heap_compact`（不感知逻辑堆，经 `am_allocator_relocate_fn` 回调按地址升序报告重定位）及 `am_allocator_host_malloc/realloc/free` 暂存分配接口；逻辑堆知识（存活判定、handle 表回写）全部在 gc 模块。allocator 不依赖 heap/map/object 等上层模块。
- GC 触发策略为“堆水位为主、周期兜底为辅”的三级触发（2026-07 起，取代原先的每轮事件循环定时 GC）：
  - L0（allocator 层）：`freelist_malloc` 分配失败时先经 `am_allocator_pool_auto_adjust` 向 VM 区让渡边界并重试（≤4 次），彻底失败置 `oom_flag`（经 `am_allocator_heap_take_oom_flag` 读取清除）；allocator 层级不允许触发 GC。
  - L1（runtime 层）：`am_runtime_tick` 内每 `AM_GC_WATERMARK_CHECK_STRIDE` 条指令及 tick 末尾检查水位（`runtime_gc_watermark_check`），级别 1 做标记-清除、级别 2 强制压缩；发现 oom_flag 也强制一轮 GC 以挽救其余进程。水位兼顺两个维度：用量比（used/capacity）与碎片（用量≥30% 且最大空闲块低于 max(容量×1/32, 近期最大分配请求)，防止 first-fit 碎片化失败；largest_request 由 freelist 记账、压缩后清零；碎片维度两阶段查询，低于下限不遍历空闲链表）。
  - L2（事件循环层）：每 `AM_GC_PERIODIC_INTERVAL` 轮事件循环执行一轮兜底 GC（0 表示禁用，即纯水位）。
  - allocator 新增查询：`am_allocator_heap_usage`（used/capacity/largest_free_block/largest_request）、`am_allocator_heap_take_oom_flag`。
- 内存池（src/allocator.c）不直接依赖宿主系统的 malloc/calloc/realloc/free（依赖倒置）：宿主在调用 `am_allocator_pool_create` 时通过 `am_allocator_host_vtable_t` 虚函数表（见 include/allocator.h）注入 `host_malloc`/`host_calloc`/`host_realloc`/`host_free` 四个实现（均为必需，任一为 NULL 则 create 失败）。池控制块、池底层内存及堆压缩的临时工作数组均经由该表分配；池仅保存指针不拷贝，宿主须保证其生命周期不短于池。宿主侧参考实现为 include/host.h 的 `am_host_malloc` 等四函数及默认实例 `am_host_default_vtable`（src/host.c 与 src/host_esp32.cpp 各有一份，ESP32 版映射到 SPIRAM 的 heap_caps_* 系列）。
- 运行时（src/runtime.c）不直接依赖宿主的输入输出回调、定时器与时间戳函数（依赖倒置）：宿主在调用 `am_runtime_create` 时通过 `am_runtime_vtable_t` 虚函数表（见 include/runtime.h）注入 6 个实现——事件回调 `on_tick`/`on_event`/`on_halt`/`on_error`（可选，为 NULL 则不触发）与时间函数 `now_ms`/`sleep_in_ms`（必需，为 NULL 则 create 失败）。runtime 仅保存 vtable 指针不拷贝，宿主须保证其生命周期不短于 runtime。桌面宿主的默认实现见 main.c 与 src/repl.c 中的 `g_host_vtable`（时间函数底层为 include/host.h 的 `am_current_timestamp_in_ms`/`am_sleep_in_ms`，src/host.c 与 src/host_esp32.cpp 各有一份实现）。

symbol是以其字面为ID的，相同拼写的symbol，无论在哪个上下文中都是同一个符号。因此AST合并时，字符串相同的symbol，就是同一个symbol。这与variable截然不同。

- 栈平衡（单值栈纪律，2026-07 起，方案详见 doc/todo/stack_bal.md 之“方案A：编译期单值纪律”）：编译器保证**任何表达式求值结束后恰好在 opstack 上留下 1 个值，任何语句序列执行完后栈深恢复到序列开始时的水平**。实现要点（均在 src/am_compiler.c，VM 指令语义不变）：
  - `begin`/lambda 体/`while` 体中，非末尾表达式的结果立即 `pop`；空 `begin`/空 lambda 体补 `push #undefined`；
  - 语句形式（`define`/`set!`/`display`/`newline`/`push`/`set_item!`/`while`/单臂 if 的假分支/无 else 且全部落空的 `cond`/空 `begin`）的值统一为 `#undefined`；
  - 语句型内建清单集中在 `compiler_statement_builtin_residue`（display/newline/list_push/set_item/read/write/fork），编译器在指令后补偿弹残留并 `push #undefined`（与 `AM_BUILTIN_OPCODE_MAP` 并列维护，勿散落各点）；
  - 编译期“零效应形式”（import/native/define-syntax/let-syntax/letrec-syntax/syntax-rules 与裸符号 break/continue）不产生值，由 `compiler_check_produces_value` 判定，语句边界不为它们发射 pop；
  - 纪律的连锁性质：函数调用净效应恒为 -argc+1；尾递归在 opstack 上恒界；while 无逐迭代栈累积；静态栈深分析随之精确（`compiler_stack_effect` 按运行时实际效应维护，call 后继深度 = 调用点深度 - argc + 1）。
  - native 函数须遵守 stack_bal.md §11 的栈平衡契约：正常返回路径恰好弹 N 压 1；语句型（如 clear_timeout、LLM.init/matmul、System.eval）压 `#undefined`；每次裸 pop 必查 `UINTPTR_MAX` 哨兵；终止型/异步型/进程替换型为登记例外。

## Amalgamation（单文件分发形态）

效仿 Lua/SQLite 的单文件库形态，项目提供 Amalgamation 机制，方便第三方集成：

- 生成方式：`make amalg`（底层调用 `bash amalgamate.sh`；Makefile 已对 include/ 与 src/ 建立依赖跟踪，源文件更新后自动重新生成）。产物为项目根目录下的 `animac_core.h`（核心头文件按依赖拓扑序合并，含 `extern "C"` 包装）与 `animac_core.c`（核心实现按同一顺序合并，仅 `#include "animac_core.h"`）。
- **收录范围 = include/animac.h 伞形头文件登记的解释器核心**（基础设施、前端、运行时），Amalgamation 是自包含的“上帝模块”。伞形头文件登记的**头文件-only 模块**（无同名 src/*.c 实现文件，如纯 static inline/宏/文档型头文件）仅并入 animac_core.h、不并入 animac_core.c，脚本会列出这类头文件（2026-07 起容忍，不再是错误）。明确排除与宿主相关的内容：`am_host.*`（宿主适配）、`am_native_*.*`（native 库，核心通过 `am_runtime_register_native_lib` 动态注册，不静态依赖）、`am_highlight.*`（终端呈现）、`am_repl.*`（上层消费者）。收录清单直接取自伞形头文件，二者自动保持同步。集成方编译 `animac_core.c` 获得解释器核心，再按需单独编译 `src/am_host.c`、`src/am_native_*.c` 等宿主侧文件一同链接。
- Makefile 相关目标：`make amalg` 生成单文件产物；`make main_amalg` / `make repl_amalg` 用单文件形态 + 宿主侧源文件（Makefile 中 `HOST_SRCS`，另加 repl 所需的 `src/am_repl.c`）构建可执行文件（`make amalg-all` 一次构建两者）；`make amalg-clean` 清理单文件形态全部产物（生成文件 + 可执行文件 + 测试输出）；`make clean` 也会清理 main_amalg / repl_amalg。
- 产物由脚本自动生成，**勿手工编辑**；修改 include/ 或 src/ 后应重新运行 `make amalg`。
- 变换规则（仅作用于产物，绝不修改 include/ 与 src/ 下的源文件）：剔除局部 `#include "..."`（保留系统 `#include <...>`）；伞形头文件 `animac.h` 不并入，其包含列表展开为其引用者的依赖。
- 跨编译单元的 static 符号冲突：以下 static 函数在不同 .c 文件中重名定义，合并到同一编译单元会重定义，脚本统一按 “<文件基名>__<原名>” 规则在产物中改名（不改源文件）：
  - `dynamic_wind_entry_{after,before,saved,set_saved}`、`dynamic_wind_get_entry`：src/am_process.c 与 src/am_runtime.c
  - `parse_term`：src/am_js2scm.c 与 src/am_parser.c
  - （宿主侧文件 `am_native_*.c` 之间亦存在同类重名——`native_pop_number`、`native_push_float_or_null`、`native_push_wstring_buf`、`wstring_content_to_buffer`——但它们不参与合并，无需处理。）
  - **新增 .c 文件时，若引入了与其他文件同名的 static 函数/文件作用域变量，必须同步更新 amalgamate.sh 的改名表（`rename_names_for`）及本清单。**
- 验证方式：`make main_amalg` 构建后，可用 `bash testall_amalg.sh`（与 testall.sh 同序同例，使用 ./main_amalg）做回归测试。

## 模块磁盘格式（dump/load）

模块及各数据结构的 dump/load 采用平台无关的固定宽度磁盘格式（2026-07 起），可在 32 位与 64 位宿主之间互导：

- （2026-07-23补充：`include/diskio.h`已全部融入`include/object.h`）序列化原语集中在 `include/diskio.h`（全部 static inline，无新增编译单元）：定长整数一律小端（LE）显式按字节读写；计数、索引、把柄等小值整数用 ULEB128 变长编码；有符号整数用 zigzag+ULEB128；浮点统一为 IEEE-754 double。
- TPV（am_value_t）磁盘编码 dvalue：1 字节类型标签（AM_VALUE_TYPE_*）+ 变长负载；NULL/UNDEFINED 无负载；INT 为 zigzag 变长；FLOAT 固定 8 字节 double；PTR 仅用于堆转储中的对象相对偏移量（必须保持偶数）。
- 磁盘上绝不出现 size_t、uintptr_t、原生指针、运行时结构体内存快照、系统 wchar_t。字符串一律以 Unicode 码点（uvarint）序列存储。
- 各对象磁盘布局见 src/list.c、src/map.c、src/wstring.c、src/vocab.c、src/closure.c、src/heap.c 中 dump 函数头部的注释；模块头与区段布局见 src/module.c 头部注释。
- 加载端按字节解码（不做结构体强制转换），并进行宿主字长适配检查（32 位宿主加载越界值会失败）。
- 堆深度转储存在不动点问题：对象偏移量依赖 heap dump 字节数，而 heap dump 字节数又取决于偏移量的变长编码长度，am_heap_deep_dump 通过单调迭代求解。

## 编码规范

关于函数返回值的语义约定。为了区分正面含义（肯定、正常、成功、找到）和负面含义（否定、异常、失败、没找到）两种语义，约定如下：

- int类返回值：以负整数为负面含义，非负整数（含0）为正面含义。对于返回int的有谓词含义的函数，不要用is_xxx来命名，而应用check_xxx来命名，以避免与C语言对真假值的定义混淆。
- bool类返回值：此类函数几乎都应该用is_xxx的风格去命名，表示这是返回bool的谓词，以true为正面含义，以false为负面含义。如TPV的类型谓词：am_value_is_xxx，其返回值是bool类型，可直接通过if(is_xxx(xx))来使用。
- uint类返回值（如size_t）：一般含有index、长度之类的语义，0也是有意义的值，因此以SIZE_MAX为负面含义（如搜索未找到等），其余为正面含义。
- am_handle_t类返回值：以AM_HANDLE_NULL即UINTPTR_MAX为负面含义（如handle分配失败等），其余为正面含义。
- 指针类返回值：以NULL为负面含义（内存分配失败等），其余为正面含义。
- am_value_t类返回值：解包成各个基本类型后，遵循以上原则。

所有对外提供的函数，都加am_前缀。所有的宏，都加AM_前缀。

对可变长容器进行写操作之后，可能触发扩容导致物理地址发生变化，因此务必注意检查和更新容器的指针。所有从heap中取出的变长容器类object，如果其指针在操作后发生变化，必须将新指针的value写回heap，以确保handle->value(ptr)->obj映射关系稳定！

## 宏系统（syntax-rules）

项目已添加基于 `syntax-rules` 的卫生宏系统，关键信息如下：

- 新增关键字：`define-syntax`、`let-syntax`、`letrec-syntax`、`syntax-rules`。
- 实现文件：`src/macro.c`、`include/macro.h`。
- 展开时机：在 `am_parse` 的 ARN 之后、`cleanup_scope_objects` 之前调用 `am_macro_expand(ast)`。
- 编译器在 `compile_application` 中跳过上述宏关键字，避免它们被当作普通函数调用编译。
- 一期限制：
  - 不支持跨模块导入/导出宏。
  - 模板中引入的 lambda 绑定会做 freshen，但用户需避免在模板中使用本解释器不支持的 `let` 类语法。
  - quote / quasiquote / unquote / unquote-splicing 内部不做宏展开，以避免用户 symbol 与关键字 symbol 值冲突。

## unquote-splicing（,@）

项目已支持 R5RS 的 unquote-splicing（`,@X` ≡ `(unquote-splicing X)`，2026-07 起），实现要点：

- 词法：`,@` 合成长度为 2 的 token `AM_TOKEN_TYPE_UNQUOTE_SPLICING`；`unquote-splicing` 为关键字。
- 语法：`,@X` 统一解析为 `AM_LIST_TYPE_UNQUOTE_SPLICING` 类型的单元素 slist 包裹节点（即使 X 是原子也包裹，以与 `,X` 区分）；ARN 将其与 UNQUOTE 同样当 application 处理。
- 编译：`compile_quasiquote` 遇到 splicing 子项时编译其内部表达式并发射 `AM_VM_OP_splice`（弹 1 压 1，栈效应 0，不影响静态栈深分析），把求值结果打包为 UNQUOTE_SPLICING 类型的运行时标记列表；splicing 节点出现在 quasiquote 之外是编译错误。
- 运行时：`op_concat` 遇到标记列表时取其唯一元素（必须是列表，否则运行时错误）并将其元素逐一拼入结果列表；标记列表生命周期止于 op_concat 内部，不泄漏到用户世界。
- 与 R5RS 的偏差：`` `,@x ``（拼接出现在模板顶层）被宽松接受；嵌套 quasiquote 无层级计数（与 unquote 一致，见 doc/ISSUES.md issue#19）。



## 测试体系与回归规范（2026-10 新增）

三批自校验回归测试已建成，全部位于 `test/`，C 实现与 Amalgamation 形态双覆盖（主回归 41 用例 + 编译期错误矩阵 10 用例 = 51 个 .scm 文件，471 条断言，全 FAIL 0 基线）。

### 运行与判定

- `bash testall.sh` / `bash testall_amalg.sh`：主回归（41 用例，其中 10 个为三批新增），脚本退出码 0 = 通过。每个用例为独立自校验文件，末行输出 `PASS: n  FAIL: m`；**m>0、脚本输出含 ❌/Segmentation、或退出码非 0 均为失败**。
- `bash testall_errors.sh`：编译期错误路径回归。`test/errors/*.scm` 中每个文件预期**非零退出**（当前实现为解析失败触发 main.c 断言终止，exit=134；理想行为是打印诊断后优雅非零退出，runner 不区分两者）。
- C 形态与 Amalgamation 形态的输出必须逐字节一致，**例外仅限已知非确定性内容**：随机数独/排序（test.scm、shudu）、llm/mlp 的生成文本与训练轨迹、test_eval 的时间戳、yinyang 被超时截断的长度。出现其他任何差异即为回归。
- 本轮回归环境：Ubuntu 24.04（gcc 13.3 / GNU Make 4.3 / Node 24），`libreadline-dev` 已安装（repl 与 repl_amalg 可编译）。

### 测试文件与断言前缀

| 文件 | 前缀 | 验证重点 |
|---|---|---|
| test/syntax_torture.scm | st_ | 语法/内建覆盖矩阵：pop、nan?、typeof、letrec-syntax、and/or 语义、数值边界（59 位回绕、mod 符号）、String 边界与参数序、空表/#null 区分、string? 模式、递归深度、quasiquote 现状、定时器控制 |
| test/json.scm | js_ | JSON 解析/序列化/往返不变量/畸形输入/压力 |
| test/errors_runtime.scm | er_ | 运行期致命错误矩阵（16 场景，fork 隔离） |
| test/linalg.scm | la_ | 线性代数：det/逆/幂法/Hilbert 病态矩阵/80×80 性能 |
| test/mpmc_pipeline.scm | mp_ | 多进程 Map-Reduce、RPC、dynamic-wind 事务守卫、可终止性 |
| test/huffman.scm | hf_ | Huffman 编解码：往返/压缩率/前缀码性质/退化边界 |
| test/dpll.scm | dp_ | SAT 求解：固定用例/踪迹自洽/随机 3-SAT 与暴力枚举对拍 |
| test/minisql.scm | sq_ | 内存表查询引擎：投影/过滤/排序/聚合/宏 DSL |
| test/miniprolog.scm | pl_ | 迷你 Prolog：合一/回溯/CPS/递归规则 |
| test/test_timer_setvar.scm | tv_ | 工单 #36 验证用例（定时器打断场景） |

### 新增测试的编写规范

- 断言框架自包含：每文件定义自己的 pass/fail 计数与 `check`（equal?）/`check-near`（|a-b|<1e-9），**变量名加独立前缀**（如上表），避免跨文件语义干扰与同名 define 冲突。文件末行必须输出汇总。
- **禁止多参算术**（工单 #35）：`+ - * / mod pow` 及比较符一律二元；链式需求用嵌套。`and`/`or` 例外（多参短路，恒返回布尔字面量）。
- **禁止在 while 循环体内 define**（原因见"语言语义要点"第 3 条）；循环变量在所属 lambda 顶层 define 一次、循环内仅 `set!` 重置。
- 自递归深递归（合一器/求解器类）**不要依赖自递归 tailcall**（见"已知缺陷"末条）；必要时以 `(pl-append '() (自递归调用))` 式包裹强制非尾。
- **先探针后断言**：对未验证过的语义（键类型、参数序、边界行为）先写 /tmp 临时脚本实测，再固化为断言；**禁止凭 R5RS 印象或其他 Scheme 的习惯写期望值**。实测过的反直觉点见下节。
- 新用例开发完成后：登记进 `testall.sh` 与 `testall_amalg.sh` 的硬编码列表（两文件列表保持一致），跑双形态全量回归确认零差异。

### 语言语义要点（实测确认，写测试/代码必读）

1. **define 无函数糖**：`(define (f x) …)` 会解析失败，必须 `(define f (lambda (x) …))`。
2. **算术仅二元、无一元取负**：负值写 `(- 0 x)`；多参算术是非法程序且当前实现会产生操作数栈垃圾（#35）。
3. **while 不创建词法作用域**（doc/manual.md §4.2、test/sleepsort.scm）：循环体实质是 goto 跳转的 begin，体内 define 直接落入所属 lambda 作用域，且循环体内创建的闭包捕获的是同一变量绑定。因此：同一 lambda 内多个循环体的**同名 define 会解析失败**（"failed to add defines to scope"）；循环中注册异步回调必须手工封装 lambda 保存当次迭代值。
4. `break`/`continue` 是裸符号，可在循环体内嵌套 if 中使用，不得出现在谓词中。
5. **String.charCodeAt 参数序为 `(index str)`**（与 `charAt (str index)` 相反）；返回浮点，越界/负索引返回 0。`String.slice` 负索引自尾计数、越界钳制、start>end 返回空。`String.parseNumber` 非法/空输入返回 #undefined，合法输入恒为浮点。
6. **Table 键类型严格**：浮点键与整数字面量键、symbol 键与字符串键**互不相通**（`Math.floor`/`Math.pow`/`charCodeAt` 的浮点返回需与写入侧同源）；`Table.keys` 顺序为哈希序。`Math.bit_*` 仅接受严格 uint，`Math.pow` 的浮点返回会被拒绝——位测试请用纯算术 `(mod (Math.floor (/ mask (pow 2 v))) 2)`。
7. **Math 域错误返回 #null 而非 NaN**；NaN 仅能由 VM 级 mod（如 `(mod 1 0)`）产生；Inf 可由 pow 溢出产生且 Inf==Inf、nan? 对其为 #f。
8. **整型为 59 位载荷**：2^59 字面量回绕为 0，运算超界同样回绕，无溢出检查（手册 §6.2.2）。
9. `get_item` 越界/负索引返回 **#undefined（设计行为，非致命）**；但作用于非列表（数字等）为致命错误。
10. **致命错误清单**（进程终止，报 `[Runtime] 指令执行异常`）：car/cdr/length/push/pop/set_item! 作用于非列表、除零（含浮点除零）、mod 非数字、Math.*/String.*/Table.* 传错类型、调用未定义变量、cons 第二参数为 #null、非尾递归超过约 1023 帧。
11. **equal? 深比较列表与字符串，但不比较 Table**（map 无对应分支）；Table 内容比较必须自写遍历。`Table.keys` 可用于键集迭代。
12. **typeof 对一切堆对象（列表/字符串/散列表/闭包/续体）返回 "handle"**（手册 §6.5 设计如此）。string? 可用模式 `(equal? v (String.atom_to_string v))` 实现（全类型安全，含空串）；table? = handle 且非 list? 且非 string?。
13. `push` 返回 #undefined 且原地修改；`pop` 原地弹出并返回尾元素，空表返回 #undefined。`'()` 是空列表堆对象、`#null` 是立即值：二者 `null?` 均为真但 `equal?` 为假；`cons` 尾参必须是列表（'() 可、#null 致命）。
14. `and`/`or` 恒返回布尔字面量（`(and 1 2)` = #t），运行期短路（被跳过分支中的未定义变量不会报错）。
15. **字符串字面量不能跨物理行**；转义支持 `\" \\ \n \t \r \b`，**不支持 `\f`**（保留为字面反斜杠+f）；中文按码点计数。
16. **保留但未实现的关键字**：for/case/do/return/let——写入程序会编译失败（test/errors/ 已锁定此行为）。
17. 解析/编译失败当前以 main.c 断言崩溃呈现（exit 134），**非优雅报错**；理想行为是打印诊断后非零退出（testall_errors.sh 不区分两者）。

### 错误路径测试模式（fork 双标记协议）

运行期致命错误会终止 VM 进程，无法在单进程内捕获。标准测法（见 errors_runtime.scm）：

```scheme
(define q (System.make_queue 8))
(define pid (System.fork))
(if (== pid 0)
    { (System.write q 1 0)      ;; 死前标记
      (致命调用)
      (System.write q 2 0)      ;; 幸存标记（缺陷时才可达）
      (System.exit) }           ;; 兜底，防缺陷场景污染
    { (define m1 (System.read q 3000))
      (define m2 (System.read q 150))
      (check name (and (== m1 1) (undefined? m2)) #t) })
```

要点：队列是虚拟机全局资源（fork 天然共享）；子进程死亡不影响父进程；子进程的 `[Runtime] 指令执行异常: PID=…` stderr 输出是预期行为；BLOCKED 进程的定时器暂不触发、STOPPED 进程的仍会触发（return_target 指向 halt）。

### 已知缺陷、规避与工单索引

- **#35（Open，优化）**：多参算术应编译期拒绝——未实施。当前行为：只发射一条运算指令、多余参数残留操作数栈（栈污染，见工单内插桩实证）。测试与库代码一律二元。
- **#36（Closed，故障）**：异步定时器回调打断运行中进程曾致操作数栈错位（回调返回值残留栈上）。已实施方案 A：`AM_VALUE_TAG_ASYNC_RET`（0x1B）异步帧标记 + `op_return` 丢弃回调返回值 + `push_stack_frame` 校验放宽，改动点见工单实施记录；`test_timer_setvar.scm` 为回归用例。**注意**：BLOCKED 进程定时器不触发、STOPPED 进程的 repeat 定时器每到期都会经 halt 分支重新入队执行一次回调——若主流程停止后仍有存活 interval，需在收尾回调中显式 clear。
- **帧栈深度（手册 §3.6）**：非尾递归上限约 1023 帧（fstack 容量 2048），超出报"指令执行异常"；尾递归不受限。errors_runtime.scm E1 场景锁定此行为。
- **自递归 tailcall 参数绑定丢失（未定位，勿采信任何未证机制）**：深互递归 + 调用点位于嵌套块内时，曾观测 `load: 变量 …a 未定义`（miniprolog 合一器、q95 最小形态）；强制非尾后消失。**机制未定位**——此前"栈错位"解释已被正确推理否定（参数弹取只依赖栈顶，与栈下值无关）。定位方法：插桩 `op_store`/`op_load`/`op_tailcall`，打印 current_closure_handle、varid 与操作数原始值。规避：自递归调用以 `(pl-append '() (…))` 包裹强制非尾。
- **json.scm 已知瑕疵**：JSON 字符串的 `\f` 转义会解码为字面 `\f` 两字符（词法器不支持 \f；修复应改用 `(String.fromCharCode 12)`），当前断言未覆盖该分支。
- **doc/todo/type_system.md** 为未跟踪的既有文件，与本轮工作无关。

### 已实施修复记录（2026-10-09）

- `src/am_process.c`：`am_process_make_wstring_handle` 允许 `str==NULL && len==0`（修复 `(String.atom_to_string "")` 崩溃；空串是完全合法的值）。
- #36 方案 A（见工单实施记录）：`include/am_object.h`（ASYNC_RET 标记与宏）、`src/am_process.c`（校验放宽）、`src/am_runtime.c`（call_async 编码 / op_return 丢弃）。
