TODO 所有代码文件加am_前缀

NOTE 回归测试使用哪些用例：

- test.scm
- mlp.scm
- llm.scm
- yinyang.scm
- yinyang_cps.scm
- test_fork.scm
- test_table.scm
- test_eval.scm
- test_macro.scm
- test_mec.scm
- test_ipc1.scm
- test_ipc2.scm
- test_deadlock.scm
- jstest.js

TODO REPL遗留问题
- import不支持：①增加cwd（base_dir）；②增加link过程；③去掉链接过程的输出
- REPL里用不了异步任务？
- 在REPL中说明局限性。重放式REPL最大的问题：副作用代码会被反复执行：因此要求整个代码是幂等的，只要里面有一个依赖物理世界的东西，就会破坏幂等

NOTE 由于eval无法增加新绑定，所以不能用eval实现REPL

TODO JS翻译器要翻译特殊标识符，例如
     - callcc  -  call/cc
     - dynamic_wind  -  dynamic-wind
     - JS不用set
     - is_null  -  null?

TODO 给每个没有注释的函数增加注释，格式：
// 功能：
// 参数：
// 返回：
// 设计说明：
已有较长注释的就不必修改或追加了。

TODO JS层面通过特殊语法实现Object操作，例如@tbl["key"]这种

TODO 反射库、自省

TODO 栈平衡。

TODO 平台相关抽象。

TODO 测试自动化。

TODO 当前dump/load是“内存快照式”实现，严重依赖字长、指针长度、size_t长度和结构体填充，不是与系统字长无关；要在32位MCU与64位宿主之间互导模块，需要引入一层显式的固定宽度磁盘格式。（详见2026-07-08的prompt）

TODO module持久化去掉scope等

TODO 计算器；增加atan2；增加位运算（严格的数值类型隐式变换规则）

TODO REPL对于有副作用的表达式的判定有问题。例如(Table.set tbl key value)显然是有副作用的。

TODO 现在实现的Table本地宿主函数库，其字符串key强烈依赖于字符串驻留机制，这可能不够合理。比如将同一个key复制了一份，复制是反驻留的，这就会导致Table失效。另外对于不驻留的长字符串，Table也会失效。

TODO opstack深度估计还是有问题，可能跟表达式压栈和begin的pop问题有关。因此在 am_process_push_operand 暂且加入扩容逻辑，但这是不合适的。未来要解决。

TODO Symbol的eq必须用字符串去比较。symbol不能根据id比较，symbol的唯一性应该是宇宙级的，而不是进程级的。symbol必须根据字面内容进行比较。

TODO uint/int/float数值类型的自动转换→装箱

TODO 遗留问题：进程初始化时为什么要新建一个顶级闭包？为了防止闭包链上溯时访问失败？

TODO 模块的转储（dump）和加载（load）

TODO REPL和输入：通过callback打印，不要直接在display里打印

TODO 架构决策：fork时全量复制，还是COW？前者运行时性能好，对现有代码改动小。后者比较酷炫，但平均性能差、改动大。
暂不实现，仅记录思路，远期作为实验性功能探索：为进程heap增加COW机制：
- 首先把process的heap写过程封装起来，加入以下逻辑：
- 进程proc调用该函数，尝试写入proc->heap[handle]
- 首先读取proc->heap[handle]的readonly和mapcount字段，若readonly=true且mapcount>0，则执行以下COW流程：
  - 将current_proc->heap[handle]的旧值（指针）所指向的对象，复制一份，并获得副本的指针（通过heap_alloc分配器）。
  - 随后用副本的指针替换掉current_proc->heap[handle]的旧值，并重置其readonly=false和mapcount=0。

TODO capturecc指令的参数改成iaddr，其返回的把柄直接入栈

TODO eq? eqv? equal? +typeof

TODO 长远：不许使用系统malloc

TODO 改进TPV格式：利用NaN

TODO 虚拟机中央switch性能优化（计算跳转、基于profiling的优化等）

TODO 在abcdefg用例中，似乎有把关键字塞进变量表的问题。

TODO 计算object对象size的宏或函数（用于内存管理）

TODO 计算object对象的hash（map也要计算？），用于相等性比较（内涵的、外延的，需精密考虑）

TODO 模块二进制文件的格式：魔数、版本号、module_id

TODO 未来将 alpha renaming 优化成 de Bruijn index

TODO 模块名称机制（全限定名之类的，以及模块名在Linker中的用法）

TODO 重要问题：module要不要作为语言内置对象存在？这样import就变成了一个内置过程，像是eval。
     - 想办法支持“具名作用域”机制（这不就是define吗），这样就不需要麻烦的merge过程了。
TODO 重要问题：链接器要不要放在IL层面？以支持module内置对象。

TODO AN前先绑定全局内置符号，内置符号全局有效不换名（与extref的处理策略一致）。

TODO 变量Alpha-renaming(ARN)规则：
- BUILTIN一律不ARN，保留原形。NOTE builtin的绑定关系不可修改，VM将其视为native_ref。
- IMPORT_REF、NATIVE_REF、IMPORT_ALIAS、NATIVE_ID都不ARN，保留原形。
- AN不会涉及new，一旦遇到new，则报错退出。
- 对于old类型的varid：ARN后的全限定名格式为"模块ID.定义所在Lambda的把柄.原名"
  - 例如：home.user.app.114514.x

TODO 将PathUtils单独实现出来。

TODO 符号求导

NOTE 内存池在编译期和运行期之间要发生一次彻底重分配：编译期和运行期，都可以使用完整的内存池。编译完成后，将模块dump成一个完整的二进制文件，随后彻底清空内存池。

NOTE 关于本地native函数
- 所有的内置函数+运算符都是本地函数，作为顶级符号绑定在顶级作用域中，全局可见。
- 谨慎设计VMAPI


NOTE linker的输入参数保持AST不变：这样可以兼容文件、repl等多种场景。TODO REPL如何实现？


TODO 指令集设计变动

- capturecc iaddr 捕获当前Continuation，以iaddr为返回地址，并将其把柄入栈
- 算术逻辑运算：add、sub、mul、div、mod、eq、eqv、ge、le、gt、lt、not、and、or、typeof
- 列表运算：car、cdr、cons、get_item、set_item、append(->push)、(+pop)、length、concat、duplicate、、、
- fork机制要仔细考虑

TODO ILCode的序列化和反序列化

- 务必注意结构体填充和对齐问题
- 序列化时，opcode只占用一个字节（uint8_t）以减小代码长度。

TODO make_label
// 功能说明：根据handle、varid等值，构造一个全局唯一的临时label（增加值类型AM_VALUE_TYPE_LABEL）。相当于@<value>
// 只要lbl_value相等，在后面的标签替换阶段就会被替换为标签所在的iaddr
make_label(am_value_t lbl_value);
