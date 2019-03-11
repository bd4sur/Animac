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
const Executor = require('./executor.js');

// 运行时
// TODO 试验性代码
const Runtime = function() {
    this.PROCESS_POOL = new Array();
    this.PROCESS_POOL_SIZE = 0;
    this.POINTER = 0;
};

Runtime.prototype = {
    AddProcess: function(process) {
        this.PROCESS_POOL.push(process);
        this.PROCESS_POOL_SIZE++;
    },

    Tick: function() {
        if(!(this.POINTER in this.PROCESS_POOL)) {
            this.POINTER++; return Common.PROCESS_STATE.DEFAULT;
        }
        let process = this.PROCESS_POOL[this.POINTER];
        let state = null;
        if(process.STATE !== Common.PROCESS_STATE.DEAD) {
            state = Executor.Executor(process, this);
        }
        else {
            state = Common.PROCESS_STATE.DEFAULT;
            this.PROCESS_POOL[this.POINTER] = undefined;
            this.PROCESS_POOL_SIZE--;
        }
        this.POINTER++;
        if(this.POINTER >= this.PROCESS_POOL.length) {
            this.POINTER = 0;
        }
        return state;
    },
}

module.exports.Runtime = Runtime;
