// Utility.ts
// 工具函数
// 状态常量
const SUCCEED = 0;
// 顶级词法节点、顶级作用域和顶级闭包的parent字段
//   用于判断上溯结束
const TOP_NODE_HANDLE = "&TOP_NODE";
// 关键字集合
const KEYWORDS = [
    "car", "cdr", "cons", "cond", "if", "else", "begin",
    "+", "-", "*", "/", "=", "and", "or",
    "not", ">", "<", ">=", "<=", "eq?",
    "define", "set!", "null?",
    "display", "newline",
    "call/cc",
    "import", "native",
    "fork",
    "quote", "quasiquote", "unquote",
];
// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}
// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if (str[0] === '"' && str[str.length - 1] === '"') {
        return str.substring(1, str.length - 1);
    }
    else {
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
    else if (KEYWORDS.indexOf(token) >= 0) {
        return "KEYWORD";
    }
    else if (token === '#t' || token === '#f') {
        return "BOOLEAN";
    }
    else if (isNaN(parseFloat(token)) === false) {
        return "NUMBER";
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
    // 把柄存在性判断
    HasHandle(handle) {
        return this.data.has(handle);
    }
    // 新建任意把柄
    NewHandle(handle) {
        this.data.set(handle, null);
        this.metadata.set(handle, {
            static: false,
            readOnly: false,
            status: 'allocated',
            referrer: []
        });
    }
    // 动态分配堆对象把柄
    AllocateHandle(typeTag, referrer) {
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
    // 遍历
    // 注意：输入函数通过返回"break"来结束循环，通过返回其他任意值来中止一轮循环（continue）。
    ForEach(f) {
        for (let handle in this.data) {
            let ctrl = f(handle);
            if (ctrl === "break")
                break;
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
}
// 字符串对象
class StringObject extends SchemeObject {
    constructor(str) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
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
    constructor(source, moduleQualifiedName) {
        this.source = source;
        this.moduleQualifiedName = moduleQualifiedName;
        this.nodes = new Memory();
        this.nodeIndexes = new HashMap();
        this.lambdaHandles = new Array();
        this.tailcall = new Array();
        this.scopes = new HashMap();
        this.variableMapping = new HashMap();
        this.topVariables = new Array();
        this.dependencies = new HashMap();
        this.natives = new HashMap();
    }
    // 取出某节点
    GetNode(handle) {
        return this.nodes.Get(handle);
    }
    // 创建一个Lambda节点，保存，并返回其把柄
    MakeLambdaNode(parentHandle) {
        // NOTE 每个节点把柄都带有模块全限定名，这样做的目的是：不必在AST融合过程中调整每个AST的把柄。下同。
        let handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.LAMBDA`);
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
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.QUOTE`);
                node = new QuoteObject(parentHandle);
                break;
            case "QUASIQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.QUASIQUOTE`);
                node = new QuasiquoteObject(parentHandle);
                break;
            case "UNQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.UNQUOTE`);
                node = new QuoteObject(parentHandle);
                break;
            default:
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.APPLICATION`);
                node = new ApplicationObject(parentHandle);
                break;
        }
        this.nodes.Set(handle, node);
        return handle;
    }
    // 创建一个字符串对象节点，保存，并返回其把柄
    MakeStringNode(str) {
        let handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.STRING`);
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }
}
//////////////////////////////////////////////////
//
//  语法分析器：完成语法分析、作用域分析，生成AST
//
//  注意：输入代码必须是`((lambda () <code>))`格式
//
//////////////////////////////////////////////////
function Parse(code, moduleQualifiedName) {
    let ast = new AST(code, moduleQualifiedName);
    let tokens = Lexer(code);
    ast.tokens = tokens;
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
                    let stringHandle = ast.MakeStringNode(currentToken);
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
                    let stringHandle = ast.MakeStringNode(currentToken);
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
    ///////////////////////////////
    //  预处理指令解析（包括import等）
    ///////////////////////////////
    function PreprocessAnalysis() {
        // 遍历所有的node，寻找预处理指令
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // import指令
            if (nodeType === "APPLICATION" && node.children[0] === "import") {
                let pathStringHandle = node.children[1]; // 模块路径字符串（的把柄）
                let moduleAlias = node.children[2]; // 模块的别名
                let pathStringObject = ast.GetNode(pathStringHandle); // 若不存在，会抛出异常
                if (pathStringObject.type !== "STRING") {
                    throw `[预处理] import的来源路径必须写成字符串`;
                }
                let path = TrimQuotes(pathStringObject.content);
                ast.dependencies.set(moduleAlias, path);
            }
            // native指令
            else if (nodeType === "APPLICATION" && node.children[0] === "native") {
                let native = node.children[1];
                ast.natives.set(native, "enabled"); // TODO: 这里可以写native库的路径。更多断言，例如重复判断、native库存在性判断等
            }
        });
    }
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
                let bounds = ast.scopes.get(currentNodeHandle).boundVariables;
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
            ast.scopes.set(nodeHandle, scope);
        }
        // 第1趟扫描：在ast.scopes中注册作用域的树状嵌套关系；处理define行为
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
                    ast.scopes.get(nodeHandle).parent = parentLambdaHandle;
                    // 为上级lambda节点增加下级成员（也就是当前lambda）
                    ast.scopes.get(parentLambdaHandle).addChild(nodeHandle);
                }
                else {
                    // 记录上级lambda节点
                    ast.scopes.get(nodeHandle).parent = TOP_NODE_HANDLE;
                }
                // 记录当前lambda的约束变量
                ast.scopes.get(nodeHandle).boundVariables = Array.from(node.getParameters()); // ES6+
            }
            // define结构：变量被defined，会覆盖掉上级同名变量（类似JS的var）
            else if (nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle = nearestLambdaHandle(nodeHandle);
                if (parentLambdaHandle !== null) {
                    let definedVariable = node.children[1];
                    // 将defined变量*同时*记录到所在lambda节点和所在作用域中（如果不存在的话）
                    ast.GetNode(parentLambdaHandle).addParameter(definedVariable);
                    ast.scopes.get(parentLambdaHandle).addParameter(definedVariable);
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
                        }
                    }
                }
            }
            // Application节点：处理方式类似body
            else if (nodeType === "APPLICATION" || nodeType === "UNQUOTE") {
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
                        }
                    }
                }
                // 后处理：记录顶级变量
                if (first === "define" && node.parent === topLambdaHandle) {
                    ast.topVariables.push(node.children[1]);
                }
            }
        }); // 所有节点扫描完毕
    }
    // 递归下降语法分析
    ParseTerm(tokens, 0);
    // 预处理指令解析
    PreprocessAnalysis();
    // 作用域解析
    ScopeAnalysis();
    return ast;
}
// Compiler.ts
// 编译器：AST→Module
// 模块
//   模块如同Java的字节码文件，包含代码、静态资源和元数据等
class Module {
    constructor() {
        this.ILCode = new Array();
    }
}
//////////////////////////////////////////////////
//
//  编译器：将AST编译成运行时环境可执行的模块
//
//////////////////////////////////////////////////
function Compile(ast) {
    let module = new Module();
    let ILCode = new Array();
    ///////////////////////////////
    //  工具函数
    ///////////////////////////////
    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `${ast.moduleQualifiedName}.ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        return uniqueString;
    }
    // 增加一条新指令
    function AddInstruction(instStr) {
        if (instStr.trim()[0] === ";") {
            ILCode.push(instStr);
        }
        else {
            ILCode.push("   " + instStr.trim()); // 与注释对齐
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
        // TODO 参数列表里通过define获得的参数，不需要在这里出现
        let parameters = node.getParameters();
        for (let i = parameters.length - 1; i >= 0; i--) {
            AddInstruction(`store  ${parameters[i]}`);
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
                else if (bodyObjType === "QUOTE" || bodyObjType === "QUASIQUOTE" || bodyObjType === "UNQUOTE") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "STRING") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "APPLICATION") {
                    CompileApplication(body);
                }
                else {
                    throw `[Error] 意外的函数体节点类型。`;
                }
            }
            else if (bodyType === "VARIABLE") {
                AddInstruction(`load ${body}`);
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(bodyType) >= 0) {
                AddInstruction(`push ${body}`);
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
            else { // 包括Application和String对象
                AddInstruction(`push ${rightValue}`); // 注意：define并不对Application（包括各种quote）求值
            }
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(rightValueType) >= 0) {
            AddInstruction(`push ${rightValue}`);
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
                AddInstruction(`push @${rightValue}`); // 注意：set!也不对Lambda节点求值（即，生成闭包实例）
            }
            else if (rightValueNode.type === "QUOTE" || rightValueNode.type === "QUASIQUOTE" || rightValueNode.type === "UNQUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "APPLICATION") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(rightValueType) >= 0) {
            AddInstruction(`push ${rightValue}`);
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
        else if (predicateType === "VARIABLE") {
            AddInstruction(`load ${predicate}`);
        }
        // TODO 此处可以作优化
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(predicateType) >= 0) {
            AddInstruction(`push ${predicate}`);
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
            else if (falseBranchNode.type === "QUOTE" || falseBranchNode.type === "QUASIQUOTE" || falseBranchNode.type === "UNQUOTE") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if (falseBranchNode.type === "STRING") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if (falseBranchNode.type === "APPLICATION") {
                CompileApplication(falseBranch);
            }
            else {
                throw `[Error] 意外的if-false分支。`;
            }
        }
        else if (falseBranchType === "VARIABLE") {
            AddInstruction(`load ${falseBranch}`);
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(falseBranchType) >= 0) {
            AddInstruction(`push ${falseBranch}`);
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
            else if (trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if (trueBranchNode.type === "STRING") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if (trueBranchNode.type === "APPLICATION") {
                CompileApplication(trueBranch);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
        }
        else if (trueBranchType === "VARIABLE") {
            AddInstruction(`load ${trueBranch}`);
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(trueBranchType) >= 0) {
            AddInstruction(`push ${trueBranch}`);
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
                else if (trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的and clause。`;
                }
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(clauseType) >= 0) {
                AddInstruction(`push ${clause}`);
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
                else if (trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的 or clause。`;
                }
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(clauseType) >= 0) {
                AddInstruction(`push ${clause}`);
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
                let trueBranchNode = ast.GetNode(child);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if (trueBranchNode.type === "APPLICATION") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if (childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(childType) >= 0) {
                AddInstruction(`push ${child}`);
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
        else if (first === 'call/cc') {
            return CompileCallCC(nodeHandle);
        }
        else if (first === 'define') {
            return CompileDefine(nodeHandle);
        }
        else if (first === 'set!') {
            return CompileSet(nodeHandle);
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
                    let trueBranchNode = ast.GetNode(child);
                    if (trueBranchNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${child}`); // 返回闭包
                    }
                    else if (trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (trueBranchNode.type === "STRING") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (trueBranchNode.type === "APPLICATION") {
                        CompileApplication(child);
                    }
                    else {
                        throw `[Error] 意外的 child。`;
                    }
                }
                else if (childType === "VARIABLE") {
                    AddInstruction(`load ${child}`);
                }
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(childType) >= 0) {
                    AddInstruction(`push ${child}`);
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
        AddInstruction(`;;   Module: ${ast.moduleQualifiedName}`);
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
    // TODO 组装模块，必要的元数据也要有
    module.ILCode = ILCode;
    return module;
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
    ProcessState[ProcessState["READY"] = 0] = "READY";
    ProcessState[ProcessState["RUNNING"] = 1] = "RUNNING";
    ProcessState[ProcessState["SLEEPING"] = 2] = "SLEEPING";
    ProcessState[ProcessState["SUSPENDED"] = 3] = "SUSPENDED";
    ProcessState[ProcessState["STOPPED"] = 4] = "STOPPED";
})(ProcessState || (ProcessState = {}));
class Process {
    /* 构造器 */
    // TODO 待实现，目前仅供测试
    constructor(instructions) {
        // 执行机核心：栈、闭包和续延
        this.PC = 0; // 程序计数器（即当前执行的指令索引）
        this.processID = 0;
        this.parentProcessID = 0;
        this.childrenProcessID = new Array();
        this.user = "";
        this.moduleQualifiedName = "";
        this.modulePath = "";
        this.priority = 0;
        this.state = ProcessState.READY;
        this.ast = new AST("", "");
        this.instructions = instructions;
        this.labelMapping = new HashMap();
        this.heap = new Memory();
        this.PC = 0;
        this.currentClosureHandle = TOP_NODE_HANDLE;
        this.OPSTACK = new Array();
        this.FSTACK = new Array();
        // 进程初始化
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
    // 判断某变量是否使用了某Native模块（通过读取this.ast.natives得知）
    IsUseNative(variable) {
        let varPrefix = variable.split(".")[0];
        return this.ast.natives.has(varPrefix);
    }
    /* 进程状态控制 */
    // 设置进程状态
    SetState(pstate) {
        this.state = pstate;
    }
}
// Instruction.ts
// 指令集定义
// Primitive对应的AIL指令
const PrimitiveInstruction = {
    "+": "add",
    "-": "sub",
    "*": "mul",
    "/": "div",
    "%": "mod",
    "=": "eqn",
    "<": "lt",
    ">": "gt",
    "<=": "le",
    ">=": "gt"
};
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
            /*
            // TODO：这部分应当剥离出来，连同Parser中的TypeOfToken
            if(KEYWORDS.indexOf(argument) >= 0) {
                this.argType = "KEYWORD";
            }
            else if(isNaN(parseFloat(argument)) === false) {
                this.argType = "NUMBER";
            }
            else if(argument === "#t" || argument === "#f") {
                this.argType = "BOOLEAN";
            }
            else if(argument[0] === "@") {
                this.argType = "LABEL";
            }
            else if(argument[0] === "&") {
                this.argType = "HANDLE";
            }
            else if(argument[0] === "\'") {
                this.argType = "SYMBOL";
            }
            else {
                this.argType = "VARIABLE";
            }
            */
        }
    }
}
// 执行（一条）中间语言指令
// 执行的效果从宏观上看就是修改了进程内部和运行时环境的状态，并且使用运行时环境提供的接口和资源
function Execute(PROCESS, RUNTIME) {
    // 取出当前指令
    let instruction = PROCESS.CurrentInstruction();
    let mnemonic = instruction.mnemonic;
    let argument = instruction.argument;
    let argType = instruction.argType;
    // 译码：分配执行路径
    if (instruction.type === "COMMENT" || instruction.type === "LABEL") {
        PROCESS.Step();
    }
    ///////////////////////////////////////
    // 第一类：基本存取指令
    ///////////////////////////////////////
    // store variable 将OP栈顶对象保存到当前闭包的约束变量中
    else if (mnemonic === "store") {
        if (argType !== 'VARIABLE') {
            throw `[Error] store指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.PopOperand();
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, value);
        PROCESS.Step();
    }
    // load variable 解引用变量，并将对象压入OP栈顶
    else if (mnemonic === "load") {
        if (argType !== 'VARIABLE') {
            throw `[Error] load指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.Dereference(variable);
        let valueType = TypeOfToken(value);
        // 值为标签，即loadclosure。
        if (valueType === 'LABEL') {
            let label = value;
            // TODO 可复用代码 以下照抄loadclosure的实现
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
    else if (mnemonic === "loadclosure") {
        // TODO 可复用代码
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
    else if (mnemonic === "push") {
        // 允许所有类型的参数
        PROCESS.PushOperand(argument);
        PROCESS.Step();
    }
    // pop 弹出并抛弃OP栈顶
    else if (mnemonic === "pop") {
        PROCESS.PopOperand();
        PROCESS.Step();
    }
    // swap 交换OP栈顶的两个对象的顺序
    else if (mnemonic === "swap") {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        PROCESS.PushOperand(top1);
        PROCESS.PushOperand(top2);
        PROCESS.Step();
    }
    // set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）
    else if (mnemonic === "set") {
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
    //call arg 函数调用（包括continuation、native函数）
    else if (mnemonic === 'call') {
        // 新的栈帧入栈
        PROCESS.PushStackFrame(PROCESS.currentClosureHandle, PROCESS.PC + 1);
        // 判断参数类型
        if (argType === 'KEYWORD') {
            // TODO 增加对primitive的一等支持
        }
        else if (argType === 'LABEL') {
            let label = argument;
            // TODO 可复用代码
            let instructionAddress = PROCESS.GetLabelAddress(label);
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
        else if (argType === 'VARIABLE') {
            // 首先判断是否为Native调用
            let variable = argument;
            if (PROCESS.IsUseNative(variable)) {
                //
                // TODO 这里重新实现原有的callnative指令
                //
            }
            else {
                let value = PROCESS.Dereference(variable);
                let valueType = TypeOfToken(value);
                if (valueType === 'LABEL') {
                    let label = value;
                    // TODO 可复用代码：与以上LABEL分支的处理方法相同，这里复制过来
                    let instructionAddress = PROCESS.GetLabelAddress(label);
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
                // 值为把柄：可能是闭包、continuation或其他
                else if (valueType === "HANDLE") {
                    let handle = value;
                    let obj = PROCESS.heap.Get(handle);
                    let objType = obj.type;
                    // 闭包：已定义的函数实例
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
                        console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                        let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                        PROCESS.Goto(targetAddress);
                    }
                    else {
                        throw `[Error] call指令的参数必须是标签、闭包或续延`;
                    }
                }
                else {
                    throw `[Error] call指令的参数必须是标签、闭包或续延`;
                }
            } // Native判断结束
        } // Variable分支结束
    }
    //tailcall arg 函数尾调用
    else if (mnemonic === 'tailcall') {
        // TODO 可复用代码 与call唯一的不同就是调用前不压栈帧，所以下面这坨代码是可以整体复用的
        // 判断参数类型
        if (argType === 'KEYWORD') {
            // TODO 增加对primitive的一等支持
        }
        else if (argType === 'LABEL') {
            // TODO 可复用代码
            let label = argument;
            let instructionAddress = PROCESS.GetLabelAddress(label);
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
        else if (argType === 'VARIABLE') {
            let value = PROCESS.Dereference(argument);
            let valueType = TypeOfToken(value);
            // TODO 可复用代码：与以上LABEL分支的处理方法相同，这里复制过来
            if (valueType === 'LABEL') {
                let label = argument;
                let instructionAddress = PROCESS.GetLabelAddress(label);
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
            // 值为把柄：可能是闭包、continuation或其他
            else if (valueType === "HANDLE") {
                let handle = value;
                let obj = PROCESS.heap.Get(handle);
                let objType = obj.type;
                // 闭包：已定义的函数实例
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
                    console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                    let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                    PROCESS.Goto(targetAddress);
                }
                else {
                    throw `[Error] call指令的参数必须是标签、闭包或续延`;
                }
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或续延`;
            }
        }
    }
    //return 函数返回
    else if (mnemonic === 'return') {
        let stackframe = PROCESS.PopStackFrame(); // 栈帧退栈
        PROCESS.SetCurrentClosure(stackframe.closureHandle); // 修改当前闭包
        PROCESS.Goto(stackframe.returnTargetAddress); // 跳转到返回地址
        stackframe = null; // 销毁当前栈帧
    }
    //capturecc variable 捕获当前Continuation并将其把柄保存在变量中
    else if (mnemonic === 'capturecc') {
        if (argType !== 'VARIABLE') {
            throw `[Error] capturecc指令参数类型不是变量`;
        }
        let variable = argument;
        let retTargetLable = `@${variable}`; // NOTE【约定】cont返回点的标签名称 = @ + cont被保存的变量名称
        let contHandle = PROCESS.CaptureContinuation(retTargetLable);
        console.info(`[Info] Continuation ${variable} 已捕获，对应的返回标签 ${retTargetLable}`);
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, contHandle);
        PROCESS.Step();
    }
    //iftrue label 如果OP栈顶条件不为false则跳转
    else if (mnemonic === 'iftrue') {
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
    else if (mnemonic === 'iffalse') {
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
    else if (mnemonic === 'goto') {
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
    else if (mnemonic === 'car') {
    }
    // cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
    else if (mnemonic === 'cdr') {
    }
    // cons 同Scheme的cons
    else if (mnemonic === 'cons') {
    }
    ///////////////////////////////////////
    // 第四类：算术逻辑运算和谓词
    ///////////////////////////////////////
    // add 实数加法
    else if (mnemonic === 'add') {
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
    else if (mnemonic === 'sub') {
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
    else if (mnemonic === 'mul') {
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
    else if (mnemonic === 'div') {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            if (operand1 <= Number.EPSILON || operand1 >= -Number.EPSILON) {
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
    else if (mnemonic === 'mod') {
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
    else if (mnemonic === 'pow') {
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
    else if (mnemonic === 'eqn') {
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
    else if (mnemonic === 'ge') {
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
    else if (mnemonic === 'le') {
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
    else if (mnemonic === 'gt') {
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
    else if (mnemonic === 'lt') {
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
    else if (mnemonic === 'not') {
        let top = PROCESS.PopOperand();
        PROCESS.PushOperand((top === "#f") ? "#t" : "#f");
        PROCESS.Step();
    }
    // and
    else if (mnemonic === 'and') {
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
    else if (mnemonic === 'or') {
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
    // TODO 还有几个谓词待实现
    ///////////////////////////////////////
    // 第五类：其他指令
    ///////////////////////////////////////
    // fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
    else if (mnemonic === 'fork') {
    }
    // display arg 调试输出
    else if (mnemonic === 'display') {
        let arg = PROCESS.OPSTACK.pop();
        console.info(`[Info] 输出：${arg}`);
        PROCESS.Step();
    }
    // newline 调试输出换行
    else if (mnemonic === 'newline') {
        console.info(`[Info] 换行`);
        PROCESS.Step();
    }
    // nop 空指令
    else if (mnemonic === "nop") {
        PROCESS.Step();
    }
    // pause 暂停当前进程
    else if (mnemonic === 'pause') {
        PROCESS.SetState(ProcessState.SUSPENDED);
    }
    // halt 停止当前进程
    else if (mnemonic === 'halt') {
        PROCESS.SetState(ProcessState.STOPPED);
    }
}
///////////////////////////////////////////////
// UT.ts
// 单元测试
// import * as fs from "fs";
const fs = require("fs");
// Parser测试
function UT_Parser() {
    const TESTCASE = `
    ((lambda ()
    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    
    ;; AppLib测试
    (native HTTPS)
    (native String)
    (native Math)
    (native File)
    (import "../../../source/applib/list.scm" List)
    (define multiply
      (lambda (x y) (Math.mul x y)))
    (display (List.reduce '(1 2 3 4 5 6 7 8 9 10) multiply 1))
    
    (define filter
      (lambda (f lst)
        (if (null? lst)
            '()
            (if (f (car lst))
                (cons (car lst) (filter f (cdr lst)))
                (filter f (cdr lst))))))
    
    (define concat
      (lambda (a b)
        (if (null? a)
            b
            (cons (car a) (concat (cdr a) b)))))
    
    (define quicksort
      (lambda (array)
        (if (or (null? array) (null? (cdr array)))
            array
            (concat (quicksort (filter (lambda (x)
                                         (if (< x (car array)) #t #f))
                                       array))
                               (cons (car array)
                                     (quicksort (filter (lambda (x)
                                                          (if (> x (car array)) #t #f))
                                                        array)))))))
    
    (display "【SSC编译】快速排序：")
    (display (quicksort '(5 9 1 7 (5 3 0) 4 6 8 2)))
    (newline)
    
    
    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ))
    `;
    let ast = Parse(TESTCASE, "me.aurora.TestModule");
    fs.writeFileSync("./AST.json", JSON.stringify(ast, null, 2), "utf-8");
}
/*
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(define Count 100)
(define Add
  (lambda (x y)
    (set! Count (+ 1 Count))
    (if (= y 0)
        x
        (+ 1 (Add x (- y 1))))))

(display (Add 10 5))
(newline)
(display Count)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
*/
function UT_Instruction() {
    const instructions = [
        `   call    @&LAMBDA_0`,
        `   halt`,
        `;; 函数&LAMBDA_n(Add)开始`,
        `   @&LAMBDA_n`,
        `;; Parameters:(x y)`,
        `   store   me.aurora.test.&LAMBDA_n.y`,
        `   store   me.aurora.test.&LAMBDA_n.x`,
        `;; (set! Count (+ 1 Count))`,
        `   push    1`,
        `   load    me.aurora.test.&LAMBDA_0.Count`,
        `   add`,
        `   set     me.aurora.test.&LAMBDA_0.Count`,
        `;; (if COND_0 TRUE_ROUTE_0 FALSE_ROUTE_0)`,
        `   @COND_0`,
        `   load    me.aurora.test.&LAMBDA_n.y`,
        `   push    0`,
        `   eqn`,
        `   iffalse @FALSE_ROUTE_0`,
        `   @TRUE_ROUTE_0`,
        `   load    me.aurora.test.&LAMBDA_n.x`,
        `   goto    @END_IF_0`,
        `   @FALSE_ROUTE_0`,
        `   push    1`,
        `   load    me.aurora.test.&LAMBDA_n.x`,
        `   load    me.aurora.test.&LAMBDA_n.y`,
        `   push    1`,
        `   sub`,
        `   call    me.aurora.test.&LAMBDA_0.Add`,
        `   add`,
        `   @END_IF_0`,
        `   return`,
        `;; 函数&LAMBDA_n(顶级作用域)开始`,
        `   @&LAMBDA_0`,
        `;; (define Count 100)`,
        `   push    100`,
        `   store   me.aurora.test.&LAMBDA_0.Count`,
        `;; (define Add &LAMBDA_n)`,
        `   push    @&LAMBDA_n`,
        `   store   me.aurora.test.&LAMBDA_0.Add`,
        `;; (Add 10 5)`,
        `   push    10`,
        `   push    5`,
        `   call    me.aurora.test.&LAMBDA_0.Add`,
        `   display`,
        `   newline`,
        `   load    me.aurora.test.&LAMBDA_0.Count`,
        `   display`,
        `   return`,
    ];
    // IL指令集和VM测试
    // 期望结果：15 106
    let process = new Process(instructions);
    while (process.state !== ProcessState.STOPPED) {
        // console.log(process.CurrentInstruction().instruction);
        Execute(process);
    }
}
// Compiler测试
function UT_Compiler() {
    const code = `
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(define Count 100)
(define Add
  (lambda (x)
    (lambda (y)
      (set! Count (+ 1 Count))
      (if (= y 0)
          x
          (+ 1 ((Add x) (- y 1)))))))

(display ((Add 20) 500))
(newline)
(display Count)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
`;
    let AST = Parse(code, "me.aurora.test");
    fs.writeFileSync("./AST.json", JSON.stringify(AST, null, 2), "utf-8");
    let module = Compile(AST);
    let ILCodeStr = module.ILCode.join('\n');
    fs.writeFileSync("./ILCode.txt", ILCodeStr, "utf-8");
    // 捎带着测试一下AVM
    let process = new Process(module.ILCode);
    while (process.state !== ProcessState.STOPPED) {
        // console.log(process.CurrentInstruction().instruction);
        Execute(process);
    }
}
// UT_Parser();
// UT_Instruction();
UT_Compiler();
