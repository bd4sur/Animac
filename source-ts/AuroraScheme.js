// Utility.ts
// 工具函数
// 状态常量
const SUCCEED = 0;
// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}
// SchemeObjects.ts
// 内存管理和对象定义
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
}
// 基于HashMap的对象存储区，用于实现pool、heap等
class Memory {
    constructor() {
        this.data = new HashMap();
        this.metadata = new HashMap();
        this.handleCounter = 0;
    }
    // 动态分配堆对象把柄
    NewHandle(typeTag, referrer) {
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        this.data.set(handle, null);
        this.metadata.set(handle, {
            static: false,
            readOnly: false,
            status: 'allocated',
            referrer: [referrer]
        });
        this.handleCounter++;
        return handle;
    }
    // 动态回收堆对象把柄：删除堆中相应位置
    DeleteHandle(handle) {
        this.data.set(handle, undefined);
        this.metadata.set(handle, {
            static: false,
            readOnly: false,
            status: 'free',
            referrer: null
        });
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
            throw `[Memory.Set] 未分配的把柄:${handle}`;
        }
        else if (metadata.readOnly) {
            throw `[Memory.Set] 不允许修改只读对象:${handle}`;
        }
        else if (metadata.static) {
            console.warn(`[Memory.Set] 修改了静态对象:${handle}`);
        }
        else {
            metadata.status = 'modified';
            this.metadata.set(handle, metadata);
            this.data.set(handle, value);
        }
    }
}
class SchemeObject {
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
}
// Quote列表对象
class QuoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUOTE;
        this.parent = parent;
        this.children = new Array();
        this.children[0] = "quote";
    }
}
// Quasiquote列表对象
class QuasiquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUASIQUOTE;
        this.parent = parent;
        this.children = new Array();
        this.children[0] = "quasiquote";
    }
}
// Unquote列表对象
class UnquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.UNQUOTE;
        this.parent = parent;
        this.children = new Array();
        this.children[0] = "unquote";
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
    addParameter(param) {
        this.children[1].push(param);
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
}
// 字符串对象
class StringObject extends SchemeObject {
    constructor(str) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
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
        else if (code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' || code[i] === '{' || code[i] === '}' || code[i] === '\'' || code[i] === ',' || code[i] === '`' || code[i] === '"') {
            if (token_temp.length > 0) {
                let new_token = token_temp.join('');
                tokens.push({
                    string: new_token,
                    index: i - new_token.length
                });
                token_temp = [];
            }
            if (code[i] === '"') {
                let string_lit = code.substring(i).match(/\"[^\"]*?\"/gi);
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
    let newTokens2 = new Array();
    let skipMark = "0(SKIP)0";
    for (let i = 0; i < newTokens.length; i++) {
        if (newTokens[i].string === skipMark) {
            continue;
        }
        if (newTokens[i].string === '(' && (newTokens[i + 1].string === 'quote' ||
            newTokens[i + 1].string === 'unquote' ||
            newTokens[i + 1].string === 'quasiquote')) {
            // 去掉(*quote对应的括号
            let bracketCount = 0;
            for (let j = i + 1; j < newTokens.length; j++) {
                if (newTokens[j].string === '(') {
                    bracketCount++;
                }
                else if (newTokens[j].string === ')') {
                    if (bracketCount === 0) {
                        newTokens[j].string = skipMark;
                        break;
                    }
                    else {
                        bracketCount--;
                    }
                }
            }
            if (newTokens[i + 1].string === 'quote') {
                newTokens2.push({
                    string: '\'',
                    index: newTokens[i].index
                });
            }
            else if (newTokens[i + 1].string === 'quasiquote') {
                newTokens2.push({
                    string: '`',
                    index: newTokens[i].index
                });
            }
            else if (newTokens[i + 1].string === 'unquote') {
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
    }
    return newTokens2;
}
// Parser.ts
// 词法分析
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
    "quote": true,
    "quasiquote": true,
    "unquote": true,
};
class AST {
    //////////////////////////////////////////////////
    constructor(source) {
        this.source = source;
        this.nodes = new Memory();
        this.nodeIndexes = new HashMap();
        this.lambdaHandles = new Array();
        this.tailcall = new Array();
        this.scopes = new HashMap();
        this.dependencies = new HashMap();
        this.aliases = new HashMap();
        this.natives = new HashMap();
    }
    // 取出某节点
    GetNode(handle) {
        return this.nodes.Get(handle);
    }
    // 创建一个Lambda节点，保存，并返回其把柄
    MakeLambdaNode(parentHandle) {
        let handle = this.nodes.NewHandle("LAMBDA");
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
                handle = this.nodes.NewHandle("QUOTE");
                node = new QuoteObject(parentHandle);
                break;
            case "QUASIQUOTE":
                handle = this.nodes.NewHandle("QUASIQUOTE");
                node = new QuasiquoteObject(parentHandle);
                break;
            case "UNQUOTE":
                handle = this.nodes.NewHandle("UNQUOTE");
                node = new QuoteObject(parentHandle);
                break;
            default:
                handle = this.nodes.NewHandle("APPLICATION");
                node = new ApplicationObject(parentHandle);
                break;
        }
        this.nodes.Set(handle, node);
        return handle;
    }
    // 创建一个字符串对象节点，保存，并返回其把柄
    MakeStringNode(str) {
        let handle = this.nodes.NewHandle("STRING");
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }
}
function Parse(code) {
    let ast = new AST(code);
    let tokens = Lexer(code);
    ast.tokens = tokens;
    // 节点把柄栈
    let NODE_STACK = new Array();
    NODE_STACK.push('');
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
    //  以下是递归下降分析
    ///////////////////////////////
    function ParseTerm(tokens, index) {
        let quoteState = Top(STATE_STACK);
        if (quoteState !== "QUOTE" && quoteState !== "QUASIQUOTE" && tokens[index].string === '(' && tokens[index + 1].string === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if (tokens[index].string === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
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
    function TypeOfToken(token) {
        if (token in KEYWORDS) {
            return "KEYWORD";
        }
        else if (token === '#t' || token === '#f') {
            return "BOOLEAN";
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
        else if (/^\-?\d+(\.\d+)?$/gi.test(token)) {
            return "NUMBER";
        }
        else if (token[0] === '"' && token[token.length - 1] === '"') {
            return "STRING";
        }
        else {
            return "VARIABLE";
        }
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
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if (type === "VARIABLE" || type === "KEYWORD" ||
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
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
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
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
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
    ParseTerm(tokens, 0);
    return ast;
}
// Instruction.ts
// 指令集定义
// Process.ts
// 进程数据结构
// 栈帧
class StackFrame {
    constructor(closureHandle, target) {
        this.closureHandle = closureHandle;
        this.returnTargetIndex = target;
    }
}
// 闭包
class Closure {
    constructor(instructionIndex, parentClosureHandle) {
        this.instructionIndex = instructionIndex;
        this.parentClosureHandle = parentClosureHandle;
        this.bound = new HashMap();
        this.upvalue = new HashMap();
        this.dirtyFlag = new HashMap();
    }
}
// 续延
class Continuation {
    constructor(partialEnvironment, contReturnTargetLable) {
        this.partialEnvironmentJson = JSON.stringify(partialEnvironment);
        this.contReturnTargetLable = contReturnTargetLable;
    }
}
class Process {
    constructor() {
        // public CLOSURES: HashMap<string, any>;       // 闭包区
        // public CONTINUATIONS: HashMap<string, any>;  // Continuation区
        // 把柄分配计数器
        //   注：每分配一个新把柄，计数器就加一，以保证每个新把柄都与已有的不同
        this.handleCounter = 0; // 把柄计数器
        // 执行机核心：栈、闭包和续延
        this.PC = 0; // 程序计数器（即当前执行的指令索引）
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
    NewClosure(instructionIndex, parentClosureHandle) {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.heap.NewHandle("CLOSURE");
        // 新建一个空的闭包对象
        let closure = new Closure(instructionIndex, parentClosureHandle);
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
        if (variableName in currentClosure.bound) {
            return currentClosure.bound.get(variableName);
        }
        // 然后查找自由变量
        let upvalueVal = null;
        if (variableName in currentClosure.upvalue) {
            upvalueVal = currentClosure.upvalue.get(variableName);
        }
        // 上溯闭包
        let closureHandle = this.currentClosureHandle;
        while (closureHandle !== null) {
            if (variableName in currentClosure.bound) {
                // 比对这个值与upvalue的值，如果一致则直接返回，如果不一致，以上溯的结果为准
                let boundVal = currentClosure.bound.get(variableName);
                if (upvalueVal !== boundVal) {
                    // 检查脏标记：
                    if (currentClosure.dirtyFlag.get(variableName)) {
                        return boundVal;
                    }
                    else {
                        return upvalueVal;
                    }
                }
                return boundVal;
            }
            currentClosure = this.GetClosure(currentClosure.parentClosureHandle);
            closureHandle = currentClosure.parentClosureHandle;
        }
        throw `[Dereference] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }
    /* 程序流程控制 */
    // 获取并解析当前指令
    CurrentInstruction() {
        let instString = (this.instructions)[this.PC];
        if (instString[0] === '@') {
            return {
                isLabel: true,
                instruction: instString,
                mnemonic: undefined,
                argument: undefined
            };
        }
        else {
            let fields = instString.split(/\s+/i);
            let mnemonic = fields[0].toLowerCase();
            let argument = fields[1];
            return {
                isLabel: false,
                instruction: instString,
                mnemonic: mnemonic,
                argument: argument
            };
        }
    }
    // 解析标签为指令索引（地址）
    ParseLabel(label) {
        return this.labelMapping.get(label);
    }
    // 前进一步（PC加一）
    Step() {
        this.PC++;
    }
    // 前进一步跳转到（PC置数）
    Goto(instructionIndex) {
        this.PC = instructionIndex;
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
        let contHandle = this.heap.NewHandle("CONTINUATION");
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
    /* 进程状态控制 */
    // 设置进程状态
    SetProcessState(pstate) {
        this.state = pstate;
    }
}
///////////////////////////////////////////////
// UT.ts
// 单元测试
// Test
const TESTCASE = `
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define A
  (lambda (k x1 x2 x3 x4 x5) (begin
      (define B
        (lambda () (begin
            (set! k (- k 1))
            (A k B x1 x2 x3 x4))))
      (if (<= k 0)
          (+ (x4) (x5))
          (B)))))
(display "【AuroraScheme编译】Man or Boy Test = ")
(display (A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
`;
let ast = Parse(TESTCASE);
console.log(JSON.stringify(ast));
