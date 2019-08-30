# AuroraScheme

![GitHub top language](https://img.shields.io/github/languages/top/mikukonai/AuroraScheme.svg) ![GitHub](https://img.shields.io/github/license/mikukonai/AuroraScheme.svg?label=Licence) 

Scheme语言实现 / A Scheme Implementation

使用TypeScript/ES6实现，基于Node.js。

## 可视化演示

[调试工具（尚未完善）](https://mikukonai.com/auroravm.html)

## 如何使用（本节未完成）

```
cd ./source-ts
tsc --out AuroraScheme.js
node AuroraScheme.js
```

## 这是什么

AuroraScheme是一款Scheme语言实现，包括编译器、运行时环境和调试工具三大模块。

### 特性

- **语言标准支持**：有限支持R<sup>5</sup>RS。具体为：支持Scheme核心语言（无类型λ演算和列表操作），有限地支持first-class continuation，暂不支持卫生宏特性。
- **独立的运行时环境**：类似于Lua，AuroraScheme设计了一套基于栈的、支持词法作用域和闭包特性的中间语言（指令集）及其虚拟机，Scheme代码将被编译成此中间语言代码，随后在运行时环境中执行。运行时环境负责内存管理、垃圾回收、进程管理、IO等任务。
- **模块化Scheme开发**：支持模块化的Scheme代码，可检测并管理模块间依赖关系。
- **可扩展性和宿主互操作性**：支持类似于JNI的本地接口机制，可以使用TypeScript/JavaScript编写供Scheme代码调用的Native库，实现AuroraScheme与宿主环境（Node.js）的互操作。

### 开发目标

- 完善基础库和应用库，使其可以处理一些简单的任务，并通过持续改进，打造成一门个人自用的趁手的工具性脚本语言。
- 作为个人自用，并**不打算完全严格遵守R<sup>5</sup>RS标准**，但是会努力对标R<sup>5</sup>RS。
- 学习目的。

### 计划实现的特性

- 高精度数值运算。
- 功能有限的准引用（quasiquote）。
- 字符串模板（类似于JavaScript的）和正则表达式。
- 进程调度器。
- 提升Native库机制的JS与Scheme的互操作性，以及接口的友好性。
- 完善基础库（nativelib）和应用库（applib），分别指利用ANI机制由JS编写的库，和直接使用Scheme编写的库。
- 可视化的调试工具。
- 自动化测试。

### 暂未列入计划的特性

- 编译时类型检查、推导，或者强类型语言。
- 模式匹配。
- 卫生宏。
- 可以由卫生宏所实现的一系列结构，例如`let`块、`delay`/`force`、柯里化和CPST等等。

随着开发过程的推进，可能会增减特性。

## BNF

```
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

## 技术文档

参见《[AuroraScheme设计笔记](https://mikukonai.com/template.html?id=AuroraScheme%E8%AE%BE%E8%AE%A1%E7%AC%94%E8%AE%B0)》

## 开发规约

参见《[开发维护规范与约定](https://github.com/mikukonai/AuroraScheme/blob/master/CONTRIBUTING.md)》

## 权利声明

版权所有 &copy; 2019 Mikukonai@GitHub，保留所有权利。

采用 MIT 协议进行授权。

本系统为个人以学习和自用目的所创作的作品。作者不对此系统的质量作任何承诺，不保证提供任何形式的解释、维护或支持，也不为任何人使用此系统所造成的任何正面的或负面的后果负责。
