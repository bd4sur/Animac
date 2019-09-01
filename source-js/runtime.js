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

    this.PROCESSES = new Object();

    this.PROCESS_QUEUE = new Array();

    this.PORTS = new Object();
};

Runtime.prototype = {
    // 运行时初始化
    Init: function() {
        // 定义系统级端口
        // 启动init进程
        // 加载系统配置 等等
    },

    // 将线程加入线程池
    AddProcess: function(process) {
        // 检查是否已存在此线程
        if(!(process.PID in this.PROCESSES)) {
            this.PROCESSES[process.PID] = process;
        }
        this.PROCESS_QUEUE.push(process.PID); // 加入队尾

        // this.PROCESS_POOL.push(process);
        // this.PROCESS_POOL_SIZE++;
    },

    // 此函数用于启动执行时钟
    // 典型应用场景为程序冷启动，以及异步IO调用的回调函数中恢复睡眠线程执行
    // 参数：结束条件
    StartClock: function(stopCondition) {
        // 假装有调度器
        while(1) {
            let rtState = this.Tick();
            if(stopCondition) {
                // console.info(`VM实例执行结束。`);
                break;
            }
            if(rtState === "VM_TERMINATED") {
                // console.info(`所有进程执行结束。`);
                break;
            }
        }
    },

    Tick: function() {
        // 取出队头线程
        let currentPID = this.PROCESS_QUEUE.shift();
        let currentProcess = this.PROCESSES[currentPID];

        Executor.Executor(currentProcess, this);

        if(currentProcess.STATE === Common.PROCESS_STATE.SLEEPING) {
            // 将睡眠的进程移入等待区，睡眠结束调用回调时，将其重新加入队列，并启动时钟
            // this.WAITING.push(currentProcess);
        }
        else if(currentProcess.STATE !== Common.PROCESS_STATE.DEAD && currentProcess.STATE !== Common.PROCESS_STATE.SLEEPING) {
            // 仍在运行的进程加入队尾
            this.PROCESS_QUEUE.push(currentPID);
        }

        if(this.PROCESS_QUEUE.length <= 0) {
            return "VM_TERMINATED";
        }
        else {
            return "VM_RUNNING";
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
