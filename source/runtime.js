// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// runtime.js
// 运行时环境，即一个虚拟机实例
//   虚拟机实例提供线程池、共享内存、文件系统和寄主环境接口、外设模拟、软中断等
//   由调度器调度执行所有线程、并负责分配资源
//   本模块的主体是一个无限循环
//   客户程序运行时，可能需要生成新的虚拟机实例，例如执行内置的eval函数
// 输入：MODULE（经模块加载器加载的模块）
// 输出：无（执行）

const Common = require('./common.js'); // 引入公用模块

// 运行时
const Runtime = function(MODULE) {
    let status = null;

    return status;
};

module.exports.Runtime = Runtime;
