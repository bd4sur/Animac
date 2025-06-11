
// nativelib/File.js
// File本地库

const fs = require('fs');
const path = require('path');

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

// (File.read filePath:String callback:(s:String->undefined)) : undefined
function read(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }

    PROCESS.Step(); // 立刻退出，执行下一指令

    fs.readFile(filePath, {encoding:"utf-8"}, (error, data)=> {
        if(error) {
            PROCESS.OPSTACK.push("#f"); // TODO native函数的错误处理仍需细化
        }
        else {
            // 构造字符串对象
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: String(data)
            };
            PROCESS.heap.Set(strHandle, strObject);
            PROCESS.OPSTACK.push(strHandle);
        }

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
    });
}

// (File.readSync filePath:String) : String
function readSync(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }
    let data = fs.readFileSync(filePath, {encoding:"utf-8"}).toString();
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: data
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (File.writeString filePath:String strdata:String flag:String callback:(err->Boolean)) : undefined
function writeString(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();

    let flagHandle = PROCESS.PopOperand();
    let flag = TrimQuotes(PROCESS.heap.Get(flagHandle).content) || "w";

    let strdataHandle = PROCESS.PopOperand();
    let strdata = TrimQuotes(PROCESS.heap.Get(strdataHandle).content);

    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }

    PROCESS.Step(); // 立刻退出，执行下一指令

    fs.writeFile(filePath, strdata, {encoding:"utf-8", flag: flag}, (error)=> {
        if(error) {
            PROCESS.OPSTACK.push("#f"); // TODO native函数的错误处理仍需细化
        }
        else {
            PROCESS.OPSTACK.push("#t");
        }

        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            PROCESS.PC = 0; // TODO 此处可优化 NOTE 使得回调函数栈帧的返回地址是地址为1的指令，即halt指令
            RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock(RUNTIME.asyncCallback);
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);
        }
    });
}

// (File.writeStringSync filePath:String strdata:String flag:String) : undefined
function writeStringSync(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let flagHandle = PROCESS.PopOperand();
    let flag = TrimQuotes(PROCESS.heap.Get(flagHandle).content) || "w";

    let strdataHandle = PROCESS.PopOperand();
    let strdata = TrimQuotes(PROCESS.heap.Get(strdataHandle).content);

    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }
    fs.writeFileSync(filePath, strdata, {encoding:"utf-8", flag: flag});
    PROCESS.Step();
}

module.exports.read = read;
module.exports.readSync = readSync;
module.exports.writeString = writeString;
module.exports.writeStringSync = writeStringSync;
