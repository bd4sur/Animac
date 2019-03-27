// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// nativelib/String.js
// 字符串本地库

const Common = require('../common.js');

const length = function(avmArgs, avmProcess, avmRuntime) {
    let argRuntimeObj = avmProcess.GetObject(avmArgs[0]);
    if(argRuntimeObj.type !== 'STRING') {
        throw '[Native:String.length] 参数类型不正确。';
    }
    else {
        let argStr = argRuntimeObj.value;
        avmProcess.OPSTACK.push(argStr.length);
    }
    avmProcess.PC++;
}

const charAt = function(avmArgs, avmProcess, avmRuntime) {
    let argString = avmProcess.GetObject(avmArgs[0]);
    let argIndex = avmProcess.GetObject(avmArgs[1]);
    if(argString.type !== 'STRING' || argIndex.type !== 'CONSTANT') {
        throw '[Native:String.charAt] 参数类型不正确。';
    }
    else {
        let str = argString.value;
        let index = parseInt(argIndex.value);
        let charRef = avmProcess.NewObject('STRING', str.charAt(index));
        avmProcess.OPSTACK.push(charRef);
    }
    avmProcess.PC++;
}

const substring = function(avmArgs, avmProcess, avmRuntime) {
    let argString = avmProcess.GetObject(avmArgs[0]);
    let argStartIndex = avmProcess.GetObject(avmArgs[1]);
    let argStopIndex = avmProcess.GetObject(avmArgs[2]);
    if(argString.type !== 'STRING' || argStartIndex.type !== 'CONSTANT' || argStopIndex.type !== 'CONSTANT') {
        throw '[Native:String.substring] 参数类型不正确。';
    }
    else {
        let str = argString.value;
        let startIndex = parseInt(argStartIndex.value);
        let stopIndex = parseInt(argStopIndex.value);
        let charRef = avmProcess.NewObject('STRING', str.substring(startIndex, stopIndex));
        avmProcess.OPSTACK.push(charRef);
    }
    avmProcess.PC++;
}

module.exports.length = length;
module.exports.charAt = charAt;
module.exports.substring = substring;
