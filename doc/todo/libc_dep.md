# Animac 核心模块 libc 依赖梳理报告

> 调研范围：`include/animac.h` 伞形头文件收录的**解释器核心**全部模块——基础设施（allocator/object/map/list/wstring/vocab/heap/closure/continuation/scope/debug）、前端（lexer/ast/parser/macro/linker/compiler/module/js2scm）、运行时（process/gc/runtime），共 21 个头文件 + 22 个 .c 文件。
> 明确不在范围：am_host.*、am_native_*、am_highlight.*、am_repl.*、main.c、main_repl.c（宿主侧，本就允许依赖平台）。
> 目标：为"极致平台无关、零依赖（乃至不依赖 libc）"的愿景盘点现状。行号基于 2026-07-27 工作区版本。本文不修改任何代码。

---

## 1. 总体结论（先看这里）

核心模块目前**不可能脱离 libc 构建**：存在 **6 大类、约 20 个文件、数百处** libc 调用点。但摸底结果也显示好消息居多：

- **架构骨架是对的**：内存池、链接器读源码、运行时事件/时间均已依赖注入（§2）——libc 依赖集中在"漏网"路径而非主干；
- **耦合面高度收敛**：真正棘手的只有 4 处——debug 模块的 `FILE *` 公开 API、js2scm 的 setjmp/全局态、runtime 的 libm 三函数、全项目的系统 `wchar_t` 类型；
- **无平台 `#if` 分支**：核心代码中没有任何 `_WIN32`/`__linux__`/ESP32 条件编译（仅 am_object.h / am_map.h 有 3 处 `UINTPTR_MAX` 字长分支），平台无关性基础良好。

## 2. 已经平台无关的部分（既有良好设计，应保持）

1. **内存池的双层抽象**（include/am_allocator.h）：通用分配器虚表 `am_allocator_vtable_t`（:20-26，`am_malloc/am_calloc/am_realloc/am_free` 内联转发 :35-46）+ 宿主内存虚表 `am_allocator_host_vtable_t`（:68-73，pool 创建时注入 `host_malloc/calloc/realloc/free`，四者任一为 NULL 则创建失败）。**内存池本体与 GC 暂存分配（`am_allocator_host_malloc`，am_allocator.c:939-957）都不直接依赖 libc malloc**。
2. **链接器读源码回调注入**（`am_linker_read_source_fn`）：核心不碰文件系统。
3. **运行时虚表**（`am_runtime_vtable_t`）：4 个事件回调 + `now_ms`/`sleep_in_ms` 两个时间函数全部注入——核心**无任何 time.h 调用**。
4. **运行时错误/输出通道**：VM 错误经 `am_runtime_error` → `error_fifo`、用户输出经 `output_fifo`，宿主自行取走——运行时主干的诊断**不走 stdio**。
5. **无 stdlib 编码转换调用**：核心没有 `mbstowcs`/`wcstombs`（编解码在宿主层，正确分层）。
6. **无 errno、无 exit/abort、无 setlocale、无环境变量、无信号处理**（核心部分）。

## 3. libc 依赖盘点（按类别，依严重度排序）

### 3.1 裸 malloc/calloc/realloc/free —— 内存抽象的最大漏洞（约 200 处）

pool 抽象只覆盖了"入池对象"的分配，而**临时工作数组**大量使用系统堆，完全绕过 `am_allocator_*` 与宿主虚表：

- **src/am_macro.c（约 60 处）**：宏展开的临时数组（pvars/bodies/expanded_children）、`am_macro_t` 及 clauses 的 calloc（:459, :466）、realloc 扩容（:318, :999, :1441）；
- **src/am_parser.c（约 50 处）**：4 个解析栈的 realloc 扩容（:119, :147, :169, :197）、token 文本 malloc（:272, :1023）、ARN 阶段临时数组（:1304, :1439, :1692, :1734）；
- **src/am_ast.c（约 40 处）**：`am_ast_merge` 的 entries 数组（:337-821 大量 malloc/realloc/free）、文本缓冲（:134, :145, :1094, :1108）；
- **src/am_js2scm.c（全文）**：Node/Token/字符串池全部裸 calloc/malloc/realloc/free（:57, :80, :115, :408, :794, :931, :1215-1234 等）；
- **src/am_debug.c（约 8 处）**：visited/handles 数组与缓冲（:43, :464, :511, :593, :600）；
- **src/am_list.c:348**：`am_list_lambda_get_bodies` 的 bodies 数组——此前调研已注明这是"系统堆，非 allocator"。

性质：这些分配的生命周期短、失败路径大多已处理，但**它们使核心在无 libc malloc 的平台上根本无法链接**。整改方向：收敛到一处注入点（扩展宿主虚表或引入"暂存分配器"，见 §6）。

### 3.2 stdio 输出 —— 错误消息与诊断的"泄漏"通道（约 200 处）

**a) 错误消息直打 stderr（fwprintf/fprintf）**——与 §2-4 的运行时 fifo 通道并存的第二套体系：

- src/am_parser.c:7 处（`[Parser Error] %ls` 系列）；src/am_macro.c:4 处（`[Macro Error]`）；src/am_module.c:17 处（`[module_dump]`/`[module_load]` 系列）；src/am_gc.c:5 处（gc_root_helper/压缩失败）；src/am_allocator.c:4-6 处（OOM/池创建失败）；src/am_compiler.c:1 处（fwprintf 的 unquote-splicing 错误）；src/am_js2scm.c:6 处 + fputs 1 处。
- **隐性 locale 依赖**：`fwprintf(stderr, L"%ls")` 输出宽字符**要求宿主已调用 `setlocale`**，否则中文消息乱码（桌面 main.c 恰好调了）；ESP32 newlib 的宽字符流**根本不可用**——src/am_js2scm.c:29-31 的注释是实证，该文件已被迫手写 UTF-8 编码函数 `js_err_fputws`（:31-50）。这说明 stdio 宽输出在目标嵌入式平台上已经实际破裂。

**b) 诊断/统计打印**：

- src/am_allocator.c 约 38 处压缩报告 fprintf——受 `AM_ALLOCATOR_PRINT_COMPACT_REPORT`（默认 0）宏控制，默认编译为空；
- src/am_runtime.c:3133-3160 共 16 处内存统计 fprintf（`[MemoryStats]` 系列）；
- src/am_debug.c：**整个模块建在 stdio 上**——fwprintf 99 处 + printf 18 处 + `fgetwc`/`fclose`/`rewind`；且 `am_debug_ast_print_to_stdout`（:583-615）用 **`tmpfile()` 创建临时文件**当中转缓冲（文件系统依赖！），配 2 处 `assert`（:586, :594）。

**c) 最深的耦合：`FILE *` 出现在公开 API**：include/am_debug.h:18, 29（`am_debug_ast_print(FILE *out, ...)` 等），am_debug.c 内部 20 余个函数均以 `FILE *` 为参数。任何无 stdio 的平台都无法使用该模块，也无法编译其头文件。

注：include/am_base.h（一个未被任何文件包含的"注释中的设计文档"）已包含对本问题的完整分析（"约 136 处 fprintf"的统计与三层解耦设计），可与本报告互为印证。

### 3.3 字符串/内存工具函数 —— 量大但易于垫片（约 180 处）

- **mem 系列**（string.h）：14 个文件约 49 处 memcpy/memset/memmove/memcmp——都是小工具，自研垫片 trivial。注意：GCC/Clang 在 `-ffreestanding` 下仍会为结构体拷贝/初始化**自动生成** memcpy/memset 调用，因此这几个垫片是**强制性的**（C 标准对 freestanding 环境的要求）。
- **wcs/wmem 系列**（wchar.h）：10 个文件约 96 处（wcslen/wcscpy/wcscat/wcsncpy/wcscmp/wcschr/wmemcpy/wmemset 等），集中在 ast(18)、js2scm(23)、linker(15)、macro(9)、runtime(12)、parser(8)、vocab(6) 等。
- **swprintf（格式化到缓冲区，35 处）**：runtime(20)、ast(6)、process(3)、js2scm(3)、linker/macro/compiler(各1)。用于 `#<handle:%zu>`、`%g`、`%lld`、`%ls` 等值字符串化——这是 libc 中最难替代的部分之一（浮点 %g 格式化自研成本高，见 §6 讨论）。

### 3.4 系统 `wchar_t` 类型 —— 隐蔽的平台相关（12 个文件）

- 源码文本、token、符号/变量词表、字符串对象内容，内存中全部以**系统 `wchar_t`** 存储 Unicode 码点；`sizeof(wchar_t)` 在 Linux/ESP32 为 4、**在 Windows/MSVC 为 2**——16 位 wchar_t 平台上 >0xFFFF 的码点无处安放（需代理对，全项目无此处理，语义直接破裂）。目前项目只在 gcc 系平台构建所以未爆。
- AGENTS.md 的"磁盘上绝不出现系统 wchar_t"只保证了磁盘格式，**内存表示仍是平台赌注**。对象语言侧已有平台无关的 `am_wchar_t`（uint32_t，am_object.h:68），但前端/词表没有使用它。
- 连带：`wcs*` 函数与 `swprintf %ls` 的语义也随 wchar_t 宽度变化。

### 3.5 libm 数学库 —— 少而硬（3 处）

src/am_runtime.c：`fmod`（:2012，op_mod）、`pow`（:2025，op_pow）、`isnan`（:2241，op_isnan）。`isnan` 是 C99 宏/编译器内建，可无依赖；`fmod`/`pow` 需要 libm——无 libm 平台须注入宿主实现或自研（fmod 可通过 trunc 除法实现，pow 需要完整算法或降级为 exp/log 组合）。

### 3.6 stdlib 数值转换（2 处）

src/am_parser.c：`wcstod`（:297，浮点字面量）、`wcstoll`（:301，整数字面量）。自研可行（十进制解析 + IEEE754 最近舍入——精确的 strtod 自研有难度，可先接受"正确到 1ulp 内"的实现或注入）。

### 3.7 排序与搜索（4 处）

`qsort`：src/am_debug.c:491、src/am_gc.c:573、src/am_heap.c:328；`bsearch`：src/am_allocator.c:1213（压缩引擎的载荷查找）。自研插入/归并排序与二分即可，无难度。

### 3.8 setjmp/longjmp 与全局可变状态（src/am_js2scm.c）

错误处理建立在 `setjmp(g_err_jmp)`（:1244）+ 4 处 `longjmp`（:60, :179, :484, :504）+ 全局错误缓冲 `g_am_js_last_error[256]` 上。setjmp 本身在多数嵌入式 libc 中存在，但：**①** 它绕过正常的资源释放路径（跳槽时已分配的 Node/Token 泄漏——该文件用注册表 `allocated_macros` 类似的集中释放缓解了吗？实际是靠 translate() 在 setjmp 点统一清理）；**②** 全局可变状态使 js2scm **不可重入、多解释器实例不安全**。整改方向：改为错误码逐级传播（工作量大但机械），或至少把全局态收进上下文结构体。

### 3.9 assert（2 处）

src/am_debug.c:586, :594（tmpfile/malloc 失败即 abort，NDEBUG 下退化为 NULL 解引用）。debug 模块整改（§3.2-c）时一并消除。

### 3.10 ctype/wctype（10 处）

src/am_lexer.c:2 处 `iswdigit`（:78, :83）；src/am_js2scm.c:8 处 `iswdigit/iswalpha/iswalnum`。宽字符分类函数**locale 相关**（ASCII 范围在 C locale 下稳定；js2scm 对 ≥0x80 的字符已自行放行 :299, :302，规避了最难的部分）。自研查表即可。

## 4. 无 libc 依赖的部分（确认安全）

- **头文件**：stdint.h / stdbool.h / stddef.h / stdarg.h / float.h / limits.h 由编译器提供（freestanding 环境亦有），无碍；
- **无平台条件编译**（除 am_object.h:39-63、am_map.h:52 的 3 处字长分支——这些本身是平台适配点，NaN-boxing 若实施还会改写）；
- **无 time.h、无 signal.h、无 locale.h、无 errno.h、无 unistd.h、无文件 IO**（除 debug 的 tmpfile 孤例）；
- am_object.c / am_scope.c / am_vocab.c / am_heap.c / am_closure.c / am_continuation.c / am_gc.c / am_linker.c / am_lexer.c / am_wstring.c / am_map.c / am_module.c 的主体逻辑仅依赖 §3.1/3.3 的工具函数与 §3.2 的错误打印——整改收敛后可达零依赖。

## 5. 依赖全景汇总（按文件）

- **重度依赖**（必须整改才能脱离 libc）：am_debug.c（FILE* API + fwprintf×99 + tmpfile + assert）、am_js2scm.c（setjmp + 全局态 + 裸 malloc + fprintf + ctype）、am_allocator.c（fprintf×44，但 38 处默认关闭）。
- **中度依赖**：am_runtime.c（fmod/pow/isnan + swprintf×20 + memstat fprintf×16 + wcs×12）、am_module.c（fprintf×17）、am_parser.c（fprintf×7 + wcstod/wcstoll + 裸 malloc）、am_ast.c（裸 malloc×40 + wcs×18 + swprintf×6）、am_macro.c（裸 malloc×60 + fprintf×4 + wcs×9）、am_gc.c（fprintf×5 + qsort）。
- **轻度依赖**（仅工具函数与偶发打印）：am_lexer.c（iswdigit×2 + wcs×4）、am_linker.c（wcs×15 + swprintf×1 + printf×1）、am_compiler.c（fwprintf×1 + swprintf×1）、am_process.c（swprintf×3 + wcs×1 + mem×7）、am_heap.c（qsort×1 + mem×3）、am_list.c（malloc×1 + mem×3）、am_map/am_wstring/am_vocab/am_closure/am_continuation/am_scope/am_object（仅 mem/wcs 工具，vocab 另有 wcs×6）。

## 6. 整改方向建议（呼应 include/am_base.h 的 Layer -1 设想）

按"先收敛、再替换"的顺序，分四层：

1. **L0 基础原语层（新建 am_base 真正的 C 实现）**：自研 `am_mem_copy/set/move/cmp`、`am_wcs_*` 系列、字符分类查表——全部实现于平台无关的 uint32 码点之上；memcpy/memset/memmove/memcmp 为 freestanding 强制项，优先保证。
2. **L1 宿主能力注入扩展**：① 把 §3.1 的全部裸 malloc 收敛到一个注入点（扩展 `am_allocator_host_vtable_t` 增加暂存分配四函数，或规定临时分配一律走池内 VM 区）；② stdio 输出统一收敛为"诊断事件 sink 回调"（am_base.h 注释文档中已有完整的三层设计：诊断事件 + 级别 + sink，直接采纳）；③ fmod/pow 注入宿主数学回调（默认可走 libm，嵌入式可换自研）。
3. **L2 模块整改**：am_debug 去 `FILE *`（改为 strbuf/sink 输出，tmpfile 中转方案删除）；am_js2scm 去 setjmp（错误码传播）与全局态（收进 ctx）；parser 的 wcstod/wcstoll 换自研解析；qsort/bsearch 换自研。
4. **L3 字符类型统一**：内存中的 `wchar_t` 全面替换为 `am_wchar_t`（uint32_t）——这是消除最大平台赌注（16 位 wchar_t）的根治，但波及词表/前端全部文本路径，宜单独成期。

验收标准建议：核心 22 个 .c 文件在 `-ffreestanding -nostdinc`（仅提供编译器内建头）下编译通过，链接仅需 L0 垫片库。

## 7. 附：核查方法与口径说明

本报告通过对核心 22 个 .c 文件逐一执行系统调用模式普查（系统 #include 清单、`\b(malloc|calloc|realloc|free)\s*\(`、mem/wcs/ctype/printf 家族/数学/转换/qsort/setjmp/assert/tmpfile 等模式）并人工复核关键命中点得出；计数为"调用点个数"（含注释中残留的少数失效调用，已就重要条目逐条核实）。am_base.h 经核实为未被包含的纯注释设计文档，不计入功能代码。
