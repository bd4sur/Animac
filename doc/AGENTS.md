# Animac 2026 通用研发规范

以下是Animac项目的通用研发规范。该规范尚未编写完毕，仍在持续补充，供AI编码代理参考。

## 项目概述

Animac（灵机）是一款Scheme解释器，支持Scheme语言的子集和某些自定义特性，并不完全遵守R5RS。

## 目录结构

- doc/：文档
- include/：C语言头文件
- src/：C语言实现（代码）文件
- test/：C语言测试实现文件
- typescript/：本项目早期原型项目，由TypeScript实现。除非明确提到参考TypeScript已有实现，一般无需阅读。

## 术语约定

- 逻辑长度称length，物理长度称size，容器最大容量称capacity。
- parameter形式参数称“引数”，argument实际参数称“参数”。
- Alpha-renaming过程，也就是通过换名来消除嵌套词法作用域中同名变量的混淆的过程，简称为ARN。
- 内置函数和运算符，值分类上属于变量，统称为“内建变量”builtin，不叫“primitive”。

## 环境与工具

- 当前开发环境是Windows系统，但部署了WSL（Ubuntu）。你可以使用WSL，通过WSL使用make、gcc等构建工具进行构建、测试。
- 禁止执行任何删除命令，如`rm`。

## 架构设计

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

symbol是以其字面为ID的，相同拼写的symbol，无论在哪个上下文中都是同一个符号。因此AST合并时，字符串相同的symbol，就是同一个symbol。这与variable截然不同。

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

