
// Parser.ts
// 词法分析

class Scope {
    parent: Handle;
    children: Array<any>;
    boundVariables: Array<string>;

    constructor(parent: Handle) {
        this.parent = parent;
        this.children = new Array();
        this.boundVariables = new Array();
    }
    public addChild(child: any): void {
        this.children.push(child);
    }
    public addParameter(param: string): void {
        if(this.boundVariables.indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.boundVariables.push(param);
        }
    }
}

enum NodeType {
    LAMBDA = "LAMBDA",
    APPLICATION = "APPLICATION",
    QUOTE = "QUOTE",
    QUASIQUOTE = "QUASIQUOTE",
    STRING = "STRING",
    SYMBOL = "SYMBOL",
    NUMBER = "NUMBER",
    BOOLEAN = "BOOLEAN"
}

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
    // TODO 待完善
};

class AST {
    // 模块全限定名
    public moduleQualifiedName: string;

    // Scheme源码
    public source: string;
    // 词法单元
    public tokens: Array<Token>;
    // 词法节点
    public nodes: Memory;

    // 词法节点到源码位置的映射
    public nodeIndexes: HashMap<Handle, number>;

    // 所有Lambda节点的把柄
    public lambdaHandles: Array<Handle>;

    // 尾调用Application节点的把柄
    public tailcall: Array<Handle>;

    // 作用域
    public scopes: HashMap<Handle, Scope>;
    // 全局唯一变量名与原始变量名之间的映射
    public variableMapping: HashMap<string, string>;

    // 外部依赖模块
    public dependencies: HashMap<string, string>; // 模块别名→模块路径

    // 使用到的Native模块
    public natives: HashMap<string, string> // Native模块名→（TODO 可能是模块的路径）

    constructor(source: string, moduleQualifiedName: string) {
        this.source = source;
        this.moduleQualifiedName = moduleQualifiedName;
        this.nodes = new Memory();
        this.nodeIndexes = new HashMap();
        this.lambdaHandles = new Array();
        this.tailcall = new Array();
        this.scopes = new HashMap();
        this.variableMapping = new HashMap();
        this.dependencies = new HashMap();
        this.natives = new HashMap();
    }

    // 取出某节点
    public GetNode(handle: Handle): any {
        return this.nodes.Get(handle);
    }

    // 创建一个Lambda节点，保存，并返回其把柄
    public MakeLambdaNode(parentHandle: Handle) {
        let handle = this.nodes.NewHandle("LAMBDA");
        let lambdaObject = new LambdaObject(parentHandle);
        this.nodes.Set(handle, lambdaObject);
        this.lambdaHandles.push(handle);
        return handle;
    }

    // 创建一个Application节点，保存，并返回其把柄
    public MakeApplicationNode(parentHandle: Handle, quoteType: string|void) {
        let handle: any;
        let node: any;
        switch(quoteType) {
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
    public MakeStringNode(str: string) {
        let handle = this.nodes.NewHandle("STRING");
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }
}

const TOP_NODE_HANDLE: Handle = "&TOP_NODE";


//////////////////////////////////////////////////
//
//  语法分析器：完成语法分析、作用域分析，生成AST
//
//  注意：输入代码必须是`((lambda () <code>))`格式
//
//////////////////////////////////////////////////

function Parse(code: string, moduleQualifiedName: string): AST {
    let ast = new AST(code, moduleQualifiedName);
    let tokens = Lexer(code);
    ast.tokens = tokens;
    // 节点把柄栈
    let NODE_STACK: Array<any> = new Array();
    NODE_STACK.push(TOP_NODE_HANDLE);
    // 状态栈
    let STATE_STACK: Array<string> = new Array();

    // 解析输出
    function parseLog(msg: string) {
        // console.log(msg);
    }
    // 判断是否为定界符
    function isSymbol(token: string) {
        if(token === "(" || token === ")" || token === "{" || token === "}" || token === "[" || token === "]"){ return false; }
        if(/^[\'\`\,]/gi.test(token)) { return false; } // 不允许开头的字符
        return true; // 其余的都是词法意义上的Symbol
    }

    // 根据字面的格式，判断token类型
    function TypeOfToken(token: string) {
        if(token in KEYWORDS){
            return "KEYWORD";
        }
        else if(token === '#t' || token === '#f') {
            return "BOOLEAN";
        }
        else if(token[0] === '&') {
            return "HANDLE";
        }
        else if(token[0] === '\'') {
            return "SYMBOL";
        }
        else if(token[0] === '@') {
            return "LABEL";
        }
        else if(/^\-?\d+(\.\d+)?$/gi.test(token)) {
            return "NUMBER";
        }
        else if(token[0] === '"' && token[token.length-1] === '"') {
            return "STRING";
        }
        else {
            return "VARIABLE";
        }
    }

    // 判断token是不是变量
    function isVariable(token: string): boolean {
        return (TypeOfToken(token) === "VARIABLE");
    }


    ///////////////////////////////
    //  递归下降分析
    ///////////////////////////////

    function ParseTerm(tokens: Array<Token>, index: number) {
        let quoteState = Top(STATE_STACK);
        if(quoteState !== "QUOTE" && quoteState !== "QUASIQUOTE" && tokens[index].string === '(' && tokens[index+1].string === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if(tokens[index].string === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
        }
        else if(tokens[index].string === '\'') {
            parseLog('<Term> → <Quote>');
            return ParseQuote(tokens, index);
        }
        else if(tokens[index].string === ',') {
            parseLog('<Term> → <Unquote>');
            return ParseUnquote(tokens, index);
        }
        else if(tokens[index].string === '`') {
            parseLog('<Term> → <Quasiquote>');
            return ParseQuasiquote(tokens, index);
        }
        else if(isSymbol(tokens[index].string)) {
            parseLog('<Term> → <Symbol>');
            return ParseSymbol(tokens, index);
        }
        else {
            throw `<Term>`;
        }
    }


    function ParseSList(tokens: Array<Token>, index: number) {
        parseLog('<SList> → ( ※ <SListSeq> )');

        // Action：向节点栈内压入一个新的SList，其中quoteType从状态栈栈顶取得。
        let quoteType = Top(STATE_STACK);
        let listHandle = ast.MakeApplicationNode(Top(NODE_STACK), ((quoteType) ? quoteType : false));
        NODE_STACK.push(listHandle);

        ast.nodeIndexes.set(listHandle, tokens[index].index);

        let nextIndex = ParseSListSeq(tokens, index+1);

        if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
        else { throw `<SList>`; }
    }

    function ParseSListSeq(tokens: Array<Token>, index: number) {
        parseLog('<SListSeq> → <Term> ※ <SListSeq> | ε');
        let currentToken = tokens[index].string;
        if( currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken))
        {
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

    function ParseLambda(tokens: Array<Token>, index: number) {
        parseLog('<Lambda> → ( ※ lambda <ArgList> <Body> )');

        // Action：pushLambda() 向节点栈内压入一个新的Lambda，忽略状态。
        let lambdaHandle = ast.MakeLambdaNode(Top(NODE_STACK));
        NODE_STACK.push(lambdaHandle);

        ast.nodeIndexes.set(lambdaHandle, tokens[index].index);

        let nextIndex = ParseArgList(tokens, index+2);
        nextIndex = ParseBody(tokens, nextIndex);

        if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
        else { throw `<Lambda>`; }
    }

    function ParseArgList(tokens: Array<Token>, index: number) {
        parseLog('<ArgList> → ( ※1 <ArgListSeq> ※2)');
        // Action1
        STATE_STACK.push("PARAMETER");
        let nextIndex = ParseArgListSeq(tokens, index+1);
        // Action2
        STATE_STACK.pop();

        if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
        else { throw `<ArgList>`; }
    }

    function ParseArgListSeq(tokens: Array<Token>, index: number) {
        parseLog('<ArgListSeq> → <ArgSymbol> ※ <ArgListSeq> | ε');
        if(isSymbol(tokens[index].string)) {
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

    function ParseArgSymbol(tokens: Array<Token>, index: number) {
        parseLog('<ArgSymbol> → <Symbol>');
        return ParseSymbol(tokens, index);
    }

    function ParseBody(tokens: Array<Token>, index: number) {
        parseLog('<Body> → <BodyTerm> ※ <Body_>');
        let nextIndex = ParseBodyTerm(tokens, index);

        // Action：从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
        let bodyNode = NODE_STACK.pop();
        ast.GetNode(Top(NODE_STACK)).addBody(bodyNode);

        nextIndex = ParseBodyTail(tokens, nextIndex);
        return nextIndex;
    }

    function ParseBodyTail(tokens: Array<Token>, index: number) {
        parseLog('<Body_> → <BodyTerm> ※ <Body_> | ε');
        let currentToken = tokens[index].string;
        if( currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken))
        {
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

    function ParseBodyTerm(tokens: Array<Token>, index: number) {
        parseLog('<BodyTerm> → <Term>');
        return ParseTerm(tokens, index);
    }

    function ParseQuote(tokens: Array<Token>, index: number) {
        parseLog('<Quote> → \' ※1 <QuoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUOTE');
        let nextIndex = ParseQuoteTerm(tokens, index+1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }

    function ParseUnquote(tokens: Array<Token>, index: number) {
        parseLog('<Unquote> → , ※1 <UnquoteTerm> ※2');
        // Action1
        STATE_STACK.push('UNQUOTE');
        let nextIndex = ParseUnquoteTerm(tokens, index+1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }

    function ParseQuasiquote(tokens: Array<Token>, index: number) {
        parseLog('<Quasiquote> → ` ※1 <QuasiquoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUASIQUOTE');
        let nextIndex = ParseQuasiquoteTerm(tokens, index+1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }

    function ParseQuoteTerm(tokens: Array<Token>, index: number) {
        parseLog('<QuoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }

    function ParseUnquoteTerm(tokens: Array<Token>, index: number) {
        parseLog('<UnquoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }

    function ParseQuasiquoteTerm(tokens: Array<Token>, index: number) {
        parseLog('<QuasiquoteTerm> → <Term>');
        return ParseTerm(tokens, index);
    }

    function ParseSymbol(tokens: Array<Token>, index: number) {
        let currentToken = tokens[index].string;
        if(isSymbol(currentToken)) {
            // Action
            let state = Top(STATE_STACK);
            if(state === 'QUOTE' || state === 'QUASIQUOTE') {
                let type: string = TypeOfToken(currentToken);
                // 被quote的常量和字符串不受影响
                if(type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken)); // 压入number
                }
                else if(type === "STRING") {
                    let stringHandle = ast.MakeStringNode(TrimQuotes(currentToken));
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if(type === "VARIABLE" || type === "KEYWORD" || 
                        (currentToken !== "quasiquote" && currentToken !== "quote" && currentToken !== "unquote")) {
                    NODE_STACK.push(`'${currentToken}`);
                }
                else { // 含boolean在内的变量、把柄等
                    NODE_STACK.push(currentToken);
                }
            }
            else if(state === 'UNQUOTE') {
                let type = TypeOfToken(currentToken);
                // 符号会被解除引用
                if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken.replace(/^\'*/gi, "")); // VARIABLE
                }
                // 其他所有类型不受影响
                else if(type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if(type === "STRING") {
                    let stringHandle = ast.MakeStringNode(TrimQuotes(currentToken));
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`
                }
            }
            else {
                let type = TypeOfToken(currentToken);
                if(type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if(type === "STRING") {
                    let stringHandle = ast.MakeStringNode(TrimQuotes(currentToken));
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken);
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`
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

    function PreprocessAnalysis(): void {
        // 遍历所有的node，寻找预处理指令
        ast.nodes.ForEach((nodeHandle)=>{
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;

            // import指令
            if(nodeType === "APPLICATION" && node.children[0] === "import") {
                let pathStringHandle: Handle = node.children[1]; // 模块路径字符串（的把柄）
                let moduleAlias: string = node.children[2];      // 模块的别名
                let pathStringObject = ast.GetNode(pathStringHandle);  // 若不存在，会抛出异常
                if(pathStringObject.type !== "STRING") {
                    throw `[预处理] import的来源路径必须写成字符串`;
                }
                let path = TrimQuotes(pathStringObject.content);
                ast.dependencies.set(moduleAlias, path);
            }
            // native指令
            else if(nodeType === "APPLICATION" && node.children[0] === "native") {
                let native:string = node.children[1];
                ast.natives.set(native, "enabled"); // TODO: 这里可以写native库的路径。更多断言，例如重复判断、native库存在性判断等
            }
        });
    }

    ///////////////////////////////
    //  作用域解析，变量换名
    ///////////////////////////////

    // 从某个节点开始，向上查找某个变量归属的Lambda节点
    function searchVarLambdaHandle(variable: string, fromNodeHandle: Handle): Handle {
        let currentNodeHandle: Handle = fromNodeHandle;
        while(currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if(node.type === "LAMBDA") {
                // 注意：从scopes中获取换名前的作用域信息
                let bounds: Array<string> = ast.scopes.get(currentNodeHandle).boundVariables;
                if(bounds.indexOf(variable) >= 0) {
                    return currentNodeHandle;
                }
            }
            currentNodeHandle = node.parent;
        }
        return null; // 变量未定义
    }

    // 查找某个node上面最近的lambda节点的地址
    function nearestLambdaHandle(fromNodeHandle: Handle): Handle {
        let currentNodeHandle: Handle = fromNodeHandle;
        while(currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if(node.type === "LAMBDA") {
                return currentNodeHandle;
            }
            currentNodeHandle = node.parent;
        }
        return null;
    }

    // 生成模块内唯一的变量名
    function MakeUniqueVariable(lambdaHandle: Handle, variable: string): string {
        return `${ast.moduleQualifiedName}.${lambdaHandle}.${variable}`;
    }

    // 以下是作用域解析：需要对所有node扫描两遍
    function ScopeAnalysis(): void {
        // 首先初始化所有scope
        for(let nodeHandle of ast.lambdaHandles) {
            let scope: Scope = new Scope(null);
            ast.scopes.set(nodeHandle, scope);
        }

        // 第1趟扫描：在ast.scopes中注册作用域的树状嵌套关系；处理define行为
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点
            if(nodeType === "LAMBDA") {
                // 寻找上级lambda节点
                let parentLambdaHandle: Handle = nearestLambdaHandle(node.parent);
                // 非顶级lambda
                if(parentLambdaHandle !== null) {
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
            else if(nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle: Handle = nearestLambdaHandle(nodeHandle);
                if(parentLambdaHandle !== null) {
                    let definedVariable: string = node.children[1];
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
        ast.nodes.ForEach((nodeHandle)=>{
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;

            // Lambda节点：替换parameter和bodies中出现的所有Variable
            if(nodeType === "LAMBDA") {
                // 处理Lambda节点的parameters
                for(let i = 0; i < node.getParameters().length; i++) {
                    let originVar = (node.getParameters())[i];
                    let newVar: string = MakeUniqueVariable(nodeHandle, originVar);
                    (ast.GetNode(nodeHandle).getParameters())[i] = newVar;
                    ast.variableMapping.set(newVar, originVar);
                }
                // 处理body中出现的单独的变量（例如(lambda (x) *x*)）
                for(let i = 2; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if(isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if(lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if(!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`
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
            else if(nodeType === "APPLICATION" || nodeType === "UNQUOTE") {
                // 跳过若干特殊类型的node
                let first = node.children[0];
                if(["native", "import"].indexOf(first) >= 0) {
                    return; // 相当于continue;
                }
                for(let i = 0; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if(isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if(lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if(!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`
                            }
                        }
                        else {
                            let newVar = MakeUniqueVariable(lambdaHandle, child);
                            (ast.GetNode(nodeHandle).children)[i] = newVar;
                        }
                    }
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