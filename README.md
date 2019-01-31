# AuroraVM

AuroraVM - A stack-based virtual machine for Scheme. 基于栈的Scheme虚拟机。

## Demo/Prototype

[JavaScript实现的原型](https://mikukonai.com/bcvm.html)

## 这是什么

AuroraVM 是一部虚拟机，可以执行由 Scheme 编译得到的字节码文件。目前已实现和计划实现的特性：

- 基于栈的机器架构。
- 支持一等函数和闭包。
- 高精度数值运算。
- 支持一等续延（continuation）和协程（coroutine）。
- 模块机制。
- 垃圾回收。

随着开发过程的推进，可能会增减特性。

## 目前的状态

目前仍在理论探索和方案设计阶段，使用 JavaScript 进行方案验证和原型构建，已经实现“能跑”的原型，但是非常粗糙。

方案稳定后，会使用C语言实现。此仓库即用来维护C语言版本的实现。

设计笔记：《[虚拟机设计笔记](https://mikukonai.com/template.html?id=虚拟机设计笔记)》

## 协议

MIT
