
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

// (String.length str:String) : Number
function length(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);

    PROCESS.OPSTACK.push(Number(str.length));

    PROCESS.Step();
    RUNTIME.AIL_RETURN(null, PROCESS, RUNTIME);

    // 进程重新加入进程队列，并重启时钟
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(RUNTIME.asyncCallback);
}

// (String.charCodeAt index:Number str:String) : Number
function charCodeAt(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    let index = Number(PROCESS.PopOperand());

    PROCESS.OPSTACK.push(Number(str.charCodeAt(index)));

    PROCESS.Step();
    RUNTIME.AIL_RETURN(null, PROCESS, RUNTIME);

    // 进程重新加入进程队列，并重启时钟
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(RUNTIME.asyncCallback);
}

// (String.fromCharCode charcode:Number) : String
function fromCharCode(PROCESS, RUNTIME) {
    let charcode = PROCESS.PopOperand();

    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: String.fromCharCode(Number(charcode))
    };
    PROCESS.heap.Set(strHandle, strObject);

    PROCESS.OPSTACK.push(strHandle);

    PROCESS.Step();
    RUNTIME.AIL_RETURN(null, PROCESS, RUNTIME);

    // 进程重新加入进程队列，并重启时钟
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(RUNTIME.asyncCallback);
}

module.exports.length = length;
module.exports.charCodeAt = charCodeAt;
module.exports.fromCharCode = fromCharCode;