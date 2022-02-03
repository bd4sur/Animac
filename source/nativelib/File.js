
// nativelib/File.js
// File本地库

function TrimQuotes(str) {
    if(str[0] === '"' && str[str.length-1] === '"') {
        return str.substring(1, str.length-1);
    }
    else {
        return str;
    }
}

const fs = require('fs');

function Read(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(`开始阻塞(file)`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let pathHandle = PROCESS.PopOperand();
        let path = TrimQuotes(PROCESS.heap.Get(pathHandle).content);

        fs.readFile(path, {encoding:"utf-8"}, (error, data)=> {
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
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: data.toString()
            };
            PROCESS.heap.Set(strHandle, strObject);

            PROCESS.OPSTACK.push(strHandle);

            PROCESS.Step();
            RUNTIME.AIL_RETURN(null, PROCESS, RUNTIME);

            // NOTE 取消异步回调设计。所有涉及阻塞的操作均设计成同步的。
            // let currentPC = PROCESS.PC;
            // RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);

            // 进程重新加入进程队列，并重启时钟
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        });
    }
}

function WriteString(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(`开始阻塞(file)`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let flagHandle = PROCESS.PopOperand();
        let flag = TrimQuotes(PROCESS.heap.Get(flagHandle).content) || "w";

        let strdataHandle = PROCESS.PopOperand();
        let strdata = TrimQuotes(PROCESS.heap.Get(strdataHandle).content);

        let pathHandle = PROCESS.PopOperand();
        let path = TrimQuotes(PROCESS.heap.Get(pathHandle).content);

        fs.writeFile(path, strdata, {encoding:"utf-8", flag: flag}, (error)=> {
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
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: JSON.stringify(error)
            };
            PROCESS.heap.Set(strHandle, strObject);

            PROCESS.OPSTACK.push(strHandle);

            PROCESS.Step();
            RUNTIME.AIL_RETURN(null, PROCESS, RUNTIME);

            // NOTE 取消异步回调设计。所有涉及阻塞的操作均设计成同步的。
            // let currentPC = PROCESS.PC;
            // RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);

            // 进程重新加入进程队列，并重启时钟
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        });
    }
}

module.exports.Read = Read;
module.exports.WriteString = WriteString;
