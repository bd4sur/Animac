// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// parser.js
// Scheme源码语法分析
// 输入：SOURCE（Scheme源代码）
// 输出：[AST（抽象语法树）, RESOURCE（静态资源）]

const Common = require('common.js'); // 引入公用模块

// 语法分析
const Parser = function(SOURCE) {
    let AST = new Common.AST();
    let RESOURCE = new Common.Resource();

    return [AST, RESOURCE];
};

module.exports.Parser = Parser;
