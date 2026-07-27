# Animac 操作数栈深度静态分析：现状批判与正确算法设计

> 调研范围：全部 C 源码，重点是 `src/am_compiler.c`（分析实现）、`src/am_runtime.c`（63 条 VM 指令的实际栈效应）、`src/am_process.c`（opstack 的分配与扩容）。
> 行号基于 2026-07-27 的工作区版本。标注【实测】的结论已通过 WSL 构建运行验证（见 §7）。
> 本文不修改任何代码，仅输出调研结论与算法提案。

---

## 1. 背景：`opstack_depth` 是什么、谁消费它

每个模块编译产物 `am_module_t` 携带一个 `opstack_depth` 字段，由 `am_compiler_opstack_depth_analysis`（src/am_compiler.c:1201-1283）静态估计，并随模块 dump/load 序列化。它的唯一消费者是进程加载（src/am_process.c:289）：

- `proc->opstack_capacity = mod->opstack_depth > 0 ? mod->opstack_depth : 256`——作为操作数栈的**初始分配容量**；
- 运行时 opstack **会自动扩容**：`am_process_push_operand`（src/am_process.c:418-438）在容量不足时 2 倍扩容（下限 16），原有的"容量不足报错"代码已被注释（421-424）。

由此得出重要前提：**`opstack_depth` 不是安全边界，只是初始分配提示**。低估会导致运行时扩容（realloc 抖动，VM 内存被指数级蚕食）；高估会浪费 VM 内存；真正会让进程死亡的是 VM 内存耗尽。但这不意味着分析可以随便错——一个"系统性地既低估又高估"的估计值没有任何指导意义，而现状正是如此（§4）。

对照组：函数调用栈 fstack **固定 2048 值、不可扩容**（am_process.c:300, 461-467），那是真正的硬边界，但不在本文范围。

---

## 2. 运行时栈协议（一切分析的事实基础）

### 2.1 函数调用协议

由 `compile_application`（am_compiler.c:466-548）与 `compile_lambda`（556-581）的代码生成约定，以及 `op_call_async`（am_runtime.c:781-885）、`op_return`（943-956）的实现共同确定：

1. **调用方**：逐个编译实参压栈（每个实参净 +1），然后发射 `call`/`tailcall`；
2. **call/tailcall 指令本身完全不触碰 opstack**（op_call_async 全函数没有任何 opstack pop/push）——它们的差异只在 fstack：`call` 压入 (当前闭包, 返回地址) 帧（811-813, 843-845），`tailcall` 传 `return_target=SIZE_MAX` 跳过压帧（894）；
3. **被调方序言**：lambda 入口处按逆序发射一串 `store`（compile_lambda:564-569），逐个弹出参数绑定进闭包——**参数由被调方消费**；
4. **函数体**：逐表达式编译，最后发射 `return`；
5. **return 只弹 fstack 帧、恢复闭包与 PC，完全不动 opstack**（943-956）。

### 2.2 关键事实：编译器从不发射 `pop`——中间结果全部留栈

`compile_lambda` 与 `compile_begin` 中"除最后一个表达式外其余结果都 pop 掉"的代码**均被注释**（am_compiler.c:574-577, 705-707，两处标记 `TODO 处理pop问题`）。这意味着：

- 每个"语句"的净栈效应 = 该表达式求值的净效应（不产生值的语句如 `define`/`set!`/`display` 调用是平衡的 0；值表达式是 +1）；
- 函数体含 k 个产生值的表达式时，**return 时栈上留有 k 个值**，调用方看到的"返回值"只是栈顶那个；
- 被调方遗留的所有值都留在调用方栈上，**tailcall 同样不做任何清理**（op_call_async:816-830 仅复用/新建闭包并 goto，无 opstack 截断）；
- 因此 opstack 深度随直线代码**单调累积**，并在"循环体净效应为正"的 while 循环中**逐迭代无界增长**（运行时靠自动扩容兜底）。

### 2.3 栈替换类语义（静态分析的特殊点）

- **continuation 调用**：`op_call_async` 检测到目标是 continuation 时，弹出 1 个传递值（857），然后 `am_process_load_continuation` → `restore_continuation_snapshot`（am_process.c:723-800）把 opstack **整体 memcpy 替换**为捕获时的快照（755-757），再经 wind 跳板压入传递值。
- **wind 指令**：多状态指令（wind_state 1→2→3），**不是编译器发射的**，由 `am_process_load_from_module` 在 ilcode 末尾追加（am_process.c:222-226）——它不出现在编译期分析的 ilcode 中。
- **evalcleanup**：同样不出现在编译期 ilcode 中——由 `System.eval` 装配时把编译产物 ilcode[1] 的 goto **改写**而来（src/am_native_System.c:1661-1672），作用是把 opstack 截断到记录的 saved_len（am_runtime.c:1854-1861）。
- **dynamic-wind 四指令序列**（compile_dynamicwind:640-643 固定连发）：`dynamicwind` 弹 3 闭包并记录 opstack_base；`after_before`/`before_after` 各把栈**截回 base** 再调用下一个闭包；`done` 截回 base 后压回保存的结果。截断语义使整条序列的静态效应确定（§3）。

### 2.4 native 调用约定

`op_callnative`（am_runtime.c:898-940）自身不碰 opstack，查表后 `return func(rt, proc)`。约定：**native 函数自己 pop N 个参数、push 1 个结果，净效应 -N+1**（抽查 Math.sin/sqrt 净 0、Math.pow 净 -1、String.concat 净 -1、零参的 System.memstat 净 +1、零参常量 Math.PI 净 +1，一致）。N 在编译期（application 节点处）是已知的。

---

## 3. 全部 63 条 VM 指令的实际栈效应

以 `src/am_runtime.c` 各 op 实现为唯一事实来源（`am_process_push_operand` 418-438 / `am_process_pop_operand` 442-446）。指令枚举见 include/am_ast.h:23-86。

**净 +1（压 1 弹 0）**：load（518）、loadclosure（549）、push（564）。

**净 -1（弹 1 压 0）**：store（496）、set（594）、pop（572，注意编译器当前从不发射它）、iftrue（1220）、iffalse（1235）、display（2319——**弹栈顶值打印，不压任何结果**）。

**净 0（弹 1 压 1 或不动）**：nop（2372）、swap（581，弹 2 压 2）、call（888→781，对闭包/iaddr 目标）、tailcall（893→781）、return（943）、capturecc（959）、goto（1250）、pause（2380）、halt（2388）、newline（2346）、not（2126）、isnull/isundef/isatom/islist/isnumber/isnan/typeof（2160-2292）、car/cdr（1262/1284）、length（1492）、list_pop（1471，弹列表压回被弹元素，列表 handle 不变无需压回）、duplicate（1674）、splice（1645）、wind（1132，自身不动；state 3 整体替换栈后 +1，见 §2.3）。

**净 -1（弹 2 压 1）**：add/sub/mul/div/mod/pow（1902-2029）、eq/eqv/equal/ge/le/gt/lt（2032-2123）、and/or（2136/2148）、cons（1322）、get_item（1360）。

**其他定值**：set_item（1403）弹 3 压 0 = **-3**；list_push（1441）弹 2 压 0 = **-2**（压回列表的语句被注释，1465）。

**运行时变值**：

- concat（1512）：弹栈顶 count_val 再弹 count 个元素、压 1 个列表 = **-count**。count 由 compile_quasiquote 在其紧邻前一条指令 `push <count>` 压入（am_compiler.c:981-982），**编译期可从该 push 的 operand 精确读出**；
- callnative（898）：**-N+1**，N 为该调用点的实参个数（编译期已知）；
- call/tailcall 目标为 continuation 时：弹 1 后**整体替换** opstack（§2.3）；
- evalcleanup（1820）：截断到 saved_len（不出现在编译期 ilcode）；
- fork（2299）、read（2354）、write（2363）：**均已废弃**——fork 直接报错，read/write 是空操作（仅 step），实际效应都是 0。

**dynamic-wind 序列**（§2.3）：dynamicwind = **-3**；after_before = 0（截回 base 后调用 thunk）；before_after = 0（截回 base、保存 thunk 结果后调用 after）；done = +1（截回 base 压回保存值）。整条 `(dynamic-wind b t a)` 形式合计 -2（3 个闭包参数换 1 个结果），与其语义一致。

---

## 4. 当前实现的错误清单

当前实现（am_compiler.c:986-1283）由三部分组成：指令效应表 `compiler_stack_effect`（999-1079）、迭代 DFS `compiler_depth_search`（1115-1198）、入口驱动 `am_compiler_opstack_depth_analysis`（1201-1283）。错误分三个层面。

### 4.1 指令效应表与运行时实际不符（10 处）

按 §3 的事实逐一对照，下述条目是错的（括号内为：表中值 → 实际值）：

1. display（0 → **-1**）：每个 display 语句虚增 1 深度，直线代码越长高估越多。【实测】`(display "a") (display "b") (display "c")` 真实峰值 1，分析输出 3。
2. set_item（-2 → **-3**）。
3. list_push（-1 → **-2**）。
4. dynamicwind（-2 → **-3**）。
5. dynamicwind_after_before（+1 → **0**）。
6. dynamicwind_done（-1 → **+1**）。连同 4/5，整条序列的累计误差相互抵消纯属侥幸。
7. read（+1 → 0，已废弃的空操作）。
8. write（-2 → 0，已废弃的空操作）。
9. concat（-1 → **-count**）：结构性错误。对 max 而言峰值在 concat 之前所以常常"碰巧不差"，但 concat 之后路径的深度被系统性高估（count-1），并污染后续所有指令的深度。
10. evalcleanup 未建模（default 0）：无害（不出现在编译期 ilcode），但缺失说明。

方向总结：1/7 使深度**高估**（浪费内存）；2/3/4/8/9 使深度**低估**（不安全方向）；5/6 方向不定。

### 4.2 算法结构性错误（比效应表更严重）

**(E1) 不组合调用方深度——跨函数峰值被系统性低估。**
`am_compiler_opstack_depth_analysis` 把每个 lambda 作为独立入口（init = 参数个数，1216-1240），取各函数**孤立**深度的最大值作为全局最大。但真实峰值发生在调用链深处：函数 g 执行时的绝对深度 = 调用方 f 在调用点的深度（扣除 g 的参数）+ g 的相对深度。当前实现从不做加法。

【实测】`(define f (lambda () 1 2 3 4 5 (g))) (define g (lambda () 1 2 3 4 5 6 7 8 9 10)) (f)`：真实峰值 = f 调用点的深度 5 + g 内 10 = **15**，分析输出 **10**。这是最危险的一类错误（低估初始分配），且嵌套越深误差越大。

**(E2) call 之后的路径深度失真。**
DFS 对 `call` 的处理（1175-1179）是"效应 0、继续下一条"——即认为 call 前后深度不变。实际上被调方会 store 弹掉 argc 个参数、留下 net 个体式结果，调用点之后的真实深度 = 调用点深度 - argc + net（见 §5.3）。当前实现把它高估为"调用点深度"（含全部实参），使调用密集代码的后续深度普遍虚高。

**(E3) 对"循环携栈增长"既无建模也无报告。**
由于编译器不发射 pop（§2.2），while 循环体每迭代净效应为正时（如 `(while c 1 (set! i (+ i 1)))`），运行时深度**逐迭代无界增长**。当前 DFS 用 `depth > icount + 16` 的硬截断（1137）静默丢弃这类路径——把一个"无界"问题伪装成一个有界数字返回，且无任何告警。

**(E4) 递归/调用图完全未建模。**
非尾递归每层帧在 opstack 上累加（tailcall 不清理栈，§2.2），真正的最大深度是**数据相关、无界**的。当前实现对此既无表示也无说明（详见 §5.1 的目标定义）。

**(E5) DFS 基础设施的静默降级**（承袭 error.md 的结论）：

- `best_depth[iaddr]` 只记录最大值、以 `depth <= best` 剪枝（1135）——对"取最大深度"目标本身可行，但配合 E2 的错误深度，剪枝传播的是错误值；
- DFS 栈容量固定 `icount * 4`（1119-1123），满时 `DEPTH_PUSH` 静默丢后继（1154-1160）；
- `depth > icount + 16` 截断（1136-1137）任意且无报告；
- 分配失败静默跳过入口（1121）、label 解析失败静默跳路径（1164/1170/1251）；
- `icount == 0` 与失败同返 `SIZE_MAX`（1202）；分析结果 0 时静默返回 1（1282）。

### 4.3 小结：当前输出的数字是什么

它是一个"指令效应有 10 处错误、函数间不做组合、循环与递归静默截断"的 DFS 最大值——既不是上界（E1/E2 低估），也不是下界（4.1 的高估项），仅在最平凡的程序上碰巧接近真值。

---

## 5. 正确的栈深度静态分析算法（提案）

### 5.1 先定义目标：什么"可算"、什么"不可算"

由于 §2.2 的留栈语义，**运行时真实的最大 opstack 深度在两类情形下是数据相关、不可静态决定的**：

- **R1 循环携栈增长**：净效应为正的 goto 环（while 体遗留值），深度随迭代次数增长；
- **R2 调用深度增长**：调用图 SCC（直接/间接递归）每展开一层在 opstack 上累加一帧的工作区（tailcall 只省 fstack 不省 opstack）。

因此正确的目标应定义为（与 opstack_depth 的消费方式匹配）：

> **静态峰值 S** = 在所有"不重复展开任何循环、不展开递归边"的执行路径上，opstack 深度的最大值；并对 R1/R2 两类情形输出**结构化警告标志**（loop_carried_growth / recursive_growth），提示该模块的运行时深度依赖动态扩容。

R1/R2 之下深度无界不是分析的缺陷而是语言实现语义（不 pop + tailcall 不清栈）的必然推论；分析的职责是**识别并报告**，而非编造有界数字。

### 5.2 第一步：修正指令效应表

按 §3 重写 `compiler_stack_effect`：

- 定值项全部按 §3 修正（display -1、set_item -3、list_push -2、dynamicwind -3、after_before 0、before_after 0、done +1、read/write/fork 0）；
- **concat**：向前看一条指令（compile_quasiquote 恒在 concat 紧邻前方发射 `push <count>`，am_compiler.c:981-982），取 operand 得精确效应 -count；若不满足该形态（防御）回退为"未知"，按当前路径深度不变并置警告；
- **callnative**：效应 -N+1。N 在 ilcode 层面无法可靠恢复，**建议编译器在发射 call/callnative 时在侧表记录每个调用点的 argc**（分析时查表），或把 argc 编码进指令 operand（需注意磁盘格式兼容——更推荐侧表）；
- **default 分支改为"未知即失败/告警"**，杜绝新增指令忘登记时被静默按 0 估计（现状 1076-1077）。

### 5.3 第二步：函数内相对深度分析（每个 lambda 一次）

对每个 lambda（含顶层 thunk 与 η 变换临时 lambda），以其入口 label 的 iaddr 为起点、**相对深度 r = arity**（参数在栈上）做控制流图上的深度传播：

- 状态为 (iaddr, r)，沿指令效应推进（§5.2 的表）；
- iftrue/iffalse 双分支都传播，goto 沿目标传播；
- **环检测**：记录每条边的净效应；若某回边使 r 净增 > 0，置 `loop_carried_growth` 标志，并按"该环不再展开"处理（即取环内单遍最大值）——这正是目标定义对 R1 的处理；
- 收敛：r 只增不减时有限步内必触发环检测；一般情形用"同 iaddr 已以 ≥ r 访问过则剪枝"（现有 best_depth 机制可保留，但改用修正后的深度）；
- 产出：**R_f**（f 内相对深度最大值，含序言 store 期间）、**net_f**（f 的 return 点的 r，即遗留值个数）、以及 f 的每个调用点的记录 (位置 p, 调用前深度 d_p, argc, 目标集合)。

### 5.4 第三步：调用图组合（恢复跨函数加法）

对 f 中每个调用点 p（d_p 为 args 全部压栈后的深度，argc 为实参数）：

- **直接调用**（目标为 lambda label/iaddr，含 loadclosure operand 可解析的间接形态）：被调方 g 执行期间的绝对深度 = (d_p - argc) + r_g，其中 r_g 是 g 内的相对深度。对全局峰值的贡献 = **(d_p - argc) + R_g**；call 之后 f 的继续深度 = **d_p - argc + net_g**（修正 E2）；
- **间接调用**（目标为变量、编译期不可解析）：保守取贡献 = (d_p - argc) + max{R_g | g ∈ 全体 lambda}，并置 `indirect_call` 标志；实践中绝大多数调用经 label/loadclosure 可解析（compile_application:534-541、compile_complex_application），保守路径很少触发；
- **尾调用**：贡献公式与 call 相同（opstack 不清理，§2.2），区别仅在被调方返回后 f 不再继续（无后继深度）；
- **native 调用点**：无被调方内部峰值（native 是 C 代码，栈效应已在 §5.2 计入），后继深度 = d_p - N + 1；
- **continuation 调用点**：栈被替换为捕获快照。恢复深度 ≤ 捕获点深度 + 1，而捕获点（capturecc）就在某个已分析的 f 内，其深度已被 R_f 覆盖——**不产生新峰值**，置 `continuation_invocation` 标志即可；
- **递归边（SCC）**：贡献按单边计算一次（同普通边），同时置 `recursive_growth` 标志（对应 R2，见 §5.1）；
- **全局峰值 S** = max（各 f 的入口基址 + R_f），其中入口基址沿调用边按 (d_p - argc) 传播、取最大值（调用图为 DAG 时即最长路径；SCC 按上述标志折叠）。

### 5.5 算法伪代码

```
pass 1: 对每个 lambda f：
    DFS/BFS over f 的指令区间（r 初值 = arity_f）
        按 §5.2 效应表推进；环检测置 loop_carried_growth
        记录 R_f、net_f、call_sites[f] = [(p, d_p, argc, target)]
pass 2: 建调用图（节点=lambda 含顶层 thunk；边=call_sites 中可解析目标）
    标记 SCC → recursive_growth；标记不可解析边 → indirect_call
pass 3: base[top] = 0；按拓扑序（SCC 折叠）传播：
    对边 f→g @p：base[g] = max(base[g], base[f] + d_p - argc)
    S = max over f of (base[f] + R_f)
输出: S + 标志集合
```

### 5.6 与现有代码的兼容性

- 可保留：`compiler_depth_entry_t`、迭代 DFS 骨架、`best_depth` 剪枝机制；
- 必须改：效应表（§5.2）、call 的 DFS 语义（E2）、入口孤立取 max 的组合方式（E1）、环/截断的处理（E3/E5）、失败与空输入的区分（icount==0）；
- 需要新增：call 点 argc 侧表（§5.2）、调用图与 SCC（§5.4）、警告标志的输出通道（可放进 `am_module_t` 或编译日志）。

### 5.7 一个更务实的过渡方案（可选）

鉴于 opstack 会自动扩容（§1），若短期不打算做完整的 §5.3-5.4，最低限度应做三件事消除"错误方向"：① 按 §5.2 修正效应表（消灭 10 处硬错误）；② call 后继深度改用 d_p - argc + net_g（E2）；③ 对 E1 改为"孤立函数最大值 + 各调用点 (d_p - argc) 之和的上界"或直接文档化低估的事实。但请注意：只做 ①② 后，E1 的低估依然存在，结果仍不是上界。

---

## 6. 验证方案（供后续实施参考）

1. **单元级**：用 `am_debug` 反汇编 dump 若干 .scm 的 ilcode，手工核算 §3 效应表下的每条路径深度，与分析输出对照；
2. **端到端**：利用 main.c 启动时打印的 `Module loaded: opstack_depth=N`，对 §7 的用例回归——修正后 A 应输出 15、C 应输出 1、D 应输出 3；
3. **对照运行**：在 gdb 中观察 `proc->opstack_top - proc->opstack` 的峰值，与 S 对照（S 应为非递归、非循环增长程序的真实上界）。

---

## 7. 附：实测记录（2026-07-27，WSL/gcc，当前实现）

- 用例 A（§4.2-E1）：`(define f (lambda () 1 2 3 4 5 (g))) (define g (lambda () 1 2 3 4 5 6 7 8 9 10)) (f)` → 分析输出 **opstack_depth=10**，手工核算真实峰值 **15**（低估，不安全方向）。
- 用例 C（§4.1-1）：`(display "a") (display "b") (display "c")` → 分析输出 **3**，真实峰值 **1**（高估）。
- 用例 D（§4.1-2/3）：`(define l '(1)) (push l 2) (set_item! l 0 9) (display l)` → 分析输出 **4**，真实峰值 **3**（高估）。
- 用例 E：`display` 一个 10 元素 quote 列表 → 分析输出 **1**，真实峰值 **1**（quote 是静态模板单 push，此类平凡情形碰巧正确）。
