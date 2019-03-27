// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// nativelib/Math.js
// 数学函数本地库

const Common = require('../common.js');

const sin = function(avmArgs, avmProcess, avmRuntime) {
    let arg0RtObj = avmProcess.GetObject(avmArgs[0]);
    if(arg0RtObj.type !== 'CONSTANT') {
        throw '[Native:Math.sin] 参数类型不正确。';
    }

    let arg0 = parseFloat(arg0RtObj.value);
    avmProcess.OPSTACK.push(Math.sin(arg0));

    avmProcess.PC++;
}

const dot = function(avmArgs, avmProcess, avmRuntime) {
    let vector1obj = avmProcess.GetObject(avmArgs[0]);
    let vector2obj = avmProcess.GetObject(avmArgs[1]);
    if(vector1obj.type !== 'SLIST' || vector2obj.type !== 'SLIST') {
        throw '[Native:Math.dot] 参数类型不正确。';
    }

    let vector1 = vector1obj.value;
    let vector2 = vector2obj.value;
    if(vector1.children.length !== vector2.children.length) {
        throw `[Native:Math.dot] 参与点乘的向量长度须相等。`;
    }

    let res = 0;

    for(let i = 0; i < vector1.children.length; i++) {
        let a = avmProcess.GetObject((vector1.children)[i]).value;
        let b = avmProcess.GetObject((vector2.children)[i]).value;
        if(Common.TypeOfToken(a) === 'NUMBER' && Common.TypeOfToken(b) === 'NUMBER') {
            res += parseFloat(a) * parseFloat(b);
        }
        else {
            throw `[Native:Math.dot] 参与点乘的向量的元素必须全为数字。`
        }
    }
    avmProcess.OPSTACK.push(res);

    avmProcess.PC++;
};

const scale = function(avmArgs, avmProcess, avmRuntime) {
    let factorObj = avmProcess.GetObject(avmArgs[0]);
    let vectorobj = avmProcess.GetObject(avmArgs[1]);
    if(factorObj.type !== 'CONSTANT' || vectorobj.type !== 'SLIST') {
        throw '[Native:Math.scale] 参数类型不正确。';
    }

    let factor = parseFloat(factorObj.value);
    let vector = vectorobj.value;

    let newlist = {
        "type": "SLIST",
        "index": null, // 待定
        "parentIndex": vector.index,
        "children": null,
        "isQuoted": true,
        "parameters": null,
        "body": null,
    };

    newlist.children = new Array();

    for(let i = 0; i < vector.children.length; i++) {
        let a = avmProcess.GetObject((vector.children)[i]).value;
        if(Common.TypeOfToken(a) === 'NUMBER') {
            (newlist.children)[i] = (parseFloat(a) * factor).toString();
        }
        else {
            throw `[Native:Math.scale] 向量的元素必须全为数字。`
        }
    }

    let newref = avmProcess.NewObject('SLIST', newlist);
    newlist.index = parseInt(Common.getRefIndex(newref));

    avmProcess.OPSTACK.push(newref);

    avmProcess.PC++;
};

const PI = function(avmArgs, avmProcess, avmRuntime) {
    avmProcess.OPSTACK.push(Math.PI);
    avmProcess.PC++;
};

module.exports.sin = sin;
module.exports.dot = dot;
module.exports.scale = scale;
module.exports.PI = PI;
