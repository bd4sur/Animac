// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// js
// 全局公用模块
// 包含数据结构定义及其构造函数、工具函数等

Array.prototype.top = function() { return this[this.length - 1]; }

// 全局参数（TODO 系统初始化的配置，每个参数的生命周期可能不一样。这块需要进一步优化）
let SYSTEM_CONFIGURATION = {
    SOURCE_PATH: './testcase',
};

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
    "import": true,
    "native": true,
    "fork": true,
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

    "PORT": "PORT",

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

// 端口前缀
const PORT_PREFIX = ':';

const getRefIndex = function(ref) {
    if(ref === undefined) return undefined;
    return ref.substring(1);
};
const getRefType = function(ref) {
    if(!ref) return undefined;
    if(ref[0] === REF_PREFIX['STRING']) {
        return "STRING";
    }
    else if(ref[0] === REF_PREFIX['SLIST']) {
        return "SLIST";
    }
    else if(ref[0] === REF_PREFIX['SYMBOL']) {
        return "SYMBOL";
    }
    else if(ref[0] === REF_PREFIX['VARIABLE']) {
        return "VARIABLE";
    }
    else if(ref[0] === REF_PREFIX['CONSTANT']) {
        return "CONSTANT";
    }
    else if(ref[0] === REF_PREFIX['CLOSURE']) {
        return "CLOSURE";
    }
    else if(ref[0] === REF_PREFIX['CONTINUATION']) {
        return "CONTINUATION";
    }
    else if(ref[0] === REF_PREFIX['PORT']) {
        return "PORT";
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
    else if(token[0] === PORT_PREFIX) {
        return OBJECT_TYPE.PORT;
    }
    else if(token === '#t' || token === '#f') {
        return OBJECT_TYPE.BOOLEAN;
    }
    else if(getRefType(token)) {
        return `REF_${getRefType(token)}`;
    }
    else if(token[0] === '\'') {
        return OBJECT_TYPE.SYMBOL;
    }
    else if(token[0] === '@') {
        return OBJECT_TYPE.LABEL;
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
};

// AST类
const AST = function () {
    this.variables = new Array();
    this.symbols = new Array();
    this.strings = new Array();
    this.slists = new Array();
    this.constants = new Array();

    this.dependencies = new Object(); // 存储import指定的别名和模块路径之间的映射，供模块加载器使用
    this.aliases = new Object();      // 存储import指定的别名和模块全限定名之间的映射，供模块加载器使用

    this.natives = new Object();  // 存储native模块名，供编译器识别native函数

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
        // 避免*乘号等关键字与ref混淆
        if(ref in KEYWORDS) {
            return ref;
        }
        else if(prefix === REF_PREFIX['STRING']) {
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
const Module = function(qualifiedName, modulePath) {
    this.qualifiedName = qualifiedName; // :string
    this.modulePath = modulePath; // :string
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
    'READY'       : 0,  // 就绪，等待调度
    'RUNNING'     : 1,  // 运行
    'SLEEPING'    : 2,  // 睡眠（可中断）
    'DEEPSLEEPING': 3,  // 深度睡眠（不可中断）
    'SUSPENDED'   : 4,  // 挂起
    'DEAD'        : 5,  // 销毁
};

// 去掉生字符串两端的双引号
const trimQuotes = function(str) {
    if(str[0] === '"' && str[str.length-1] === '"') {
        return str.substring(1, str.length-1);
    }
    else {
        return str;
    }
};

// 端口
// 是对共享内存、文件系统、外设的抽象。
// 端口分为两种，其一是runtime定义的系统端口，用于模拟文件系统等。其二是用户端口，充当进程通信手段，例如（进程安全的）共享内存。
// 为简单起见，端口使用哈希表进行寻址。这意味着任何“:”开头的字符串（在不引起混淆的情况下，也称为“端口”）都可以用来寻址端口。
const Port = function() {
    this.semaphore = 0;          // 信号量。
    this.bufferSize = 0;         // 缓冲队列长度。
    this.buffer = new Array();   // 数据缓冲队列。注意，经端口传输的数据，必须是经编码（序列化）的**Scheme对象**。编码协议暂定为JSON字符串，细节另行设计。TODO 要考虑到代码和数据的一致性。
};

Port.prototype = {
    // 定义端口操作，包括端口新建和初始化、同步原语、队列读写等。
};

module.exports.SYSTEM_CONFIGURATION = SYSTEM_CONFIGURATION;
module.exports.KEYWORDS = KEYWORDS;
module.exports.NODE_TYPE = NODE_TYPE;
module.exports.Node = Node;
module.exports.SList = SList;
module.exports.Lambda = Lambda;
module.exports.AST = AST;
module.exports.OBJECT_TYPE = OBJECT_TYPE;
module.exports.REF_PREFIX = REF_PREFIX;
module.exports.PORT_PREFIX = PORT_PREFIX;
module.exports.getRefIndex = getRefIndex;
module.exports.getRefType = getRefType;
module.exports.makeRef = makeRef;
module.exports.TypeOfToken = TypeOfToken;
module.exports.Module = Module;
module.exports.PROCESS_STATE = PROCESS_STATE;
module.exports.trimQuotes = trimQuotes;
module.exports.Port = Port;

