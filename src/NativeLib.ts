ANIMAC_VFS["/lib/System.js"] = `
// (System.set_timeout time_ms:Number callback:(void->undefined)) : Number(计时器编号)
function set_timeout(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let time_ms = PROCESS.PopOperand();

    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

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

    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

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

module.exports.set_timeout = set_timeout;
module.exports.set_interval = set_interval;
module.exports.clear_timeout = clear_timeout;
module.exports.clear_interval = clear_interval;
`;

ANIMAC_VFS["/lib/Math.js"] = `
// (Math.PI) : Number
function PI(PROCESS, RUNTIME) {
    PROCESS.OPSTACK.push(Number(Math.PI));
    PROCESS.Step();
}

// (Math.exp x:Number) : Number
function exp(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.exp(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log x:Number) : Number
function log(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log10 x:Number) : Number
function log10(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log10(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log2 x:Number) : Number
function log2(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log2(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.sin x:Number) : Number
function sin(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.sin(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.cos x:Number) : Number
function cos(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.cos(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.tan x:Number) : Number
function tan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.tan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.atan x:Number) : Number
function atan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.atan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.floor x:Number) : Number
function floor(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.floor(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.ceil x:Number) : Number
function ceil(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.ceil(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.round x:Number) : Number
function round(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.round(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.abs x:Number) : Number
function abs(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.abs(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.random) : Number
function random(PROCESS, RUNTIME) {
    let res = Math.random();
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

module.exports.PI = PI;
module.exports.exp = exp;
module.exports.log = log;
module.exports.log10 = log10;
module.exports.log2 = log2;
module.exports.sin = sin;
module.exports.cos = cos;
module.exports.tan = tan;
module.exports.atan = atan;
module.exports.floor = floor;
module.exports.ceil = ceil;
module.exports.round = round;
module.exports.abs = abs;
module.exports.random = random;
`;

ANIMAC_VFS["/lib/String.js"] = `
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
    }
    str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t');
    return str;
}

// (String.length str:String) : Number
function length(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    PROCESS.OPSTACK.push(Number(str.length));
    PROCESS.Step();
}

// (String.atom_to_string x:Boolean|Number|Symbol) : String
function atom_to_string(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: String(x)
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (String.concat str1:String str2:String) : String
function concat(PROCESS, RUNTIME) {
    let str2Handle = PROCESS.PopOperand();
    let str2 = TrimQuotes(PROCESS.heap.Get(str2Handle).content);
    let str1Handle = PROCESS.PopOperand();
    let str1 = TrimQuotes(PROCESS.heap.Get(str1Handle).content);
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: str1.concat(str2)
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (String.charCodeAt index:Number str:String) : Number
function charCodeAt(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    let index = Number(PROCESS.PopOperand());
    PROCESS.OPSTACK.push(Number(str.charCodeAt(index)));
    PROCESS.Step();
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
}

module.exports.length = length;
module.exports.atom_to_string = atom_to_string;
module.exports.concat = concat;
module.exports.charCodeAt = charCodeAt;
module.exports.fromCharCode = fromCharCode;
`;
