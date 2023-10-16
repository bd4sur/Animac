
// Parser.ts
// 语法分析：将代码解析成AST，但不加分析

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
    public absolutePath: string;                     // 模块代码所在绝对路径
    public moduleID: string;                         // 模块ID
    public source: string;                           // Scheme源码
    public nodes: Memory;                            // 词法节点
    public nodeIndexes: HashMap<Handle, number>;     // 词法节点到源码位置的映射
    public lambdaHandles: Array<Handle>;             // 所有Lambda节点的把柄
    public tailcall: Array<Handle>;                  // 尾调用Application节点的把柄
    public variableMapping: HashMap<string, string>; // 全局唯一变量名→原变量名
    public topVariables: HashMap<string, string>;    // 顶级变量（即顶层作用域define的变量）→原变量名
    public dependencies: HashMap<string, string>;    // 外部依赖模块：模块别名→模块路径
    public natives: HashMap<string, string>;         // Native模块名→（TODO 可能是模块的路径）

    constructor(source: string, absolutePath: string) {
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
    public Copy(): AST {
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
    public IsNativeCall(variable: string): boolean {
        let varPrefix = variable.split(".")[0];
        return this.natives.has(varPrefix);
    }

    // 取出某节点
    public GetNode(handle: Handle): any {
        return this.nodes.Get(handle);
    }

    // 创建一个Lambda节点，保存，并返回其把柄
    public MakeLambdaNode(parentHandle: Handle): Handle {
        // NOTE 每个节点把柄都带有模块ID，这样做的目的是：不必在AST融合过程中调整每个AST的把柄。下同。
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.LAMBDA`, true);
        let lambdaObject = new LambdaObject(parentHandle);
        this.nodes.Set(handle, lambdaObject);
        this.lambdaHandles.push(handle);
        return handle;
    }

    // 创建一个Application节点，保存，并返回其把柄
    public MakeApplicationNode(parentHandle: Handle, quoteType: string|void): Handle {
        let handle: any;
        let node: any;
        switch(quoteType) {
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
    public MakeStringNode(str: string): Handle {
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.STRING`, true);
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }

    //////////////////////////
    // 顶级节点操作
    //////////////////////////

    // 查找最顶级Application的把柄（用于尾调用起始位置、AST融合等场合）
    public TopApplicationNodeHandle(): Handle {
        let TopHandle: Handle = null;
        this.nodes.ForEach((nodeHandle)=> {
            if(this.nodes.Get(nodeHandle).parent === TOP_NODE_HANDLE) {
                TopHandle = nodeHandle;
                return "break";
            }
        });
        return TopHandle;
    }

    // 查找顶级Lambda（全局作用域）节点的把柄
    public TopLambdaNodeHandle(): Handle {
        return this.nodes.Get(this.TopApplicationNodeHandle()).children[0];
    }

    // 获取位于全局作用域的节点列表
    public GetGlobalNodes(): Array<any> {
        return this.nodes.Get(this.TopLambdaNodeHandle()).getBodies();
    }

    // 设置全局作用域的节点列表
    public SetGlobalNodes(bodies: Array<any>): void {
        this.nodes.Get(this.TopLambdaNodeHandle()).setBodies(bodies);
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
                else str = "(";*/
                if(node.children.length > 0) {
                    str = "(";
                    for(let i = 0; i < node.children.length-1; i++) {
                        str += this.NodeToString(node.children[i]);
                        str += " ";
                    }
                    str += this.NodeToString(node.children[node.children.length-1]);
                }
                else if(node.children.length === 0) {
                    str = "'(";
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
    public MergeAST(anotherAST: AST, order: string) {
        order = order || "top"; // 默认顺序为在顶部融合

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

        let sourceGlobalNodeHandles = anotherAST.GetGlobalNodes();

        let targetTopLambdaNodeHandle = this.TopLambdaNodeHandle();
        let targetGlobalNodeHandles = this.GetGlobalNodes();

        // 依赖（源）节点应挂载到前面
        if(order === "top") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(sourceGlobalNodeHandles.concat(targetGlobalNodeHandles));
        }
        else if(order === "bottom") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(targetGlobalNodeHandles.concat(sourceGlobalNodeHandles));
        }

        // 修改被挂载节点的parent字段
        for(let i = 0; i < sourceGlobalNodeHandles.length; i++) {
            this.nodes.Get(sourceGlobalNodeHandles[i]).parent = targetTopLambdaNodeHandle;
        }
        // 3、删除原来的顶级App节点和顶级Lambda节点
        this.nodes.DeleteHandle(anotherAST.TopLambdaNodeHandle());
        this.nodes.DeleteHandle(anotherAST.TopApplicationNodeHandle());

        for(let hd in anotherAST.nodeIndexes) {
            let oldValue = anotherAST.nodeIndexes.get(hd);
            this.nodeIndexes.set(hd, oldValue + this.source.length);
        }

        for(let hd of anotherAST.lambdaHandles) {
            if(hd === anotherAST.TopLambdaNodeHandle()) continue; // 注意去掉已删除的顶级Lambda节点
            this.lambdaHandles.push(hd);
        }

        for(let hd of anotherAST.tailcall) {
            if(hd === anotherAST.TopApplicationNodeHandle()) continue; // 注意去掉已删除的顶级Application节点
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


//////////////////////////////////////////////////
//
//  语法分析器：完成语法分析、作用域分析，生成AST
//
//  注意：输入代码必须是`((lambda () <code>))`格式
//
//////////////////////////////////////////////////

function Parse(code: string, absolutePath: string): AST {
    let ast = new AST(code, absolutePath);
    let tokens = Lexer(code);

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
                // 将相对路径扩展为绝对路径
                let modulePath = TrimQuotes(pathStringObject.content);
                if(PathUtils.IsAbsolutePath(modulePath) === false) {
                    let basePath = PathUtils.DirName(absolutePath);    // 当前模块所在的目录
                    modulePath = PathUtils.Join(basePath, modulePath); // 将依赖模块的路径拼接为绝对路径
                }
                ast.dependencies.set(moduleAlias, modulePath);
            }
            // (native <NativeLibName>)
            else if(nodeType === "APPLICATION" && node.children[0] === "native") {
                let nativeLibName: string = node.children[1];
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
