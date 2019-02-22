// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// scheduler.js
// 调度器
//   调度器根据运行时（虚机实例）的状态，按照调度算法，从线程池中选择一个线程执行，并修改线程状态
// 引用外部资源：runtime提供的线程池等
// 输入：虚机实例状态
// 输出：被选中执行的线程句柄

const Common = require('common.js'); // 引入公用模块

//调度器
const Scheduler = function(MODULE) {
    
};

module.exports.Scheduler = Scheduler;
