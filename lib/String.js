const _ANIMAC_NATIVE_UTILS = require('./_utils.js');

// (String.length str:String) : Number
function length(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(strHandle).content);
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
    let str2 = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(str2Handle).content);
    let str1Handle = PROCESS.PopOperand();
    let str1 = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(str1Handle).content);
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
    let str = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(strHandle).content);
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

// (String.slice str:String start:Number end:Number) : String
function slice(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let end = Number(PROCESS.PopOperand());
    let start = Number(PROCESS.PopOperand());
    let strHandle = PROCESS.PopOperand();
    let str = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(strHandle).content);
    // 构造字符串对象
    let newStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let newStrObject = {
        type: "STRING",
        content: String(str.slice(start, end))
    };
    PROCESS.heap.Set(newStrHandle, newStrObject);
    PROCESS.OPSTACK.push(newStrHandle);
    PROCESS.Step();
}

// (String.equals str1:String str2:String) : Boolean
function equals(PROCESS, RUNTIME) {
    let str2Handle = PROCESS.PopOperand();
    let str2 = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(str2Handle).content);
    let str1Handle = PROCESS.PopOperand();
    let str1 = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(str1Handle).content);

    PROCESS.OPSTACK.push((String(str1) === String(str2)) ? "#t" : "#f");
    PROCESS.Step();
}

// (String.charAt str:String index:Number) : String
function charAt(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let index = Number(PROCESS.PopOperand());
    let strHandle = PROCESS.PopOperand();
    let str = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(strHandle).content);

    // 构造字符串对象
    let newStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let newStrObject = {
        type: "STRING",
        content: (index < 0 || index >= str.length) ? "" : String(str[index])
    };
    PROCESS.heap.Set(newStrHandle, newStrObject);
    PROCESS.OPSTACK.push(newStrHandle);
    PROCESS.Step();
}

// (String.parseNumber x:String) : Number|#undefined
function parseNumber(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = _ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(strHandle).content);
    let num = Number(str);
    PROCESS.OPSTACK.push(isNaN(num) ? "#undefined" : num);
    PROCESS.Step();
}

module.exports.length = length;
module.exports.atom_to_string = atom_to_string;
module.exports.concat = concat;
module.exports.charCodeAt = charCodeAt;
module.exports.fromCharCode = fromCharCode;
module.exports.slice = slice;
module.exports.equals = equals;
module.exports.charAt = charAt;
module.exports.parseNumber = parseNumber;
