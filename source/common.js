// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// js
// 全局公用模块
// 包含数据结构定义及其构造函数、工具函数等

Array.prototype.top = function() { return this[this.length - 1]; }

// 关键字集合
const KEYWORDS = {
    "car": true,
    "cdr": true,
    "cons": true,
    "cond": true,
    "if": true,
    "else": true,
    "begin": true,
    "+": true,
    "-": true,
    "*": true,
    "/": true,
    "=": true,
    "and": true,
    "or": true,
    "not": true,
    ">": true,
    "<": true,
    ">=": true,
    "<=": true,
    "eq?": true,
    "define": true,
    "set!": true,
    "null?": true,
    "display": true,
    "call/cc": true,
    // TODO 待完善
};

// 语法节点类型枚举
const NODE_TYPE = {
    "SLIST": "SLIST",
    "LAMBDA": "LAMBDA",
}

// 语法节点类
const Node = function (type, index, parentIndex, body, isQuoted) {
    this.type = type;
    this.index = index;
    this.parentIndex = parentIndex;
    this.children = new Array();
    this.isQuoted = isQuoted;
    // 仅LAMBDA节点有这些项
    this.parameters = new Array();
    this.body = body || null; // 未来改成数组，以支持隐式(begin ...)
    return this;
}

// AST节点定义（构造器）
const SList = function(isQuote, index, parentIndex) {
    return new Node(NODE_TYPE.SLIST, index, parentIndex, null, isQuote);
}
const Lambda = function(isQuote, index, parentIndex) {
    return new Node(NODE_TYPE.LAMBDA, index, parentIndex, null, isQuote);
}

// AST类
const AST = function () {
    return this;
}

// 对象类型枚举
const OBJECT_TYPE = {
    "STRING": "STRING",
    "SLIST": "SLIST",
    "SYMBOL": "SYMBOL",
    "VARIABLE": "VARIABLE",
    "CONSTANT": "CONSTANT",
    "CLOSURE": "CLOSURE",
    "CONTINUATION": "CONTINUATION",

    "REF_STRING": "REF_STRING",
    "REF_SLIST": "REF_SLIST",
    "REF_SYMBOL": "REF_SYMBOL",
    "REF_VARIABLE": "REF_VARIABLE",
    "REF_CONSTANT": "REF_CONSTANT",
    "REF_CLOSURE": "REF_CLOSURE",
    "REF_CONTINUATION": "REF_CONTINUATION",

    // 关键字
    "KEYWORD": "KEYWORD",

    // CONSTANT的子类型
    "BOOLEAN": "BOOLEAN",
    "NUMBER": "NUMBER",

    // SLIST的子类型（没有用）
    "LAMBDA": "LAMBDA",
    "QUOTED_SLIST": "QUOTED_SLIST",
};

// 引用前缀
const REF_PREFIX = {
    "REF_STRING":   "*",
    "REF_SLIST":    "$",
    "REF_SYMBOL":   "!",
    "REF_VARIABLE": "&",
    "REF_CONSTANT": "#",
    "REF_CLOSURE":  "^",
    "REF_CONTINUATION":  "~",
};

const getRefIndex = function(ref) {
    if(ref === undefined) return undefined;
    return parseInt(ref.substring(1));
};
const getRefType = function(ref) {
    if(ref === undefined) return undefined;
    if(ref[0] === REF_PREFIX.REF_STRING) {
        return OBJECT_TYPE.REF_STRING;
    }
    else if(ref[0] === REF_PREFIX.REF_SLIST) {
        return OBJECT_TYPE.REF_SLIST;
    }
    else if(ref[0] === REF_PREFIX.REF_SYMBOL) {
        return OBJECT_TYPE.REF_SYMBOL;
    }
    else if(ref[0] === REF_PREFIX.REF_VARIABLE) {
        return OBJECT_TYPE.REF_VARIABLE;
    }
    else if(ref[0] === REF_PREFIX.REF_CONSTANT) {
        return OBJECT_TYPE.REF_CONSTANT;
    }
    else if(ref[0] === REF_PREFIX.REF_CLOSURE) {
        return OBJECT_TYPE.REF_CLOSURE;
    }
    else if(ref[0] === REF_PREFIX.REF_CONTINUATION) {
        return OBJECT_TYPE.REF_CONTINUATION;
    }
    else {
        return null;
    }
};

const makeRef = function(type, index) {
    if(index === undefined) return undefined;
    return `${REF_PREFIX["REF_"+type]}${parseInt(index)}`;
}

// 获取符号类型
const TypeOfToken = function(token) {
    let refType = getRefType(token);
    if(refType) {
        return refType;
    }
    else {
        if(typeof token === 'string') {
            if(token[0] === '\'') {
                return OBJECT_TYPE.SYMBOL;
            }
            else if(token === '#t' || token === '#f') {
                return OBJECT_TYPE.BOOLEAN;
            }
            else if(/^\-?\d+(\.\d+)?$/gi.test(token)) {
                return OBJECT_TYPE.NUMBER;
            }
            else if(token[0] === '"' && token[token.length-1] === '"') {
                return OBJECT_TYPE.STRING;
            }
            else if(token in KEYWORDS){
                return OBJECT_TYPE.KEYWORD;
            }
            else {
                return OBJECT_TYPE.VARIABLE;
            }
        }
    }
};

// Resource类
const Resource = function () {
    this.variables = new Array();
    this.symbols = new Array();
    this.strings = new Array();
    this.slists = new Array();
    this.constants = new Array();

    this.refIndexes = new Object();
    this.refIndexes[REF_PREFIX.REF_STRING] = 0;
    this.refIndexes[REF_PREFIX.REF_SLIST] = 0;
    this.refIndexes[REF_PREFIX.REF_SYMBOL] = 0;
    this.refIndexes[REF_PREFIX.REF_VARIABLE] = 0;
    this.refIndexes[REF_PREFIX.REF_CONSTANT] = 0;
    this.refIndexes[REF_PREFIX.REF_CLOSURE] = 0;

    return this;
}
Resource.prototype = {
    GetObject: function(ref) {
        // TODO 输入检查
        let prefix = ref[0];
        let index = parseInt(ref.substring(1));
        if(prefix === REF_PREFIX.REF_STRING) {
            return this.strings[index];
        }
        else if(prefix === REF_PREFIX.REF_SLIST) {
            return this.slists[index];
        }
        else if(prefix === REF_PREFIX.REF_SYMBOL) {
            return this.symbols[index];
        }
        else if(prefix === REF_PREFIX.REF_VARIABLE) {
            return this.variables[index];
        }
        else if(prefix === REF_PREFIX.REF_CONSTANT) {
            return this.constants[index];
        }
        else {
            return ref;
            // throw `ref error`;
        }
    },
    NewObject: function(type, value) {
        // TODO 参数检查
        let index = this.refIndexes[REF_PREFIX[`REF_${type}`]];
        if(type === OBJECT_TYPE.STRING) {
            this.strings[index] = value;
        }
        else if(type === OBJECT_TYPE.SLIST) {
            this.slists[index] = value;
        }
        else if(type === OBJECT_TYPE.SYMBOL) {
            this.symbols[index] = value;
        }
        else if(type === OBJECT_TYPE.VARIABLE) {
            this.variables[index] = value;
        }
        else if(type === OBJECT_TYPE.CONSTANT) {
            this.constants[index] = value;
        }
        else {
            throw `type error`;
        }
        this.refIndexes[REF_PREFIX[`REF_${type}`]]++;
        return makeRef(type, index);
    },
};


// 模块类
const Module = function() {
    return this;
};

// 线程类
const Thread = function() {
    return this;
};


module.exports.KEYWORDS = KEYWORDS;
module.exports.NODE_TYPE = NODE_TYPE;
module.exports.Node = Node;
module.exports.SList = SList;
module.exports.Lambda = Lambda;
module.exports.AST = AST;
module.exports.OBJECT_TYPE = OBJECT_TYPE;
module.exports.REF_PREFIX = REF_PREFIX;
module.exports.getRefIndex = getRefIndex;
module.exports.getRefType = getRefType;
module.exports.makeRef = makeRef;
module.exports.TypeOfToken = TypeOfToken;
module.exports.Resource = Resource;
module.exports.Module = Module;
module.exports.Thread = Thread;

