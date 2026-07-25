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

- 当前开发环境是Windows系统，但部署了WSL（Ubuntu）。你可以使用WSL，通过WSL使用make、gcc等构建工具进行构建、测试。
- 禁止执行任何删除命令，如`rm`。

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

## Amalgamation（单文件分发形态）

效仿 Lua/SQLite 的单文件库形态，项目提供 Amalgamation 机制，方便第三方集成：

- 生成方式：`make amalg`（底层调用 `bash amalgamate.sh`；Makefile 已对 include/ 与 src/ 建立依赖跟踪，源文件更新后自动重新生成）。产物为项目根目录下的 `animac_core.h`（核心头文件按依赖拓扑序合并，含 `extern "C"` 包装）与 `animac_core.c`（核心实现按同一顺序合并，仅 `#include "animac_core.h"`）。
- **收录范围 = include/animac.h 伞形头文件登记的解释器核心**（基础设施、前端、运行时），Amalgamation 是自包含的“上帝模块”。明确排除与宿主相关的内容：`am_host.*`（宿主适配）、`am_native_*.*`（native 库，核心通过 `am_runtime_register_native_lib` 动态注册，不静态依赖）、`am_highlight.*`（终端呈现）、`am_repl.*`（上层消费者）。收录清单直接取自伞形头文件，二者自动保持同步。集成方编译 `animac_core.c` 获得解释器核心，再按需单独编译 `src/am_host.c`、`src/am_native_*.c` 等宿主侧文件一同链接。
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
  - quote / quasiquote / unquote 内部不做宏展开，以避免用户 symbol 与关键字 symbol 值冲突。

