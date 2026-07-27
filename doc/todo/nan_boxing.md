# NaN-boxing 技术分析与在 Animac 中的适用性评估

> 本附录回应关于 include/am_object.h 中 TPV 低位 5-bit 标签设计的改进问题：讲解 NaN-boxing（利用 IEEE754 NaN 空间存放类型标签）技术，评估其在本项目的适用性，给出方案与风险分析。行号基于 2026-07-27 工作区版本；标注【实测】的结论已通过 WSL 运行验证。本文不修改任何代码。

## 14. NaN-boxing 技术讲解

### 14.1 IEEE754 双精度的位布局与 NaN 空间

一个 64 位 double 由三部分组成：符号位（bit 63，1 位）、指数（bits 62–52，11 位）、尾数（bits 51–0，52 位）。IEEE754 规定：**指数全 1（0x7FF）的值不是数**——尾数为 0 时是 ±Infinity，尾数非 0 时是 NaN。这意味着全部 64 位模式中有约 **2^53 个模式（±两组，指数全 1 且尾数非 0）都是 NaN**，而正常浮点运算实际产生的 NaN 几乎只有固定的一两种位型（典型为 quiet NaN `0x7FF8000000000000`）。

**NaN-boxing 的核心观察**：这 2^53 个 NaN 模式中，绝大多数永远不会被合法浮点计算产生——它们是一块巨大的"空闲地址空间"。于是可以约定：

- 凡 `(v & 0x7FF0000000000000) != 0x7FF0000000000000` 的 64 位值，**就是一个普通的 double**（浮点值零开销：位型即值，无需任何打包/拆箱）；
- 凡指数全 1 的值，则是**非浮点类型**：用高若干位（如 bits 63–48）做类型标签，低 48 位做载荷（指针、整数、句柄、符号 id……）。

### 14.2 一个典型的编码布局（JSC 风格）

以 JavaScriptCore（WebKit 的 JS 引擎，NaN-boxing 最知名的工业实践）为代表的布局：

- double：直接使用全部"指数非全 1"的模式；
- 指针/对象引用：quiet-NaN 区加标签，载荷 48 位（x86-64 与 ARM64 的用户态虚拟地址都不超过 48 位）；
- int32：标签 `0xFFFF`，载荷为低 32 位——解包只需 `(int32_t)v` 一次强转，符号扩展免费；
- true/false/null/undefined：NaN 区内的几个保留单例。

类型检测只需一次掩码+比较（如 `v >= 0xFFFF000000000000` 即 int），整数解包零移位，浮点完全无操作——相比低位标签方案"每次解包都要移位/掩码"，NaN-boxing 在解释器最热的指令路径上更省。采用同类技术的还有 SpiderMonkey（Firefox JS）、LuaJIT 2（内部 TValue）、Wren、Duktape 等。

### 14.3 与其他标签方案的对比

- **低位标签（Animac 现状）**：标签在最低 k 位，指针依赖对齐空出低位，立即数 `x << k | tag`。优点：值等于平台字长（32 位平台 4 字节）；缺点：所有立即数载荷损失 k 位，浮点必须截尾数或装箱，标签空间只有 2^(k-1)。
- **高位标签**：标签在最高 k 位。缺点：指针的高位在多数平台并不空闲（32 位平台指针用满 32 位；64 位虽空闲但符号扩展处理烦琐），通用性差。
- **NaN-boxing**：优点：double 无损、类型检测廉价、标签空间巨大、载荷 48 位统一；缺点：**值必须固定 64 位**（32 位平台上值容器内存翻倍），整数值域被压缩进 48（或 32）位，64 位整数值域反而可能比低位标签方案小。

### 14.4 预算账（64 位值的位分配）

NaN 空间共 2^53（或取 quiet 半区 2^52）个模式。Alloc 预算：PTR48 需要 2^48、INT48 需要 2^48、其余十余种小立即数（handle/varid/iaddr/label/symbol/wchar/bool/null/undefined）共享若干 2^48 大区绰绰有余——2^49 « 2^52，预算宽裕。若保守起见指针限 47 位（防御 ARM64 LVA-52 / Intel 5 级分页 57 位地址，可配合自定义 mmap 约束），也完全放得下。

## 15. Animac TPV 现状与痛点量化

### 15.1 当前布局（include/am_object.h:39-250）

- `am_value_t = uintptr_t`（平台字长）；LSB=0 为 PTR（依赖指针 2 字节对齐，include/am_allocator.h:16 的 NOTE），LSB=1 为立即数、bits 1–4 为类型（4 位标签）、bits 5+ 为载荷（`AM_MAKE_VALUE_OF_UINT_LIKE(x,tag) = (x<<5)|tag`）。
- 载荷宽度：64 位平台 59 位；32 位平台 27 位。
- 类型枚举已用 13 个（PTR + 12 种立即数），4 位标签最多 16 种——**仅剩 3 个空位**。

### 15.2 痛点（逐条量化，均有代码或实证）

1. **浮点截尾**：`am_make_value_of_float` 右移 5 位**丢弃低 5 位尾数**（am_object.h:245-250，注释明确"无论32位还是64位都截断低5位尾数"）——64 位平台 double 有效尾数 52→47 位；32 位平台 `am_float_t` 本就是单精度 float，尾数 23→**18** 位。每个浮点字面量与每次浮点装箱都引入约 2^-47（64 位）的相对误差。【实测】`(- 0.3 (+ 0.1 0.2))` 显示 `0`（全精度双精度下应约为 5.55e-17）——截断造成的精度现象已可被简单算式观测；打印侧因统一 `%g` 六位精度（am_process.c:1084 等）平时不可见，属"静默失精"。
2. **整数值域**：64 位 ±2^58、32 位 ±2^26【实测 64 位下 `288230376151711744`（2^58）、`576460752303423487`（2^59-1）可显示，更大字面量被静默截断】；且 parser 的 `wcstoll` 饱和 + 装箱移位叠加，大整数被静默改写（am_parser.c:297-306）。
3. **对象语言可见的位宽漂移**：`AM_UINT_BIT_WIDTH = sizeof(am_value_t)*8 - 5`（am_native_Math.c:212）——Scheme 层 `bit_*` 运算的逻辑位宽在 64 位是 59、32 位是 27，同一程序跨平台语义不同。
4. **标签空间枯竭**：4 位标签只剩 3 个空位，无法支撑未来新立即数类型（如 boxed bigint、rationals、新单例）。
5. **PTR 的脆弱对齐契约**：仅依赖 LSB=0（2 字节对齐），是 allocater 必须永久遵守的隐性契约（include/am_allocator.h:16）。
6. **磁盘格式的双平台分叉**：FLOAT 盘上 8 字节 double 在 64 位写的是"截断后提升"的值、32 位写的是"float 提升"的值（am_object.h:549-551, 577-580, :378 注释）——同一模块在不同字长宿主间互导时浮点值有系统性差异。

## 16. NaN-boxing 在 Animac 的适用性分析

### 16.1 有利因素（改造工程量比想象小）

1. **封装极其干净**：全部打包/解包集中在 include/am_object.h 的 static inline 函数与宏；全项目**未发现**绕过封装直接移位/掩码 TPV 的代码（`>> 5`/`<< 5`/`& 0x1F` 仅命中两处与 TPV 无关的 UTF-8 解码）。改造主战场只有一个头文件。
2. **PTR 消费面小**：PTR 值只出现在 heap 表的 slot value（handle→PTR 映射）一处；opstack/fstack/闭包绑定/list children 中只存 HANDLE 与立即数（am_gc.c:293-310 的 gc_mark 只认 handle）；GC 压缩只需回写 heap->table（am_gc.c:614-618）。
3. **磁盘格式基本自描述**：dvalue 是"1 字节类型标签 + 变长载荷"（am_object.h:356-608），与内存编码解耦。FLOAT 盘上 8 字节 double：新编码下写入全精度值，读旧盘（低 5 位为 0 的 double）也完全兼容——**旧盘可读、新盘更准**，迁移路径平滑。
4. **相等与哈希语义编码无关**：单例比较（AM_VALUE_FALSE/NULL/UNDEFINED/HANDLE_NULL 及 map 的 EMPTY/TOMBSTONE 哨兵）全部是 `==` 位比较；map 哈希用原始位模式（am_map.h:50）；`equal?` 对数字做数值比较（am_runtime.c:449-453）。只要新常量宏唯一定义、构造均走宏，这些全部自然成立。
5. **关键字比较安全**：主流形式是"解包后比 symbol 载荷"（约 30 处），与编码无关；少数直接 `== AM_VALUE_KW_*`（am_repl.c:241-248）只要求宏是编译期常量；`am_ast.c:840` 的"预置顺序==常量序号"是序号约定，不受影响。
6. **载荷全面提升**：handle/varid/iaddr/symbol/wchar 从 59/27 位升到统一 48 位——32 位平台是数量级改善；`AM_HANDLE_NULL` 等哨兵可定义为显式常量，摆脱 `UINTPTR_MAX>>5` 的字长推导。
7. **am_float_t 可统一为 double**：删除 32/64 分支（am_object.h:43,53），同时消除 32 位的单精度损失与磁盘"float 提升"特例（§15.2-6）。

### 16.2 不利因素与代价（决策的真正难点）

1. **32 位平台值容器内存翻倍**：`am_value_t` 4→8 字节，波及 opstack/fstack（am_process.c:290,301）、list children、map entry、闭包 binding、continuation stacks、`am_wstring_t.content[]`（**每个字符一个 TPV，字符串内存直接翻倍**）。ESP32 是本项目的真实目标（src/am_host_esp32.cpp、PSRAM vtable），PSRAM 带宽与容量压力需要实测重新评估。
2. **Xtensa 软双精度**：ESP32（LX6/LX7）硬件 FPU 仅单精度，double 由软件模拟。现状 32 位构建 `am_float_t=float` 恰好避开软 double；NaN-boxing 统一 double 位型后，**MCU 上所有浮点运算变为软浮点**，性能显著下降。
3. **64 位平台整数值域倒退**：59 位（±2^58）→ INT48（±2^47）。对把 Animac 当"大整数玩具"的场景（test/big_int.scm）是可见变化；且 `AM_UINT_BIT_WIDTH` 需改为固定 48——对象语言可见语义变化，manual 须同步。若选 INT32（JSC 风格）则倒退更大，不推荐。
4. **磁盘格式的连带改动**：`AM_DISK_UINT_PAYLOAD_MAX`（现为 UINTPTR_MAX>>5）、`AM_DISK_INT_BITS`（现为字长-6）需改为显式载荷宽度；PTR 的"偶数偏移量"编码（am_object.h:559-561,596-601 与 am_heap.c:404-408,510 的伪造/解包偏移量）整个约定要重设计（PTR 编码改变后偏移量直接用 48 位载荷即可，反而是简化）；模块头版本号（am_module.c 的 `unsupported version %u`，现 202607）应 bump 以拒绝旧引擎误读新盘。
5. **哨兵体系重定义**：`am_process_pop_operand` 的 `(am_value_t)UINTPTR_MAX` 哨兵（am_process.c:443-444）与 5 个 native 库约 15 处直接比较——32 位宿主上 UINTPTR_MAX 提升后不等于 uint64 哨兵，且全 1 位型在 NaN 区可能与合法值冲突，必须引入专用常量（如 NaN 区保留单例 `AM_VALUE_SENTINEL`）。
6. **值 0 的语义翻转**：当前 0 = PTR 标签 NULL 指针，多处 `am_value_t x = 0` 作"空"草稿值（am_map.c:285、am_list.c:197 等 5 处）；NaN-boxing 下 0 是 float +0.0——这些点应改为 AM_VALUE_UNDEFINED（虽然只是 read 前的草稿，但属于必须排查的语义陷阱）。
7. **哈希退化陷阱**：am_map.h:50-61 的 `am_value_hash` 用 `#if UINTPTR_MAX` 分支折叠 64 位——32 位宿主上若值变 64 位而分支仍按指针字长走 32 位路径，**高 32 位（含全部标签位）被丢弃，同类型所有值哈希相同，map/heap 退化为链表**。必须改为按 `sizeof(am_value_t)` 或无条件折叠。
8. **测试与调试耦合**：`System.test` 打印 TPV 原始位模式（am_native_System.c:1027），输出全部变化，依赖它的 test/mob.scm 需同步；am_debug 系列均经解包函数，无碍。
9. **amalgamation 与文档**：animac_core.* 需重新生成；doc/report.md:30-48、doc/AGENTS.md:97（AM_HANDLE_NULL 记述）、doc/manual.md 的数值章节需同步。

### 16.3 结论性判断

**技术适用：适合，且比多数 C 项目更适合**——得益于 am_object.h 的干净封装与磁盘格式的自描述设计，改造面收敛于"一个头文件 + 五类已知耦合点"。**真正的决策变量不是技术而是平台定位**：64 位桌面/服务器场景下 NaN-boxing 几乎全是收益（浮点无损、标签空间、检测更快、唯一代价是 int 59→48 位）；32 位 ESP32 场景下收益（int/uint/handle 27→48 位、float 18→53 位尾数）与代价（值容器翻倍、软 double）需要按产品需求权衡。

## 17. 改进方案（若采纳）

### 17.1 目标编码（推荐布局）

```
double ：(v & 0x7FF0000000000000) != 0x7FF0000000000000   // 位型即值，零开销
NaN 区 ：指数全 1。tag = bits 63..48，payload = bits 47..0
  0x7FF8 : PTR      （48 位指针；保守可限 47 位并对齐）
  0x7FF9 : HANDLE   （48 位句柄；哨兵 AM_VALUE_HANDLE_NULL = 该区 payload 全 1）
  0x7FFA : IADDR
  0x7FFB : VARID
  0x7FFC : LABEL
  0x7FFD : SYMBOL
  0x7FFE : WCHAR    （21 位码点绰绰有余）
  0x7FFF : UINT     （48 位无符号）
  0xFFF8 : INT      （48 位有符号：解包 (am_int_t)((int64_t)(v << 16) >> 16)，
                     高 tag 便于未来向 INT32/INT64 子区扩展）
  0xFFF9 : BOOLEAN / NULL / UNDEFINED（单例区，payload 区分）
保留   ：0xFFF0–0xFFF7、0x7FF0–0x7FF7 备用（未来 bigint 装箱标记、新单例）
```

要点：类型检测统一为"先测指数全 1，再比 tag"，与现状的 `am_value_type` 两段式同构；`am_value_is_float` 变为"指数非全 1"；`is_ptr` 变为 `tag==0x7FF8`，不再依赖指针对齐（include/am_allocator.h:16 的隐性契约可解除）。

### 17.2 改造点清单（必修八项，源自耦合盘点）

1. **include/am_object.h 整体重写**：typedef（`am_value_t = uint64_t` 恒 64 位；`am_float_t = double` 统一；int/uint/handle 等保持平台类型但载荷上限固定 48 位）、全部 TAG/常量/打包/解包/谓词；`AM_HANDLE_NULL` 改为显式常量 `(1ULL<<47)`（48 位载荷上限）；新增 `AM_VALUE_SENTINEL` 专用哨兵替换 `(am_value_t)UINTPTR_MAX`。
2. **哨兵替换**：am_process.c:443-444 + 5 个 native 库约 15 处 `(am_value_t)UINTPTR_MAX` 比较点。
3. **include/am_map.h**：`am_value_hash` 改为按值宽度无条件 64 位折叠；哨兵别名（:19-20）跟随新常量。
4. **位宽语义**：am_native_Math.c:212 `AM_UINT_BIT_WIDTH` 改为固定 48；manual 同步。
5. **磁盘格式**：`AM_DISK_UINT_PAYLOAD_MAX` / `AM_DISK_INT_BITS` 改为显式载荷宽度；PTR 偏移量编码重写（am_object.h:559-561,596-601 + am_heap.c:404-408,510，用 48 位载荷直存偏移，删除"偶数"技巧）；模块头版本 bump 并保留旧版本只读兼容（可选）。
6. **`am_value_t x = 0` 草稿值**（5 处）改 AM_VALUE_UNDEFINED；`System.test` 输出改为分类型打印（并同步 test/mob.scm）。
7. **amalgamation**：`make amalg` 重新生成 animac_core.*；`amalgamate.sh` 无需改。
8. **文档**：doc/report.md、doc/AGENTS.md、doc/manual.md 数值与位运算章节。

### 17.3 阶段路线

- 阶段 1：am_object.h 重写 + 一个独立的 TPV 单元测试程序（打包/解包往返、谓词、单例、极值、NaN/Inf/±0.0 行为）；
- 阶段 2：清单 2–6 的机械改造，`make` 零警告，`testall.sh` 全量回归（重点：big_int、fft、cas 数值用例；mob.scm 的 System.test 输出；模块 dump/load 互导）；
- 阶段 3：磁盘格式迁移策略落地（版本 bump/兼容读）与文档同步；
- 阶段 4：ESP32 专项——PSRAM 占用实测（wstring 翻倍最敏感）、软 double 性能基准（fft.scm 可作现成基准），据此决定 ESP32 是否跟进或保留旧布局（§18-B4）。

### 17.4 预期收益核对

浮点全精度（52 位尾数，32 位从 18 位直升）；int/uint/handle/varid/iaddr 统一 48 位（32 位从 27 位直升，64 位 int 从 59 降到 48 位——唯一倒退项）；标签空间从 3 个空位变为约 2^16 个；类型检测由"掩码+移位+比较"简化为"掩码+比较"；解除指针 2 字节对齐契约。

## 18. 备选方案对比

- **B1 维持现状**：零成本。接受浮点截尾与 32 位小值域。适合"ESP32 是一等公民、数值精度不敏感"的定位。
- **B2 仅修浮点（最小手术）**：FLOAT 改为堆装箱——am_object.h 已有 `AM_OBJECT_TYPE_BOX (0x09)` 的 TODO 占位（:277），浮点对象入堆、TPV 中只存 handle/ptr。改动远小于 NaN-boxing，32/64 位都受益（32 位还可顺势把 am_float_t 升 double）；代价是每次浮点产生都伴随堆分配与 GC 压力、算术路径多一次解引用，热循环（fft.scm）会明显变慢。适合"只要精度、不要大改"的过渡。
- **B3 NaN-boxing 统一 64 位（本方案）**：桌面收益最大、32 位精度收益最大但内存/性能代价也最大。
- **B4 双布局编译开关**：64 位构建用 NaN-boxing、32 位构建保留旧布局（am_object.h 已有 `#if UINTPTR_MAX` 分支传统，加第三路 `AM_VALUE_LAYOUT_NANBOX` 即可）。代价是两套路由长期共存于同一头文件，磁盘格式需同时兼容两种内存编码的导出（自描述格式可做到，但测试矩阵翻倍）。

**推荐**：若项目重心在 64 位桌面/服务器与语言实验，直接 **B3**；若 ESP32 是严肃交付目标，先 **B2**（低风险解决最痛的浮点截尾），把 B3/B4 留作需要 48 位整数/句柄或更多立即数类型时的升级路径。

## 19. 附：本次实证记录（2026-07-27，WSL/gcc，当前实现）

- `(- 0.3 (+ 0.1 0.2))` → 显示 `0`：截断尾数使本应为 ~5.55e-17 的误差被抹平（精度损失的可观测实例）；
- `(display 0.1)`、`(/ 1.0 3.0)` → `0.1`、`0.333333`：`%g` 六位精度掩盖了截断（属静默失精）；
- `288230376151711744`（2^58）、`576460752303423487`（2^59-1）→ 正常显示；更大整数字面量被静默截断（§15.2-2）；
- 封装干净度核查：除 am_object.h 外**未发现**任何绕过打包/解包函数的 TPV 位运算（仅两处 UTF-8 解码命中 `& 0x1F`，无关）；
- PTR 消费面核查：PTR 值只存于 heap 表 slot；GC 根与对象图只认 handle（am_gc.c:293-310）；GC 压缩只回写 heap->table（am_gc.c:614-618）。
