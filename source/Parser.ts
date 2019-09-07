
// Parser.ts
// 词法分析

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

class AST {
    public moduleQualifiedName: string;              // 模块全限定名
    public source: string;                           // Scheme源码
    public nodes: Memory;                            // 词法节点
    public nodeIndexes: HashMap<Handle, number>;     // 词法节点到源码位置的映射
    public lambdaHandles: Array<Handle>;             // 所有Lambda节点的把柄
    public tailcall: Array<Handle>;                  // 尾调用Application节点的把柄
    public variableMapping: HashMap<string, string>; // 全局唯一变量名→原变量名
    public topVariables: HashMap<string, string>;    // 顶级变量（即顶层作用域define的变量）→原变量名
    public dependencies: HashMap<string, string>;    // 外部依赖模块：模块别名→模块路径
    public natives: HashMap<string, string>;         // Native模块名→（TODO 可能是模块的路径）

    constructor(source: string, moduleQualifiedName: string) {
        this.source = source;
        this.moduleQualifiedName = moduleQualifiedName;
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
    public Copy(): AST {
        let copy = new AST(this.source, this.moduleQualifiedName);
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

    // 取出某节点
    public GetNode(handle: Handle): any {
        return this.nodes.Get(handle);
    }

    // 创建一个Lambda节点，保存，并返回其把柄
    public MakeLambdaNode(parentHandle: Handle) {
        // NOTE 每个节点把柄都带有模块全限定名，这样做的目的是：不必在AST融合过程中调整每个AST的把柄。下同。
        let handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.LAMBDA`, true);
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
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.QUOTE`, true);
                node = new QuoteObject(parentHandle);
                break;
            case "QUASIQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.QUASIQUOTE`, true);
                node = new QuasiquoteObject(parentHandle);
                break;
            case "UNQUOTE":
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.UNQUOTE`, true);
                node = new QuoteObject(parentHandle);
                break;
            default:
                handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.APPLICATION`, true);
                node = new ApplicationObject(parentHandle);
                break;
        }
        this.nodes.Set(handle, node);
        return handle;
    }

    // 创建一个字符串对象节点，保存，并返回其把柄
    public MakeStringNode(str: string) {
        let handle = this.nodes.AllocateHandle(`${this.moduleQualifiedName}.STRING`, true);
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }

    // 查找最顶级Application的把柄（用于尾调用起始位置、AST融合等场合）
    public TopApplicationNodeHandle() {
        let TopHandle: Handle = null;
        this.nodes.ForEach((nodeHandle)=> {
            if(this.nodes.Get(nodeHandle).parent === TOP_NODE_HANDLE) {
                TopHandle = nodeHandle;
                return "break";
            }
        });
        return TopHandle;
    }

    // 将某个节点转换回Scheme代码
    // TODO 对于Quote列表的输出效果可以优化
    public NodeToString(nodeHandle: Handle): string {
        let str = '';
        if(TypeOfToken(nodeHandle) === "VARIABLE") {
            if(this.variableMapping.has(nodeHandle)) {
                return this.variableMapping.get(nodeHandle);
            }
            else {
                return String(nodeHandle);
            }
        }
        else if(TypeOfToken(nodeHandle) === "SYMBOL") {
            return String(nodeHandle.substring(1));
        }
        else if(TypeOfToken(nodeHandle) !== "HANDLE") {
            return String(nodeHandle);
        }
        else {
            let node = this.GetNode(nodeHandle);
            let type = node.type;
            if(type === "STRING") {
                return node.content;
            }
            else if(type === "APPLICATION" || type === "QUOTE" || type === "QUASIQUOTE" || type === "UNQUOTE") {
                /*if(type === "QUOTE") str = "'(";
                else if(type === "QUASIQUOTE") str = "`(";
                else if(type === "UNQUOTE") str = ",(";
                else */str = "(";
                if(node.children.length > 0) {
                    for(let i = 0; i < node.children.length-1; i++) {
                        str += this.NodeToString(node.children[i]);
                        str += " ";
                    }
                    str += this.NodeToString(node.children[node.children.length-1]);
                }
                str += ')';
            }
            else if(type === "LAMBDA") {
                str = "(lambda (";
                // parameters
                let parameters = node.getParameters();
                if(parameters.length > 0) {
                    for(let i = 0; i < parameters.length-1; i++) {
                        str += this.NodeToString(parameters[i]);
                        str += " ";
                    }
                    str += this.NodeToString(parameters[parameters.length-1]);
                }
                str += ') ';
                // body
                let bodies = node.getBodies();
                if(bodies.length > 0) {
                    for(let i = 0; i < bodies.length-1; i++) {
                        str += this.NodeToString(bodies[i]);
                        str += " ";
                    }
                    str += this.NodeToString(bodies[bodies.length-1]);
                }
                str += ')';
            }
            return str;
        }
    }

    // 融合另一个AST（注意，把柄需完全不同，否则会冲突报错）
    // TODO 这里细节比较复杂，需要写一份文档描述
    public MergeAST(anotherAST: AST) {
        this.source += "\n";
        this.source += anotherAST.source;

        // 注意：为了维持词法作用域关系，不可以简单地将两个nodes并列起来，而应该将源AST的顶级Lambda节点追加到目标AST的顶级Lambda节点的bodie中
        // 1 融合
        anotherAST.nodes.ForEach((hd)=> {
            let node = anotherAST.nodes.Get(hd);
            this.nodes.NewHandle(hd, true); // 任何把柄在使用前都需要先注册，以初始化元数据
            this.nodes.Set(hd, node); // TODO：建议深拷贝
        });
        // 2 重组

        let sourceTopApplicationNodeHandle = anotherAST.TopApplicationNodeHandle();
        let sourceTopLambdaNodeHandle = anotherAST.nodes.Get(sourceTopApplicationNodeHandle).children[0];
        let sourceGlobalNodeHandles = anotherAST.nodes.Get(sourceTopLambdaNodeHandle).getBodies();

        let targetTopLambdaNodeHandle = this.nodes.Get(this.TopApplicationNodeHandle()).children[0];
        let targetGlobalNodeHandles = this.nodes.Get(targetTopLambdaNodeHandle).getBodies();

        // 依赖（源）节点应挂载到前面
        this.nodes.Get(targetTopLambdaNodeHandle).setBodies(sourceGlobalNodeHandles.concat(targetGlobalNodeHandles));

        // 修改被挂载节点的parent字段
        for(let i = 0; i < sourceGlobalNodeHandles.length; i++) {
            this.nodes.Get(sourceGlobalNodeHandles[i]).parent = targetTopLambdaNodeHandle;
        }
        // 3、删除原来的顶级App节点和顶级Lambda节点
        this.nodes.DeleteHandle(sourceTopLambdaNodeHandle);
        this.nodes.DeleteHandle(sourceTopApplicationNodeHandle);

        for(let hd in anotherAST.nodeIndexes) {
            let oldValue = anotherAST.nodeIndexes.get(hd);
            this.nodeIndexes.set(hd, oldValue + this.source.length);
        }

        for(let hd of anotherAST.lambdaHandles) {
            if(hd === sourceTopLambdaNodeHandle) continue; // 注意去掉已删除的顶级Lambda节点
            this.lambdaHandles.push(hd);
        }

        for(let hd of anotherAST.tailcall) {
            if(hd === sourceTopApplicationNodeHandle) continue; // 注意去掉已删除的顶级Application节点
            this.tailcall.push(hd);
        }

        for(let hd in anotherAST.variableMapping) {
            let oldValue = anotherAST.variableMapping.get(hd);
            this.variableMapping.set(hd, oldValue);
        }

        for(let hd in anotherAST.topVariables) {
            let oldValue = anotherAST.topVariables.get(hd);
            this.topVariables.set(hd, oldValue);
        }

        for(let hd in anotherAST.dependencies) {
            let oldValue = anotherAST.dependencies.get(hd);
            this.dependencies.set(hd, oldValue);
        }

        for(let hd in anotherAST.natives) {
            let oldValue = anotherAST.natives.get(hd);
            this.natives.set(hd, oldValue);
        }
    }
}

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

    let scopes: HashMap<Handle, Scope> = new HashMap();

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

    ///////////////////////////////
    //  递归下降分析
    ///////////////////////////////

    function ParseTerm(tokens: Array<Token>, index: number) {
        let quoteState = Top(STATE_STACK);
        if(quoteState !== "QUOTE" && quoteState !== "QUASIQUOTE" && tokens[index].string === '(' && tokens[index+1].string === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if(tokens[index].string === '(' && tokens[index+1].string === 'quote') {
            parseLog('<Term> → <Quote>');
            let nextIndex = ParseQuote(tokens, index+1);
            if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
            else { throw `[Error] quote 右侧括号未闭合。`; }
        }
        else if(tokens[index].string === '(' && tokens[index+1].string === 'unquote') {
            parseLog('<Term> → <Unquote>');
            let nextIndex = ParseUnquote(tokens, index+1);
            if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
            else { throw `[Error] unquote 右侧括号未闭合。`; }
        }
        else if(tokens[index].string === '(' && tokens[index+1].string === 'quasiquote') {
            parseLog('<Term> → <Quasiquote>');
            let nextIndex = ParseQuasiquote(tokens, index+1);
            if(tokens[nextIndex].string === ')') { return nextIndex + 1; }
            else { throw `[Error] quasiquote 右侧括号未闭合。`; }
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
        else if(tokens[index].string === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
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
        if(index >= tokens.length) throw `[Error] SList右侧括号未闭合。`; // TODO 完善错误提示
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
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "PORT" || 
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
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
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
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken);
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
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

            // (import <Alias> <Path>)
            if(nodeType === "APPLICATION" && node.children[0] === "import") {
                let moduleAlias: string = node.children[1];      // 模块的别名
                let pathStringHandle: Handle = node.children[2]; // 模块路径字符串（的把柄）
                let pathStringObject = ast.GetNode(pathStringHandle);  // 若不存在，会抛出异常
                if(pathStringObject.type !== "STRING") {
                    throw `[预处理] import的来源路径必须写成字符串`;
                }
                let path = TrimQuotes(pathStringObject.content);
                ast.dependencies.set(moduleAlias, path);
            }
            // (native <NativeLibName>)
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
                let bounds: Array<string> = scopes.get(currentNodeHandle).boundVariables;
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
        return `${lambdaHandle.substring(1)}.${variable}`;
    }

    // 以下是作用域解析：需要对所有node扫描两遍
    function ScopeAnalysis(): void {
        // 顶级Lambda的把柄
        let topLambdaHandle: Handle = ast.lambdaHandles[0];

        // 首先初始化所有scope
        for(let nodeHandle of ast.lambdaHandles) {
            let scope: Scope = new Scope(null);
            scopes.set(nodeHandle, scope);
        }

        // 第1趟扫描：在scopes中注册作用域的树状嵌套关系；处理define行为
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
            else if(nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle: Handle = nearestLambdaHandle(nodeHandle);
                if(parentLambdaHandle !== null) {
                    let definedVariable: string = node.children[1];
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
                            ast.variableMapping.set(newVar, child);
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
                            ast.variableMapping.set(newVar, child);
                        }
                    }
                }
                // 后处理：记录顶级变量
                if(first === "define" && node.parent === topLambdaHandle) {
                    let newVarName = node.children[1];
                    let originVarName = ast.variableMapping.get(newVarName);
                    if(ast.topVariables.has(originVarName)) {
                        throw `[Error] 顶级变量“${originVarName}”@Position ${ast.nodeIndexes.get(nodeHandle)} 重复。`
                    }
                    else {
                        ast.topVariables.set(originVarName, newVarName);
                    }
                }
            }
        }); // 所有节点扫描完毕
    }


    // 尾位置分析（参照R5RS的归纳定义）
    function TailCallAnalysis(item: any, isTail: boolean) {
        if(TypeOfToken(item) === "HANDLE") {
            let node = ast.GetNode(item);
            if(node.type === "APPLICATION") {
                let first = node.children[0];
                // if 特殊构造
                if(first === "if") {
                    TailCallAnalysis(node.children[1], false);
                    TailCallAnalysis(node.children[2], true);
                    TailCallAnalysis(node.children[3], true);
                }
                // cond 特殊构造
                else if(first === "cond") {
                    for(let i = 1; i < node.children.length; i++) {
                        let clauseNode = ast.GetNode(node.children[i]);
                        TailCallAnalysis(clauseNode.children[0], false);
                        TailCallAnalysis(clauseNode.children[1], true);
                    }
                }
                // 其他构造，含and、or，这些形式的尾位置是一样的
                else {
                    for(let i = 0; i < node.children.length; i++) {
                        let istail = false;
                        if ((i === node.children.length - 1) &&
                            (node.children[0] === 'begin' || node.children[0] === 'and' || node.children[0] === 'or')) {
                            istail = true;
                        }
                        TailCallAnalysis(node.children[i], istail);
                    }
                    if(isTail) {
                        ast.tailcall.push(item); // 标记为尾（调用）位置
                    }
                }
            }
            else if(node.type === "LAMBDA") {
                let bodies = node.getBodies();
                for(let i = 0; i < bodies.length; i++) {
                    if(i === bodies.length - 1) {
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

    // 递归下降语法分析
    ParseTerm(tokens, 0);
    // 预处理指令解析
    PreprocessAnalysis();
    // 作用域解析
    ScopeAnalysis();
    // 尾调用分析
    TailCallAnalysis(ast.TopApplicationNodeHandle(), true);

    return ast;
}
