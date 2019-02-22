// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// module-loader.js
// 模块加载器
// 输入：SOURCE（Scheme源代码，可能引用其他代码）
// 输出：MODULE（经整合、命名空间分析、编译的模块文件）

const Common = require('common.js'); // 引入公用模块

// 模块加载器
const ModuleLoader = function(SOURCE) {
    let MODULE = new Common.Module();

    return MODULE;
};

module.exports.ModuleLoader = ModuleLoader;
