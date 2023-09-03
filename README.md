<p align="center"><img src="./doc/logo.png" width="400"></p>

<h1 align="center">Animac · 灵机</h1>

**灵机 · Animac**是一款[Scheme](https://zh.wikipedia.org/wiki/Scheme)解释器，是Scheme语言的一个实现。Animac能够将Scheme代码编译为中间语言代码，并且在虚拟机上执行中间语言代码。目前，Animac使用TypeScript开发，基于Node.js实现。

## 演示

**案例1**：在Animac的REPL中，通过调用事先封装好的Scheme接口模块`chatbot.scm`，构造提示语（prompt），通过本地宿主环境接口，将其传递给部署于本地的[ChatGLM2-6B](https://github.com/THUDM/ChatGLM2-6B)语言模型，并且将ChatGLM2推理输出的文本回传Animac，实现问答式对话。

https://github.com/bd4sur/Animac/assets/20069428/6fb423b5-7798-41e8-917c-ed828b54ac3e

## 开始使用

请先安装Node.js，建议使用 V18.17.1 LTS。然后执行以下命令，以启动Animac：

```
git clone https://github.com/bd4sur/Animac.git
cd Animac
node build/animac.js -h
```

构建：`npx tsc`

## 系统框图

![System Architecture](./doc/sysarch.png)

## 特性

### Scheme语言特性

- 支持Scheme核心子集，包括第一等（first-class）的函数、词法作用域和列表操作。
- 支持第一等续体（continuation）和`call/cc`。
- 自动尾调用优化。
- 具备模块机制，可检测并管理模块间依赖关系。
- **不遵守R<sup>5</sup>RS标准**。

### 运行时系统

- 基于栈的虚拟机，执行Scheme代码编译成的中间语言代码。
- 支持虚拟机层次上的多线程。支持“端口”机制以实现线程间通信。
- 暂不具备垃圾回收机制。

### 宿主接口和可扩展性

- 提供宿主接口机制，称为“Native接口”，类似于JNI，实现Animac与宿主环境（Node.js）的互操作，例如文件读写、网络收发等。通过Native接口的二次开发，可以灵活扩展Animac的功能，无需修改Animac核心。

## 用例

全部测试用例位于 [`test`](https://github.com/bd4sur/Animac/tree/master/test) 目录，主要包括3个用例集合和两个较大规模的单独的测试用例，详情如下。

用例集1 `test/test_1.scm` 包括：

- 格式化输出日历
- 简单递归函数
- 列表操作
- Man or Boy test ([Wikipedia](https://en.wikipedia.org/wiki/Man_or_boy_test))
- 使用CPS风格实现的复杂的阶乘
- 快速排序
- Quine（自己输出自己的程序）
- 准引用列表
- *The Little Schemer* 书中给出的简单解释器
- 中缀表达式解析器
- 生成器
- 快速傅里叶变换（FFT）
- 基于FFT的大整数乘法

用例集2 `test/test_2.scm` 包括：

- Church encoding ([Wikipedia](https://en.wikipedia.org/wiki/Church_encoding))
- Brainfuck解释器

用例集3 `test/test_3.scm` 包括：

- 线程和本地库（文件、HTTPS）测试
- Yin-yang puzzle ([Wikipedia](https://en.wikipedia.org/wiki/Call-with-current-continuation#Examples))

用例 `test/test_deadlock.scm` 基于虚拟机提供的多线程机制，实现了一个死锁现象的案例，旨在测试线程调度器和端口操作。

用例 `test/test_cr.scm` 基于`call/cc`实现了一个简单的协程机制，借助典型的生产者消费者问题来演示单个虚拟机线程内实现关键资源的无锁同步操作能力。

**词法作用域**

```scheme
(define free 100)
(define foo (lambda () `(,free))) ; 准引用列表也是词法作用域的
(define bar (lambda (free) (foo)))
(bar 200) ; 输出(100)，而不是(200)
```

**函数作为一等公民**

```scheme
(import List "test/std.list.scm")         ; 引入列表操作高阶函数
(native Math)                             ; 声明使用数学本地库
(List.reduce '(1 2 3 4 5 6 7 8 9 10) + 0) ; 55
(List.map '(-2 -1 0 1 2) Math.abs)        ; (2 1 0 1 2)
(List.filter '(0 1 2 3)
             (lambda (x) (= 0 (% x 2))))  ; (0 2)
```

**Quine（自己输出自己的程序）**

```scheme
((lambda (x) (cons x (cons (cons quote (cons x '())) '()))) (quote (lambda (x) (cons x (cons (cons quote (cons x '())) '())))))
```

**续体和`call/cc`**

```scheme
;; Yin-yang puzzle
;; see https://en.wikipedia.org/wiki/Call-with-current-continuation
(((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
 ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k))))
; Output @*@**@***@**** ...
```

## 研发方针

- **Animac是一个实验性的系统，并非健壮可靠的软件产品**。开发过程的首要考虑是写出给人看的代码，以代码为文档，将关键设计思想固化在可执行的代码中，而不刻意采用软件工程的种种设计模式和“最佳实践”，以免关键思想被掩盖在软件工程的迷雾之中。
- **Animac从构建最小可用系统(MVP)开始，持续扩充功能特性“做加法”**。目前，Animac重视解决“从0到1”的问题，暂时不关注性能优化、异常和边界情况处理、安全加固等打造一款成熟软件时所必须考虑的问题。
- **Animac贯彻极简主义，期望打造成一个自持的、具体而微的系统**。Animac尽可能减少外部依赖，其核心功能仅需Node.js和一份代码即可运行，无需额外安装其他依赖。

## 特性规划

|Features|Priority|Status|
|----|-----|----|
|Web IDE|★★★|正在开发|
|垃圾回收|★★★|待研究|
|卫生宏和模式匹配|★★★|待研究|
|自动CPST & 自动柯里化|★★☆|待研究|
|模板字符串和正则表达式|★★☆|待研究|
|数值类型塔（数学库）|★★☆|待研究|
|图形库|★★☆|待研究|
|尽量兼容R<sup>n</sup>RS|★☆☆|待研究|
|高级编译优化|★☆☆|待研究|
|C语言重构|★☆☆|待研究|
|类型系统|★☆☆|待研究|

## 形式语法（BNF表示）

```
    <SourceCode> ::= (lambda () <TERM>*) CRLF
          <Term> ::= <SList> | <Lambda> | <Quote> | <Unquote> | <Quasiquote> | <Symbol>
         <SList> ::= ( <SListSeq> )
      <SListSeq> ::= <Term> <SListSeq> | ε
        <Lambda> ::= ( lambda <ArgList> <Body> )
       <ArgList> ::= ( <ArgListSeq> )
    <ArgListSeq> ::= <ArgSymbol> <ArgListSeq> | ε
     <ArgSymbol> ::= <Symbol>
          <Body> ::= <BodyTerm> <Body_>
         <Body_> ::= <BodyTerm> <Body_> | ε
      <BodyTerm> ::= <Term>
         <Quote> ::= ' <QuoteTerm> | ( quote <QuoteTerm> )
       <Unquote> ::= , <UnquoteTerm> | ( unquote <QuoteTerm> )
    <Quasiquote> ::= ` <QuasiquoteTerm> | ( quasiquote <QuoteTerm> )
     <QuoteTerm> ::= <Term>
   <UnquoteTerm> ::= <Term>
<QuasiquoteTerm> ::= <Term>
        <Symbol> ::= SYMBOL
```

## 参考文献

- R Kelsey, et al. **Revised^5 Report on the Algorithmic Language Scheme**. 1998.
- D P Friedman, M Wand. **Essentials of Programming Panguages**. 3rd Edition. 2001.
- G Springer, D P Friedman. **Scheme and the Art of Programming**. 1989.
- H Abelson, G J Sussman. **Structure and Interpretation of Computer Programs**. 2nd Edition. 1996.
- A V Aho, M S Lam, et al. **编译原理**. 第2版. 赵建华等译. 2009.
- D P Friedman, M Felleisen. **The Little Schemer**. 1995.
- D P Friedman, M Felleisen. **The Seasoned Schemer**. 1995.
- B C Pierce. **Types and Programming Languages**. 2002.
- G L Steele. **Rabbit: A Compiler for Scheme**. 1978.
- R K Dybvig. **Three Implementation Models for Scheme**. 1987.
- O Danvy, A Filinski. **Representing Control: A Study of the CPS Transformation**. 1992.
- C Flanagan, A Sabry, B F Duba, M Felleisen. **The Essence of Compiling with Continuations**. 1993.
- R A Kelsey. **A Correspondence between Continuation Passing Style and Static Single Assignment Form**. 1995.
- O Danvy. **Three Steps for the CPS Transformation**. 1992.

## 名称和图标

**Animac**，是自创的合成词，由拉丁语词汇Anima“灵魂”和Machina“机器”缩合而成，寓意“有灵魂的机器”。汉语名称为“**灵机**”，从“灵机一动”而来，也暗示本系统与图**灵机**的计算能力等价。

图标是六元环状图形，表示Eval-Apply循环。相邻的两边，形如“λ”，表示λ-calculus。六边形表示本系统基于Node.js实现。图形整体与艾舍尔名作《[上升与下降](https://en.wikipedia.org/wiki/Ascending_and_Descending)》相似，表达“无限循环”的意思。

## 权利声明

版权所有 &copy; 2019~2023 BD4SUR，保留所有权利。

本系统“按原样”提供，采用MIT协议授权。本系统为作者个人以学习和自用目的所创作的作品。作者不对本系统的质量作任何承诺。作者不保证提供有关本系统的任何形式的解释、维护或支持。作者不为任何人使用此系统所造成的任何正面的或负面的后果负责。
