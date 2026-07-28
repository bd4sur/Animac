# Animac 栈平衡问题研究与改进方案

> 调研范围：全部 C 源码，重点是 `src/am_compiler.c`（代码生成的栈效应来源）、`src/am_runtime.c`（指令的实际栈效应）、`src/am_process.c`（opstack 机制）、`src/am_repl.c`（值打印包装）。
> 行号基于 2026-07-27 的工作区版本。标注【实测】的结论已通过 WSL 构建运行验证（见 §9）。
> 本文是 stack_depth.md 的上游研究：栈深度静态分析之所以"不可能做对"，根源在于引擎没有栈平衡纪律。本文不修改任何代码，仅输出问题盘点与改进方案。

> **实施状态（2026-07-28）**：方案 A（§5）与 §12 的 native 侧同步改造**已实施完毕**——
> ① §5.1 全部 8 项编译器改动（src/am_compiler.c：begin/lambda/while 语句边界 pop、空 begin 与空函数体补值、define/set! 补值、语句型内建清单 `compiler_statement_builtin_residue` 补偿、单臂 if 与 cond 落空路径补值）；
> ② §12 阶段 1 同步工作：System.clear_timeout/clear_interval、LLM.init/matmul 补压 #undefined，evalcleanup 截断后补压 #undefined，System.test 补哨兵检查，wake_process 压值失败改为杀死进程并报错；
> ③ 静态分析同步修正（stack_depth.md §5.2 的定值项与 concat 前看、§5.3 的 call 后继深度 = d - argc + 1，net ≡ 1）；跨函数组合（§5.4，E1）与方案 B/C 仍未实施。
> 验证：`make` 零警告；testall.sh 全量回归与基线一致（差异仅为模块尺寸/深度数值与用例固有随机性）；test/ 下另 20 个非 testall 用例与基线逐字节一致；gdb 实测多语句函数体尾递归 opstack 深度恒定（基线 ~2×10⁵ 且逐帧增长 → 现恒为 1）；ISSUES#34 关闭。
> 已知剩余缺口（与基线行为一致，非回归）：语句型内建经**变量引用**被一等公民式调用时（如 `(define p display) (p 1)`），运行时由 `op_call_async` 直接派发指令、编译器无法补偿，调用点净效应为 -1 而非 +1。彻底消除需方案 B（指令自压 #undefined）。

---

## 1. 问题背景：什么是"栈平衡"

本解释器的 VM 是栈式机：表达式求值把结果压入操作数栈（opstack），语句/指令从栈上消费。所谓**栈平衡纪律**（单值栈纪律）是指：

> **任何表达式求值结束后，恰好在栈上留下 1 个值（它的值）；任何语句序列执行完后，栈深恢复到序列开始时的水平。**

这条纪律是三个重要性质的前提：

1. **静态栈深度分析可精确**——每个程序点的栈深是编译期可计算的确定值；
2. **栈安全**——表达式可以任意嵌套组合（`(f (g x) (h y))`）而不必担心弹到别人的值；
3. **资源可控**——opstack 深度有界且可预测，不会随程序运行单调膨胀。

**现状：这条纪律完全不存在。** 编译器从不发射 `pop`（am_compiler.c:574-577 与 705-707 两处"除最后一个表达式外其余结果都 pop 掉"的代码均被注释，标记 `TODO 处理pop问题`）；各语法形式与内建过程的栈效应各自为政（§2）；由此产生语义危害、资源浪费与分析不可行（§3）。

---

## 2. 现状盘点：各语法形式与内建过程的栈效应

以下"净效应"指该形式作为整体编译执行后对 opstack 的净影响（事实来源：am_compiler.c 代码生成 + am_runtime.c 指令实现，与 stack_depth.md §3 一致）。

### 2.1 已经平衡的"表达式"（净 +1，产出 1 个值）——良好多数派

- 字面量、quote、变量引用（load/push）；
- 算术/比较/谓词（`+ - * / mod pow == eq? ...`：参数 +2、指令 -1）；
- 列表操作：`car cdr cons get_item length list_pop typeof duplicate`；
- `and`/`or`（每个子句 +1 后被 iftrue/iffalse 弹掉，末尾 push 结果）；
- `quasiquote`（每个子项 1 槽 + count 槽，concat 全部消费，净 +1；`,@` 经 splice 标记亦在此列）；
- 双臂 `if`（两分支各 +1，殊途同归）；
- 有分支命中的 `cond`；
- **名义上的**函数调用（实参 +argc、被调方 store -argc、返回值……见 2.3 的实际值）。

### 2.2 平衡的"语句形式"（净 0，不产出值）——隐患在于可被当作表达式用

- `define`（值 +1、store -1）、`set!`（值 +1、set -1）；
- `display`（值 +1、display 指令 -1）、`newline`（0）；
- `push`（list_push：参数 +2、指令 -2，压回列表的代码被注释 am_runtime.c:1465）；
- `set_item!`（参数 +3、指令 -3）。

这些形式**作为语句是平衡的，但作为表达式不产出任何值**。Scheme 语法上它们可以出现在任何表达式位置（如 `(+ (define x 1) 2)`、`(display (if #f 1))`），此时消费方会**弹走栈上属于别人的值**——静默错乱或直接异常（§3.1 实测）。manual.md 仅约定它们"作为语句使用"、值"未规定"，但实现层面没有任何防线。

### 2.3 路径相关的不平衡——真正的重灾区

- **单臂 if（`(if p t)`）**：真分支 +1、假分支 **0**（compile_if:805-807，iffalse 直接跳到 end_label，假路径什么都不压）。
- **cond 无 else 且全部落空**：**0**（compile_cond:752-753，最后一个子句的 iffalse 跳到 end_lbl）；有分支命中则 +1。同一个 cond 表达式，栈效应取决于运行时数据。
- **begin**：净效应 = 各子表达式净效应之和（0 到 k 不等，compile_begin:702-708 无 pop）；空 begin 为 **0**（:700 直接 return 0，一条指令都不发射）。
- **lambda 函数体**：与 begin 同构，k 个产值表达式留 k 个值（compile_lambda:572-578）。
- **函数调用**：净效应 = -argc + **k**（k = 被调函数体遗留值个数），而非语义上的 -argc + 1。【实测】`(define f (lambda () 1 2 3)) (display (f))` 打印 3 纯属侥幸——栈顶恰好是最后表达式；1 和 2 作为残留永久留在调用方栈上。
- **while**：循环体遗留值**逐迭代累积**（compile_while:832-834 无 pop），`(while c 1 (set! i (+ i 1)))` 每迭代净 +1——**opstack 深度随迭代次数无界增长**，只能依赖运行时自动扩容（am_process.c:426-435）兜底。循环自身净 0（退出时不产出值）。
- **尾调用**：`op_call_async` 完全不清理 opstack（am_runtime.c:816-830）——在上述累积之上，尾调用链中每一环的遗留值都沉淀在栈上，**尾递归在 opstack 上并不恒界**（TCO 只省了 fstack）。

### 2.4 已经自平衡的特殊机制——值得效仿的正面范例

- **dynamic-wind 四指令序列**：每条指令执行前把 opstack **截断到条目记录的 base**（`dynamic_wind_trim_opstack_to_base`，am_runtime.c:1022-1030），整条 `(dynamic-wind b t a)` 净 -2（3 闭包换 1 结果），确定且与路径无关；
- **evalcleanup**：把 opstack 截断到保存的 saved_len（am_runtime.c:1854-1861）；
- **continuation 恢复**：`restore_continuation_snapshot` 整体替换 opstack（am_process.c:755-757），wind 跳板再压入传递值。

这三者证明了"以运行时记录的基址做截断"是引擎内已存在且可靠的平衡手段（方案 C 将把它普遍化）。

### 2.5 废弃指令

`fork`（直接报错）、`read`/`write`（空操作）已无栈效应，仅作为静态分析的对照项存在。

---

## 3. 危害分析

### 3.1 语义危害：静默错值与跨帧污染【实测】

- `(display (if #f 1))`、`(display (cond (#f 1)))`、`(display (while #f 1))`、`(display (begin))`：全部**打印一个空行**——display 弹走的是栈上属于别人的残留值（或空栈哨兵 UINTPTR_MAX 的降级打印），静默错乱、无任何报错；
- `(+ (define x 1) 2)`：`[Runtime] 指令执行异常: PID=0 PC=5`——add 弹到了非数值的垃圾值，只有一条没有原因的通用消息；
- `(define f (lambda () 1 2 3)) (display (f))`：打印 3，残留 1、2 永远占用调用方栈空间。

即：**"语句形式用作值"目前是未设防的未定义行为**，表现形式从静默垃圾到莫名崩溃不等。

### 3.2 使静态栈深度分析不可能

stack_depth.md 已详述：单值纪律缺失意味着 ① call 的后继深度依赖被调方遗留数 k（编译期需要复杂推导）；② while 循环携栈无界增长（R1）；③ 尾调用残留使"帧"概念在 opstack 上不存在。**栈深度分析的上游前提是栈平衡**——本研究正是为此铺路。

### 3.3 性能与资源

- **opstack 单调膨胀**：每个 begin/lambda 体的中间结果、每次函数调用的 k-1 个残留、while 的逐迭代累积，全部沉淀为栈内容；触发 2 倍自动扩容的 realloc 抖动，VM 内存被指数级蚕食（128 MiB 池也会耗尽）；
- **GC 根集合放大**：opstack 是 GC 根（gc_root 遍历整个 opstack），所有逻辑上已死的残留值都作为根参与每一轮标记——既浪费标记时间，又使垃圾对象被人为保活（残留引用的列表/字符串/闭包全部无法回收）；
- **尾递归的内存语义被破坏**：fstack 恒界但 opstack 不恒界，长时间运行的尾递归服务（如事件循环、sleepsort 风格的异步回调链）会持续漏栈。

### 3.4 可维护性

每种新语法形式/新内建都要靠开发者"梦到啥就做啥"地决定栈效应，没有不变量可检验——`compiler_stack_effect` 中 display=0、set_item=-2、list_push=-1 三处照抄现实的错误（stack_depth.md §4.1）正是这种状态的直接产物。

---

## 4. 改进目标与原则

- **P1 单值纪律**：任何表达式求值恰好留下 1 个值；"语句形式"（define/set!/display/newline/push/set_item!/while/单臂 if 假分支/cond 落空/空 begin）的值统一为 `#undefined`。
- **P2 语句边界回归**：begin/lambda 体/while 体中，非末尾表达式的结果立即 pop——任何"语句边界"处栈深回到该帧的基址。
- **P3 编译器可达**：一期不动 VM 指令语义、不动 fstack、不动模块磁盘格式、不动测试语义。
- **P4 与 manual 兼容**：manual.md 已声明 define/display 等"作为语句使用"（§4.1）、其值与 `while` 的值"未规定"（§1.1.1）——统一给 `#undefined` 是对"未规定"的合法具体化，不构成违约。

---

## 5. 方案 A（推荐，一期）：编译期单值纪律

**思路：只改 `src/am_compiler.c` 的代码生成，用 pop 与 push #undefined 把每个形式的栈效应归一化。** VM 指令语义完全不变（pop、push 指令均已存在）。

### 5.1 逐项改动清单

1. **compile_begin（am_compiler.c:696-710）**：取消 705-707 的注释——非末尾子表达式后发射 `pop`；空 begin（`node->length <= 1`）改为发射 `push #undefined`（净 +1）。
2. **compile_lambda（556-581）**：取消 574-577 的注释——函数体非末尾表达式后发射 `pop`。效果：**任何函数返回恰好 1 个值**。
3. **compile_define / compile_set（648-691）**：`store`/`set` 之后发射 `push #undefined`（形式净 +1）。
4. **语句型内建调用**（`display`、`newline`、`push`/`list_push`、`set_item!`，compile_application 的 builtin 分支 527-531）：指令之后发射 `push #undefined`。建议在编译器内维护一张"语句型内建"清单（与 `AM_BUILTIN_OPCODE_MAP` 并列），集中处理而非散落各点。
5. **compile_if 单臂（779-811）**：else 缺省时，在 `end_label` 定位**之前**发射 `push #undefined`（即 iffalse 跳转的落入路径上有值）——两分支均为 +1。
6. **compile_cond（713-776）**：在 `end_lbl` 定位**之前**发射 `push #undefined`（全部落空的到达路径上有值）；注意 else/末子句的命中路径经 goto 跳过该 push——需要把命中路径的 goto 目标调整到 push 之后的公共点，或为落空路径单独设标签（实现细节，二选一）。
7. **compile_while（814-839）**：循环体每个表达式后发射 `pop`（消灭逐迭代累积）；`end_label` 定位后发射 `push #undefined`（循环作为语句形式产出 #undefined）。
8. **break/continue**：无需改动——它们编译为 goto，在 P2 纪律下跳转点的栈深恒等于帧基址，目标点的深度假设一致（须以回归测试验证，见 §8）。

### 5.2 纪律确立后的连锁收益（本方案的核心价值）

- **函数调用协议精确化**：净效应恒为 -argc + 1。call 的后继深度 = 调用点深度 - argc + 1，静态分析不再需要推导"被调方遗留 k 个值"；
- **尾调用自然恒界**：纪律下任何语句边界栈深 = 帧基址，尾调用时栈上只有 [帧基址] + args；被调方 store 弹参后栈深恰好回到帧基址——**无需对 op_call_async 做任何修改**，尾递归在 opstack 上也恒界；
- **while 携栈增长（R1）彻底消失**；
- **静态栈深度分析变为精确可算**：stack_depth.md §5 的算法中 net_f ≡ 1、循环平衡，仅剩"非尾递归的调用深度"这一本质无界源（以 SCC 标志报告即可）；
- **GC 减负**：opstack 只剩活值，根扫描缩小、死对象不再被保活；扩容 realloc 基本消失，`opstack_depth` 估计重新具有指导意义；
- **REPL 行为改善**：REPL 把用户输入的最后一个表达式包成 `(display <expr>)`（am_repl.c:339-351）——纪律下任何表达式恒有 1 值可打印；`define` 等语句从"打印垃圾/空行"变为打印 `#undefined`（可见行为变化，但更合理且属原未定义行为）。

### 5.3 成本与风险

- 指令数增加：每个语句 ≤2 条（pop / push #undefined），对执行速度影响可忽略；
- 可见行为变化仅限原本"未规定"的领域（语句形式用作值时的结果）；所有正常程序的输出不变——**回归判据：testall.sh 全部用例输出逐字节一致**（quasiquote、yinyang、call/cc、dynamic-wind、coroutine、tls 等重栈用例需逐一核对）；
- 风险点：cond 的落空 push 与 goto 目标的配合（5.1-6）是本方案唯一需要仔细落子的地方；continuation 快照会因残留清除而变小（语义不变，快照只含活值）。

---

## 6. 方案 B（可选，三期）：指令语义规范化

**思路**：让 `display`/`newline`/`list_push`/`set_item` 指令自身压回 `#undefined`（`list_push` 恢复 am_runtime.c:1465 被注释的压回列表），编译器不再补偿 push。

- **优点**：指令级即满足"每条调用形式净 +1"，编译器更简单；`list_push` 压回列表还顺带恢复 `push` 作为表达式（返回列表）的能力。
- **障碍**：`store`/`set` 也用于 lambda 序言（逐参弹栈）——若指令自身压值，序言协议被破坏，必须引入"序言专用 store 变体"或接受编译器补偿，复杂度反而上升；把"表达式/语句"语义烧进 VM 层也降低了指令的通用性。
- **结论**：不推荐单独实施。若实施，**只动 display/newline/list_push/set_item 四条，不碰 store/set**；且应在方案 A 之后作为"去补偿化"的美化步骤。

---

## 7. 方案 C（可选，二期）：运行时帧基址强制（防御性纵深）

**思路**：把 dynamic-wind 已验证的"记录基址 + 截断"机制（§2.4）普遍化到函数调用协议：

1. fstack 帧（当前为 2 值：闭包 + 返回地址，am_process.c:461-483）扩展为 3 值，增加 `opstack_base`（call 压帧时的 opstack 长度）；
2. `op_return`：弹帧后将 opstack **截断到 base，再压回返回值**（等效 base+1）；
3. `op_tailcall`：跳转前把 opstack 截断到当前帧的 base（需能取到当前帧基址——当前帧基址 = 上一个压帧点，可在进程内维护 current_frame_base 字段随 call/return 更新）；
4. continuation 快照/恢复与 dynamic-wind trim 按新的 base 语义适配（快照本就整栈替换，兼容）。

- **优点**：栈平衡从"代码生成守约"升级为"运行时强制不变量"——未来任何代码生成 bug 都不会再造成栈泄漏；静态深度分析可简化为帧内相对深度的简单组合；
- **成本**：fstack 帧格式变化（固定 2048 值的帧预算从 1024 帧降为 682 帧）、return/tailcall 热路径加截断逻辑、continuation/dynamic-wind 适配测试；
- **与方案 A 的关系**：A 治本（不产生垃圾），C 治未然（垃圾不可能存在）。**A 之后 C 的截断在正确代码下恒为 no-op**，运行时成本仅为一次长度比较。建议 A 先行、C 视对健壮性的要求跟进。

---

## 8. 渐进式路线图

- **阶段 0（准备）**：把 §2 的栈效应清单固化为文档（可并入 doc/AGENTS.md 的架构章节）；为 disassemble 输出补充每指令的深度注解，便于人肉/脚本校验。
- **阶段 1（方案 A）**：编译期单值纪律。
  - 验证：`make` 零警告；`testall.sh` 全部用例输出逐字节一致；重点人工核对 call/cc（yinyang_cps）、dynamic-wind 系列、coroutine、quasiquote、tls、brainfuck 解释器；REPL 交互抽查（define/set!/if/cond/while/begin 作为最后表达式时打印 `#undefined`）；gdb 观测尾递归循环的 `opstack_top` 恒定。
  - 同步工作：按 stack_depth.md §5 修正静态分析（此时 net_f ≡ 1、循环平衡，分析自然精确）。
- **阶段 2（可选，方案 C）**：帧基址强制。
  - 验证：同上回归 + 故意注入失衡代码验证运行时兜住。
- **阶段 3（可选，方案 B）**：指令语义美化（display/newline/list_push/set_item 自压 #undefined，撤掉编译器补偿）。
  - 验证：同上回归。

每阶段独立可交付、独立可回滚（A 是纯编译器改动，C/B 逐条指令可拆）。

---

## 9. 附：本次实测记录（2026-07-27，WSL/gcc，当前实现）

- `(display (if #f 1))` → 打印空行（display 弹走别人的值，静默错乱）；
- `(display (+ (define x 1) 2))` → `[Runtime] 指令执行异常: PID=0 PC=5`（add 弹到垃圾值）；
- `(display (cond (#f 1)))` → 打印空行；`(display (while #f 1))` → 打印空行；`(display (begin))` → 打印空行；
- `(define f (lambda () 1 2 3)) (display (f))` → 打印 `3`（仅栈顶可用，1、2 残留）；
- REPL 包装机制确认：用户最后一个表达式被包成 `(display <expr>)`（am_repl.c:339-351）——REPL 同样暴露于上述失衡；
- 指令级事实（承 stack_depth.md §3，本次复核）：display 弹 1 压 0、list_push 弹 2 压 0（压回被注释 am_runtime.c:1465）、set_item 弹 3 压 0、store/set 弹 1 压 0、call/tailcall/return 不动 opstack、dynamic-wind 序列经 trim 自平衡。


---

## 10. Native 库的栈平衡（补充调研）

> 本节覆盖 5 个 native 库（src/am_native_Math.c / String.c / System.c / Table.c / LLM.c，共 64 个注册函数）的逐函数栈效应盘点，并据此提出 native 开发者应遵循的纪律与契约（§11）。

### 10.1 Native 调用协议（基准事实）

与 builtin（编译期映射为专用 VM 指令）不同，native 调用是**动态查表 + 全权委托**：

1. 调用方把 N 个实参压栈（每个净 +1），发射 `callnative`（或 `call`/`tailcall` 经 `op_call_async` 检测到 native 引用后转交，am_runtime.c:788-790, 877-879——**对 native 而言 call 与 tailcall 无区别，均不压栈帧**）；
2. `op_callnative`（am_runtime.c:898-940）自身**完全不碰 opstack**：解析 `LibID.funcName` 名字、查表（`am_native_find_func`），然后 `return func(rt, proc)`——弹参数、压结果、步进 PC **全部是 native 函数自己的责任**；
3. 由此推出两个关键结论：
   - **编译器无法为 native 补偿栈平衡**。对语句型 builtin（display/set_item 等），方案 A 的 A4 可以让编译器在指令后补 `push #undefined`；但 `callnative` 是统一入口，编译期无法区分目标函数是表达式型还是语句型——**native 的单值纪律只能在 native 函数内部保证**，这正是 §11 契约必须存在的原因；
   - native 函数的净栈效应 = **-N + （自己压的值数）**，静态分析要精确建模 callnative，依赖每个 native 函数遵守统一契约（§11 N1）。

辅助设施现状：`am_process_pop_operand` 栈空时返回哨兵 `UINTPTR_MAX`（am_process.c:442-446，不报错）；各库的 `native_pop_*` 辅助函数普遍检查该哨兵；`native_push_*` 辅助函数内部恰好"压 1 + step 1"。

### 10.2 逐库盘点结论

**总体面貌比编译器侧好得多**：全库 64 个函数中，**没有任何函数在任何路径压 ≥2 个值**；绝大多数已是标准的"弹 N 压 1"表达式型。

- **Math 库（25 个函数）**：全部"弹 N 压 1、step 恰好 1 次"，无例外。零元的 `Math.PI`/`Math.random` 压 1；NaN 软失败统一压 `#null`（`native_push_result`）。
- **String 库（9 个函数）**：全部"弹 N 压 1"。软失败按函数语义压 `0.0`/空串/`#undefined`（parseNumber），均为 1 个值。
- **Table 库（8 个函数）**：全部"弹 N 压 1"。特别值得肯定：`Table.set`/`Table.delete` 成功时**压 `#undefined`**（am_native_Table.c:156, 254）——是"语句语义、表达式形态"的正确示范，与方案 A 的 P1 纪律天然一致。
- **System 库（16 个函数）**：形态最多样，详见 10.3 的分类。
- **LLM 库（6 个函数）**：`get_config`（0→1，9 元素列表）、`get_param`（0→**1**，把 14 个权重列表打包成 1 个 14 元素总列表，不是压 14 个值）、`encode`（1→1）、`decode`（1→1）为标准表达式型；`init`/`matmul` 为语句型（见下）。

**辅助函数哨兵审计**：Math/String/System/Table/LLM 的 `native_pop_*` 系列全部检查 `UINTPTR_MAX`；裸用 `am_process_pop_operand` 的点中，Table.set 的 value（Table.c:131）、System.write 的 v（System.c:970）有检查，System.exec/eval 的 code 靠 `is_handle` 等效拦截——**唯一漏洞是 `System.test`（System.c:1025）：裸 pop 不查哨兵，栈下溢时不报错、压出垃圾字符串**。

### 10.3 按栈效应形态的分类（System/LLM 的特例全在这里）

**表达式型（弹 N 压 1，净 -N+1）——契约的基准形态**：除下列各型外的全部函数，含 System 库的 kill（1→1）、set_timeout/set_interval（2→1）、timestamp（0→1）、memstat（0→1）、gc（0→1）、make_queue（1→1）、read/write（同步路径）。

**语句型（弹 N 压 0，净 -N）——违反单值纪律，需改造（§11 N2）**：
- `System.clear_timeout` / `System.clear_interval`（1→0，System.c:802/816）；
- `LLM.init`（1→0，LLM.c:758）；
- `LLM.matmul`（7→0，LLM.c:922，副作用写回 xout 列表）；
- `System.eval`（1→0 净 -1，见下"引擎特许型"）。

**终止型（特许例外）**：`System.exit`（0→0，不 step，置 STOPPED，System.c:552）——进程死亡使栈平衡失去意义，属合法例外（§11 N3）。

**进程替换型（特许例外）**：`System.exec`（System.c:667）——成功路径压 0 不 step，旧 opstack 整体释放、新进程 PC=0 空栈起跑；失败路径压 1 个 int `-1`（净 0 = -1+1，**失败分支恰好满足单值契约**）。

**eval 型（引擎特许，但当前净效应违反纪律）**：`System.eval` 弹代码串后跳转入 evalee（PC=offset），`evalcleanup` 结束时把 opstack 截断到"弹码串之后记录的 saved_len"（System.c:1610 → am_runtime.c:1855-1861）——**净效应 -1：消费 1 个值、产出 0 个值**。按单值纪律，eval 应产出 1 个值（`#undefined`，或未来考虑 evalee 的最终值）——改造点为 evalcleanup 截断后补压 1 个值（见 §11 N2 与 §12）。

**异步型（阻塞-唤醒，契约需专门建模）**：`System.read`（2→?）、`System.write`（3→?）——阻塞路径**压 0 不 step**，置 BLOCKED 挂入等待队列；唤醒由 `runtime_queue_wake_process`（am_runtime.c:100-112）补压**恰好 1 个值**并 step：写方被唤醒压 `#t`、超时压 `#f`；读方被唤醒压该值、超时压 `#undefined`（am_runtime.c:138, 156, 259, 313）。**跨悬挂点合计仍满足"弹 N 压 1"**——这是异步 native 的正确范式。
【遗留缺陷】wake_process 的 push 失败时**静默 return，进程永久停留 BLOCKED**（am_runtime.c:105）——契约 N5 要求修复。

**双边界型（特许例外）**：`System.fork`（System.c:889）——一次调用、两个进程**各压恰好 1 个值**（父压子 pid、子压 0）；父进程在深拷贝**之前** step 1 次，子进程继承已前进的 PC 与深拷贝的 opstack。形态特殊但逐进程仍满足单值纪律。

### 10.4 Native 侧对静态分析与方案 A 的影响

- **callnative 的静态效应可精确化**：契约 N1 保证净效应恒为 -N+1；N 在编译期（application 节点）已知——正好补上 stack_depth.md §5.2 中"callnative 效应需记录 argc 侧表"的另一半；
- **语句型 native 的改造责任在 native 内部**（§10.1 结论 2），方案 A 的 A4"语句型内建清单"只覆盖 builtin 指令（display/newline/list_push/set_item），native 侧需按 §11 N2 同步改造 4 个函数（clear_timeout、clear_interval、LLM.init、LLM.matmul）+ 决策 eval 的产出值；
- `Table.set/delete` 压 `#undefined` 的既有做法证明：native 侧单值纪律与现有代码风格兼容，改造量小。

---

## 11. Native 函数栈平衡纪律与契约（开发者规范）

以下条款适用于一切新增/修改 native 函数（`am_native_*.c`），并作为 code review 的检查清单。条款分三级：**【必须】**违反即破坏栈平衡；**【应当】**违反属风格缺陷；**【例外】**需经显式登记。

**N1【必须】单一结果契约**：函数的每条正常返回路径（return 0）恰好向 opstack 压入 **1 个**结果值。即净栈效应恒为 **-N+1**（N 为弹出的参数个数）。禁止压 0 个（语句型须走 N2）、禁止压 2 个及以上、禁止把 opstack 当暂存空间（压入的临时值必须在返回前配对弹出）。

**N2【必须】语句型补值契约**：语义上不产出有意义结果的函数（clear/init/写回型等），**也必须压 1 个 `#undefined`** 再返回——参照现有 `Table.set`/`Table.delete` 的范式（`native_push_undefined`）。当前违规者：`System.clear_timeout`、`System.clear_interval`、`LLM.init`、`LLM.matmul`（各差一个 push）；`System.eval` 的产出值需在 evalcleanup 截断后补压（语义建议：`#undefined`；若未来定义"eval 返回最后表达式值"，则改为压该值）。

**N3【例外】终止型**：以终止/替换当前进程为目的的函数（现有仅 `System.exit`、`System.exec` 成功支）允许压 0 不 step，但**必须**把进程置于明确的终态（STOPPED）或完成整体替换，且必须在函数头部注释中声明本例外。新增加此类函数须同步登记到本文档与 manual。

**N4【必须】失败路径契约**：
- 硬错误（参数类型/个数不符、OOM、内部失败）：`return -1`——进程将被 STOPPED，允许栈不平衡，但**禁止"已压结果又 return -1"**；【应当】在返回前调 `am_runtime_error` 给出具体消息（现状：native 全库零消息，用户只能看到 PID/PC 兜底——这是已知诊断缺陷，新增函数不应继续恶化）；
- 软失败（查无此键、域错误、超时等）：压 1 个约定的失败值（`#undefined`/`#null`/`#f`/语义值），仍满足 N1。

**N5【必须】参数校验契约**：每次 `am_process_pop_operand` 都必须检查 `UINTPTR_MAX` 哨兵（首选使用各库 `native_pop_*` 辅助函数；裸 pop 必须显式比对）。哨兵命中 = 调用方少传参数 = 硬错误 `return -1`。当前违规者：`System.test`（System.c:1025）。多传参数不主动检测（与 VM 层无 arity 检查的现状一致，manual 声明为"未规定"）。

**N6【必须】step 契约**：同步成功路径**恰好**调用 1 次 `am_process_step`（使用 `native_push_*` 辅助函数者已内含，不要重复调用）。漏 step 会使同一条 callnative 再次执行（重复弹参、栈错乱）；多 step 会跳过指令。【应当】函数内只保留"压值+step"一个出口点（参考 Table 库的辅助函数封装）。

**N7【必须】异步契约**：阻塞型函数（队列、未来的 IO 等）在阻塞路径压 0 不 step、置 BLOCKED 并登记等待者；**唤醒路径必须恰好补压 1 个值并 step**（由运行时 `runtime_queue_wake_process` 统一执行），使"弹 N 压 1"跨悬挂点成立。唤醒值的语义须固定并写入 manual（现状：写方 `#t`/超时 `#f`，读方 值/超时 `#undefined`）。附带修复项：wake_process 的 push 失败导致进程永久 BLOCKED（am_runtime.c:105）——唤醒压值失败时应杀死该进程并报错，而非静默挂起。

**N8【必须】进程语义契约**：创建/复制进程的函数（fork 型）必须在**每个**受影响的进程中各压恰好 1 个值；step 的时机（fork 父进程在深拷贝之前 step）属于函数语义的一部分，改动须连带评估子进程继承的 PC。

**N9【应当】元数稳定性**：函数的参数个数 N 应固定并在 manual 登记；避免可变参数（栈上无法自检个数）。 N 是静态分析对 callnative 建模的输入（stack_depth.md §5.2），变动 N 须同步更新文档。

**N10【应当】自检清单**：新增 native 函数提交前回答：① 每条 return 0 路径压了几个值？② 每次 pop 都查哨兵了吗？③ step 恰好一次吗？④ 软失败值与 manual 一致吗？⑤ 若阻塞/终止/换栈，例外登记了吗？

**标准范式骨架**（表达式型）：

```c
int32_t am_native_Lib_func(am_runtime_t *rt, am_process_t *proc) {
    double a, b;
    if (!native_pop_number(proc, &b)) return -1;   // N5：查哨兵+类型，逆序弹参
    if (!native_pop_number(proc, &a)) return -1;
    // ... 计算（不触碰 opstack）...
    return native_push_result(proc, result);        // N1+N6：压 1 + step 1
}
```

语句型：计算后 `return native_push_undefined(proc);`（N2）。异步型：阻塞分支登记等待者后 `return 0`（压 0 不 step），由 wake_process 补值（N7）。

---

## 12. 路线图的 native 侧补充（对 §8 的修订）

- **阶段 1（方案 A）同步工作**：
  1. native 语句型补值（§11 N2）：`System.clear_timeout`、`System.clear_interval`、`LLM.init`、`LLM.matmul` 各补一个 `push #undefined`（每处 ≤3 行）；
  2. `System.eval` 产出值决策：evalcleanup 截断后补压 `#undefined`（推荐，语义最小变动；manual 中 eval 标注为 void 需同步更新）；
  3. `System.test` 补哨兵检查（§11 N5）；
  4. 修复 wake_process 的 push 失败永久挂起（§11 N7）；
  5. 回归重点：test_dw_*（dynamic-wind 与 eval 交互）、test_eval、sleepsort/协程（计时器与队列异步路径）、quasiquote（含 eval 用例）。
- **文档同步**：manual.md 第 8 章为每个 native 函数登记元数 N 与软失败值；doc/AGENTS.md 增补 §11 契约的引用。

## 13. 附：本次 native 盘点的关键事实摘要

- `op_callnative` 不碰栈（am_runtime.c:898-940），栈平衡完全由 native 函数自负；`call` 与 `tailcall` 对 native 无区别。
- 全库 64 函数无任何路径压 ≥2 个值；Math 25 个、String 9 个、Table 8 个全部标准"弹 N 压 1"。
- `Table.set`/`Table.delete` 压 `#undefined` 是语句型单值纪律的既有正确示范。
- 语句型违规 4 处：clear_timeout/clear_interval（1→0）、LLM.init（1→0）、LLM.matmul（7→0）；eval 净 -1（特许形态但违反纪律）。
- 哨兵漏洞 1 处：System.test（System.c:1025）。
- 异步范式正确：read/write 阻塞压 0 不 step，wake_process 恰好补压 1 个值并 step；唯一缺陷是 wake push 失败静默永久挂起（am_runtime.c:105）。
- fork 双边各压 1 值、父进程先 step 后深拷贝；exec 成功换栈/失败压 -1（净 0）；exit 终止型合法例外。
- 【实测】`(display (System.clear_timeout 0))` → 打印空行（语句型 native 不压值，display 弹走别人的值，与 §3.1 同类静默错乱）；`(display (Table.set t "k" 1))` → 打印 `#undefined`（表达式型 native 行为正确）。
