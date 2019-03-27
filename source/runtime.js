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
    this.NATIVE_LIB_PATH = './nativelib/'; // native库目录（相对于JS代码所在目录，因为使用时是通过require引入）

    this.PROCESS_POOL = new Array();
    this.PROCESS_POOL_SIZE = 0;
    this.POINTER = 0;

    this.PORTS = new Object();
};

Runtime.prototype = {
    // 运行时初始化
    Init: function() {
        // 定义系统级端口
        // 启动init进程
        // 加载系统配置 等等
    },

    AddProcess: function(process) {
        this.PROCESS_POOL.push(process);
        this.PROCESS_POOL_SIZE++;
    },

    Tick: function() {
        if(!(this.POINTER in this.PROCESS_POOL)) {
            this.POINTER++; return Common.PROCESS_STATE.DEFAULT;
        }
        let process = this.PROCESS_POOL[this.POINTER];

        if(process.STATE !== Common.PROCESS_STATE.DEAD && process.STATE !== Common.PROCESS_STATE.SLEEPING) {
            Executor.Executor(process, this);
        }
        else if(process.STATE === Common.PROCESS_STATE.SLEEPING) {
            // TODO
        }
        else {
            this.PROCESS_POOL[this.POINTER] = undefined;
            this.PROCESS_POOL_SIZE--;
        }
        this.POINTER++;
        if(this.POINTER >= this.PROCESS_POOL.length) {
            this.POINTER = 0;
        }
    },

    GetPort: function(portName) {
        if(portName in this.PORTS) {
            return this.PORTS[portName];
        }
        else {
            throw `[运行时错误] 不存在的端口`;
        }
    },

    NewPort: function(portName) {
        if(portName[0] !== Common.PORT_PREFIX) {
            throw `[运行时错误] 端口名称不合法（应该以“${Common.PORT_PREFIX}”为前缀）`;
        }
        else {
            // 新端口
        }
    },
}

module.exports.Runtime = Runtime;
