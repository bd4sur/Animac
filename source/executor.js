// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// execotor.js
// 执行机
//   执行线程PC指定的代码，并访问线程内部或外部的存储区域
// 输入：THREAD（线程实例（的句柄））
// 输出：THREAD（线程实例（的句柄））

const Common = require('common.js'); // 引入公用模块

// 运行时
const Executor = function(THREAD) {
    let status = null;

    return status;
};

module.exports.Executor = Executor;
