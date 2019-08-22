interface Array<T> {
    top(): any;
}
Array.prototype.top = ()=>{ return this[this.length - 1]; }

interface Scope {
    parent: Handle;
    children: Array<Handle>;
    boundVariables: Array<string>;
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
    // Scheme源码
    public source: string;
    // 词法节点
    public nodes: Memory;
    // 词法节点到源码位置的映射
    public indexes: Map<Handle, number>;

    // 所有Lambda节点的把柄
    public lambdaHandles: Array<Handle>;

    // 尾调用Application节点的把柄
    public tailcall: Array<Handle>;

    // 作用域
    public scopes: Map<Handle, Scope>;

    // 外部依赖模块
    public dependencies: Map<string, string>; // 模块别名→模块路径
    // 模块全限定名
    public aliases: Map<string, string>; // 模块别名→模块全限定名

    // 使用到的Native模块
    public natives: Map<string, string> // Native模块名→（TODO 可能是模块的路径）

    //////////////////////////////////////////////////

    constructor(source: string) {
        this.source = source;
        this.nodes = new Memory();
        this.indexes = new Map();
        this.lambdaHandles = new Array();
        this.tailcall = new Array();
        this.scopes = new Map();
        this.dependencies = new Map();
        this.aliases = new Map();
        this.natives = new Map();
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
        let handle = this.nodes.NewHandle("LAMBDA");
        let node: any;
        switch(quoteType) {
            case "QUOTE":      node = new QuoteObject(parentHandle); break;
            case "QUASIQUOTE": node = new QuasiquoteObject(parentHandle); break;
            case "UNQUOTE":    node = new QuoteObject(parentHandle); break;
            default:           node = new ApplicationObject(parentHandle); break;
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


function Parse(code: string): AST {
    let ast = new AST(code);
    let tokens = Lexer(code);
    // 节点把柄栈
    let NODE_STACK: Array<any> = new Array();  NODE_STACK.push('');
    // 状态栈
    let STATE_STACK: Array<string> = new Array();

    // 解析输出
    function parseLog(msg: string) {}
    // 判断是否为定界符
    function isSymbol(token: string) {
        if(token === "(" || token === ")" || token === "{" || token === "}" || token === "[" || token === "]"){ return false; }
        if(/^[\'\`\,]/gi.test(token)) { return false; } // 不允许开头的字符
        return true; // 其余的都是词法意义上的Symbol
    }


    ///////////////////////////////
    //  以下是递归下降分析
    ///////////////////////////////

    function ParseTerm(tokens: Array<Token>, index: number) {
        let quoteState = STATE_STACK.top();
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
        let quoteType = STATE_STACK.top();
        let listHandle = ast.MakeApplicationNode(NODE_STACK.top(), ((quoteType) ? quoteType : false));
        NODE_STACK.push(listHandle);

        ast.indexes.set(listHandle, tokens[index].index);

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
            ast.GetNode(NODE_STACK.top()).content.children.push(childHandle);

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
        let lambdaHandle = ast.MakeLambdaNode(NODE_STACK.top());
        NODE_STACK.push(lambdaHandle);

        ast.indexes.set(lambdaHandle, tokens[index].index);

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
            ast.GetNode(NODE_STACK.top()).addParameter(parameter);
        
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
        ast.GetNode(NODE_STACK.top()).addBody(bodyNode);

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
            ast.GetNode(NODE_STACK.top()).addBody(bodyNode);

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

    function ParseSymbol(tokens: Array<Token>, index: number) {
        let currentToken = tokens[index].string;
        if(isSymbol(currentToken)) {
            // Action
            let state = STATE_STACK.top();
            if(state === 'QUOTE' || state === 'QUASIQUOTE') {
                let type: string = TypeOfToken(currentToken);
                // 被quote的常量和字符串不受影响
                if(type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken)); // 压入number
                }
                else if(type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if(type === "VARIABLE" || type === "KEYWORD" || 
                        (currentToken !== "quasiquote" && currentToken !== "quote" && currentToken !== "unquote")) {
                    NODE_STACK.push(currentToken);
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
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`
                }
/*
                let noderef = NewNode("SLIST", "UNQUOTE", NODE_STACK.top());
                GetNode(noderef).children.push('unquote');
                let atomRef = NewAtom("VARIABLE", currentToken);
                GetNode(noderef).children.push(atomRef);
                NODE_STACK.push(noderef);
*/
            }
            else {
                let type = TypeOfToken(currentToken);
                if(type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if(type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken); // TODO:去掉两边的引号
                    NODE_STACK.push(stringHandle);
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

    return ast;
}