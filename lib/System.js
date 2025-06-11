
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
    else {
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
}

const child_process = require('child_process');

function exec(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(`开始阻塞(System)`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let cmdStrHandle = PROCESS.PopOperand();
        let cmdStr = TrimQuotes(PROCESS.heap.Get(cmdStrHandle).content);

        child_process.exec(cmdStr, {encoding: "UTF-8"}, (error, stdout, stderr)=> {
            if(error) {
                console.error(error);
                // console.warn(`进程 ${PROCESS.PID} 恢复。`);
                PROCESS.SetState("RUNNING");
                PROCESS.Step();
                return;
            }
            // 恢复进程状态
            // /console.warn(`进程 ${PROCESS.PID} 恢复。`);
            PROCESS.SetState("RUNNING");

            // 首先构造字符串对象
            // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
            let stdoutStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let stdoutStrObject = {
                type: "STRING",
                content: stdout.toString()
            };
            PROCESS.heap.Set(stdoutStrHandle, stdoutStrObject);

            PROCESS.OPSTACK.push(stdoutStrHandle);

            PROCESS.Step();

            // NOTE 取消异步回调设计。所有涉及阻塞的操作均设计成同步的。
            // let currentPC = PROCESS.PC;
            // RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);

            // 进程重新加入进程队列，并重启时钟
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        });
    }
}

// (System.set_timeout time_ms:Number callback:(void->undefined)) : Number(计时器编号)
function set_timeout(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let time_ms = PROCESS.PopOperand();

    let timer = setTimeout(() => {
        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            // NOTE 返回到地址为1的指令，即halt指令
            RUNTIME.CallAsync(1, callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            // 返回到中断发生时的PC
            RUNTIME.CallAsync(PROCESS.PC, callback, PROCESS, RUNTIME);
        }
    }, time_ms);

    PROCESS.OPSTACK.push(Number(timer));
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.set_interval time_ms:Number callback:(void->undefined)) : Number(计时器编号)
function set_interval(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let time_ms = PROCESS.PopOperand();

    let timer = setInterval(() => {
        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            // NOTE 返回到地址为1的指令，即halt指令
            RUNTIME.CallAsync(1, callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            // 返回到中断发生时的PC
            RUNTIME.CallAsync(PROCESS.PC, callback, PROCESS, RUNTIME);
        }
    }, time_ms);

    PROCESS.OPSTACK.push(Number(timer));
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.clear_timeout timer:Number) : void
function clear_timeout(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let timer = PROCESS.PopOperand();
    clearTimeout(timer);
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.clear_interval timer:Number) : void
function clear_interval(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let timer = PROCESS.PopOperand();
    clearInterval(timer);
    PROCESS.Step(); // 退出，执行下一指令
}

module.exports.exec = exec;
module.exports.set_timeout = set_timeout;
module.exports.set_interval = set_interval;
module.exports.clear_timeout = clear_timeout;
module.exports.clear_interval = clear_interval;
