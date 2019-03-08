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
    "newline": true,
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

    // 标签
    "LABEL": "LABEL",
};

// 引用前缀
const REF_PREFIX = {
    "STRING":   "*",
    "SLIST":    "$",
    "SYMBOL":   "!",
    "VARIABLE": "&",
    "CONSTANT": "#",
    "CLOSURE":  "^",
    "CONTINUATION":  "~",
};

const getRefIndex = function(ref) {
    if(ref === undefined) return undefined;
    return ref.substring(1);
};
const getRefType = function(ref) {
    if(ref === undefined) return undefined;
    if(ref[0] === REF_PREFIX['STRING']) {
        return "REF_STRING";
    }
    else if(ref[0] === REF_PREFIX['SLIST']) {
        return "REF_SLIST";
    }
    else if(ref[0] === REF_PREFIX['SYMBOL']) {
        return "REF_SYMBOL";
    }
    else if(ref[0] === REF_PREFIX['VARIABLE']) {
        return "REF_VARIABLE";
    }
    else if(ref[0] === REF_PREFIX['CONSTANT']) {
        return "REF_CONSTANT";
    }
    else if(ref[0] === REF_PREFIX['CLOSURE']) {
        return "REF_CLOSURE";
    }
    else if(ref[0] === REF_PREFIX['CONTINUATION']) {
        return "REF_CONTINUATION";
    }
    else {
        return null;
    }
};

const makeRef = function(type, index) {
    if(index === undefined) return undefined;
    if(isNaN(index)) {
        return `${REF_PREFIX[type]}${index}`;
    }
    else {
        return `${REF_PREFIX[type]}${parseInt(index)}`;
    }
}

// 获取符号类型
const TypeOfToken = function(token) {
    if(token in KEYWORDS){
        return OBJECT_TYPE.KEYWORD;
    }
    let refType = getRefType(token);
    if(refType) {
        return refType;
    }
    else {
        if(typeof token === 'string') {
            if(token[0] === '\'') {
                return OBJECT_TYPE.SYMBOL;
            }
            else if(token[0] === '@') {
                return OBJECT_TYPE.LABEL;
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
            else {
                return OBJECT_TYPE.VARIABLE;
            }
        }
    }
};

// AST类
const AST = function () {
    this.variables = new Array();
    this.symbols = new Array();
    this.strings = new Array();
    this.slists = new Array();
    this.constants = new Array();

    this.refIndexes = new Object();
    this.refIndexes['STRING'] = 0;
    this.refIndexes['SLIST'] = 0;
    this.refIndexes['SYMBOL'] = 0;
    this.refIndexes['VARIABLE'] = 0;
    this.refIndexes['CONSTANT'] = 0;

    return this;
}
AST.prototype = {
    GetObject: function(ref) {
        // TODO 输入检查
        let prefix = ref[0];
        let index = getRefIndex(ref);
        if(prefix === REF_PREFIX['STRING']) {
            return this.strings[index];
        }
        else if(prefix === REF_PREFIX['SLIST']) {
            return this.slists[index];
        }
        else if(prefix === REF_PREFIX['SYMBOL']) {
            return this.symbols[index];
        }
        else if(prefix === REF_PREFIX['VARIABLE']) {
            return this.variables[index];
        }
        else if(prefix === REF_PREFIX['CONSTANT']) {
            return this.constants[index];
        }
        else {
            return ref;
            // throw `ref error`;
        }
    },
    NewObject: function(type, value) {
        // TODO 参数检查
        let index = this.refIndexes[type];
        if(type === "STRING") {
            this.strings[index] = value;
        }
        else if(type === "SLIST") {
            this.slists[index] = value;
        }
        else if(type === "SYMBOL") {
            this.symbols[index] = value;
        }
        else if(type === "VARIABLE") {
            this.variables[index] = value;
        }
        else if(type === "CONSTANT") {
            this.constants[index] = value;
        }
        else {
            throw `type error`;
        }
        this.refIndexes[type]++;
        return makeRef(type, index);
    },
};


// 模块类
const Module = function(qualifiedName) {
    this.qualifiedName = qualifiedName; // :string
    this.name = (qualifiedName.split(/\./gi)).top(); // :string
    this.AST = null; // :AST
    this.ASM = null; // :Array<Instruction>
    this.labelDict = new Object(); // :Map<label,instIndex>
    return this;
};
Module.prototype.setAST = function(ast) {
    this.AST = ast;
}
// 注意此函数会同时设置labelDict
Module.prototype.setASM = function(asmlines) {
    this.ASM = new Array();
    this.labelDict = new Object();
    for(let line of asmlines) {
        if(line.length <= 0) { continue; }
        else if(/^\s*\;[\s\S]*$/.test(line)) { this.ASM.push(line); }
        else { this.ASM.push(line.trim()); }
    }

    for(let i = 0; i < this.ASM.length; i++) {
        let line = this.ASM[i];
        if(line[0] === '@') { // 标签行
            if(line in this.labelDict) {
                throw `[汇编错误] 标签重复出现`;
            }
            this.labelDict[line] = i;
        }
    }
}


// 进程状态
const PROCESS_STATE = {
    'DEFAULT'     : -1, // 默认
    'RUNNING'     : 1,  // 运行
    'SLEEPING'    : 2,  // 睡眠（可中断）
    'DEEPSLEEPING': 3,  // 深度睡眠（不可中断）
    'SUSPENDED'   : 4,  // 挂起
    'DEAD'        : 5,  // 销毁
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
module.exports.Module = Module;
module.exports.PROCESS_STATE = PROCESS_STATE;

