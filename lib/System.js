
function TrimQuotes(str) {
    if(str[0] === '"' && str[str.length-1] === '"') {
        return str.substring(1, str.length-1);
    }
    else {
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

module.exports.exec = exec;
