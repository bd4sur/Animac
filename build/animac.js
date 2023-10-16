// Utility.ts
// 工具函数
const fs = require("fs");
const path = require("path");
const ANIMAC_VERSION = "0.2.0";
const ANIMAC_HELP = `Animac Scheme Implementation V${ANIMAC_VERSION}
Copyright (c) 2019~2023 BD4SUR
https://github.com/bd4sur/Animac

Usage: node animac.js [option] <input> <output>

Options:
  (no option)       read and run Scheme code from file <input>.
                      if no <input> argument provided, start interactive REPL.
  -                 read and run Scheme code from stdin.
  -c, --compile     compile Scheme code file <input> to Animac VM executable file <output>.
                      will not execute the compiled executable.
                      default <output> is in the curent working directory.
  -d, --debug       activate built-in web IDE (debugger) server.
  -e, --eval        evaluate code string <input>
  -h, --help        print help and copyright information.
  -i, --intp        interpret Animac VM executable file <input>.
  -r, --repl        start interactive REPL (read-eval-print-loop).
  -v, --version     print Animac version number.`;
// 顶级词法节点、顶级作用域和顶级闭包的parent字段
//   用于判断上溯结束
const TOP_NODE_HANDLE = "&TOP_NODE";
// 关键字集合
const KEYWORDS = [
    "car", "cdr", "cons", "cond", "if", "else", "begin",
    "+", "-", "*", "/", "=", "%", "pow",
    "and", "or", "not", ">", "<", ">=", "<=", "eq?",
    "define", "set!", "null?", "atom?", "list?", "number?",
    "display", "newline",
    "write", "read",
    "call/cc",
    "import", "native",
    "fork",
    "quote", "quasiquote", "unquote",
];
// Primitive对应的AIL指令
const PrimitiveInstruction = {
    "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
    "=": "eqn", "<": "lt", ">": "gt", "<=": "le", ">=": "ge",
    "set!": "set"
};
// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}
// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if (str === undefined)
        return "";
    if (str[0] === '"' && str[str.length - 1] === '"') {
        str = str.substring(1, str.length - 1);
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
    else {
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
}
// 根据字面的格式，判断token类型
function TypeOfToken(token) {
    if (token === undefined || token === null) {
        return token;
    }
    else if (typeof token === "boolean") {
        return "BOOLEAN";
    }
    else if (typeof token === "number") {
        return "NUMBER";
    }
    else if (typeof token !== "string" || token === "lambda") {
        return undefined;
    }
    else if (KEYWORDS.indexOf(token) >= 0) {
        return "KEYWORD";
    }
    else if (token === '#t' || token === '#f') {
        return "BOOLEAN";
    }
    else if (isNaN(parseFloat(token)) === false) {
        return "NUMBER";
    }
    else if (token[0] === ':') {
        return "PORT";
    }
    else if (token[0] === '&') {
        return "HANDLE";
    }
    else if (token[0] === '\'') {
        return "SYMBOL";
    }
    else if (token[0] === '@') {
        return "LABEL";
    }
    else if (token[0] === '"' && token[token.length - 1] === '"') {
        return "STRING";
    }
    else {
        return "VARIABLE";
    }
}
// 判断token是不是变量
function isVariable(token) {
    return (TypeOfToken(token) === "VARIABLE");
}
// 路径处理
class PathUtils {
    static PathToModuleID(absolutePath) {
        return absolutePath.trim()
            .replace(/[\\\/]/gi, ".")
            .replace(/\s/gi, "_")
            .replace(/[\:]/gi, "")
            .replace(/\.scm$/gi, "");
    }
    // 判断是否是所在平台的绝对路径
    static IsAbsolutePath(p) {
        return path.isAbsolute(p);
    }
    // 在特定平台下，将多个路径按顺序拼接成合理的绝对路径
    static Join(p1, p2) {
        return path.join(p1, p2);
    }
    // 在特定平台下，返回某个路径的所在目录路径
    static DirName(p) {
        return path.dirname(p);
    }
    // 在特定平台下，返回某个路径的文件名部分
    static BaseName(p, suffix) {
        return path.basename(p, suffix);
    }
}
// 文件操作
class FileUtils {
    static ReadFileSync(p) {
        return fs.readFileSync(p, "utf-8");
    }
}
// Object.ts
// 数据对象定义
class SchemeObject {
    Copy() { }
}
var SchemeObjectType;
(function (SchemeObjectType) {
    SchemeObjectType["STRING"] = "STRING";
    // SYMBOL     = "SYMBOL",
    // NUMBER     = "NUMBER",
    // BOOLEAN    = "BOOLEAN",
    SchemeObjectType["LIST"] = "LIST";
    SchemeObjectType["LAMBDA"] = "LAMBDA";
    SchemeObjectType["APPLICATION"] = "APPLICATION";
    SchemeObjectType["QUOTE"] = "QUOTE";
    SchemeObjectType["QUASIQUOTE"] = "QUASIQUOTE";
    SchemeObjectType["UNQUOTE"] = "UNQUOTE";
    SchemeObjectType["CLOSURE"] = "CLOSURE";
    SchemeObjectType["CONTINUATION"] = "CONTINUATION";
})(SchemeObjectType || (SchemeObjectType = {}));
// 各种具体对象
// Application列表对象
class ApplicationObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.APPLICATION;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new ApplicationObject(this.parent);
        copy.type = SchemeObjectType.APPLICATION;
        copy.children = this.children.slice();
        return copy;
    }
}
// Quote列表对象
class QuoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new QuoteObject(this.parent);
        copy.type = SchemeObjectType.QUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Quasiquote列表对象
class QuasiquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUASIQUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new QuasiquoteObject(this.parent);
        copy.type = SchemeObjectType.QUASIQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Unquote列表对象
class UnquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.UNQUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new UnquoteObject(this.parent);
        copy.type = SchemeObjectType.UNQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Lambda列表对象
// [lambda, [param0, ... ], body0, ...]
class LambdaObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.LAMBDA;
        this.parent = parent;
        this.children = new Array();
        this.children[0] = "lambda";
        this.children[1] = new Array();
    }
    Copy() {
        let copy = new LambdaObject(this.parent);
        copy.type = SchemeObjectType.LAMBDA;
        copy.children = this.children.slice();
        return copy;
    }
    addParameter(param) {
        if (this.children[1].indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.children[1].push(param);
        }
    }
    addBody(body) {
        this.children.push(body);
    }
    getParameters() {
        return this.children[1];
    }
    getBodies() {
        return this.children.slice(2);
    }
    // 用于AST融合
    setBodies(bodies) {
        this.children = this.children.slice(0, 2).concat(bodies);
    }
}
// 字符串对象
class StringObject extends SchemeObject {
    constructor(str) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
    }
    Copy() {
        return new StringObject(this.content);
    }
}
// 闭包（运行时堆对象）
class Closure extends SchemeObject {
    constructor(instructionAddress, parent) {
        super();
        this.type = SchemeObjectType.CLOSURE;
        this.instructionAddress = instructionAddress;
        this.parent = parent;
        this.boundVariables = new HashMap();
        this.freeVariables = new HashMap();
        this.dirtyFlag = new HashMap();
    }
    Copy() {
        let copy = new Closure(this.instructionAddress, this.parent);
        copy.type = SchemeObjectType.CLOSURE;
        copy.boundVariables = this.boundVariables.Copy();
        copy.freeVariables = this.freeVariables.Copy();
        copy.dirtyFlag = this.dirtyFlag.Copy();
        return copy;
    }
    // 不加脏标记
    InitBoundVariable(variable, value) {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    SetBoundVariable(variable, value) {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    GetBoundVariable(variable) {
        return this.boundVariables[variable];
    }
    // 不加脏标记
    InitFreeVariable(variable, value) {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    SetFreeVariable(variable, value) {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    GetFreeVariable(variable) {
        return this.freeVariables[variable];
    }
    IsDirtyVariable(variable) {
        return this.dirtyFlag[variable];
    }
    HasBoundVariable(variable) {
        return this.boundVariables.has(variable);
    }
    HasFreeVariable(variable) {
        return this.freeVariables.has(variable);
    }
}
// 续延（运行时堆对象）
class Continuation extends SchemeObject {
    constructor(partialEnvironment, contReturnTargetLable) {
        super();
        this.type = SchemeObjectType.CONTINUATION;
        this.partialEnvironmentJson = JSON.stringify(partialEnvironment);
        this.contReturnTargetLable = contReturnTargetLable;
    }
    Copy() {
        let copy = new Continuation(null, null);
        copy.type = SchemeObjectType.CONTINUATION;
        copy.partialEnvironmentJson = this.partialEnvironmentJson;
        copy.contReturnTargetLable = this.contReturnTargetLable;
        return copy;
    }
}
// Memory.ts
// 内存管理
class HashMap extends Object {
    set(handle, value) {
        this[handle] = value;
    }
    get(handle) {
        return this[handle];
    }
    has(handle) {
        return (handle in this);
    }
    Copy() {
        let copy = new HashMap();
        for (let addr in this) {
            let value = this.get(addr);
            if (value === undefined)
                continue;
            if (value instanceof SchemeObject) {
                copy.set(addr, value.Copy());
            }
            else {
                let newValue = JSON.parse(JSON.stringify(value));
                copy.set(addr, newValue);
            }
        }
        return copy;
    }
}
// 基于HashMap的对象存储区，用于实现pool、heap等
class Memory {
    constructor() {
        this.data = new HashMap();
        this.metadata = new HashMap();
        this.handleCounter = 0;
    }
    // 生成元数据字符串
    MetaString(isStatic, isReadOnly, status) {
        let str = "";
        str += (isStatic) ? "S" : "_";
        str += (isReadOnly) ? "R" : "_";
        switch (status) {
            case "allocated":
                str += "A";
                break;
            case "modified":
                str += "M";
                break;
            case "free":
                str += "F";
                break;
            default:
                str += "_";
                break;
        }
        return str;
    }
    // 把柄存在性判断
    HasHandle(handle) {
        return this.data.has(handle);
    }
    // 新建任意把柄
    NewHandle(handle, isStatic) {
        isStatic = isStatic || false;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated"));
    }
    // 动态分配堆对象把柄
    AllocateHandle(typeTag, isStatic) {
        isStatic = isStatic || false;
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated"));
        this.handleCounter++;
        return handle;
    }
    // 动态回收堆对象把柄：删除堆中相应位置
    DeleteHandle(handle) {
        delete this.data[handle];
        delete this.metadata[handle];
        // this.data.set(handle, undefined);
        // this.metadata.set(handle, this.MetaString(false, false, "free"));
    }
    // 根据把柄获取对象
    Get(handle) {
        if (this.data.has(handle)) {
            return this.data.get(handle);
        }
        else {
            throw `[Memory.Get] 空把柄:${handle}`;
        }
    }
    // 设置把柄的对象值
    Set(handle, value) {
        let metadata = this.metadata.get(handle);
        if (this.data.has(handle) === false) {
            throw `[Error] 未分配的把柄:${handle}`;
        }
        else if (metadata[1] === "R") {
            throw `[Error] 不允许修改只读对象:${handle}`;
        }
        else if (metadata[0] === "S") {
            // console.warn(`[Warn] 修改了静态对象:${handle}`);
        }
        this.metadata.set(handle, this.MetaString((metadata[0] === "S"), false, "modified"));
        this.data.set(handle, value);
    }
    // 是否静态
    IsStatic(handle) {
        return ((this.metadata.get(handle))[0] === "S");
    }
    // 遍历
    // 注意：输入函数通过返回"break"来结束循环，通过返回其他任意值来中止一轮循环（continue）。
    ForEach(f) {
        for (let handle in this.data) {
            let ctrl = f(handle);
            if (ctrl === "break")
                break;
        }
    }
    // 深拷贝
    Copy() {
        let copy = new Memory();
        copy.data = this.data.Copy();
        copy.metadata = this.metadata.Copy();
        copy.handleCounter = this.handleCounter;
        return copy;
    }
}
// Lexer.ts
// 词法分析
// 词法分析：源码→Token序列
function Lexer(code) {
    // 转义恢复
    code = code.replace(/\&lt\;/gi, '<');
    code = code.replace(/\&gt\;/gi, '>');
    // 在末尾加一个换行
    code = [code, '\n'].join('');
    let tokens = new Array();
    let token_temp = new Array();
    for (let i = 0; i < code.length; i++) {
        // 跳过注释
        if (code[i] === ';') {
            while (code[i] !== '\n' && code[i] !== '\r') {
                i++;
            }
            continue;
        }
        // 括号等定界符
        else if (code[i - 1] !== '\\' &&
            (code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' ||
                code[i] === '{' || code[i] === '}' || code[i] === '\'' || code[i] === ',' || code[i] === '`' || code[i] === '"')) {
            if (token_temp.length > 0) {
                let new_token = token_temp.join('');
                tokens.push({
                    string: new_token,
                    index: i - new_token.length
                });
                token_temp = [];
            }
            if (code[i] === '"') {
                let string_lit = code.substring(i).match(/".*?(?<!\\)"/gi);
                if (string_lit !== null) {
                    tokens.push({
                        string: string_lit[0],
                        index: i
                    });
                    i = i + string_lit[0].length - 1;
                    continue;
                }
                else {
                    console.error('词法分析错误：字符串字面值未找到');
                    return;
                }
            }
            else {
                tokens.push({
                    string: code[i],
                    index: i
                });
            }
        }
        // 空格
        else if (code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r') {
            if (token_temp.length > 0) {
                let new_token = token_temp.join('');
                tokens.push({
                    string: new_token,
                    index: i - new_token.length
                });
                token_temp = [];
            }
        }
        // 其他字符
        else {
            token_temp.push(code[i]);
        }
    }
    // 处理begin的大括号
    let newTokens = new Array();
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].string === '{') {
            newTokens.push({
                string: '(',
                index: tokens[i].index
            });
            newTokens.push({
                string: 'begin',
                index: tokens[i].index + 1
            });
        }
        else if (tokens[i].string === '}') {
            newTokens.push({
                string: ')',
                index: tokens[i].index
            });
        }
        else {
            newTokens.push(tokens[i]);
        }
    }
    // 处理quote、quasiquote和unquote
    /*let newTokens2: Array<Token> = new Array();
    let skipMark = "0(SKIP)0";
    for(let i = 0; i < newTokens.length; i++) {
        if(newTokens[i].string === skipMark) {
            continue;
        }
        if(newTokens[i].string === '(' && (
            newTokens[i+1].string === 'quote' ||
            newTokens[i+1].string === 'unquote' ||
            newTokens[i+1].string === 'quasiquote')) {
            // 去掉(*quote对应的括号
            let bracketCount = 0
            for(let j = i+1; j < newTokens.length; j++) {
                if(newTokens[j].string === '(') { bracketCount++; }
                else if(newTokens[j].string === ')') {
                    if(bracketCount === 0) { newTokens[j].string = skipMark; break;}
                    else {bracketCount--; }
                }
            }
            if(newTokens[i+1].string === 'quote') {
                newTokens2.push({
                    string: '\'',
                    index: newTokens[i].index
                });
            }
            else if(newTokens[i+1].string === 'quasiquote') {
                newTokens2.push({
                    string: '`',
                    index: newTokens[i].index
                });
            }
            else if(newTokens[i+1].string === 'unquote') {
                newTokens2.push({
                    string: ',',
                    index: newTokens[i].index
                });
            }
            i++;
        }
        else {
            newTokens2.push(newTokens[i]);
        }
    }*/
    return newTokens;
}
// Parser.ts
// 语法分析：将代码解析成AST，但不加分析
var NodeType;
(function (NodeType) {
    NodeType["LAMBDA"] = "LAMBDA";
    NodeType["APPLICATION"] = "APPLICATION";
    NodeType["QUOTE"] = "QUOTE";
    NodeType["QUASIQUOTE"] = "QUASIQUOTE";
    NodeType["STRING"] = "STRING";
    NodeType["SYMBOL"] = "SYMBOL";
    NodeType["NUMBER"] = "NUMBER";
    NodeType["BOOLEAN"] = "BOOLEAN";
})(NodeType || (NodeType = {}));
class AST {
    constructor(source, absolutePath) {
        this.absolutePath = absolutePath;
        this.moduleID = PathUtils.PathToModuleID(absolutePath);
        this.source = source;
        this.nodes = new Memory();
        this.nodeIndexes = new HashMap();
        this.lambdaHandles = new Array();
        this.tailcall = new Array();
        this.variableMapping = new HashMap();
        this.topVariables = new HashMap();
        this.dependencies = new HashMap();
        this.natives = new HashMap();
    }
    // 深拷贝
    Copy() {
        let copy = new AST(this.source, this.absolutePath);
        copy.nodes = this.nodes.Copy();
        copy.nodeIndexes = this.nodeIndexes.Copy();
        copy.lambdaHandles = this.lambdaHandles.slice();
        copy.tailcall = this.tailcall.slice();
        copy.variableMapping = this.variableMapping.Copy();
        copy.topVariables = this.topVariables.Copy();
        copy.dependencies = this.dependencies.Copy();
        copy.natives = this.natives.Copy();
        return copy;
    }
    // 判断某变量是否使用了某Native模块（通过读取natives得知）
    IsNativeCall(variable) {
        let varPrefix = variable.split(".")[0];
        return this.natives.has(varPrefix);
    }
    // 取出某节点
    GetNode(handle) {
        return this.nodes.Get(handle);
    }
    // 创建一个Lambda节点，保存，并返回其把柄
    MakeLambdaNode(parentHandle) {
        // NOTE 每个节点把柄都带有模块ID，这样做的目的是：不必在AST融合过程中调整每个AST的把柄。下同。
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.LAMBDA`, true);
        let lambdaObject = new LambdaObject(parentHandle);
        this.nodes.Set(handle, lambdaObject);
        this.lambdaHandles.push(handle);
        return handle;
    }
    // 创建一个Application节点，保存，并返回其把柄
    MakeApplicationNode(parentHandle, quoteType) {
        let handle;
        let node;
        switch (quoteType) {
            case "QUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleID}.QUOTE`, true);
                node = new QuoteObject(parentHandle);
                break;
            case "QUASIQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleID}.QUASIQUOTE`, true);
                node = new QuasiquoteObject(parentHandle);
                break;
            case "UNQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleID}.UNQUOTE`, true);
                node = new UnquoteObject(parentHandle);
                break;
            default:
                handle = this.nodes.AllocateHandle(`${this.moduleID}.APPLICATION`, true);
                node = new ApplicationObject(parentHandle);
                break;
        }
        this.nodes.Set(handle, node);
        return handle;
    }
    // 创建一个字符串对象节点，保存，并返回其把柄
    MakeStringNode(str) {
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.STRING`, true);
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }
    //////////////////////////
    // 顶级节点操作
    //////////////////////////
    // 查找最顶级Application的把柄（用于尾调用起始位置、AST融合等场合）
    TopApplicationNodeHandle() {
        let TopHandle = null;
        this.nodes.ForEach((nodeHandle) => {
            if (this.nodes.Get(nodeHandle).parent === TOP_NODE_HANDLE) {
                TopHandle = nodeHandle;
                return "break";
            }
        });
        return TopHandle;
    }
    // 查找顶级Lambda（全局作用域）节点的把柄
    TopLambdaNodeHandle() {
        return this.nodes.Get(this.TopApplicationNodeHandle()).children[0];
    }
    // 获取位于全局作用域的节点列表
    GetGlobalNodes() {
        return this.nodes.Get(this.TopLambdaNodeHandle()).getBodies();
    }
    // 设置全局作用域的节点列表
    SetGlobalNodes(bodies) {
        this.nodes.Get(this.TopLambdaNodeHandle()).setBodies(bodies);
    }
    // 将某个节点转换回Scheme代码
    // TODO 对于Quote列表的输出效果可以优化
    NodeToString(nodeHandle) {
        let str = '';
        if (TypeOfToken(nodeHandle) === "VARIABLE") {
            if (this.variableMapping.has(nodeHandle)) {
                return this.variableMapping.get(nodeHandle);
            }
            else {
                return String(nodeHandle);
            }
        }
        else if (TypeOfToken(nodeHandle) === "SYMBOL") {
            return String(nodeHandle.substring(1));
        }
        else if (TypeOfToken(nodeHandle) !== "HANDLE") {
            return String(nodeHandle);
        }
        else {
            let node = this.GetNode(nodeHandle);
            let type = node.type;
            if (type === "STRING") {
                return node.content;
            }
            else if (type === "APPLICATION" || type === "QUOTE" || type === "QUASIQUOTE" || type === "UNQUOTE") {
                /*if(type === "QUOTE") str = "'(";
                else if(type === "QUASIQUOTE") str = "`(";
                else if(type === "UNQUOTE") str = ",(";
                else str = "(";*/
                if (node.children.length > 0) {
                    str = "(";
                    for (let i = 0; i < node.children.length - 1; i++) {
                        str += this.NodeToString(node.children[i]);
                        str += " ";
                    }
                    str += this.NodeToString(node.children[node.children.length - 1]);
                }
                else if (node.children.length === 0) {
                    str = "'(";
                }
                str += ')';
            }
            else if (type === "LAMBDA") {
                str = "(lambda (";
                // parameters
                let parameters = node.getParameters();
                if (parameters.length > 0) {
                    for (let i = 0; i < parameters.length - 1; i++) {
                        str += this.NodeToString(parameters[i]);
                        str += " ";
                    }
                    str += this.NodeToString(parameters[parameters.length - 1]);
                }
                str += ') ';
                // body
                let bodies = node.getBodies();
                if (bodies.length > 0) {
                    for (let i = 0; i < bodies.length - 1; i++) {
                        str += this.NodeToString(bodies[i]);
                        str += " ";
                    }
                    str += this.NodeToString(bodies[bodies.length - 1]);
                }
                str += ')';
            }
            return str;
        }
    }
    // 融合另一个AST（注意，把柄需完全不同，否则会冲突报错）
    // TODO 这里细节比较复杂，需要写一份文档描述
    MergeAST(anotherAST, order) {
        order = order || "top"; // 默认顺序为在顶部融合
        this.source += "\n";
        this.source += anotherAST.source;
        // 注意：为了维持词法作用域关系，不可以简单地将两个nodes并列起来，而应该将源AST的顶级Lambda节点追加到目标AST的顶级Lambda节点的bodie中
        // 1 融合
        anotherAST.nodes.ForEach((hd) => {
            let node = anotherAST.nodes.Get(hd);
            this.nodes.NewHandle(hd, true); // 任何把柄在使用前都需要先注册，以初始化元数据
            this.nodes.Set(hd, node); // TODO：建议深拷贝
        });
        // 2 重组
        let sourceGlobalNodeHandles = anotherAST.GetGlobalNodes();
        let targetTopLambdaNodeHandle = this.TopLambdaNodeHandle();
        let targetGlobalNodeHandles = this.GetGlobalNodes();
        // 依赖（源）节点应挂载到前面
        if (order === "top") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(sourceGlobalNodeHandles.concat(targetGlobalNodeHandles));
        }
        else if (order === "bottom") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(targetGlobalNodeHandles.concat(sourceGlobalNodeHandles));
        }
        // 修改被挂载节点的parent字段
        for (let i = 0; i < sourceGlobalNodeHandles.length; i++) {
            this.nodes.Get(sourceGlobalNodeHandles[i]).parent = targetTopLambdaNodeHandle;
        }
        // 3、删除原来的顶级App节点和顶级Lambda节点
        this.nodes.DeleteHandle(anotherAST.TopLambdaNodeHandle());
        this.nodes.DeleteHandle(anotherAST.TopApplicationNodeHandle());
        for (let hd in anotherAST.nodeIndexes) {
            let oldValue = anotherAST.nodeIndexes.get(hd);
            this.nodeIndexes.set(hd, oldValue + this.source.length);
        }
        for (let hd of anotherAST.lambdaHandles) {
            if (hd === anotherAST.TopLambdaNodeHandle())
                continue; // 注意去掉已删除的顶级Lambda节点
            this.lambdaHandles.push(hd);
        }
        for (let hd of anotherAST.tailcall) {
            if (hd === anotherAST.TopApplicationNodeHandle())
                continue; // 注意去掉已删除的顶级Application节点
            this.tailcall.push(hd);
        }
        for (let hd in anotherAST.variableMapping) {
            let oldValue = anotherAST.variableMapping.get(hd);
            this.variableMapping.set(hd, oldValue);
        }
        for (let hd in anotherAST.topVariables) {
            let oldValue = anotherAST.topVariables.get(hd);
            this.topVariables.set(hd, oldValue);
        }
        for (let hd in anotherAST.dependencies) {
            let oldValue = anotherAST.dependencies.get(hd);
            this.dependencies.set(hd, oldValue);
        }
        for (let hd in anotherAST.natives) {
            let oldValue = anotherAST.natives.get(hd);
            this.natives.set(hd, oldValue);
        }
    }
}
//////////////////////////////////////////////////
//
//  语法分析器：完成语法分析、作用域分析，生成AST
//
//  注意：输入代码必须是`((lambda () <code>))`格式
//
//////////////////////////////////////////////////
function Parse(code, absolutePath) {
    let ast = new AST(code, absolutePath);
    let tokens = Lexer(code);
    // 节点把柄栈
    let NODE_STACK = new Array();
    NODE_STACK.push(TOP_NODE_HANDLE);
    // 状态栈
    let STATE_STACK = new Array();
    // 解析输出
    function parseLog(msg) {
        // console.log(msg);
    }
    // 判断是否为定界符
    function isSymbol(token) {
        if (token === "(" || token === ")" || token === "{" || token === "}" || token === "[" || token === "]") {
            return false;
        }
        if (/^[\'\`\,]/gi.test(token)) {
            return false;
        } // 不允许开头的字符
        return true; // 其余的都是词法意义上的Symbol
    }
    ///////////////////////////////
    //  递归下降分析
    ///////////////////////////////
    function ParseTerm(tokens, index) {
        let quoteState = Top(STATE_STACK);
        if (quoteState !== "QUOTE" && quoteState !== "QUASIQUOTE" && tokens[index].string === '(' && tokens[index + 1].string === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'quote') {
            parseLog('<Term> → <Quote>');
            let nextIndex = ParseQuote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] quote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'unquote') {
            parseLog('<Term> → <Unquote>');
            let nextIndex = ParseUnquote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] unquote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'quasiquote') {
            parseLog('<Term> → <Quasiquote>');
            let nextIndex = ParseQuasiquote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] quasiquote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '\'') {
            parseLog('<Term> → <Quote>');
            return ParseQuote(tokens, index);
        }
        else if (tokens[index].string === ',') {
            parseLog('<Term> → <Unquote>');
            return ParseUnquote(tokens, index);
        }
        else if (tokens[index].string === '`') {
            parseLog('<Term> → <Quasiquote>');
            return ParseQuasiquote(tokens, index);
        }
        else if (tokens[index].string === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
        }
        else if (isSymbol(tokens[index].string)) {
            parseLog('<Term> → <Symbol>');
            return ParseSymbol(tokens, index);
        }
        else {
            throw `<Term>`;
        }
    }
    function ParseSList(tokens, index) {
        parseLog('<SList> → ( ※ <SListSeq> )');
        // Action：向节点栈内压入一个新的SList，其中quoteType从状态栈栈顶取得。
        let quoteType = Top(STATE_STACK);
        let listHandle = ast.MakeApplicationNode(Top(NODE_STACK), ((quoteType) ? quoteType : false));
        NODE_STACK.push(listHandle);
        ast.nodeIndexes.set(listHandle, tokens[index].index);
        let nextIndex = ParseSListSeq(tokens, index + 1);
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<SList>`;
        }
    }
    function ParseSListSeq(tokens, index) {
        parseLog('<SListSeq> → <Term> ※ <SListSeq> | ε');
        if (index >= tokens.length)
            throw `[Error] SList右侧括号未闭合。`; // TODO 完善错误提示
        let currentToken = tokens[index].string;
        if (currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken)) {
            let nextIndex = ParseTerm(tokens, index);
            // Action：从节点栈顶弹出节点，追加到新栈顶节点的children中。
            let childHandle = NODE_STACK.pop();
            ast.GetNode(Top(NODE_STACK)).children.push(childHandle);
            nextIndex = ParseSListSeq(tokens, nextIndex);
            return nextIndex;
        }
        else {
            return index;
        }
    }
    function ParseLambda(tokens, index) {
        parseLog('<Lambda> → ( ※ lambda <ArgList> <Body> )');
        // Action：pushLambda() 向节点栈内压入一个新的Lambda，忽略状态。
        let lambdaHandle = ast.MakeLambdaNode(Top(NODE_STACK));
        NODE_STACK.push(lambdaHandle);
        ast.nodeIndexes.set(lambdaHandle, tokens[index].index);
        let nextIndex = ParseArgList(tokens, index + 2);
        nextIndex = ParseBody(tokens, nextIndex);
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<Lambda>`;
        }
    }
    function ParseArgList(tokens, index) {
        parseLog('<ArgList> → ( ※1 <ArgListSeq> ※2)');
        // Action1
        STATE_STACK.push("PARAMETER");
        let nextIndex = ParseArgListSeq(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<ArgList>`;
        }
    }
    function ParseArgListSeq(tokens, index) {
        parseLog('<ArgListSeq> → <ArgSymbol> ※ <ArgListSeq> | ε');
        if (isSymbol(tokens[index].string)) {
            let nextIndex = ParseArgSymbol(tokens, index);
            // Action：从节点栈顶弹出节点（必须是符号），追加到新栈顶Lambda节点的parameters中。
            let parameter = NODE_STACK.pop();
            ast.GetNode(Top(NODE_STACK)).addParameter(parameter);
            nextIndex = ParseArgListSeq(tokens, nextIndex);
            return nextIndex;
        }
        else {
            return index;
        }
    }
    function ParseArgSymbol(tokens, index) {
        parseLog('<ArgSymbol> → <Symbol>');
        return ParseSymbol(tokens, index);
    }
    function ParseBody(tokens, index) {
        parseLog('<Body> → <BodyTerm> ※ <Body_>');
        let nextIndex = ParseBodyTerm(tokens, index);
        // Action：从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
        let bodyNode = NODE_STACK.pop();
        ast.GetNode(Top(NODE_STACK)).addBody(bodyNode);
        nextIndex = ParseBodyTail(tokens, nextIndex);
        return nextIndex;
    }
    function ParseBodyTail(tokens, index) {
        parseLog('<Body_> → <BodyTerm> ※ <Body_> | ε');
        let currentToken = tokens[index].string;
        if (currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken)) {
            let nextIndex = ParseBodyTerm(tokens, index);
            // Action：从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
            let bodyNode = NODE_STACK.pop();
            ast.GetNode(Top(NODE_STACK)).addBody(bodyNode);
            nextIndex = ParseBodyTail(tokens, nextIndex);
            return nextIndex;
        }
        else {
            return index;
        }
    }
    function ParseBodyTerm(tokens, index) {
        parseLog('<BodyTerm> → <Term>');
        return ParseTerm(tokens, index);
    }
    function ParseQuote(tokens, index) {
        parseLog('<Quote> → \' ※1 <QuoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUOTE');
        let nextIndex = ParseQuoteTerm(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }
    function ParseUnquote(tokens, index) {
        parseLog('<Unquote> → , ※1 <UnquoteTerm> ※2');
        // Action1
        STATE_STACK.push('UNQUOTE');
        let nextIndex = ParseUnquoteTerm(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }
    function ParseQuasiquote(tokens, index) {
        parseLog('<Quasiquote> → ` ※1 <QuasiquoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUASIQUOTE');
        let nextIndex = ParseQuasiquoteTerm(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }
    function ParseQuoteTerm(tokens, index) {
        parseLog('<QuoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }
    function ParseUnquoteTerm(tokens, index) {
        parseLog('<UnquoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }
    function ParseQuasiquoteTerm(tokens, index) {
        parseLog('<QuasiquoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }
    function ParseSymbol(tokens, index) {
        let currentToken = tokens[index].string;
        if (isSymbol(currentToken)) {
            // Action
            let state = Top(STATE_STACK);
            if (state === 'QUOTE' || state === 'QUASIQUOTE') {
                let type = TypeOfToken(currentToken);
                // 被quote的常量和字符串不受影响
                if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken)); // 压入number
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "PORT" ||
                    (currentToken !== "quasiquote" && currentToken !== "quote" && currentToken !== "unquote")) {
                    NODE_STACK.push(`'${currentToken}`);
                }
                else { // 含boolean在内的变量、把柄等
                    NODE_STACK.push(currentToken);
                }
            }
            else if (state === 'UNQUOTE') {
                let type = TypeOfToken(currentToken);
                // 符号会被解除引用
                if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken.replace(/^\'*/gi, "")); // VARIABLE
                }
                // 其他所有类型不受影响
                else if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`;
                }
            }
            else {
                let type = TypeOfToken(currentToken);
                if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`;
                }
            }
            return index + 1;
        }
        else {
            throw `<Symbol>`;
        }
    }
    ///////////////////////////////
    //  预处理指令解析（包括import等）
    ///////////////////////////////
    function PreprocessAnalysis() {
        // 遍历所有的node，寻找预处理指令
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // (import <Alias> <Path>)
            if (nodeType === "APPLICATION" && node.children[0] === "import") {
                let moduleAlias = node.children[1]; // 模块的别名
                let pathStringHandle = node.children[2]; // 模块路径字符串（的把柄）
                let pathStringObject = ast.GetNode(pathStringHandle); // 若不存在，会抛出异常
                if (pathStringObject.type !== "STRING") {
                    throw `[预处理] import的来源路径必须写成字符串`;
                }
                // 将相对路径扩展为绝对路径
                let modulePath = TrimQuotes(pathStringObject.content);
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    let basePath = PathUtils.DirName(absolutePath); // 当前模块所在的目录
                    modulePath = PathUtils.Join(basePath, modulePath); // 将依赖模块的路径拼接为绝对路径
                }
                ast.dependencies.set(moduleAlias, modulePath);
            }
            // (native <NativeLibName>)
            else if (nodeType === "APPLICATION" && node.children[0] === "native") {
                let nativeLibName = node.children[1];
                ast.natives.set(nativeLibName, "enabled"); // TODO: 这里可以写native库的路径。更多断言，例如重复判断、native库存在性判断等
            }
        });
    }
    // 递归下降语法分析
    ParseTerm(tokens, 0);
    // 预处理指令解析
    PreprocessAnalysis();
    return ast;
}
// Parser.ts
// 作用域和尾调用分析：分析并处理AST
class Scope {
    constructor(parent) {
        this.parent = parent;
        this.children = new Array();
        this.boundVariables = new Array();
    }
    addChild(child) {
        this.children.push(child);
    }
    addParameter(param) {
        if (this.boundVariables.indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.boundVariables.push(param);
        }
    }
}
function Analyse(ast) {
    let scopes = new HashMap();
    ///////////////////////////////
    //  作用域解析，变量换名
    ///////////////////////////////
    // 从某个节点开始，向上查找某个变量归属的Lambda节点
    function searchVarLambdaHandle(variable, fromNodeHandle) {
        let currentNodeHandle = fromNodeHandle;
        while (currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if (node.type === "LAMBDA") {
                // 注意：从scopes中获取换名前的作用域信息
                let bounds = scopes.get(currentNodeHandle).boundVariables;
                if (bounds.indexOf(variable) >= 0) {
                    return currentNodeHandle;
                }
            }
            currentNodeHandle = node.parent;
        }
        return null; // 变量未定义
    }
    // 查找某个node上面最近的lambda节点的地址
    function nearestLambdaHandle(fromNodeHandle) {
        let currentNodeHandle = fromNodeHandle;
        while (currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if (node.type === "LAMBDA") {
                return currentNodeHandle;
            }
            currentNodeHandle = node.parent;
        }
        return null;
    }
    // 生成模块内唯一的变量名
    function MakeUniqueVariable(lambdaHandle, variable) {
        return `${lambdaHandle.substring(1)}.${variable}`;
    }
    // 以下是作用域解析：需要对所有node扫描两遍
    function ScopeAnalysis() {
        // 顶级Lambda的把柄
        let topLambdaHandle = ast.lambdaHandles[0];
        // 首先初始化所有scope
        for (let nodeHandle of ast.lambdaHandles) {
            let scope = new Scope(null);
            scopes.set(nodeHandle, scope);
        }
        // 第1趟扫描：在scopes中注册作用域的树状嵌套关系；处理define行为
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点
            if (nodeType === "LAMBDA") {
                // 寻找上级lambda节点
                let parentLambdaHandle = nearestLambdaHandle(node.parent);
                // 非顶级lambda
                if (parentLambdaHandle !== null) {
                    // 记录上级lambda节点
                    scopes.get(nodeHandle).parent = parentLambdaHandle;
                    // 为上级lambda节点增加下级成员（也就是当前lambda）
                    scopes.get(parentLambdaHandle).addChild(nodeHandle);
                }
                else {
                    // 记录上级lambda节点
                    scopes.get(nodeHandle).parent = TOP_NODE_HANDLE;
                }
                // 记录当前lambda的约束变量
                scopes.get(nodeHandle).boundVariables = Array.from(node.getParameters()); // ES6+
            }
            // define结构：变量被defined，会覆盖掉上级同名变量（类似JS的var）
            else if (nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle = nearestLambdaHandle(nodeHandle);
                if (parentLambdaHandle !== null) {
                    let definedVariable = node.children[1];
                    // 【×】将defined变量*同时*记录到所在lambda节点和所在作用域中（如果不存在的话）
                    // 【√】将defined变量记录到所在作用域中
                    // NOTE: 全局变量不能加入形参列表！(通过Man-or-boy-test用例发现此问题)
                    // ast.GetNode(parentLambdaHandle).addParameter(definedVariable);
                    scopes.get(parentLambdaHandle).addParameter(definedVariable);
                }
                else {
                    throw `[作用域分析] 不可在顶级作用域之外define。`;
                }
            }
        });
        // 第2趟扫描：根据作用域嵌套关系，替换所有节点中出现的bound和free变量 为 全局唯一的变量，并在ast.variableMapping中登记映射关系
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点：替换parameter和bodies中出现的所有Variable
            if (nodeType === "LAMBDA") {
                // 处理Lambda节点的parameters
                for (let i = 0; i < node.getParameters().length; i++) {
                    let originVar = (node.getParameters())[i];
                    let newVar = MakeUniqueVariable(nodeHandle, originVar);
                    (ast.GetNode(nodeHandle).getParameters())[i] = newVar;
                    ast.variableMapping.set(newVar, originVar);
                }
                // 处理body中出现的单独的变量（例如(lambda (x) *x*)）
                for (let i = 2; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if (isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if (lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if (!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`;
                            }
                        }
                        else {
                            let newVar = MakeUniqueVariable(lambdaHandle, child);
                            (ast.GetNode(nodeHandle).children)[i] = newVar;
                            ast.variableMapping.set(newVar, child);
                        }
                    }
                }
            }
            // Application节点：处理方式类似body
            else if (nodeType === "APPLICATION" || nodeType === "UNQUOTE" || nodeType === "QUASIQUOTE") {
                // 跳过若干特殊类型的node
                let first = node.children[0];
                if (["native", "import"].indexOf(first) >= 0) {
                    return; // 相当于continue;
                }
                for (let i = 0; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if (isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if (lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if (!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`;
                            }
                        }
                        else {
                            let newVar = MakeUniqueVariable(lambdaHandle, child);
                            (ast.GetNode(nodeHandle).children)[i] = newVar;
                            ast.variableMapping.set(newVar, child);
                        }
                    }
                }
                // 后处理：记录顶级变量
                if (first === "define" && node.parent === topLambdaHandle) {
                    let newVarName = node.children[1];
                    let originVarName = ast.variableMapping.get(newVarName);
                    if (ast.topVariables.has(originVarName)) {
                        throw `[Error] 顶级变量“${originVarName}”@Position ${ast.nodeIndexes.get(nodeHandle)} 重复。`;
                    }
                    else {
                        ast.topVariables.set(originVarName, newVarName);
                    }
                }
            }
        }); // 所有节点扫描完毕
    }
    // 尾位置分析（参照R5RS的归纳定义）
    function TailCallAnalysis(item, isTail) {
        if (TypeOfToken(item) === "HANDLE") {
            let node = ast.GetNode(item);
            if (node.type === "APPLICATION") {
                let first = node.children[0];
                // if 特殊构造
                if (first === "if") {
                    TailCallAnalysis(node.children[1], false);
                    TailCallAnalysis(node.children[2], isTail);
                    TailCallAnalysis(node.children[3], isTail);
                }
                // cond 特殊构造
                else if (first === "cond") {
                    for (let i = 1; i < node.children.length; i++) {
                        let clauseNode = ast.GetNode(node.children[i]);
                        TailCallAnalysis(clauseNode.children[0], false);
                        TailCallAnalysis(clauseNode.children[1], isTail);
                    }
                }
                // 其他构造，含and、or，这些形式的尾位置是一样的
                else {
                    for (let i = 0; i < node.children.length; i++) {
                        let _istail = false;
                        if ((i === node.children.length - 1) &&
                            (node.children[0] === 'begin' || node.children[0] === 'and' || node.children[0] === 'or')) {
                            _istail = isTail;
                        }
                        TailCallAnalysis(node.children[i], _istail);
                    }
                    if (isTail) {
                        ast.tailcall.push(item); // 标记为尾（调用）位置
                    }
                }
            }
            else if (node.type === "LAMBDA") {
                let bodies = node.getBodies();
                for (let i = 0; i < bodies.length; i++) {
                    if (i === bodies.length - 1) {
                        TailCallAnalysis(bodies[i], true);
                    }
                    else {
                        TailCallAnalysis(bodies[i], false);
                    }
                }
            }
        }
        else {
            return;
        }
    }
    // 作用域解析
    ScopeAnalysis();
    // 尾调用分析
    TailCallAnalysis(ast.TopApplicationNodeHandle(), true);
    return ast;
}
// Compiler.ts
// 编译器：AST→ILCode
//////////////////////////////////////////////////
//
//  编译器：将AST编译成中间语言代码
//
//////////////////////////////////////////////////
function Compile(ast) {
    let ILCode = new Array();
    ///////////////////////////////
    //  工具函数
    ///////////////////////////////
    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `${ast.moduleID}.ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        return uniqueString;
    }
    // 增加一条新指令
    function AddInstruction(instStr) {
        if (instStr.trim()[0] === ";") {
            // ILCode.push(instStr);
        }
        else {
            ILCode.push(instStr.trim());
        }
    }
    ////////////////////////////////////////////////
    //  从所有的Lambda节点开始，递归地编译每个节点
    ////////////////////////////////////////////////
    // 编译Lambda节点
    function CompileLambda(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ FUNCTION “${nodeHandle}” BEGIN`);
        // 函数开始标签：格式约定为@+LambdaHandle
        AddInstruction(`@${nodeHandle}`);
        // 按参数列表逆序，插入store指令
        // 【已解决】TODO 参数列表里通过define获得的参数，不需要在这里出现
        let parameters = node.getParameters();
        for (let i = parameters.length - 1; i >= 0; i--) {
            AddInstruction(`store ${parameters[i]}`);
        }
        // 逐个编译函数体，等价于begin块
        let bodies = node.getBodies();
        for (let i = 0; i < bodies.length; i++) {
            let body = bodies[i];
            let bodyType = TypeOfToken(body);
            if (bodyType === "HANDLE") {
                let bodyObj = ast.GetNode(body);
                let bodyObjType = bodyObj.type;
                if (bodyObjType === "LAMBDA") {
                    AddInstruction(`loadclosure @${body}`);
                }
                else if (bodyObjType === "QUOTE") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "QUASIQUOTE") {
                    CompileQuasiquote(body);
                }
                else if (bodyObjType === "STRING") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "APPLICATION" || bodyObjType === "UNQUOTE") {
                    CompileApplication(body);
                }
                else {
                    throw `[Error] 意外的函数体节点类型。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(bodyType) >= 0 || ast.IsNativeCall(body)) {
                AddInstruction(`push ${body}`);
            }
            else if (bodyType === "VARIABLE") {
                AddInstruction(`load ${body}`);
            }
            else {
                throw `[Error] 意外的函数体类型。`;
            }
        }
        // 返回指令
        AddInstruction(`return`);
        AddInstruction(`;; 🛑 FUNCTION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译CallCC
    function CompileCallCC(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ Call/cc “${nodeHandle}” BEGIN`);
        // 参数：lambda（必须是thunk）或者引用thunk的变量
        let thunk = node.children[1];
        // cont临时变量，同时也构成cont返回标签
        let contName = `CC_${thunk}_${UniqueString()}`;
        AddInstruction(`;; ✅ Current Continuation captured, stored in “${contName}”`);
        // 捕获CC，并使用此CC调用thunk
        AddInstruction(`capturecc ${contName}`);
        AddInstruction(`load ${contName}`);
        if (TypeOfToken(thunk) === "HANDLE") {
            let thunkNode = ast.GetNode(thunk);
            // TODO Thunk类型检查
            if (thunkNode.type === "LAMBDA") {
                AddInstruction(`call @${thunk}`);
            }
            else {
                throw `[Error] call/cc的参数必须是Thunk。`;
            }
        }
        else if (TypeOfToken(thunk) === "VARIABLE") {
            // TODO Thunk类型检查
            AddInstruction(`call ${thunk}`);
        }
        else {
            throw `[Error] call/cc的参数必须是Thunk。`;
        }
        // cont返回标签
        AddInstruction(`@${contName}`);
        AddInstruction(`;; 🛑 Call/cc “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译define
    function CompileDefine(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ DEFINE “${nodeHandle}” BEGIN`);
        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if (rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if (rightValueNode.type === "LAMBDA") {
                AddInstruction(`push @${rightValue}`); // 注意：define并不对Lambda节点求值（即，生成闭包实例）
            }
            else if (rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if (rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            AddInstruction(`push ${rightValue}`);
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }
        // store
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if (leftVariableType === "VARIABLE") {
            AddInstruction(`store ${leftVariable}`);
        }
        else {
            throw `[Error] define左值必须是变量名称。`;
        }
        AddInstruction(`;; 🛑 DEFINE “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译set!
    function CompileSet(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ SET! “${nodeHandle}” BEGIN`);
        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if (rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if (rightValueNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${rightValue}`); // 注意：set!对Lambda节点求值（即，生成闭包实例）
            }
            else if (rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if (rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            AddInstruction(`push ${rightValue}`);
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }
        // set
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if (leftVariableType === "VARIABLE") {
            AddInstruction(`set ${leftVariable}`);
        }
        else {
            throw `[Error] set!左值必须是变量名称。`;
        }
        AddInstruction(`;; 🛑 SET! “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // TODO 编译begin
    /*
    function CompileBegin(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ BEGIN “${nodeHandle}” BEGIN`);

        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();

        // 遍历每个分支
        for(let i = 1; i < node.children.length; i++) {
            let child = node.children[i];
            let childType = TypeOfToken(child);
            if(childType === "HANDLE") {
                let trueBranchNode = ast.GetNode(child);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                AddInstruction(`push ${child}`);
            }
            else if(childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }

            // 只保留最后一个child的压栈结果，其他的全部pop掉
            if(i !== node.children.length - 1) {
                AddInstruction(`pop`);
            }
        } // 分支遍历结束

        AddInstruction(`;; 🛑 BEGIN “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    */
    // 编译cond
    function CompileCond(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ COND “${nodeHandle}” BEGIN`);
        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();
        // 遍历每个分支
        for (let i = 1; i < node.children.length; i++) {
            let clauseNode = ast.GetNode(node.children[i]);
            // 插入开始标签（实际上第一个分支不需要）
            AddInstruction(`@COND_BRANCH_${uqStr}_${i}`);
            // 处理分支条件（除了else分支）
            let predicate = clauseNode.children[0];
            if (predicate !== "else") {
                let predicateType = TypeOfToken(predicate);
                if (predicateType === "HANDLE") {
                    let predicateNode = ast.GetNode(predicate);
                    if (predicateNode.type === "APPLICATION") {
                        CompileApplication(predicate);
                    }
                    // 其余情况，统统作push处理
                    else {
                        AddInstruction(`push ${predicate}`);
                    }
                }
                // TODO 此处可以作优化
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
                    AddInstruction(`push ${predicate}`);
                }
                else if (predicateType === "VARIABLE") {
                    AddInstruction(`load ${predicate}`);
                }
                else {
                    throw `[Error] 意外的cond分支条件。`;
                }
                // 如果不是最后一个分支，则跳转到下一条件；如果是最后一个分支，则跳转到结束标签
                if (i === node.children.length - 1) {
                    AddInstruction(`iffalse @COND_END_${uqStr}`);
                }
                else {
                    AddInstruction(`iffalse @COND_BRANCH_${uqStr}_${(i + 1)}`);
                }
            }
            // 处理分支主体
            let branch = clauseNode.children[1];
            let branchType = TypeOfToken(branch);
            if (branchType === "HANDLE") {
                let branchNode = ast.GetNode(branch);
                if (branchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${branch}`); // 返回闭包
                }
                else if (branchNode.type === "QUOTE") {
                    AddInstruction(`push ${branch}`);
                }
                else if (branchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(branch);
                }
                else if (branchNode.type === "STRING") {
                    AddInstruction(`push ${branch}`);
                }
                else if (branchNode.type === "APPLICATION" || branchNode.type === "UNQUOTE") {
                    CompileApplication(branch);
                }
                else {
                    throw `[Error] 意外的if-true分支。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(branchType) >= 0 || ast.IsNativeCall(branch)) {
                AddInstruction(`push ${branch}`);
            }
            else if (branchType === "VARIABLE") {
                AddInstruction(`load ${branch}`);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
            // 插入收尾语句（区分else分支和非else分支）
            if (predicate === "else" || i === node.children.length - 1) {
                AddInstruction(`@COND_END_${uqStr}`);
                break; // 忽略else后面的所有分支
            }
            else {
                AddInstruction(`goto @COND_END_${uqStr}`);
            }
        } // 分支遍历结束
        AddInstruction(`;; 🛑 COND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译if
    function CompileIf(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ IF “${nodeHandle}” BEGIN`);
        // 处理分支条件
        let predicate = node.children[1];
        let predicateType = TypeOfToken(predicate);
        if (predicateType === "HANDLE") {
            let predicateNode = ast.GetNode(predicate);
            if (predicateNode.type === "APPLICATION") {
                CompileApplication(predicate);
            }
            // 其余情况，统统作push处理
            else {
                AddInstruction(`push ${predicate}`);
            }
        }
        // TODO 此处可以作优化
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
            AddInstruction(`push ${predicate}`);
        }
        else if (predicateType === "VARIABLE") {
            AddInstruction(`load ${predicate}`);
        }
        else {
            throw `[Error] 意外的if分支条件。`;
        }
        // 认为取f分支的概率较大，因此使用iftrue指令
        let uqStr = UniqueString();
        let trueTag = `@IF_TRUE_${uqStr}`; // true分支标签
        let endTag = `@IF_END_${uqStr}`; // if语句结束标签
        AddInstruction(`iftrue ${trueTag}`);
        // 处理false分支
        let falseBranch = node.children[3];
        let falseBranchType = TypeOfToken(falseBranch);
        if (falseBranchType === "HANDLE") {
            let falseBranchNode = ast.GetNode(falseBranch);
            if (falseBranchNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${falseBranch}`); // 返回闭包
            }
            else if (falseBranchNode.type === "QUOTE") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if (falseBranchNode.type === "QUASIQUOTE") {
                CompileQuasiquote(falseBranch);
            }
            else if (falseBranchNode.type === "STRING") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if (falseBranchNode.type === "APPLICATION" || falseBranchNode.type === "UNQUOTE") {
                CompileApplication(falseBranch);
            }
            else {
                throw `[Error] 意外的if-false分支。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(falseBranchType) >= 0 || ast.IsNativeCall(falseBranch)) {
            AddInstruction(`push ${falseBranch}`);
        }
        else if (falseBranchType === "VARIABLE") {
            AddInstruction(`load ${falseBranch}`);
        }
        else {
            throw `[Error] 意外的if-false分支。`;
        }
        // 跳转到结束标签
        AddInstruction(`goto ${endTag}`);
        // 添加true分支标签
        AddInstruction(trueTag);
        // 处理true分支
        let trueBranch = node.children[2];
        let trueBranchType = TypeOfToken(trueBranch);
        if (trueBranchType === "HANDLE") {
            let trueBranchNode = ast.GetNode(trueBranch);
            if (trueBranchNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${trueBranch}`); // 返回闭包
            }
            else if (trueBranchNode.type === "QUOTE") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if (trueBranchNode.type === "QUASIQUOTE") {
                CompileQuasiquote(trueBranch);
            }
            else if (trueBranchNode.type === "STRING") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                CompileApplication(trueBranch);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(trueBranchType) >= 0 || ast.IsNativeCall(trueBranch)) {
            AddInstruction(`push ${trueBranch}`);
        }
        else if (trueBranchType === "VARIABLE") {
            AddInstruction(`load ${trueBranch}`);
        }
        else {
            throw `[Error] 意外的if-true分支。`;
        }
        // 结束标签
        AddInstruction(endTag);
        AddInstruction(`;; 🛑 IF “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译and
    function CompileAnd(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ AND “${nodeHandle}” BEGIN`);
        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@AND_END_${uqStr}`;
        let falseTag = `@AND_FALSE_${uqStr}`;
        // 遍历每一项
        for (let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);
            if (clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的and clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                AddInstruction(`push ${clause}`);
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            else {
                throw `[Error] 意外的and clause。`;
            }
            // 每个分支后面都要作判断
            AddInstruction(`iffalse ${falseTag}`);
        }
        // 没有任何一项为假，则返回#t，结束
        AddInstruction(`push #t`);
        AddInstruction(`goto ${endTag}`);
        // 有任何一项为#f都会跳到这里，返回#f，结束
        AddInstruction(falseTag);
        AddInstruction(`push #f`);
        // 结束标签
        AddInstruction(endTag);
        AddInstruction(`;; 🛑 AND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译or
    function CompileOr(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ OR “${nodeHandle}” BEGIN`);
        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@OR_END_${uqStr}`;
        let trueTag = `@OR_FALSE_${uqStr}`;
        // 遍历每一项
        for (let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);
            if (clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的 or clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                AddInstruction(`push ${clause}`);
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            else {
                throw `[Error] 意外的 or clause。`;
            }
            // 每个分支后面都要作判断
            AddInstruction(`iftrue ${trueTag}`);
        }
        // 没有任何一项为真（非假），则返回#f，结束
        AddInstruction(`push #f`);
        AddInstruction(`goto ${endTag}`);
        // 有任何一项为#t（非#f）都会跳到这里，返回#t，结束
        AddInstruction(trueTag);
        AddInstruction(`push #t`);
        // 结束标签
        AddInstruction(endTag);
        AddInstruction(`;; 🛑 OR “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译准引用节点
    function CompileQuasiquote(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        for (let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            if (TypeOfToken(child) === "HANDLE") {
                let childObj = ast.GetNode(child);
                if (childObj.type === "APPLICATION" || childObj.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else if (childObj.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(TypeOfToken(child)) >= 0 || ast.IsNativeCall(child)) {
                AddInstruction(`push ${child}`);
            }
            else if (TypeOfToken(child) === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
        }
        AddInstruction(`push ${node.children.length}`);
        AddInstruction(`concat`);
    }
    // 编译复杂的Application节点（即首项为待求值的Application的Application，此时需要作η变换）
    // (A 1 2 ..) → ((lambda (F x y ..) (F x y ..)) A 1 2 ..)
    function CompileComplexApplication(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ C'APPLICATION “${nodeHandle}” BEGIN`);
        let children = node.children;
        let uqStr = UniqueString();
        // 调用(TempFunc A 1 2 ..)开始点
        let startTag = `@APPLY_BEGIN_${uqStr}`;
        AddInstruction(`goto ${startTag}`);
        // 构造临时函数
        // 临时函数的开始点标签和返回点标签
        let tempLambdaName = `TEMP_LAMBDA_${uqStr}`;
        let tempLambdaRetName = `TEMP_LAMBDA_RETURN_TARGET_${uqStr}`;
        // 临时函数的形式参数列表
        let tempLambdaParams = new Array();
        for (let i = 0; i < children.length; i++) {
            tempLambdaParams[i] = `TEMP_LAMBDA_PARAM${i}_${uqStr}`;
        }
        // 临时函数开始
        AddInstruction(`;; >>>>>> Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(`@${tempLambdaName}`);
        // 执行η变换
        for (let i = children.length - 1; i >= 0; i--) {
            AddInstruction(`store ${tempLambdaParams[i]}`);
        }
        for (let i = 1; i < children.length; i++) {
            AddInstruction(`load ${tempLambdaParams[i]}`);
        }
        AddInstruction(`tailcall ${tempLambdaParams[0]}`);
        // 以下二选一
        // AddInstruction(`goto @${tempLambdaRetName}`); // 不用return，直接返回调用临时函数的位置
        AddInstruction(`return`);
        // 主体开始
        AddInstruction(`;; >>>>>> Call Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(startTag);
        // 编译(TempFunc A 1 2 ..)形式
        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            let childType = TypeOfToken(child);
            if (childType === "HANDLE") {
                let childNode = ast.GetNode(child);
                if (childNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if (childNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if (childNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if (childNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if (childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                AddInstruction(`push ${child}`);
            }
            else if (childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }
        }
        // 调用临时函数
        // 以下二选一
        // AddInstruction(`goto @${tempLambdaName}`); // 不用call
        AddInstruction(`call @${tempLambdaName}`);
        // 临时函数调用返回点
        AddInstruction(`@${tempLambdaRetName}`);
        AddInstruction(`;; 🛑 C'APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译一般的Application节点
    function CompileApplication(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ APPLICATION “${nodeHandle}” BEGIN`);
        let children = node.children;
        // 判断Application类型，根据不同的类型，执行不同的编译流程
        // 空表
        if (children.length <= 0) {
            return;
        }
        let first = children[0];
        let firstType = TypeOfToken(first);
        // 以下是几种特殊形式
        if (first === 'import') {
            return;
        }
        else if (first === 'native') {
            return;
        }
        // TODO else if(first === 'begin')   { return CompileBegin(nodeHandle); }
        else if (first === 'call/cc') {
            return CompileCallCC(nodeHandle);
        }
        else if (first === 'define') {
            return CompileDefine(nodeHandle);
        }
        else if (first === 'set!') {
            return CompileSet(nodeHandle);
        }
        else if (first === 'cond') {
            return CompileCond(nodeHandle);
        }
        else if (first === 'if') {
            return CompileIf(nodeHandle);
        }
        else if (first === 'and') {
            return CompileAnd(nodeHandle);
        }
        else if (first === 'or') {
            return CompileOr(nodeHandle);
        }
        else if (first === 'fork') {
            AddInstruction(`fork ${children[1]}`);
            return;
        }
        // 首项是待求值的Application，需要进行η变换
        if (firstType === "HANDLE" && ast.GetNode(first).type === "APPLICATION") {
            CompileComplexApplication(nodeHandle);
            return;
        }
        // 首项是合法的原子对象，包括变量、Native、Primitive、Lambda
        else if (["HANDLE", "VARIABLE", "KEYWORD"].indexOf(firstType) >= 0) {
            // 首先处理参数
            for (let i = 1; i < children.length; i++) { // 处理参数列表
                let child = children[i];
                let childType = TypeOfToken(child);
                if (childType === "HANDLE") {
                    let childNode = ast.GetNode(child);
                    if (childNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${child}`); // 返回闭包
                    }
                    else if (childNode.type === "QUOTE") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (childNode.type === "QUASIQUOTE") {
                        CompileQuasiquote(child);
                    }
                    else if (childNode.type === "STRING") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                        CompileApplication(child);
                    }
                    else {
                        throw `[Error] 意外的 child。`;
                    }
                }
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                    AddInstruction(`push ${child}`);
                }
                else if (childType === "VARIABLE") {
                    AddInstruction(`load ${child}`);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            // 处理调用。需要做这样几件事情：
            // 1、确保首项是合法的可调用项，变量、Native、Primitive、Lambda
            // 2、处理import的外部变量名称（Native不必处理，保留原形）
            //    TODO 外部变量的处理方式根据整个系统对多模块的支持方式不同而不同。这里采取的策略是：暂不处理，交给运行时的模块加载器去动态地处理。
            // 3、处理尾递归
            // Primitive
            if (firstType === "KEYWORD") {
                if (first !== 'begin') { // begin不加入指令序列
                    if (first in PrimitiveInstruction) {
                        AddInstruction(`${PrimitiveInstruction[first]}`);
                    }
                    else {
                        AddInstruction(`${first}`);
                    }
                }
            }
            // 尾调用
            else if (ast.tailcall.indexOf(nodeHandle) >= 0) {
                if (firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`tailcall @${first}`);
                }
                else if (firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`tailcall ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
            else {
                if (firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`call @${first}`);
                }
                else if (firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`call ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
        }
        else {
            throw `[Error] 不可调用的首项。`;
        }
        AddInstruction(`;; 🛑 APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 开始编译整个AST
    function CompileAll() {
        // 注释
        AddInstruction(`;;`);
        AddInstruction(`;; Aurora Intermediate Language (AIL) Code`);
        AddInstruction(`;;   Module: ${ast.moduleID}`);
        AddInstruction(`;;   Generated by ASCompiler V0`); // TODO 编译器版本号
        AddInstruction(`;;`);
        // 程序入口（顶级Lambda）
        let topLambdaHandle = ast.lambdaHandles[0];
        AddInstruction(`;; 🐟🐟🐟🐟🐟 Program Entry 🐟🐟🐟🐟🐟`);
        AddInstruction(`call @${topLambdaHandle}`);
        AddInstruction(`halt`);
        AddInstruction(`;; 🐟🐟🐟🐟🐟  Program End  🐟🐟🐟🐟🐟`);
        AddInstruction(`;;`);
        // 从所有的Lambda节点开始顺序编译
        // 这类似于C语言，所有的函数都是顶级的
        for (let i = 0; i < ast.lambdaHandles.length; i++) {
            CompileLambda(ast.lambdaHandles[i]);
        }
    }
    // 开始编译，并组装成模块
    CompileAll();
    return ILCode;
}
// ModuleLoader.ts
// 模块加载器
// 模块
class Module {
}
Module.AVM_Version = "V0"; // 指示可用的AVM版本
// 载入模块：本质上是静态链接
function LoadModule(modulePath, workingDir) {
    // 所有互相依赖的AST：{moduleID -> AST}
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    // 递归地引入所有依赖文件，并检测循环依赖
    (function importModule(modulePath, basePath) {
        // 将相对路径拼接为绝对路径
        if (PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(basePath, modulePath);
        }
        let code;
        try {
            code = FileUtils.ReadFileSync(modulePath);
        }
        catch (_a) {
            throw `[Error] 模块“${modulePath}”未找到。`;
        }
        code = `((lambda () ${code}))\n`;
        let currentAST = Analyse(Parse(code, modulePath));
        let moduleID = PathUtils.PathToModuleID(modulePath);
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, currentBasePath);
        }
    })(modulePath, workingDir);
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    let mainModuleID = PathUtils.PathToModuleID(modulePath);
    mergedModule.AST = allASTs.get(mainModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === mainModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    // mergedModule.Components = sortedModuleIDs;
    return mergedModule;
}
// 用于fork指令：从某个Application节点开始，构建模块
// TODO 这个函数实现不够优雅，待改进
function LoadModuleFromNode(ast, nodeHandle, workingDir) {
    // 所有互相依赖的AST
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    let mainModuleID = `${ast.moduleID}.forked`;
    let currentAST = ast.Copy();
    // 将目标节点移到顶级作用域
    let topLambdaNodeHandle = currentAST.GetNode(currentAST.TopApplicationNodeHandle()).children[0];
    let temp = currentAST.GetNode(topLambdaNodeHandle).children;
    // 将所在AST的顶级作用域的(define ..)搬迁到顶级作用域
    let temp2 = new Array();
    for (let i = 2; i < temp.length; i++) {
        if (TypeOfToken(temp[i]) === "HANDLE") {
            let childNode = currentAST.GetNode(temp[i]);
            if (childNode.type === "APPLICATION" && childNode.children[0] === "define") {
                temp2.push(temp[i]);
            }
        }
    }
    temp2.push(nodeHandle);
    currentAST.GetNode(topLambdaNodeHandle).children = temp.slice(0, 2).concat(temp2);
    allASTs.set(mainModuleID, currentAST);
    for (let alias in currentAST.dependencies) {
        let dependencyPath = currentAST.dependencies.get(alias);
        dependencyGraph.push([
            mainModuleID,
            PathUtils.PathToModuleID(dependencyPath)
        ]);
        // 检测是否有循环依赖
        sortedModuleIDs = TopologicSort(dependencyGraph);
        if (sortedModuleIDs === undefined) {
            throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
        }
        importModule(dependencyPath, workingDir);
    }
    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(modulePath, basePath) {
        // 将相对路径拼接为绝对路径
        if (PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(workingDir, modulePath);
        }
        let code;
        try {
            code = FileUtils.ReadFileSync(modulePath);
        }
        catch (_a) {
            throw `[Error] 模块“${modulePath}”未找到。`;
        }
        code = `((lambda () ${code}))\n`;
        let currentAST = Analyse(Parse(code, modulePath));
        let moduleID = PathUtils.PathToModuleID(modulePath);
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, currentBasePath);
        }
    }
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    mergedModule.AST = allASTs.get(mainModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === mainModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    // mergedModule.Components = sortedModuleIDs;
    return mergedModule;
}
// 直接从代码构建模块：用于REPL、eval(code)、直接解释小段代码等场合
// 其中virtualDir用于确定模块的ID
function LoadModuleFromCode(code, virtualDir) {
    // 所有互相依赖的AST
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(pathOrCode, isPath, basePath) {
        let code;
        let moduleID;
        let modulePath;
        if (isPath) {
            try {
                // 将相对路径拼接为绝对路径
                modulePath = pathOrCode;
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    modulePath = PathUtils.Join(basePath, modulePath);
                }
                code = FileUtils.ReadFileSync(modulePath);
                code = `((lambda () ${code}))\n`;
            }
            catch (_a) {
                throw `[Error] 模块“${modulePath}”未找到。`;
            }
        }
        else {
            modulePath = virtualDir;
            code = pathOrCode;
        }
        moduleID = PathUtils.PathToModuleID(modulePath);
        let currentAST = Analyse(Parse(code, modulePath));
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, true, currentBasePath);
        }
    }
    importModule(code, false, virtualDir);
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    let replModuleID = PathUtils.PathToModuleID(virtualDir);
    mergedModule.AST = allASTs.get(replModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === replModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    return mergedModule;
}
// 对依赖关系图作拓扑排序，进而检测是否存在环路
function TopologicSort(dependencyGraph) {
    // 建立邻接表和模块名称表
    let moduleNameDict = new HashMap();
    for (let i = 0; i < dependencyGraph.length; i++) {
        moduleNameDict[dependencyGraph[i][0]] = 0;
        moduleNameDict[dependencyGraph[i][1]] = 0;
    }
    let counter = 0;
    let moduleName = new Array();
    for (let n in moduleNameDict) {
        moduleNameDict[n] = counter;
        moduleName[counter] = n;
        counter++;
    }
    let adjMatrix = new Array();
    for (let i = 0; i < counter; i++) {
        let init = new Array();
        for (let j = 0; j < counter; j++) {
            init[j] = false;
        }
        adjMatrix[i] = init;
    }
    for (let i = 0; i < dependencyGraph.length; i++) {
        let left = moduleNameDict[dependencyGraph[i][0]];
        let right = moduleNameDict[dependencyGraph[i][1]];
        adjMatrix[left][right] = true;
    }
    // 拓扑排序
    let hasLoop = false;
    let sortedModuleIndex = new Array();
    (function sort(adjMatrix) {
        // 计算某节点入度
        function getInDegree(vertex, adjMatrix) {
            let count = 0;
            if (!(adjMatrix[vertex])) {
                return -1;
            }
            for (let i = 0; i < adjMatrix[vertex].length; i++) {
                if (adjMatrix[vertex][i] === true)
                    count++;
            }
            return count;
        }
        while (sortedModuleIndex.length < adjMatrix.length) {
            // 计算入度为0的点
            let zeroInDegVertex = null;
            for (let i = 0; i < adjMatrix.length; i++) {
                let indeg = getInDegree(i, adjMatrix);
                if (indeg === 0) {
                    zeroInDegVertex = i;
                    break;
                }
            }
            if (zeroInDegVertex === null) {
                hasLoop = true;
                return;
            }
            sortedModuleIndex.push(zeroInDegVertex);
            // 删除这个点
            for (let i = 0; i < adjMatrix.length; i++) {
                if (!(adjMatrix[i])) {
                    continue;
                }
                adjMatrix[i][zeroInDegVertex] = false;
            }
            adjMatrix[zeroInDegVertex] = undefined;
        }
    })(adjMatrix);
    if (hasLoop) {
        return undefined;
    }
    else {
        let sortedModuleName = new Array();
        for (let i = 0; i < sortedModuleIndex.length; i++) {
            sortedModuleName[i] = moduleName[sortedModuleIndex[i]];
        }
        return sortedModuleName;
    }
}
// Process.ts
// 进程数据结构
// 栈帧
class StackFrame {
    constructor(closureHandle, target) {
        this.closureHandle = closureHandle;
        this.returnTargetAddress = target;
    }
}
// 进程状态枚举
var ProcessState;
(function (ProcessState) {
    ProcessState["READY"] = "READY";
    ProcessState["RUNNING"] = "RUNNING";
    ProcessState["SLEEPING"] = "SLEEPING";
    ProcessState["SUSPENDED"] = "SUSPENDED";
    ProcessState["STOPPED"] = "STOPPED";
})(ProcessState || (ProcessState = {}));
class Process {
    /* 构造器 */
    // TODO 待实现，目前仅供测试
    constructor(modul) {
        // 执行机核心：栈、闭包和续延
        this.PC = 0; // 程序计数器（即当前执行的指令索引）
        this.PID = 0;
        this.parentPID = 0;
        this.state = ProcessState.READY;
        this.AST = modul.AST;
        this.instructions = modul.ILCode;
        this.labelMapping = new HashMap();
        this.heap = new Memory();
        this.PC = 0;
        this.currentClosureHandle = TOP_NODE_HANDLE;
        this.OPSTACK = new Array();
        this.FSTACK = new Array();
        //////////////////////////////
        //  TODO 进程初始化
        //////////////////////////////
        // AST中的静态对象移动到heap中
        // TODO：建议深拷贝
        this.heap = this.AST.nodes;
        // 标签分析
        this.LabelAnalysis();
        // 顶级闭包
        this.heap.NewHandle(TOP_NODE_HANDLE);
        this.heap.Set(TOP_NODE_HANDLE, new Closure(-1, TOP_NODE_HANDLE));
    }
    /* 栈和闭包操作 */
    // 向操作数栈中压入值
    PushOperand(value) {
        this.OPSTACK.push(value);
    }
    // 从操作数栈中弹出一个值
    PopOperand() {
        return this.OPSTACK.pop();
    }
    // 压入函数调用栈帧
    PushStackFrame(closureHandle, returnTarget) {
        let sf = new StackFrame(closureHandle, returnTarget);
        this.FSTACK.push(sf);
    }
    // 弹出函数调用栈帧
    PopStackFrame() {
        return this.FSTACK.pop();
    }
    // 新建闭包并返回把柄
    NewClosure(instructionAddress, parent) {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.heap.AllocateHandle("CLOSURE");
        // 新建一个空的闭包对象
        let closure = new Closure(instructionAddress, parent);
        // 存到堆区
        this.heap.Set(newClosureHandle, closure);
        return newClosureHandle;
    }
    // 根据闭包把柄获取闭包
    GetClosure(closureHandle) {
        return this.heap.Get(closureHandle);
    }
    // 获取进程的当前闭包
    GetCurrentClosure() {
        return this.heap.Get(this.currentClosureHandle);
    }
    // 设置进程的当前闭包
    SetCurrentClosure(closureHandle) {
        this.currentClosureHandle = closureHandle;
    }
    // 变量解引用（解引/用引）
    Dereference(variableName) {
        let currentClosure = this.GetCurrentClosure();
        // 首先查找约束变量
        if (currentClosure.HasBoundVariable(variableName)) {
            return currentClosure.GetBoundVariable(variableName);
        }
        // 然后查找自由变量
        let freeVarValue = null;
        if (currentClosure.HasFreeVariable(variableName)) {
            freeVarValue = currentClosure.GetFreeVariable(variableName);
        }
        // 上溯闭包
        let closureHandle = this.currentClosureHandle;
        while (closureHandle !== TOP_NODE_HANDLE) {
            currentClosure = this.GetClosure(closureHandle);
            if (currentClosure.HasBoundVariable(variableName)) {
                // 比对这个值与freeVar的值，如果一致则直接返回，如果不一致，以上溯的结果为准
                let boundVal = currentClosure.GetBoundVariable(variableName);
                if (freeVarValue !== boundVal) {
                    // 检查脏标记：
                    if (currentClosure.IsDirtyVariable(variableName)) {
                        return boundVal;
                    }
                    else {
                        return freeVarValue;
                    }
                }
                return boundVal;
            }
            closureHandle = currentClosure.parent;
        }
        throw `[Error] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }
    GC() {
        // 获取当前所有闭包空间的全部绑定、以及操作数栈内的把柄，作为可达性分析的根节点
        let gcroots = new Array();
        this.heap.ForEach((hd) => {
            let obj = this.heap.Get(hd);
            if (obj.type === "CLOSURE") {
                let currentClosure = obj;
                for (let bound in currentClosure.boundVariables) {
                    let boundValue = currentClosure.GetBoundVariable(bound);
                    if (TypeOfToken(boundValue) === "HANDLE") {
                        gcroots.push(boundValue);
                    }
                }
                for (let free in currentClosure.freeVariables) {
                    let freeValue = currentClosure.GetFreeVariable(free);
                    if (TypeOfToken(freeValue) === "HANDLE") {
                        gcroots.push(freeValue);
                    }
                }
            }
        });
        for (let r of this.OPSTACK) {
            if (TypeOfToken(r) === "HANDLE") {
                gcroots.push(r);
            }
        }
        for (let f of this.FSTACK) {
            let closure = this.heap.Get(f.closureHandle);
            if (closure.type === "CLOSURE") {
                let currentClosure = closure;
                for (let bound in currentClosure.boundVariables) {
                    let boundValue = currentClosure.GetBoundVariable(bound);
                    if (TypeOfToken(boundValue) === "HANDLE") {
                        gcroots.push(boundValue);
                    }
                }
                for (let free in currentClosure.freeVariables) {
                    let freeValue = currentClosure.GetFreeVariable(free);
                    if (TypeOfToken(freeValue) === "HANDLE") {
                        gcroots.push(freeValue);
                    }
                }
            }
        }
        // 仅标记列表和字符串，不处理闭包和续延。清除也是。
        let alives = new HashMap();
        let thisProcess = this;
        function GCMark(handle) {
            if (TypeOfToken(handle) !== "HANDLE")
                return;
            else if (thisProcess.heap.HasHandle(handle) !== true)
                return; // 被清理掉的对象
            let obj = thisProcess.heap.Get(handle);
            if (obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "APPLICATION") {
                alives.set(handle, true);
                for (let child of obj.children) {
                    GCMark(child);
                }
            }
            else if (obj.type === "STRING") {
                alives.set(handle, true);
            }
        }
        for (let root of gcroots) {
            GCMark(root);
        }
        // 凡是上位节点存活的，标记为存活
        // this.heap.ForEach((hd)=> {
        //     let obj = this.heap.Get(hd);
        //     let isStatic = (this.heap.metadata.get(hd).charAt(0) === "S");
        //     if(isStatic) return;
        //     else if(obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE") {
        //         if(alives.get(obj.parent) === true) {
        //             alives.set(hd, true);
        //         }
        //     }
        //     else return;
        // });
        // 清理
        let gcount = 0;
        let count = 0;
        this.heap.ForEach((hd) => {
            count++;
            let obj = this.heap.Get(hd);
            let isStatic = (this.heap.metadata.get(hd).charAt(0) === "S");
            if (isStatic)
                return;
            else if (obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "STRING") {
                if (alives.get(hd) !== true) {
                    this.heap.DeleteHandle(hd);
                    gcount++;
                }
            }
            else
                return;
        });
        if (gcount > 0) {
            console.info(`[GC] 已回收 ${gcount} / ${count} 个对象。`);
        }
    }
    /* 程序流程控制 */
    // 获取并解析当前指令
    CurrentInstruction() {
        let instString = (this.instructions)[this.PC];
        return new Instruction(instString);
    }
    // 解析标签为指令索引（地址）
    GetLabelAddress(label) {
        return this.labelMapping.get(label);
    }
    // 前进一步（PC加一）
    Step() {
        this.PC++;
    }
    // 前进一步跳转到（PC置数）
    Goto(instructionAddress) {
        this.PC = instructionAddress;
    }
    // 捕获当前续延并返回其把柄
    CaptureContinuation(contReturnTargetLable) {
        // 首先保存当前的（部分）进程环境
        let partialEnvironment = {
            currentClosureHandle: this.currentClosureHandle,
            OPSTACK: this.OPSTACK,
            FSTACK: this.FSTACK
        };
        // 新建续延对象
        let cont = new Continuation(partialEnvironment, contReturnTargetLable);
        // 分配一个续延把柄
        let contHandle = this.heap.AllocateHandle("CONTINUATION");
        // 将续延存到堆区
        this.heap.Set(contHandle, cont);
        return contHandle;
    }
    // 恢复指定的续延，并返回其返回目标位置的标签
    LoadContinuation(continuationHandle) {
        // 获取续延，并反序列化之
        let cont = this.heap.Get(continuationHandle);
        let newConfiguration = JSON.parse(cont.partialEnvironmentJson);
        // 恢复续延保存的环境
        this.currentClosureHandle = newConfiguration.currentClosureHandle;
        this.OPSTACK = newConfiguration.OPSTACK;
        this.FSTACK = newConfiguration.FSTACK;
        // 返回续延的返回位置标签
        return cont.contReturnTargetLable;
    }
    /* 反射相关 */
    // 中间语言指令序列的标签分析
    LabelAnalysis() {
        for (let i = 0; i < this.instructions.length; i++) {
            if ((this.instructions[i].trim())[0] === "@") {
                this.labelMapping.set(this.instructions[i].trim(), i);
            }
        }
    }
    /* 进程状态控制 */
    // 设置进程状态
    SetState(pstate) {
        this.state = pstate;
    }
}
// Runtime.ts
// 运行时环境
var VMState;
(function (VMState) {
    VMState["IDLE"] = "IDLE";
    VMState["RUNNING"] = "RUNNING";
})(VMState || (VMState = {}));
class Runtime {
    constructor(workingDir) {
        this.processPool = new Array();
        this.processQueue = new Array();
        this.ports = new HashMap();
        this.asyncCallback = () => { };
        this.outputBuffer = "";
        this.errorBuffer = "";
        this.workingDir = workingDir;
    }
    AllocatePID() {
        return this.processPool.length;
    }
    AddProcess(p) {
        // 检查是否已存在此线程
        if (this.processPool[p.PID] === undefined) {
            this.processPool[p.PID] = p;
        }
        this.processQueue.push(p.PID); // 加入队尾
        return p.PID;
    }
    //=================================================================
    //                       以下是进程调度器
    //=================================================================
    Tick(timeslice) {
        if (this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        // 取出队头线程
        let currentPID = this.processQueue.shift();
        let currentProcess = this.processPool[currentPID];
        currentProcess.state = ProcessState.RUNNING;
        // 执行时间片
        while (timeslice >= 0) {
            this.Execute(currentProcess, this);
            timeslice--;
            if (currentProcess.state === ProcessState.RUNNING) {
                continue;
            }
            else if (currentProcess.state === ProcessState.SLEEPING) {
                break;
            }
            else if (currentProcess.state === ProcessState.STOPPED) {
                // TODO REPL不能清理
                // delete this.processPool[currentPID]; // 清理掉执行完的进程
                break;
            }
        }
        // 后处理
        if (currentProcess.state === ProcessState.RUNNING) {
            // 仍在运行的进程加入队尾
            // currentProcess.GC(); // TODO 垃圾回收仍然不完善
            currentProcess.state = ProcessState.READY;
            this.processQueue.push(currentPID);
        }
        if (this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        else {
            return VMState.RUNNING;
        }
    }
    StartClock(callback) {
        /* NOTE 【执行时钟设计说明】为什么要用setInterval？
            设想两个进程，其中一个是常驻的无限循环进程，另一个是需要执行某Node.js异步操作的进程。
            根据Node.js的事件循环特性，如果单纯使用while(1)实现，则异步操作永远得不到执行。
            但如果单纯用setInterval实现，则性能极差。
            那么可以折中一下：
            程序的执行，在一个短的时间周期内（称为计算周期ComputingPhase），使用while()循环全力计算。
            全力计算一段时间后，由setInterval控制，结束当前计算周期，给异步事件处理的机会。
            计算周期的长度COMPUTATION_PHASE_LENGTH决定了VM的性能，以及异步事件响应的速度。
            如果COMPUTATION_PHASE_LENGTH=1，则退化为完全由setInterval控制的执行时钟，性能最差。
            如果COMPUTATION_PHASE_LENGTH=∞，则退化为完全由while控制的执行时钟，性能最佳，但异步事件得不到执行。
        */
        function Run() {
            let COMPUTATION_PHASE_LENGTH = 100; // TODO 这个值可以调整
            while (COMPUTATION_PHASE_LENGTH >= 0) {
                let avmState = this.Tick(1000);
                COMPUTATION_PHASE_LENGTH--;
                if (avmState === VMState.IDLE) {
                    clearInterval(CLOCK);
                    callback();
                    break;
                }
            }
        }
        let CLOCK = setInterval(() => {
            try {
                Run.call(this);
            }
            catch (e) {
                this.Error(e.toString());
                this.Error(`\n`);
            }
        }, 0);
    }
    //=================================================================
    //                      以下是控制台输入输出
    //=================================================================
    Output(str) {
        process.stdout.write(str);
        this.outputBuffer += str;
    }
    Error(str) {
        process.stderr.write(str);
        this.errorBuffer += str;
    }
    //=================================================================
    //                  以下是AIL指令实现（封装成函数）
    //=================================================================
    ///////////////////////////////////////
    // 第一类：基本存取指令
    ///////////////////////////////////////
    // store variable 将OP栈顶对象保存到当前闭包的约束变量中
    AIL_STORE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] store指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.PopOperand();
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, value);
        PROCESS.Step();
    }
    // load variable 解引用变量，并将对象压入OP栈顶
    AIL_LOAD(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] load指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.Dereference(variable);
        let valueType = TypeOfToken(value);
        // 值为标签，即loadclosure。
        if (valueType === 'LABEL') {
            let label = value;
            let instAddress = PROCESS.GetLabelAddress(label);
            let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
            let currentClosure = PROCESS.GetCurrentClosure();
            for (let v in currentClosure.freeVariables) {
                let value = currentClosure.GetFreeVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            for (let v in currentClosure.boundVariables) {
                let value = currentClosure.GetBoundVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            PROCESS.PushOperand(newClosureHandle);
            PROCESS.Step();
        }
        else {
            PROCESS.PushOperand(value);
            PROCESS.Step();
        }
    }
    // loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
    AIL_LOADCLOSURE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] loadclosure指令参数类型不是标签`;
        }
        let label = argument;
        let instAddress = PROCESS.GetLabelAddress(label);
        let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
        let currentClosure = PROCESS.GetCurrentClosure();
        for (let v in currentClosure.freeVariables) {
            let value = currentClosure.GetFreeVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        for (let v in currentClosure.boundVariables) {
            let value = currentClosure.GetBoundVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        PROCESS.PushOperand(newClosureHandle);
        PROCESS.Step();
    }
    // push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
    AIL_PUSH(argument, PROCESS, RUNTIME) {
        // 允许所有类型的参数
        PROCESS.PushOperand(argument);
        PROCESS.Step();
    }
    // pop 弹出并抛弃OP栈顶
    AIL_POP(argument, PROCESS, RUNTIME) {
        PROCESS.PopOperand();
        PROCESS.Step();
    }
    // swap 交换OP栈顶的两个对象的顺序
    AIL_SWAP(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        PROCESS.PushOperand(top1);
        PROCESS.PushOperand(top2);
        PROCESS.Step();
    }
    // set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）
    AIL_SET(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] set指令参数类型不是变量`;
        }
        let variable = argument;
        let rightValue = PROCESS.PopOperand();
        // 修改当前闭包内部的绑定
        let currentClosure = PROCESS.GetCurrentClosure();
        if (currentClosure.HasBoundVariable(variable)) {
            PROCESS.GetCurrentClosure().SetBoundVariable(variable, rightValue); // 带脏标记
        }
        if (currentClosure.HasFreeVariable(variable)) {
            PROCESS.GetCurrentClosure().SetFreeVariable(variable, rightValue); // 带脏标记
        }
        // 沿闭包链上溯，直到找到该变量作为约束变量所在的上级闭包，修改绑定
        let currentClosureHandle = PROCESS.currentClosureHandle;
        while (currentClosureHandle !== TOP_NODE_HANDLE && PROCESS.heap.HasHandle(currentClosureHandle)) {
            let currentClosure = PROCESS.GetClosure(currentClosureHandle);
            if (currentClosure.HasBoundVariable(variable)) {
                PROCESS.GetClosure(currentClosureHandle).SetBoundVariable(variable, rightValue); // 带脏标记
                break;
            }
            currentClosureHandle = currentClosure.parent;
        }
        PROCESS.Step();
    }
    ///////////////////////////////////////
    // 第二类：分支跳转指令
    ///////////////////////////////////////
    // 辅助函数：本地宿主函数调用
    CallNative(target, PROCESS, RUNTIME) {
        // NOTE native不压栈帧
        let nativeModuleName = target.split(".")[0];
        let nativeFunctionName = target.split(".").slice(1).join("");
        // 引入Native模块
        let nativeModulePath = PathUtils.Join(process.cwd(), `lib/${nativeModuleName}.js`);
        let nativeModule = require(nativeModulePath);
        // 调用Native模块内部的函数
        (nativeModule[nativeFunctionName])(PROCESS, RUNTIME);
    }
    // 辅助函数：可以任意指定返回指令地址的函数调用（非尾调用）。这一函数用于支持异步过程调用（如事件回调），同时也用于实现普通的同步过程调用。
    CallAsync(returnTarget, argument, PROCESS, RUNTIME) {
        let target;
        if (TypeOfToken(argument) === "VARIABLE") {
            // 首先判断是否为Native调用
            let variable = argument;
            if (PROCESS.AST.IsNativeCall(variable)) {
                this.CallNative(variable, PROCESS, RUNTIME);
                return;
            }
            else {
                target = PROCESS.Dereference(variable);
            }
        }
        else {
            target = argument;
        }
        let targetType = TypeOfToken(target);
        if (PROCESS.AST.IsNativeCall(target)) {
            this.CallNative(target, PROCESS, RUNTIME);
            return;
        }
        else if (targetType === "KEYWORD") {
            // NOTE primitive不压栈帧
            let mnemonic = PrimitiveInstruction[target] || target;
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
        else if (targetType === "LABEL") {
            PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
            let instructionAddress = PROCESS.GetLabelAddress(target);
            let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
            let currentClosure = PROCESS.GetCurrentClosure();
            for (let v in currentClosure.freeVariables) {
                let value = currentClosure.GetFreeVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            for (let v in currentClosure.boundVariables) {
                let value = currentClosure.GetBoundVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            PROCESS.SetCurrentClosure(newClosureHandle);
            PROCESS.Goto(instructionAddress);
        }
        else if (targetType === "HANDLE") {
            let handle = target;
            let obj = PROCESS.heap.Get(handle);
            let objType = obj.type;
            // 闭包：函数实例
            if (objType === SchemeObjectType.CLOSURE) {
                PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
                let targetClosure = obj;
                PROCESS.SetCurrentClosure(handle);
                PROCESS.Goto(targetClosure.instructionAddress);
            }
            // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
            else if (objType === SchemeObjectType.CONTINUATION) {
                PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
                let top = PROCESS.PopOperand();
                let returnTargetLabel = PROCESS.LoadContinuation(handle);
                PROCESS.PushOperand(top);
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
            }
        }
        else {
            throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
        }
    }
    //call arg 函数调用（包括continuation、native函数）
    AIL_CALL(argument, PROCESS, RUNTIME) {
        this.CallAsync(PROCESS.PC + 1, argument, PROCESS, RUNTIME);
    }
    //tailcall arg 函数尾调用
    AIL_TAILCALL(argument, PROCESS, RUNTIME) {
        // 与call唯一的不同就是调用前不压栈帧，所以下面这坨代码是可以整体复用的
        let target;
        if (TypeOfToken(argument) === "VARIABLE") {
            // 首先判断是否为Native调用
            let variable = argument;
            if (PROCESS.AST.IsNativeCall(variable)) {
                this.CallNative(variable, PROCESS, RUNTIME);
                return;
            }
            else {
                target = PROCESS.Dereference(variable);
            }
        }
        else {
            target = argument;
        }
        let targetType = TypeOfToken(target);
        if (PROCESS.AST.IsNativeCall(target)) {
            this.CallNative(target, PROCESS, RUNTIME);
            return;
        }
        else if (targetType === "KEYWORD") {
            // NOTE primitive不压栈帧
            let mnemonic = PrimitiveInstruction[target] || target;
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
        else if (targetType === "LABEL") {
            let instructionAddress = PROCESS.GetLabelAddress(target);
            let currentClosure = PROCESS.GetCurrentClosure();
            if (currentClosure.instructionAddress !== instructionAddress) {
                let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
                for (let v in currentClosure.freeVariables) {
                    let value = currentClosure.GetFreeVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                for (let v in currentClosure.boundVariables) {
                    let value = currentClosure.GetBoundVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                PROCESS.SetCurrentClosure(newClosureHandle);
            }
            PROCESS.Goto(instructionAddress);
        }
        else if (targetType === "HANDLE") {
            let handle = target;
            let obj = PROCESS.heap.Get(handle);
            let objType = obj.type;
            // 闭包：函数实例
            if (objType === SchemeObjectType.CLOSURE) {
                let targetClosure = obj;
                PROCESS.SetCurrentClosure(handle);
                PROCESS.Goto(targetClosure.instructionAddress);
            }
            // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
            else if (objType === SchemeObjectType.CONTINUATION) {
                let top = PROCESS.PopOperand();
                let returnTargetLabel = PROCESS.LoadContinuation(handle);
                PROCESS.PushOperand(top);
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
            }
        }
        else {
            throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
        }
    }
    //return 函数返回
    AIL_RETURN(argument, PROCESS, RUNTIME) {
        let stackframe = PROCESS.PopStackFrame(); // 栈帧退栈
        PROCESS.SetCurrentClosure(stackframe.closureHandle); // 修改当前闭包
        PROCESS.Goto(stackframe.returnTargetAddress); // 跳转到返回地址
        stackframe = null; // 销毁当前栈帧
    }
    //capturecc variable 捕获当前Continuation并将其把柄保存在变量中
    AIL_CAPTURECC(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] capturecc指令参数类型不是变量`;
        }
        let variable = argument;
        let retTargetLable = `@${variable}`; // NOTE【约定】cont返回点的标签名称 = @ + cont被保存的变量名称
        let contHandle = PROCESS.CaptureContinuation(retTargetLable);
        // console.info(`[Info] Continuation ${variable} 已捕获，对应的返回标签 ${retTargetLable}`);
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, contHandle);
        PROCESS.Step();
    }
    //iftrue label 如果OP栈顶条件不为false则跳转
    AIL_IFTRUE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] iftrue指令的参数必须是标签`;
        }
        let label = argument;
        let condition = PROCESS.PopOperand();
        if (condition !== '#f') {
            let targetAddress = PROCESS.GetLabelAddress(label);
            PROCESS.Goto(targetAddress);
        }
        else {
            PROCESS.Step();
        }
    }
    //iffalse label 如果OP栈顶条件为false则跳转
    AIL_IFFALSE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] iffalse指令的参数必须是标签`;
        }
        let label = argument;
        let condition = PROCESS.PopOperand();
        if (condition === '#f') {
            let targetAddress = PROCESS.GetLabelAddress(label);
            PROCESS.Goto(targetAddress);
        }
        else {
            PROCESS.Step();
        }
    }
    //goto label 无条件跳转
    AIL_GOTO(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] goto指令的参数必须是标签`;
        }
        let label = argument;
        let targetAddress = PROCESS.GetLabelAddress(label);
        PROCESS.Goto(targetAddress);
    }
    ///////////////////////////////////////
    // 第三类：列表操作指令
    ///////////////////////////////////////
    // car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
    AIL_CAR(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let firstElement = listObj.children[0];
                PROCESS.PushOperand(firstElement);
                PROCESS.Step();
            }
            else {
                throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    // cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
    AIL_CDR(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if (listObj.children.length <= 0) {
                    throw `[Error] cdr参数不能是空表。`;
                }
                let newListHandle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList;
                if (listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(1);
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    // cons 同Scheme的cons
    AIL_CONS(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        let firstElement = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let newListHandle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList;
                if (listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(); // 复制数组
                newList.children.unshift(firstElement); // 并在左侧插入元素
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    ///////////////////////////////////////
    // 第四类：算术逻辑运算和谓词
    ///////////////////////////////////////
    // add 实数加法
    AIL_ADD(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 + operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // sub 实数减法
    AIL_SUB(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 - operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // mul 实数乘法
    AIL_MUL(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 * operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // div 实数除法
    AIL_DIV(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            if (operand1 <= Number.EPSILON && operand1 >= -Number.EPSILON) {
                throw `[Error] 除零`;
            }
            let result = operand2 / operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // mod 求余
    AIL_MOD(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 % operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // pow 求幂
    AIL_POW(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = Math.pow(operand2, operand1);
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // eqn =
    AIL_EQN(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (Math.abs(operand2 - operand1) <= Number.EPSILON) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // ge >=
    AIL_GE(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 >= operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // le <=
    AIL_LE(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 <= operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // gt >
    AIL_GT(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 > operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // lt <
    AIL_LT(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 < operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // not
    AIL_NOT(argument, PROCESS, RUNTIME) {
        let top = PROCESS.PopOperand();
        PROCESS.PushOperand((top === "#f") ? "#t" : "#f");
        PROCESS.Step();
    }
    // and
    AIL_AND(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (top1 === "#f" || top2 === "#f") {
            PROCESS.PushOperand("#f");
        }
        else {
            PROCESS.PushOperand("#t");
        }
        PROCESS.Step();
    }
    // or
    AIL_OR(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (top1 !== "#f" && top2 !== "#f") {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // eq?
    // TODO eq?的逻辑需要进一步精确化
    AIL_ISEQ(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (String(top1) === String(top2)) {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // null?
    AIL_ISNULL(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if (listObj.children.length <= 0) {
                    PROCESS.PushOperand("#t");
                }
                else {
                    PROCESS.PushOperand("#f");
                }
            }
            else {
                PROCESS.PushOperand("#f");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // atom?
    AIL_ISATOM(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            PROCESS.PushOperand("#f");
        }
        else {
            PROCESS.PushOperand("#t");
        }
        PROCESS.Step();
    }
    // list?
    AIL_ISLIST(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if (listObj.type === "STRING") {
                PROCESS.PushOperand("#f");
            }
            else {
                PROCESS.PushOperand("#t");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // number?
    AIL_ISNUMBER(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'NUMBER') {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    ///////////////////////////////////////
    // 第五类：其他指令
    ///////////////////////////////////////
    // fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
    AIL_FORK(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType === "HANDLE") {
            let node = PROCESS.heap.Get(argument);
            if (node.type === "APPLICATION") {
                let basePath = PathUtils.DirName(PROCESS.AST.absolutePath);
                let modul = LoadModuleFromNode(PROCESS.AST, argument, basePath);
                let newProcess = new Process(modul);
                // 分配新的PID
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else if (node.type === "STRING") {
                let modulePath = TrimQuotes(node.content);
                // 将相对路径拼接为绝对路径
                let basePath = PathUtils.DirName(PROCESS.AST.absolutePath);
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    modulePath = PathUtils.Join(basePath, modulePath);
                }
                let forkedModule = LoadModule(modulePath, basePath);
                // 构造新进程，并分配PID
                let newProcess = new Process(forkedModule);
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else {
                throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
            }
        }
        else {
            throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
        }
        PROCESS.Step();
    }
    // display arg 调试输出
    AIL_DISPLAY(argument, PROCESS, RUNTIME) {
        let content = PROCESS.OPSTACK.pop();
        let contentType = TypeOfToken(content);
        if (contentType === "HANDLE") {
            let obj = PROCESS.heap.Get(content);
            if (obj.type === "STRING") {
                RUNTIME.Output(`${TrimQuotes(obj.content)}`);
            }
            else {
                let str = PROCESS.AST.NodeToString(content);
                RUNTIME.Output(`${str}`);
            }
        }
        else {
            if (content === undefined) {
                RUNTIME.Output(`#undefined`);
            }
            else {
                RUNTIME.Output(`${String(content)}`);
            }
        }
        PROCESS.Step();
    }
    // newline 调试输出换行
    AIL_NEWLINE(argument, PROCESS, RUNTIME) {
        RUNTIME.Output(`\n`);
        PROCESS.Step();
    }
    // read 读端口内容
    AIL_READ(argument, PROCESS, RUNTIME) {
        let port = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(port) === 'PORT') {
            PROCESS.PushOperand(RUNTIME.ports.get(port));
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }
    // write 写端口内容
    AIL_WRITE(argument, PROCESS, RUNTIME) {
        let value = PROCESS.PopOperand();
        let port = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(port) === 'PORT') {
            RUNTIME.ports.set(port, value);
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }
    // nop 空指令
    AIL_NOP(argument, PROCESS, RUNTIME) {
        PROCESS.Step();
    }
    // pause 暂停当前进程
    AIL_PAUSE(argument, PROCESS, RUNTIME) {
        PROCESS.SetState(ProcessState.SUSPENDED);
    }
    // halt 停止当前进程
    AIL_HALT(argument, PROCESS, RUNTIME) {
        PROCESS.SetState(ProcessState.STOPPED);
    }
    // set-child! handle 修改列表元素
    AIL_SETCHILD(argument, PROCESS, RUNTIME) {
        let index = PROCESS.PopOperand();
        let value = PROCESS.PopOperand();
        if (TypeOfToken(argument) === "HANDLE") {
            PROCESS.heap.Get(argument).children[parseInt(index)] = value;
            PROCESS.Step();
        }
        else {
            throw `[Error] set-child!参数类型不正确`;
        }
    }
    // concat 将若干元素连接为新列表，同时修改各子列表的parent字段为自身把柄
    // 栈参数：child1 child2 ... n
    AIL_CONCAT(argument, PROCESS, RUNTIME) {
        let length = parseInt(PROCESS.PopOperand());
        let children = new Array();
        for (let i = length - 1; i >= 0; i--) {
            children[i] = PROCESS.PopOperand();
        }
        let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
        let newList = new QuoteObject(TOP_NODE_HANDLE);
        for (let i = 0; i < length; i++) {
            newList.children[i] = children[i];
            // 设置子节点的parent字段
            if (TypeOfToken(children[i]) === "HANDLE") {
                let childObj = PROCESS.heap.Get(children[i]);
                if (childObj.type === "QUOTE" || childObj.type === "QUASIQUOTE" || childObj.type === "UNQUOTE" || childObj.type === "APPLICATION") {
                    PROCESS.heap.Get(children[i]).parent = newListHandle;
                }
            }
        }
        PROCESS.heap.Set(newListHandle, newList);
        PROCESS.PushOperand(newListHandle);
        PROCESS.Step();
    }
    // duplicate 递归复制对象，并分配把柄
    AIL_DUPLICATE(argument, PROCESS, RUNTIME) {
        // 堆对象深拷贝，并分配新的堆地址
        function DeepCopy(sourceHandle, parentHandle) {
            if (TypeOfToken(sourceHandle) === "HANDLE") {
                // 跳过已经被复制的对象（非静态对象）
                // if(PROCESS.heap.HasHandle(handle) !== true || PROCESS.heap.IsStatic(sourceHandle) === false) {
                //     return sourceHandle;
                // }
                let newObject = PROCESS.heap.Get(sourceHandle).Copy();
                let newHandle = PROCESS.heap.AllocateHandle(newObject.type, false);
                if (["QUOTE", "QUASIQUOTE", "UNQUOTE", "APPLICATION", "LAMBDA"].indexOf(newObject.type) >= 0) {
                    newObject.parent = parentHandle;
                    for (let i = 0; i < newObject.children.length; i++) {
                        (newObject.children)[i] = DeepCopy((newObject.children)[i], newHandle);
                    }
                }
                PROCESS.heap.Set(newHandle, newObject);
                return newHandle;
            }
            else {
                return sourceHandle;
            }
        }
        let handle = PROCESS.PopOperand();
        if (TypeOfToken(handle) !== "HANDLE") {
            throw `[Error] duplicate参数类型不正确`;
        }
        else {
            let parentHandle = PROCESS.heap.Get(handle).parent;
            PROCESS.PushOperand(DeepCopy(handle, parentHandle));
            PROCESS.Step();
        }
    }
    // 执行（一条）中间语言指令
    // 执行的效果从宏观上看就是修改了进程内部和运行时环境的状态，并且使用运行时环境提供的接口和资源
    Execute(PROCESS, RUNTIME) {
        // 取出当前指令
        let instruction = PROCESS.CurrentInstruction();
        let mnemonic = instruction.mnemonic;
        let argument = instruction.argument;
        // 译码：分配执行路径
        if (instruction.type === "COMMENT" || instruction.type === "LABEL") {
            PROCESS.Step(); // 跳过注释和标签
        }
        else {
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
    }
    ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME) {
        if (mnemonic === "store") {
            this.AIL_STORE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "load") {
            this.AIL_LOAD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "loadclosure") {
            this.AIL_LOADCLOSURE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "push") {
            this.AIL_PUSH(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "pop") {
            this.AIL_POP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "swap") {
            this.AIL_SWAP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "set") {
            this.AIL_SET(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'call') {
            this.AIL_CALL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'tailcall') {
            this.AIL_TAILCALL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'return') {
            this.AIL_RETURN(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'capturecc') {
            this.AIL_CAPTURECC(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'iftrue') {
            this.AIL_IFTRUE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'iffalse') {
            this.AIL_IFFALSE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'goto') {
            this.AIL_GOTO(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'car') {
            this.AIL_CAR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'cdr') {
            this.AIL_CDR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'cons') {
            this.AIL_CONS(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'add') {
            this.AIL_ADD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'sub') {
            this.AIL_SUB(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'mul') {
            this.AIL_MUL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'div') {
            this.AIL_DIV(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'mod') {
            this.AIL_MOD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'pow') {
            this.AIL_POW(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'eqn') {
            this.AIL_EQN(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'ge') {
            this.AIL_GE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'le') {
            this.AIL_LE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'gt') {
            this.AIL_GT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'lt') {
            this.AIL_LT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'not') {
            this.AIL_NOT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'and') {
            this.AIL_AND(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'or') {
            this.AIL_OR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'eq?') {
            this.AIL_ISEQ(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'null?') {
            this.AIL_ISNULL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'atom?') {
            this.AIL_ISATOM(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'list?') {
            this.AIL_ISLIST(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'number?') {
            this.AIL_ISNUMBER(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'fork') {
            this.AIL_FORK(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'display') {
            this.AIL_DISPLAY(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'newline') {
            this.AIL_NEWLINE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'read') {
            this.AIL_READ(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'write') {
            this.AIL_WRITE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "nop") {
            this.AIL_NOP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'pause') {
            this.AIL_PAUSE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'halt') {
            this.AIL_HALT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'set-child!') {
            this.AIL_SETCHILD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'concat') {
            this.AIL_CONCAT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'duplicate') {
            this.AIL_DUPLICATE(argument, PROCESS, RUNTIME);
        }
    }
}
// Instruction.ts
// 指令集定义
/**
# 指令集实现

## 指令列表

### 第一类：基本存取指令

- store variable 将OP栈顶对象保存到当前闭包的约束变量中
- load variable 解引用变量，并将对象压入OP栈顶
- loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
- push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
- pop 弹出并抛弃OP栈顶
- swap 交换OP栈顶的两个对象的顺序
- set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）

### 第二类：分支跳转指令

- call arg 函数调用（包括continuation、native函数）
- tailcall arg 函数尾调用
- return 函数返回
- capturecc variable 捕获当前Continuation并将其把柄保存在变量中
- iftrue label 如果OP栈顶条件不为false则跳转
- iffalse label 如果OP栈顶条件为false则跳转
- goto label 无条件跳转

### 第三类：列表操作指令

- car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
- cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
- cons 同Scheme的cons

### 第四类：算术逻辑运算和谓词

- add/sub/mul/div/mod/pow
- eqn/lt/gt/le/ge
- and/or/not（注意and和or不同于Scheme的and/or，因Scheme的and/or有短路特性，本质上是条件分支）
- atom?/list?/null?

### 第五类：其他指令

- fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
- nop 空指令
- pause 暂停当前进程
- halt 停止当前进程

*/
class Instruction {
    // 解析指令，并构造为指令对象
    constructor(instString) {
        instString = instString.trim();
        if (/^\s*\;[\s\S]*$/.test(instString)) { // 注释
            this.type = "COMMENT";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else if (instString[0] === '@') { // 标签
            this.type = "LABEL";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else { // 普通指令
            let fields = instString.split(/\s+/i);
            let mnemonic = fields[0].toLowerCase();
            let argument = fields[1];
            this.type = "INSTRUCTION";
            this.instruction = instString;
            this.mnemonic = mnemonic;
            this.argument = argument;
            this.argType = TypeOfToken(argument);
        }
    }
}
// REPL.ts
// Read-Eval-Print Loop
class REPL {
    constructor() {
        this.allCode = new Array();
        this.RUNTIME = new Runtime(process.cwd());
        this.inputBuffer = new Array();
    }
    run(input, callback) {
        try {
            let code = `((lambda () ${this.allCode.join(" ")} (display ${input}) (newline) ))\n`;
            let mod = LoadModuleFromCode(code, PathUtils.Join(this.RUNTIME.workingDir, "repl.scm"));
            let proc = new Process(mod);
            proc.PID = 0;
            this.RUNTIME.asyncCallback = callback; // NOTE 用于文件读写等异步操作结束之后执行
            this.RUNTIME.processPool[0] = proc;
            this.RUNTIME.AddProcess(proc);
            this.RUNTIME.StartClock(callback);
            // TODO 仅保留有副作用的语句
            if (/define|set!|native|import/gi.test(input)) {
                this.allCode.push(input);
            }
        }
        catch (e) {
            process.stderr.write(`${e.toString()}\n`);
            // 即便报错也要保留define语句
            if (/define/gi.test(input)) {
                this.allCode.push(input);
            }
            callback();
        }
    }
    CountBrackets(input) {
        let bcount = 0;
        for (let i = 0; i < input.length; i++) {
            if (input[i] === "(" || input[i] === "{")
                bcount++;
            else if (input[i] === ")" || input[i] === "}")
                bcount--;
        }
        return bcount;
    }
    ReadEvalPrint(input) {
        input = input.toString();
        if (input.trim() === ".help") {
            this.RUNTIME.Output(`Animac Scheme Implementation V2023-alpha\n`);
            this.RUNTIME.Output(`Copyright (c) 2019~2023 BD4SUR\n`);
            this.RUNTIME.Output(`https://github.com/bd4sur/Animac\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`REPL Command Reference:\n`);
            this.RUNTIME.Output(`  .exit     exit the REPL.\n`);
            this.RUNTIME.Output(`  .reset    reset the REPL to initial state.\n`);
            this.RUNTIME.Output(`  .help     show usage and copyright information.\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`> `);
            return;
        }
        else if (input.trim() === ".exit") {
            process.exit();
        }
        else if (input.trim() === ".reset") {
            this.allCode = new Array();
            this.RUNTIME.Output(`REPL已重置。\n`);
            this.RUNTIME.Output(`> `);
            return;
        }
        this.inputBuffer.push(input);
        let code = this.inputBuffer.join("");
        let indentLevel = this.CountBrackets(code);
        if (indentLevel === 0) {
            this.inputBuffer = new Array();
            this.run(code, () => {
                if (this.RUNTIME.processPool[0] !== undefined && this.RUNTIME.processPool[0].state === ProcessState.SLEEPING) {
                    return;
                }
                else {
                    this.RUNTIME.Output("> ");
                }
            });
        }
        else if (indentLevel > 0) {
            let prompt = "...";
            let icount = indentLevel - 1;
            while (icount > 0) {
                prompt += "..";
                icount--;
            }
            this.RUNTIME.Output(`${prompt} `);
        }
        else {
            this.inputBuffer = new Array();
            this.RUNTIME.Error(`[REPL Error] 括号不匹配\n`);
        }
    }
    Start() {
        this.RUNTIME.Output(`Animac Scheme Implementation V2023-alpha\n`);
        this.RUNTIME.Output(`Copyright (c) 2019~2023 BD4SUR\n`);
        this.RUNTIME.Output(`Type ".help" for more information.\n`);
        this.RUNTIME.Output(`> `);
        process.stdin.on("data", (input) => { this.ReadEvalPrint(input); });
    }
}
const http = require('http');
const url = require('url');
const DebugServerConfig = {
    'portNumber': 8088,
    'MIME': {
        "css": "text/css",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "bmp": "image/bmp",
        "webp": "image/webp",
        "js": "text/javascript",
        "ico": "image/vnd.microsoft.icon",
        "mp3": "audio/mpeg",
        "woff": "application/font-woff",
        "woff2": "font/woff2",
        "ttf": "application/x-font-truetype",
        "otf": "application/x-font-opentype",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "svg": "image/svg+xml"
    },
};
// 启动调试服务器
function StartDebugServer() {
    let RUNTIME = new Runtime(process.cwd());
    function loadCode(codefiles, baseModuleID) {
        let mod = LoadModuleFromCode(`((lambda () ${codefiles[0]}))`, baseModuleID);
        let proc = new Process(mod);
        proc.PID = 0;
        RUNTIME.asyncCallback = () => { };
        RUNTIME.processPool[0] = proc;
        RUNTIME.AddProcess(proc);
    }
    // 工具函数：用于判断某字符串是否以另一个字符串结尾
    function IsEndWith(test, endPattern) {
        let reg = new RegExp(endPattern + '$', 'i');
        return reg.test(test);
    }
    http.createServer((request, response) => {
        // 请求数据
        let incomeData = '';
        // 响应结构
        let res = {
            process: null,
            outputBuffer: null
        };
        // 解析请求，包括文件名
        let reqPath = url.parse(request.url).pathname.substr(1);
        let filePath = path.join(process.cwd(), "ide", url.parse(request.url).pathname);
        request.on('data', (chunk) => {
            incomeData += chunk;
        });
        request.on('end', () => {
            let now = new Date();
            console.log(`${now.toLocaleDateString()} ${now.toLocaleTimeString()} 收到请求：${request.url}`);
            // 默认主页
            if (reqPath === '') {
                readFileSystem(filePath + "index.html");
            }
            else if (reqPath === "load") {
                let codefiles = JSON.parse(incomeData);
                loadCode(codefiles, "ADB");
            }
            else if (reqPath === "execute") {
                RUNTIME.StartClock(() => {
                    res.process = RUNTIME.processPool[0];
                    res.outputBuffer = RUNTIME.outputBuffer;
                    response.writeHead(200, { 'Content-Type': 'application/json' });
                    response.write(JSON.stringify(res));
                    response.end();
                });
            }
            else if (reqPath === "step") {
                RUNTIME.Tick(0);
                res.process = RUNTIME.processPool[0];
                res.outputBuffer = RUNTIME.outputBuffer;
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.write(JSON.stringify(res));
                response.end();
            }
            else if (reqPath === "reset") {
                RUNTIME.outputBuffer = "";
                RUNTIME.errorBuffer = "";
                RUNTIME.processPool = new Array();
                RUNTIME.processQueue = new Array();
                res.process = RUNTIME.processPool[0];
                res.outputBuffer = RUNTIME.outputBuffer;
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.write(JSON.stringify(res));
                response.end();
            }
            else {
                readFileSystem(decodeURI(filePath));
            }
            // 从文件系统读取相应的数据，向客户端返回
            function readFileSystem(reqPath) {
                fs.readFile(reqPath, function (err, data) {
                    // 处理404，返回预先设置好的404页
                    if (err) {
                        console.log("404 ERROR");
                        fs.readFile('404.html', function (err, data) {
                            // 如果连404页都找不到
                            if (err) {
                                response.writeHead(404, { 'Content-Type': 'text/html' });
                                response.write('<head><meta charset="utf-8"/></head><h1>真·404</h1>');
                            }
                            else {
                                response.writeHead(404, { 'Content-Type': 'text/html' });
                                response.write(data.toString());
                            }
                            response.end(); // 响应
                        });
                        return;
                    }
                    else {
                        // 默认MIME标记
                        let defaultFlag = true;
                        // 根据后缀，检查所有的已有的MIME类型（如果可以硬编码是不是好一点？可能要用到所谓的元编程了）
                        for (let suffix in DebugServerConfig.MIME) {
                            if (IsEndWith(reqPath, '.' + suffix)) {
                                defaultFlag = false;
                                let mimeType = DebugServerConfig.MIME[suffix];
                                response.writeHead(200, { 'Content-Type': mimeType });
                                if ((mimeType.split('/'))[0] === 'text') {
                                    response.write(data.toString());
                                }
                                else {
                                    response.write(data);
                                }
                            }
                        }
                        // 默认MIME类型：text
                        if (defaultFlag === true) {
                            response.writeHead(200, { 'Content-Type': 'text/html' });
                            response.write(data.toString());
                        }
                    }
                    response.end(); // 响应
                });
            }
        });
    }).listen(DebugServerConfig.portNumber);
    console.log(`Animac调试服务器已启动，正在监听端口：${DebugServerConfig.portNumber}`);
}
///////////////////////////////////////////////
// Main.ts
// 系统入口（外壳）
// 将Scheme代码文件编译为可执行文件
function compileCodeToExecutable(inputAbsPath, outputAbsPath) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(inputAbsPath);
    let linkedModule = LoadModule(inputAbsPath, workingDir);
    fs.writeFileSync(outputAbsPath, JSON.stringify(linkedModule, null, 2), "utf-8");
}
// 直接执行模块文件
function runFromExecutable(execAbsPath) {
    let workingDir = process.cwd();
    let moduleJson = JSON.parse(fs.readFileSync(execAbsPath, "utf-8"));
    let PROCESS = new Process(moduleJson);
    let RUNTIME = new Runtime(workingDir);
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(() => { });
}
function runFromFile(srcAbsPath) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(srcAbsPath);
    let linkedModule = LoadModule(srcAbsPath, workingDir);
    // fs.writeFileSync("module.json", JSON.stringify(linkedModule, null, 2), "utf-8");
    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(() => { });
}
function runFromCode(code) {
    let workingDir = process.cwd();
    let virtualFilename = "temp.scm";
    code = `((lambda () (display { ${code} }) (newline) ))\n`;
    let linkedModule = LoadModuleFromCode(code, PathUtils.Join(workingDir, virtualFilename));
    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(() => { });
}
function shellPrompt() {
}
function Main() {
    let argv = process.argv.slice(2);
    let option = (argv[0] || "").trim().toLowerCase();
    // REPL
    if (option === "") {
        let sourcePath = TrimQuotes(argv[1]);
        if (sourcePath.length > 0) {
            // 相对路径补全为绝对路径
            if (PathUtils.IsAbsolutePath(sourcePath) === false) {
                sourcePath = PathUtils.Join(process.cwd(), sourcePath);
            }
            runFromFile(sourcePath);
        }
        else {
            let repl = new REPL();
            repl.Start();
        }
    }
    // 从stdin读取代码并执行
    else if (option === "-") {
        process.stdin.on("data", (input) => {
            runFromCode(input.toString());
        });
    }
    else if (option === "-c" || option === "--compile") {
        let inputPath = TrimQuotes(argv[1]);
        let outputPath = TrimQuotes(argv[2]);
        if (PathUtils.IsAbsolutePath(inputPath) === false) {
            inputPath = PathUtils.Join(process.cwd(), inputPath);
        }
        outputPath = (outputPath.length > 0) ? outputPath : (PathUtils.BaseName(inputPath, ".scm") + ".json");
        if (PathUtils.IsAbsolutePath(outputPath) === false) {
            outputPath = PathUtils.Join(PathUtils.DirName(inputPath), outputPath);
        }
        compileCodeToExecutable(inputPath, outputPath);
        console.log(`Compiled Animac VM executable file saved at: ${outputPath}\n`);
    }
    else if (option === "-d" || option === "--debug") {
        StartDebugServer();
    }
    else if (option === "-e" || option === "--eval") {
        let code = TrimQuotes(argv[1]);
        runFromCode(code.toString());
    }
    // 显示帮助信息
    else if (option === "-h" || option === "--help") {
        console.log(ANIMAC_HELP);
    }
    // 解释执行编译后的模块
    else if (option === "-i" || option === "--intp") {
        let modulePath = TrimQuotes(argv[1]);
        if (PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(process.cwd(), modulePath);
        }
        runFromExecutable(modulePath);
    }
    else if (option === "-r" || option === "--repl") {
        let repl = new REPL();
        repl.Start();
    }
    else if (option === "-v" || option === "--version") {
        console.log(`V${ANIMAC_VERSION}`);
    }
    // 如果没有可识别的参数，则第一个参数视为输入代码路径
    else {
        let sourcePath = TrimQuotes(argv[0]);
        // 相对路径补全为绝对路径
        if (PathUtils.IsAbsolutePath(sourcePath) === false) {
            sourcePath = PathUtils.Join(process.cwd(), sourcePath);
        }
        runFromFile(sourcePath);
    }
}
Main();
