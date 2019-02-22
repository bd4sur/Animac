// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// compiler.js
// 编译器
// 输入：AST（代码抽象语法树） × RESOURCE（静态资源）
// 输出：MODULE（经编译的模块文件）

const Common = require('common.js'); // 引入公用模块

// 编译器
const Compiler = function(AST, RESOURCE) {
    let MODULE = new Common.Module();

    return MODULE;
};

module.exports.Compiler = Compiler;
