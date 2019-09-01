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

const split = function(avmArgs, avmProcess, avmRuntime) {
    let argString = avmProcess.GetObject(avmArgs[0]);
    let argSeperator = avmProcess.GetObject(avmArgs[1]);

    if(argString.type !== 'STRING' || argSeperator.type !== 'STRING') {
        throw '[Native:String.split] 参数类型不正确。';
    }
    else {
        let str = argString.value;
        let septor = argSeperator.value;

        let segs = str.split(new RegExp(septor));
        let newlist = {
            "type": "SLIST",
            "index": null, // 待定
            "parentIndex": 0,
            "children": new Array(),
            "isQuoted": true,
            "parameters": null,
            "body": null,
        };
        for(let i = 0; i < segs.length; i++) {
            let segRef = avmProcess.NewObject('STRING', segs[i]);
            newlist.children.push(segRef);
        }

        let slistRef = avmProcess.NewObject('SLIST', newlist);
        newlist.index = parseInt(Common.getRefIndex(slistRef));

        avmProcess.OPSTACK.push(slistRef);
    }
    avmProcess.PC++;
}

const charCodeAt = function(avmArgs, avmProcess, avmRuntime) {
    let argObj1 = avmProcess.GetObject(avmArgs[0]);
    let argObj2 = avmProcess.GetObject(avmArgs[1]);
    if(argObj1.type !== 'CONSTANT' || argObj2.type !== 'STRING') {
        throw '[Native:String.charCodeAt] 参数类型不正确。';
    }
    else {
        let index = argObj1.value;
        let str = argObj2.value;
        avmProcess.OPSTACK.push(str.charCodeAt(index));
    }
    avmProcess.PC++;
}

const fromCharCode = function(avmArgs, avmProcess, avmRuntime) {
    let argObj1 = avmProcess.GetObject(avmArgs[0]);
    if(argObj1.type === 'SLIST') {
        let codeSList = argObj1.value.children;
        let codeArray = new Array();
        for(let i = 0; i < codeSList.length; i++) {
            codeArray[i] = avmProcess.GetObject(codeSList[i]).value;
        }
        let strRef = avmProcess.NewObject('STRING', String.fromCharCode.apply(null, codeArray));
        avmProcess.OPSTACK.push(strRef);
    }
    else if(argObj1.type === 'CONSTANT') {
        let code = argObj1.value;
        let strRef = avmProcess.NewObject('STRING', String.fromCharCode(code));
        avmProcess.OPSTACK.push(strRef);
    }
    else {
        throw '[Native:String.fromCharCode] 参数类型不正确。';
    }
    avmProcess.PC++;
}

module.exports.length = length;
module.exports.charAt = charAt;
module.exports.substring = substring;
module.exports.split = split;
module.exports.charCodeAt = charCodeAt;
module.exports.fromCharCode = fromCharCode;
