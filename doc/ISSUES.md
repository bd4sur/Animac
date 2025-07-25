# 工单跟踪

考虑到：①单人开发无需使用重量级的工单管理工具；②逐步减少直至完全消除对于GitHub等平台的依赖；③工单是重要的文档，很大程度上记录了需求和方案的核心思想，甚至提供了关键的用例，是理解代码的重要参考资料，有必要、也可以作为仓库的一部分，纳入版本控制。

决定：①将2022年（#21）之前的工单迁移到本文档；②新工单使用本文档作记录和跟踪，不再使用GitHub自带工单管理机制。

## 34 【故障】begin表达式和lambda函数体污染操作数栈问题 Open

2025-07-11

`begin`表达式和lambda函数体都是由多个子表达式组成的，各个子表达式顺序求值。按照语言规范，`begin`表达式的值是最后一个子表达式的值，而lambda函数体的返回值是最后一个子表达式的值。

在当前实现中，`begin`表达式和lambda函数体的各个子表达式，都会被求值，并且求值结果都会被压栈。然而，除了最后一个子表达式压栈的结果会被续体消费外，其余压栈的结果，一般不会被消费，会留在操作数栈中，导致操作数栈被污染（覆盖了先前压栈的值）。

在以下测试用例中，函数`g`向操作数栈中依次压入1、2、3三个值，然而只有3是期望的返回值，1和2都不应压栈。在函数`f`中，调用`g`之前，`,a`已经被求值，结果100被压入操作数栈。调用`g`之后，`g`不仅将期望的返回值3压栈，还额外压栈了1、2。这就导致`f`在求值quasiquote时，取出的栈顶两个值是3和2，而不是期望的3和100。

```scheme
(define f
  (lambda (a)
    `(,a ,(g)))) ;; 此处g压栈的结果会覆盖a压栈的值：(100 [1] [2] 3)

(define g
  (lambda (x)
    1 2 3)) ;; 1和2不应压栈

(display (f 100))
```

可能的对策：研究编译期死代码消除（注意不要消除副作用），或者识别无副作用的push并在push之后添加pop将其退栈。另外各类表达式的返回值要严格定义，禁止无返回值（语义上无返回值的，实现上要返回`#undefined`，如`set!`表达式），以便编译器统一处理push后pop的问题。

## 33 【特性】while循环结构的块作用域支持 Open

2025-07-03

详见睡眠排序测试用例。现阶段，`while`实质上等同于简单的代码展开，其循环体并非独立的词法作用域，因此循环体内捕获的闭包并不能保存循环过程中每一步的实际绑定。这种行为与JS是不同的。虽然通过在循环体中手动执行thunk的方法，也能迂回实现循环体块作用域的特性，但是后续要考虑是否增加默认块作用域特性。

## 32 【计划】本地库异步回调的实现？ Open

2025-06-10

异步回调函数与中断服务程序不完全相同。异步回调函数相当于在代码任意位置中插入的函数调用，回调的发生时刻本质上就是不确定的，其执行环境（上位闭包）也是不确定的，因此数据竞争、脏读脏写等问题是预料内的情况。虚拟机并不关心这些问题对业务逻辑的影响，业务逻辑需要自行处理同步问题（例如编写完全函数式风格的业务代码、用虚拟机提供的端口机制等等）。

执行异步操作之后，线程继续执行（或者执行完毕，线程处于停止状态），在未来的某个时刻，异步操作完成，触发中断，调用回调函数。在进入中断服务程序（回调函数）之前，是否需要显式保存所在线程在中断发生时刻的执行状态？我看是不需要的。因为回调函数是普通的函数调用，只是其发生时刻不确定，无论如何不确定，有一点是确定的，那就是绝不会发生在一条中间指令执行的过程当中。因此，虚拟机在调用回调函数之前完成参数压栈等操作，调用回调函数，基于当前闭包生成新闭包，并不会破坏当前闭包、栈、堆的状态。唯一需要保存的，就是回调发生时，当前线程的PC。当回调完成时，返回地址就是PC+1。

## 31 【特性】本地库的路径问题 Open

2023-10-16

现阶段，本地库的搜索路径是固定的。应当确定一个搜索规则，或者做成可配置的。

## 30 【优化】函数调用的arity检查 Open

2023-08-30

对于内置函数、Lambda函数，分别执行arity检查，并完善错误提示。内置的算术逻辑函数应当支持可变arity。

## 29 【计划】文档结构优化 Open

2023-08-22

计划重新整理博客上的技术笔记，初步拟定大纲为：语言特性概览、语法分析、语义分析、中间代码生成、虚拟机架构、模块管理、内存管理、线程调度和同步、虚拟机宿主互操作、调试器、性能优化、专题讨论（卫生宏和模式语言、元语言和反射能力、代码形式变换（利用形式变换实现单步调试等、自动CPS变换等）、第一等续体和通用控制流（如`call/cc`、`dynamic-wind`等，并且从ANF和虚拟机、CPST两个角度去解释`call/cc`））。

## 28 【故障】源代码文件最后一行要有空行否则报错 Open

2023-08-22

这个问题很久以前就发现了，触发条件还不是特别清楚，待分析。

## 27 【计划】在WebIDE中使用模块机制的限制 Open

2023-08-22

对于WebIDE而言，尽管不是不能在浏览器中模拟出一个层级的“文件系统”，但是出于简化复杂性（而专注于原理验证）的考虑，目前限制要求所有的模块都位于同一层级的目录下。这也就是说，WebIDE场景下的模块加载器，只会在同级目录下寻找被引入的模块。多个模块构成的一个“项目”，其结构约定如下：①GUI上显示的所有模块，不一定都有相互依赖的关系，但是应该全部发给后端，让后端按需取用。②GUI上当前活动的模块，相当于“main”模块，即入口模块，后端作依赖分析时，以它为根节点，递归地分析依赖关系，并链接成一个大模块。③项目中所有的模块都是在同一个虚拟目录下，没有目录层级。实在想体现层级，就把模块文件名写成点号分割形式吧。多模块项目的JSON格式如下：

```json
{
    "entrance": "main.scm",
    "files": {
        "example.mod1.scm": `code string...`,
        "example.mod2.scm": `code string...`,
        ...
        "main.scm": `code string...`,
    }
}
```

## 26 【优化】线程调度和同步机制以及`fork`用法的优化 Open

2023-08-22

设计思想和原理：

- 虚拟机的中断机制。这个中断机制不能依赖于node提供的事件循环机制，而应该想办法自行实现一个事件循环，然后在这个事件循环的基础上去实现中断和事件回调。这也有利于移植到其他语言上。
- 重新理解`fork`：如果说闭包是函数的运行时实例，那么线程就是模块的运行时实例。从一个运行中的线程`fork`出一个新的线程，前者是父线程，后者是子线程。父子线程并不能互相访问自身的堆空间，也就是说，线程的堆空间是私有的。这与Java不同。
- 从一个现有的Lambda（函数）`fork`一个线程，相当于把这个函数所在的整个模块即时编译成了一个新的模块，这个模块与当前运行的模块是独立的。尽管父子线程（或者同一个模块文件所fork出来的不同线程实例）共享相同的代码，但它们之间实际上并无“共享内存”。例如，尽管函数A和B在词法上（字面上）都能够“访问”到自由变量C，但是在运行时，以A和B为入口fork出来的两个线程，并不会访问到**同一个**自由变量C：这个自由变量C（和它指向的对象）分别存在于两个完全独立的线程实例的闭包链（和私有堆空间）中。好比同一个exe文件运行两次，产生两个进程，虽然是同一个代码，这两个进程并不能互相访问到自己的内部变量。
- 从一个现有的Lambda（函数）`fork`一个线程，就是将这个模块实例化为线程池（属于虚拟机运行时环境的公共内存）中的一个线程实例，分配把柄，并置为“挂起”状态。任何运行中的线程都能通过线程的把柄访问到一个线程，进而对线程进行控制，实现进程间的协同。
- 当`run`一个线程的时候，将这个线程加入线程队列，等待调度激活，并置为“启动”状态。至于用户程序能否控制虚拟机的调度策略，这个需要进一步调研。
- 线程之间通过端口进行线程间通信，端口实质上是共享内存，并不是线程安全的。Animac基础设施（暂）不提供任何内建的同步机制和原语。当然，未来如果有可能的话，不妨提供一些诸如FIFO之类的机制，实现更加简单实用的线程间同步通信。

`fork`机制的使用方法：

- 语法为`(fork <var> <ent>)`，其中`<var>`是变量，用于将线程实例对象的把柄绑定在这个变量上，供当前父线程使用；`<ent>`是线程的入口点，限定为(a)外部模块路径字符串（例如`(fork "lib/module.scm")`）；(b)当前模块定义的顶层变量，这个变量指向一个没有参数的函数（例如`(fork func)`，其中`func`是当前模块顶层的`(define func (lambda () ...))`），或者(c)某个没有参数的函数的字面表示（例如`(fork (lambda () ...))`）。
- 语义为：将`<ent>`所在的代码模块整体，编译为一个模块实例，并实例化为线程实例对象，保存到线程池中，分配线程把柄，绑定到变量`<var>`上。对于`<ent>`为Lambda的情况（即语法中(b)(c)两种情况），在编译成模块之前，先将`<ent>`这个Lambda所在的AST节点，构建为立即执行的Application节点（即`((lambda () ...))`或者对于已经存在变量绑定的情况`(func)`），并将其挂载到模块顶级LambdaBody下。这样，`<ent>`就充当了模块的立即执行的所谓main函数的作用。子线程中当然允许继续fork子线程。

## 25 【优化】系统规划设计虚拟机接口 Open

2023-08-22

- 将内存操作的相关函数，从现在的Memory对象成员，改为Runtime的静态函数。一个Process（后续可能有必要改称Thread）应该是个不带“方法”的纯粹的数据结构。这样有利于宿主本地接口的二次开发。
- 待考虑。

## 24 【优化】厘清指称（符号）和含义（值/对象）的区别的关系 Open

2023-08-22

现在`TypeOfToken`这个函数是非常混乱的，它试图判定一个指称属于哪种类型。但是这个函数、甚至现有设计的指称体系是完全混乱的，混淆了表世界和里世界的区别。例如，表世界的Lambda，跟里世界的Lambda结构对象、Closure闭包对象之间，并没有做良好的区分。

优化的目标是：彻底厘清指称（表世界符号）和含义（里世界对象）的区别，表世界的符号要用正则语言构造性地定义，里世界对象的指称（如把柄）要更加简明高效。

这个问题要同时考虑到语言的自省（反射）问题。

## 23 【优化】虚拟机指令拆分优化 Open

2023-08-22

现阶段，某些指令（如`call`）的实现过于庞大，单个指令处理的情况过于复杂，既不利于性能，也不利于理解。有必要将这类指令拆分成多个指令。编译器也要相应地修改。

尝试在编译期进行简单的类型检查。很多场景是可以做到的，例如`call/cc`的参数是单参数函数，等等。

## 22 【优化】平台无关化改造 Open

2023-08-22

尽可能完全去除系统核心对于node的依赖，将依赖node的部分（如文件操作）封装成平台无关的接口，以兼容node和Web浏览器。

## 21 【故障】现有尾位置分析的实现是完全错误的 Closed

2022-07-13

应严格对照R5RS实现。

## 20 【优化】完善异常处理 Open

2019-10-05

系统设计异常处理机制，梳理并资源化所有报错信息。运行时、编译器、链接器、分析器的异常信息，必须能够顺畅地传递给stderr等输出渠道，同时处理好系统的体面中止问题。

## 19 【特性】准引用支持R5RS中规定的层级嵌套 Open

2019-09-20

**特性描述**：见R5RS对准引用的描述。

**实现思路**：①Parser、Analyser和Compiler都需要做修改；②需要恰当处理单个符号（变量）的unquote情形，尤其是Analyser中需要区分因嵌套层数不同，而导致unquote在unquote和variable之间变化的情况。例如：`(quasiquote ,a)`和`(quasiquote (quasiquote ,a))`两个qq中，`,a`应当被分别解释成变量和符号。作为变量的`a`，应当作未定义的检查。

## 18 【故障】Native函数的一等化未实现 Closed

2019-09-19

**复现用例与故障描述**：

```scheme
((lambda (f x) (f x)) Native.Read "path..")
;; 报错“变量Native.Read未定义”
```

**原因分析与补救措施**：

原因在于编译阶段未对Native函数名作特殊处理，而是当成普通变量直接load。再由于VM中也未处理，导致出错。

Native函数的本质是用于指明外部库的符号，因此Native函数的一等化，实际上是指将Native函数的名称作为符号原子处理。

补救措施是，在编译阶段增加相应分支，改load为push。另外`Process`类中的工具函数`IsUseNative`宜移动至`AST`类。

## 17 【计划】固化版本0.1.0 Closed

2019-09-19

目前处在盲目开发的状态，因此有必要固化现有工作成果，梳理现有特性集合，为后续制订开发计划、规划新特性提供依据。

争取十一之前关闭现有的所有故障单，将当前开发状态固化为0.1.0版本。

## 16 【故障】准引用列表编译实现有误 Closed

2019-09-17

**复现用例与故障描述**：

```scheme
(define foo (lambda (a lst) (cons `(,a) lst)))
(define lst '())
(set! lst (foo 100 lst))
(display lst)  ;; 期望输出((100))，实际输出同
(set! lst (foo 200 lst))
(display lst)  ;; 期望输出((200) (100))，实际输出((200) (200))
```

**原因分析与补救措施**：在目前的（错误）实现中，qq是被编译成`set-child!`语句，**直接修改**AST（静态数据）上的qq节点的children，这是错误的。正确的做法应当是：

- 提供`copylist`指令，用于将AST上的列表及其全部子表递归地复制到堆区中，并对所有列表对象分配把柄，指令返回根节点的把柄。
- 在已有`CompileQuasiquote`实现的基础上，增加`copylist`的步骤。这样，Scheme代码中的每个qq，实际上都是起到了只读模板的作用，每次引用qq，都会在堆区新建一个实例。

2019-09-19

这个问题似乎没有这么简单，可能需要重新设计，并且需要跟GC结合起来考虑。

## 15 【故障】`cond`表达式无法处理没有`else`的情形 Closed

2019-09-16

**故障描述**：若`cond`表达式没有显式的`else`分支，则编译结果不正确。

**补救措施**：加入对无`else`的处理。

## 14 【故障】REPL中应容忍`define`中出现的未定义符号 Closed

2019-09-16

**故障描述**：在REPL中执行`define`表达式，会因为其内有尚未定义的符号而报错。而对于REPL来说这是需要（暂时）容忍的。

**补救措施**：凡`define`表达式（及其子表达式）内出现未定义符号，REPL可以给出警告，但不能报错终止。当前轮次的代码**需要**加入缓冲区，供后续轮次执行。那么什么时候报错呢？只有在非`define`表达式中引用了未定义的符号，才报错。

## 13 【优化】将Parser和Analyser解离成两个独立环节 Closed

2019-09-11

目的是为实现REPL，以及`fork`和ModuleLoader的优化做准备。

## 12 【特性】REPL Open

2019-09-10

如题，需要交互式的REPL。进一步的思考记录在下面。

## 11 【优化】基本运算符支持不定长参数列表 Open

2019-09-10

**特性描述**：支持`+`等基本运算符传入多于2个的参数，以实现不定长参数列表。

**实现思路**：此特性不紧急，未来将使用宏实现。进一步地，将所有算术逻辑运算符封装为宏。

## 10 【特性】增加`this`特殊变量 Open

2019-09-05

**特性描述**：增加`this`特殊变量，这一变量的值，①为它所出现的词法Lambda节点的把柄。②为运行时确定的所在闭包的把柄。

**实现思路**：这一特性涉及反射，需要通盘考虑。目前的想法是：若值为闭包，则返回`currentClosureHandle`。若值为Lambda节点把柄，则静态分析阶段作替换。

需要考虑`this`①能否用来模拟面向对象特性；②能否用来实现`define`；③能否用来实现匿名函数递归进而实现`(function ..)`特殊结构。等等。

## 9 【特性】约束变量声明+初始化结构`(var <variable> <init>)` Open

2019-09-05

**特性描述**：增加`(var <variable> <init>)`，用于声明一个变量`<variable>`（即建立当前词法作用域上的一个约束变量绑定），并用`<init>`参数初始化其值。新声明的变量在作用域内是全局有效的，这类似于JavaScript的`var`变量声明，以及RnRS规定的`letrec`。

为什么要增加这个结构？因为`(set! var val)`只能修改**已绑定**的变量为已求值的右值参数，而`(define var init)`的右值参数只能是**未经求值**的词法节点把柄/立即值/函数所在IL代码的标签。二者的功能某种程度上是正交的，这一点与RnRS中定义的有所不同。

**实现思路**：接续执行`define`和`set!`。在实现卫生宏之前，在编译器层面实现之。

## 8 【故障】尾位置分析和尾调用 Closed

2019-09-04

**故障描述**：①尾位置分析忽略了`begin`；②尾调用指令无需新建闭包。

**补救措施**：①添加；②去掉。

更正：尾调用是尾递归的情况下无需新建闭包，其他情况仍然需要新建闭包。

## 7 【故障】`null?`等若干个primitives没有被纳入primitives处理 Closed

2019-09-03

**现象描述**：`null?`等原始函数没有被特殊处理。

**补救措施**：纳入primitive处理（例如`+`等算术运算）。

## 6 【特性】增加“普通”函数调用相关指令 Open

2019-09-02

**特性描述**：计划增加3条指令，使AVM可执行不具有闭包特性的非一等函数（例如C、Java等语言的函数、方法等）。3条指令分别为：

- `invoke <label>` 执行`<label>`处定义的函数。
- `setlocal <variable>` 将OP栈顶对象保存到位于栈帧的局部变量中。
- `getlocal <variable>` 从栈帧中取出局部变量的值，并压入OP栈顶。

还需要加入全局变量操作指令。

**实现思路**：①栈帧增加局部变量字段。②或者`invoke`的栈帧并不与`call`共用同一类栈帧。

## 5 【特性】非递归的循环结构`while` Open

2019-09-02

**特性描述**：增加非递归的、直接的循环结构`(while condition body)`。这个特性应当优先实现，因为该结构无法通过宏构造出来。

**实现思路**：①将`while`设置为关键字；②编译器将其作为特殊结构，使用现有的AIL指令集直接编译为AIL代码。

考虑将尾递归编译为简单循环。这是最基本的编译优化。

## 4 【优化】对IL代码中出现的变量名作优化 Open

2019-09-02

**特性描述**：目前，变量名是直接以原始形式被保留在编译得到的AIL代码中，这很冗长，且字符串形式的变量名并不利于后续的处理。因此，有必要将IL代码中出现的变量，全部替换为全局唯一的数字形式（变量编号），这样VM就可以使用数组之类的简单数据结构去实现闭包，也便于以后用C语言实现VM。

**实现思路**：在适当位置保留变量名与变量编号的映射表，也就是所谓的符号表。

## 3 【特性】进程间通信和进程同步 Closed

2019-09-02

尝试将文件、网络操作、共享内存抽象为“端口”操作。提供信号量、锁机制。

## 2 【优化】本地库函数和内置函数的一等化改造 Closed

2019-04-29

**特性描述**：目前的本地库函数和内置函数尚未支持一等函数特性，严格来讲算是表达式而非函数。改造后，本地库函数和内置函数应当获得与普通函数相同的一等地位，即可以作为值传递。

**实现思路**：①取消`callnative`指令，由`call`和`tailcall`指令统一处理本地库函数的调用问题。②在进程VMI中增加判断变量是否是内置函数调用的谓词，在运行时VMI增加内置函数谓词（如加减乘除等）。③`Dereference`函数要对内置函数名和本地库函数名作特殊处理，例如直接返回字符串。

## 1 【故障】脏标记泄露问题 Closed

2019-04-29

**现象描述**：由`set!`函数引入的脏标记会通过`executor.getBoundValue`函数泄露到执行机中。

**补救措施**：此函数的所有出口均做去掉脏标记的处理。

2019-08-30

重构后已消除此问题产生的机制原因。
