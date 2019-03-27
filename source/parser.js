// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// parser.js
// Scheme源码语法分析
// 输入：SOURCE（Scheme源代码）
// 输出：AST（抽象语法树，含静态资源）

const Common = require('./common.js'); // 引入公用模块

const Lexer = function(code) {
    // 预处理：去掉注释
    code = code.replace(/\;.*\n/gi, '');
    // 预处理：转义恢复
    code = code.replace(/\&lt\;/gi, '<');
    code = code.replace(/\&gt\;/gi, '>');
    // 预处理：去除前面的空白字符，并且在末尾加一个换行
    code = code.replace(/^\s(?=\S)/, "");
    code = [code, '\n'].join('');

    var tokens = [];
    var token_temp = [];
    var inspace = false; // 是否在多个空格中

    for(var i = 0; i < code.length; i++) {
        if(code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' || code[i] === '{' || code[i] === '}' || code[i] === '\'' || code[i] === '"') {
            if(token_temp.length > 0) {
                var new_token = token_temp.join('');
                tokens.push(new_token);
                token_temp = [];
            }
            if(code[i] === '"') {
                var string_lit = code.substring(i).match(/\"[^\"]*?\"/gi);
                if(string_lit != null) {
                    string_lit = string_lit[0];
                    tokens.push(string_lit);
                    i = i + string_lit.length - 1;
                    continue;
                }
                else {
                    console.error('词法分析错误：字符串字面值未找到');
                    return;
                }
            }
            else {
                tokens.push(code[i]);
            }
        }
        else {
            // 如果是空格，则将
            if(code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r') {
                if(inspace == true) {
                    continue;
                }
                else {
                    inspace = false;
                    if(token_temp.length > 0) {
                        var new_token = token_temp.join('');
                        tokens.push(new_token);
                        token_temp = [];
                    }
                }
            }
            else {
                token_temp.push(code[i]);
            }
        }
    }
    // console.log("Tokens:");
    // console.log(tokens);
    return tokens;
}

// 递归下降分析+尾位置标记
// 生成AST
const GenarateAST = function(TOKENS) {
    let AST = new Common.AST();

    let NODE_ARRAY = new Array();
    let NODE_COUNTER = 0;
    let NODE_STACK = new Array();

    // 分配一个新的AST节点索引
    function allocateNodeIndex() {
        let ret = NODE_COUNTER;
        NODE_COUNTER++;
        return ret;
    }

    // 压入新SList节点
    function pushSList() {
        let parentIndex = NODE_STACK.top();
        let currentIndex = allocateNodeIndex();
        let slist = new Common.SList(false, currentIndex, parentIndex);
        let slistRef = AST.NewObject(Common.OBJECT_TYPE.SLIST, slist);
        NODE_ARRAY[currentIndex] = slistRef;
        NODE_STACK.push(currentIndex);
    }
    // 压入新Lambda节点
    function pushLambda() {
        let parentIndex = NODE_STACK.top();
        let currentIndex = allocateNodeIndex();
        let lambda = new Common.Lambda(false, currentIndex, parentIndex);
        let lambdaRef = AST.NewObject(Common.OBJECT_TYPE.SLIST, lambda);
        NODE_ARRAY[currentIndex] = lambdaRef;
        NODE_STACK.push(currentIndex);
    }

    // 压入新QuotedSList节点
    function pushQuotedSList() {
        let parentIndex = NODE_STACK.top();
        let currentIndex = allocateNodeIndex();
        let qlist = new Common.SList(true, currentIndex, parentIndex);
        let qlistRef = AST.NewObject(Common.OBJECT_TYPE.SLIST, qlist);
        NODE_ARRAY[currentIndex] = qlistRef;
        NODE_STACK.push(currentIndex);
    }

    // 作为列表项结束
    function popItem() {
        let a = NODE_STACK.pop();
        if(NODE_ARRAY[NODE_STACK.top()] !== undefined) {
            let slistRef = NODE_ARRAY[NODE_STACK.top()];
            AST.GetObject(slistRef).children.push(NODE_ARRAY[a]);
        }
    }
    // 作为函数体结束
    function popBody() {
        let a = NODE_STACK.pop();
        let lambdaRef = NODE_ARRAY[NODE_STACK.top()];
        AST.GetObject(lambdaRef).body = NODE_ARRAY[a];
    }

    // 添加新Symbol（列表项）
    function addItemSymbol(s) {
        // let symbolRef = AST.NewObject(Common.OBJECT_TYPE.SYMBOL, s);
        let slistRef = NODE_ARRAY[NODE_STACK.top()];
        AST.GetObject(slistRef).children.push(s);
    }
    // 添加新Symbol（参数列表）
    function addParameterSymbol(s) {
        let lambdaRef = NODE_ARRAY[NODE_STACK.top()];
        AST.GetObject(lambdaRef).parameters.push(s);
    }
    // 添加新Symbol（函数体）
    function addBodySymbol(s) {
        let lambdaRef = NODE_ARRAY[NODE_STACK.top()];
        AST.GetObject(lambdaRef).body = s;
    }


    function isSYMBOL(t) {
        if(t === '(' || t === ')' || t === '[' || t === ']' || t === '{' || t === '}' || t === undefined) { return false; }
        else { return true; }
    }
    
    function ParserLog(m) {
        // console.log(m);
        // STDOUT.push(m.replace(/\</gi,'&lt;').replace(/\>/gi,'&gt;'));
        // STDOUT.push('<br>');
    }
    function ParserError(m) {
        console.error(m);
        // STDOUT.push(`<span style="color:red;">${m.replace(/\</gi,'&lt;').replace(/\>/gi,'&gt;')}</span>`);
        // STDOUT.push('<br>');
        throw 'ParseError';
    }
    
    // 用于记录quote状态
    let quoteFlag = false;
    // 用于记录body节点的退出
    let lambdaBodyFlag = new Array();
    // 用于记录body是否是单独的symbol
    let symbolBodyFlag = false;
    
    // 起始非终结符（NT）
    function NT_Term(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '(') {
            // <Lambda>
            if(quoteFlag !== true && tokens[index+1] === 'lambda') {
                ParserLog(`<Term> → <Lambda> @ ${tokens[index]}`);
                next = NT_Lambda(tokens, index);
                return next;
            }
            // <SList>
            else {
                ParserLog(`<Term> → <SList> @ ${tokens[index]}`);
                next = NT_SList(tokens, index);
                return next;
            }
        }
        // <Quote>
        else if(tokens[index] === '\'') {
            ParserLog(`<Term> → <Quote> @ ${tokens[index]}`);
            next = NT_Quote(tokens, index);
            return next;
        }
        // <Quasiquote>
        else if(tokens[index] === '[') {
            ParserLog(`<Term> → <Quasiquote> @ ${tokens[index]}`);
            next = NT_Quasiquote(tokens, index);
            return next;
        }
        // <Symbol>
        else if(isSYMBOL(tokens[index])) {
            ParserLog(`<Term> → <Symbol> @ ${tokens[index]}`);
            next = NT_Symbol(tokens, index);
            return next;
        }
        else {
            ParserError(`<Term> 意外前缀 @ ${next}`);
            return;
        }
    }
    
    
    // <SList> ::= ( <SListSeq> )
    function NT_SList(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '(') {
            ParserLog(`<SList> → ( <SListSeq> ) @ ${tokens[index]}`);
            // lambdaBodyFlag.push(false);
            // 判断是不是quote后面的
            if(quoteFlag === true) {
                pushQuotedSList();
            }
            else {
                pushSList();
            }
            next = NT_SListSeq(tokens, next);
            if(tokens[next] === ')') {
                let isBody = lambdaBodyFlag.pop();
                if(isBody === true) {
                    popBody();
                }
                else {
                    popItem();
                }
                return (next+1);
            }
            else {
                ParserError(`<SList> 缺少右括号 @ ${next}`);
                return;
            }
        }
        else {
            ParserError(`<SList> 意外前缀 @ ${next}`);
            return;
        }
    }
    
    // <Lambda> ::= ( lambda <ArgList> <Term> )
    function NT_Lambda(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '(' && tokens[index+1] === 'lambda') {
            ParserLog(`<Lambda> → ( lambda <ArgList> <Term> ) @ ${tokens[index]}`);
            // lambdaBodyFlag.push(false);
            pushLambda();
            next = NT_ArgList(tokens, index+2);
            // lambdaBodyFlag.push(true);
            next = NT_Body(tokens, next);
            if(tokens[next] === ')') {
                let isBody = lambdaBodyFlag.pop();
                if(isBody === true) {
                    popBody();
                }
                else {
                    popItem();
                }
                return (next+1);
            }
            else {
                ParserError(`<Lambda> 缺少右括号 @ ${next}`);
                return next;
            }
        }
        else {
            ParserError(`<Lambda> 意外前缀 @ ${next}`);
            return next;
        }
    }
    
    // <Body> ::= <Term>
    function NT_Body(tokens, index) {
        let next = index + 1;
        // <Term>
        if(tokens[index] === '(' || tokens[index] === '[' || tokens[index] === '\'') {
            ParserLog(`<Body> → <Term> @ ${tokens[index]}`);
            lambdaBodyFlag.push(true);
            next = NT_Term(tokens, index);
            return next;
        }
        // <Symbol>
        else if(isSYMBOL(tokens[index])) {
            ParserLog(`<Body> → <BodySymbol> @ ${tokens[index]}`);
            symbolBodyFlag = true;
            next = NT_BodySymbol(tokens, index);
            return next;
        }
        else {
            ParserError(`<Body> 意外前缀 @ ${next}`);
            return;
        }
    }
    
    // <SListSeq> ::= <Term> <SListSeq> | ε
    function NT_SListSeq(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '(' || tokens[index] === '[' || tokens[index] === '\'' || isSYMBOL(tokens[index])) {
            ParserLog(`<SListSeq> → <Term> <SListSeq> @ ${tokens[index]}`);
            lambdaBodyFlag.push(false);
            next = NT_Term(tokens, index);
            next = NT_SListSeq(tokens, next);
            return next;
        }
        ParserLog(`<SListSeq> → ε @ ${tokens[index]}`);
        return index; // epsilon不吃token
    }
    
    // <ArgListSeq> ::= <ArgSymbol> <ArgListSeq> | ε
    function NT_ArgListSeq(tokens, index) {
        let next = index + 1;
        if(isSYMBOL(tokens[index])) {
            ParserLog(`<ArgListSeq> → <ArgSymbol> <ArgListSeq> @ ${tokens[index]}`);
            next = NT_ArgSymbol(tokens, index);
            next = NT_ArgListSeq(tokens, next);
            return next;
        }
        ParserLog(`<ArgListSeq> → ε @ ${tokens[index]}`);
        return index; // epsilon不吃token
    }
    
    // <ArgList> ::= ( <ArgListSeq> )
    function NT_ArgList(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '(') {
            ParserLog(`<ArgList> → ( <ArgListSeq> ) @ ${tokens[index]}`);
            next = NT_ArgListSeq(tokens, index+1);
            if(tokens[next] === ')') {
                return (next+1);
            }
            else {
                ParserError(`<ArgList> 缺少右括号 @ ${next}`);
                return next;
            }
        }
        else {
            ParserError(`<ArgList> 意外前缀 @ ${next}`);
            return next;
        }
    }
    
    // <Quote> ::= ' <SList> | ' <Symbol>
    function NT_Quote(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '\'') {
            if(tokens[index+1] === '(') {
                ParserLog(`<Quote> → ' <SList> @ ${tokens[index]}`);
                quoteFlag = true;
                // lambdaBodyFlag.push(false);
                next = NT_SList(tokens, next);
                quoteFlag = false;
                return next;
            }
            // <Quasiquote>
            else if(tokens[index+1] === '[') {
                ParserLog(`<Quote> → <Quasiquote> @ ${tokens[index]}`);
                // quoteFlag = true;
                next = NT_Quasiquote(tokens, next);
                // quoteFlag = false;
                return next;
            }
            else if(isSYMBOL(tokens[index+1]) === true || tokens[index+1] === 'lambda') {
                ParserLog(`<Quote> → ' <Symbol> @ ${tokens[index]}`);
                quoteFlag = true;
                // lambdaBodyFlag.push(false);
                next = NT_Symbol(tokens, next);
                quoteFlag = false;
                return next;
            }
            else {
                ParserError(`<Quote> 意外前缀 @ ${next}`);
                return next;
            }
        }
        else {
            ParserError(`<Quote> 意外前缀 @ ${next}`);
            return next;
        }
    }
    
    // <Quasiquote> ::= [ <SListSeq> ]
    function NT_Quasiquote(tokens, index) {
        let next = index + 1;
        if(tokens[index] === '[') {
            ParserLog(`<SList> → [ <SListSeq> ] @ ${tokens[index]}`);
            pushQuotedSList(); //quasiquote目前以quote看待
            next = NT_SListSeq(tokens, next);
            if(tokens[next] === ']') {
                let isBody = lambdaBodyFlag.pop();
                if(isBody === true) {
                    popBody();
                }
                else {
                    popItem();
                }
                return (next+1);
            }
            else {
                ParserError(`<Quasiquote> 缺少右括号 @ ${next}`);
                return;
            }
        }
        else {
            ParserError(`<Quasiquote> 意外前缀 @ ${next}`);
            return;
        }
    }
    
    // <Symbol> ::= SYMBOL
    function NT_Symbol(tokens, index) {
        let next = index + 1;
        if(isSYMBOL(tokens[index])) {
            ParserLog(`<Symbol> → SYMBOL @ ${tokens[index]}`);
            let isBody = lambdaBodyFlag.pop();
            if(isBody === true && symbolBodyFlag == true) {
                addBodySymbol(tokens[index]);
                symbolBodyFlag = false;
            }
            else { // quote也走这个分支，只不过要保留'号
                let termtype = Common.TypeOfToken(tokens[index]);
                if(termtype === Common.OBJECT_TYPE.STRING) {
                    let newStringRef = AST.NewObject(Common.OBJECT_TYPE.STRING, tokens[index]);
                    addItemSymbol(newStringRef);
                }
                else if(termtype === Common.OBJECT_TYPE.BOOLEAN || termtype === Common.OBJECT_TYPE.NUMBER) {
                    let newConstantRef = AST.NewObject(Common.OBJECT_TYPE.CONSTANT, tokens[index]);
                    addItemSymbol(newConstantRef);
                }
                else {
                    if(quoteFlag) {
                        let newSymbolRef = AST.NewObject(Common.OBJECT_TYPE.SYMBOL, tokens[index]);
                        addItemSymbol(newSymbolRef);
                    }
                    else {
                        // NOTE 注意这里保留变量原形，待AST形成后再进行分析（替换重名自由变量→变量入AST）
                        /*
                        if(termtype === Common.OBJECT_TYPE.VARIABLE) {
                            let newVarRef = AST.NewObject(Common.OBJECT_TYPE.VARIABLE, tokens[index]);
                            addItemSymbol(newVarRef);
                        }
                        */
                        addItemSymbol(tokens[index]);
                    }
                }
            }
            return next;
        }
        else {
            ParserError(`<Symbol> 意外前缀 @ ${next}`);
            return next;
        }
    }
    
    // <BodySymbol> ::= SYMBOL
    function NT_BodySymbol(tokens, index) {
        let next = index + 1;
        if(isSYMBOL(tokens[index])) {
            ParserLog(`<BodySymbol> → SYMBOL @ ${tokens[index]}`);
            addBodySymbol(tokens[index]);
            return next;
        }
        else {
            ParserError(`<BodySymbol> 意外前缀 @ ${next}`);
            return next;
        }
    }
    
    // <ArgSymbol> ::= SYMBOL
    function NT_ArgSymbol(tokens, index) {
        let next = index + 1;
        if(isSYMBOL(tokens[index])) {
            ParserLog(`<ArgSymbol> → SYMBOL @ ${tokens[index]}`);
            addParameterSymbol(tokens[index]);
            return next;
        }
        else {
            ParserError(`<ArgSymbol> 意外前缀 @ ${next}`);
            return next;
        }
    }

    // 针对(quote .)的预处理
    function dealQuote() {
        for(let i = 0; i < NODE_ARRAY.length; i++) {
            let node = AST.GetObject(NODE_ARRAY[i]);
            if(node.type === Common.NODE_TYPE.SLIST && node.children[0] === 'quote') {
                // 取出被引用的元素，并将其父元素设置为(quote .)的父元素
                let quoted = node.children[1];
                let type = Common.TypeOfToken(quoted);
                if(/^REF\_/.test(type)) {
                    AST.GetObject(quoted).isQuote = true;
                    AST.GetObject(quoted).parentIndex = node.parentIndex;
                }
                else {
                    quoted = "'" + quoted;
                }
                // 将quoted的父节点的所有相应的儿子都改成quoted
                let parentNode = AST.GetObject(NODE_ARRAY[node.parentIndex]);
                for(let j = 0; j < parentNode.children.length; j++) {
                    if(parentNode.children[j] === NODE_ARRAY[i]) {
                        parentNode.children[j] = quoted;
                    }
                }
                // 删除(quote .)元素
                delete NODE_ARRAY[i];
            }
        }
    }

    

    // 尾位置标记（参照R5RS的归纳定义）
    function markTailCall(nodeRef, isTail) {
        if(Common.TypeOfToken(nodeRef) !== Common.NODE_TYPE.REF_SLIST) { return; }
        let node = AST.GetObject(nodeRef);
        if(node.type === Common.NODE_TYPE.SLIST) {
            // if 特殊构造
            if(node.children[0] === 'if') {
                markTailCall(node.children[1], false);
                markTailCall(node.children[2], true);
                markTailCall(node.children[3], true);
            }
            // cond 特殊构造
            else if(node.children[0] === 'cond') {
                for(let i = 1; i < node.children.length; i++) {
                    markTailCall(AST.GetObject(node.children[i]).children[0], false);
                    markTailCall(AST.GetObject(node.children[i]).children[1], true);
                }
            }
            // 其他构造，含begin、and、or，这些形式的尾位置是一样的
            else {
                for(let i = 0; i < node.children.length; i++) {
                    let istail = false;
                    if(i === node.children.length-1) {
                        if(node.children[0] === 'begin' || node.children[0] === 'and' || node.children[0] === 'or') {
                            istail = true;
                        }
                    }
                    markTailCall(node.children[i], istail);
                }
                if(isTail) {
                    AST.GetObject(nodeRef).isTail = true; // 标记为尾（调用）位置
                }
            }
        }
        else if(node.type === Common.NODE_TYPE.LAMBDA) {
            let node = AST.GetObject(nodeRef);
            markTailCall(node.body, true);
        }
        else {
            return;
        }
    }

    function TailCallAnalysis() {
        markTailCall(Common.makeRef(Common.OBJECT_TYPE.SLIST, 0), false);
    }

    function parseBegin(tokens) {
        NT_Term(tokens, 0);
    }

    parseBegin(TOKENS);         // 递归下降
    dealQuote();                // 特殊处理 (quote .) 语法
    TailCallAnalysis();         // 尾位置标注

    return AST;
};


// 预处理语句分析
const Preprocess = function(AST) {
    for(let index = 0; index < AST.slists.length; index++) {
        let node = AST.GetObject(Common.makeRef("SLIST", index));
        if(node.type === Common.NODE_TYPE.SLIST) {
            let children = node.children;
            // import：将别名列入别名字典，且保留
            if(children[0] === 'import') {
                if(Common.TypeOfToken(children[1]) !== "REF_STRING") {
                    throw `[SSC预处理] import的来源路径必须写成字符串`;
                }
                else {
                    node.children[1] = AST.GetObject(children[1]); // 替换为字符串，方便分析
                    let alias = children[2];
                    if(alias && alias.length > 0) {
                        AST.dependencies[alias] = Common.trimQuotes(node.children[1]); // 去掉双引号
                    }
                }
                continue;
            }
            // native：指定native库名称
            else if(children[0] === 'native') {
                // TODO：更多断言，例如重复判断、native库存在性判断等
                let nativeName = AST.GetObject(children[1]);
                AST.natives[nativeName] = true; // TODO：可以存一点有意义的东西
                continue;
            }
        }
    }
};

// 作用域分析
// 变量名称唯一化，为汇编做准备。针对AST进行操作。
const DomainAnalysis = function(AST) {
    // 从某个节点开始，向上查找某个变量归属的Lambda节点
    function searchVarLambdaIndex(symbol, fromNodeIndex, variableMapping) {
        let currentNodeIndex = fromNodeIndex;
        let currentMap = null;
        while(currentNodeIndex !== undefined) {
            let node = AST.GetObject(Common.makeRef("SLIST", currentNodeIndex));
            if(node.type === Common.NODE_TYPE.LAMBDA) {
                currentMap = variableMapping[currentNodeIndex].map;
                if(symbol in currentMap) {
                    return currentNodeIndex;
                }
            }
            currentNodeIndex = node.parentIndex;
        }
        return null; // 变量未定义
    }

    // 查找某个node上面最近的lambda节点的地址
    function nearestLambdaIndex(index) {
        let cindex = index;
        while(cindex !== undefined) {
            let node = AST.GetObject(Common.makeRef("SLIST", cindex));
            if(node.type === Common.NODE_TYPE.LAMBDA) {
                return cindex;
            }
            cindex = node.parentIndex;
        }
        return null;
    }

    // 替换模式
    let varPattern = function(lambdaRef, index) {
        return index;
        // return `VAR@${lambdaRef}:${index}`;
    };
    // 变量判断
    let isVar = function(s) {
        return (Common.TypeOfToken(s) === 'VARIABLE');
    };
    // 用于记录每个Lambda拥有哪些直属变量，以及它们的编号（含参数列表和define的）
    let variableMapping = new Array();

    // 需要扫描AST两遍。第一遍进行词法域定位，第二遍替换。
    // 第一遍扫描：确定所有的参数和defined变量所在的Lambda节点和编号，以及记录所有import的别名
    for(let index = 0; index < AST.slists.length; index++) {
        let node = AST.GetObject(Common.makeRef("SLIST", index));
        if(node.type === Common.NODE_TYPE.LAMBDA) {
            // 首先注册变量，替换变量表
            let parameters = node.parameters;
            let varMap = new Object();
            varMap.map = new Object();
            for(let i = 0; i < parameters.length; i++) {
                let varRef = AST.NewObject(Common.OBJECT_TYPE.VARIABLE, parameters[i]);
                (varMap.map)[parameters[i]] = varRef; //i;
            }
            varMap.count = parameters.length;
            variableMapping[index] = varMap;
        }
        else if(node.type === Common.NODE_TYPE.SLIST) {
            let children = node.children;

            // 以下是一些预处理指令，注意：第二遍扫描处也需要修改
            // import：将别名列入别名字典，且保留
            if(children[0] === 'import') {
                // if(Common.TypeOfToken(children[1]) !== "REF_STRING") {
                //     throw `[SSC预处理] import的来源路径必须写成字符串`;
                // }
                // else {
                //     node.children[1] = AST.GetObject(children[1]); // 替换为字符串，方便分析
                //     let alias = children[2];
                //     if(alias && alias.length > 0) {
                //         AST.dependencies[alias] = node.children[1].substring(1, node.children[1].length - 1); // 去掉双引号
                //     }
                // }
                continue;
            }
            // native：指定native库名称
            else if(children[0] === 'native') {
                // TODO：更多断言，例如重复判断、native库存在性判断等
                // let nativeName = AST.GetObject(children[1]);
                // AST.natives[nativeName] = true; // TODO：可以存一点有意义的东西
                continue;
            }
            for(let i = 0; i < children.length; i++) {
                let s = children[i];
                if(isVar(s)) {
                    // 变量被defined，无论上级是否有定义过，都要使用本级Lambda
                    if(children[0] === 'define' && i === 1) {
                        let currentLambdaIndex = nearestLambdaIndex(index);
                        let varNum = variableMapping[currentLambdaIndex].count;
                        // NOTE：凡是defined的变量，都需要加上前缀“%MODULE_QUALIFIED_NAME%.”，以方便模块加载器将其替换成模块的全限定名
                        // NOTE：为简单起见，并不检查是否是顶级变量
                        let varRef = AST.NewObject(Common.OBJECT_TYPE.VARIABLE, `%MODULE_QUALIFIED_NAME%.${s}`);
                        (variableMapping[currentLambdaIndex].map)[s] = varRef; //varNum;
                        variableMapping[currentLambdaIndex].count = varNum + 1;
                    }
                }
            }
        }
    }

    // 第二遍扫描：替换
    for(let index = 0; index < AST.slists.length; index++) {
        let node = AST.GetObject(Common.makeRef("SLIST", index));
        if(node.children[0] === 'import') {
            continue;
        }
        if(node.children[0] === 'native') {
            continue;
        }
        if(node.type === Common.NODE_TYPE.LAMBDA) {
            // 首先注册变量，替换变量表
            let parameters = node.parameters;
            let varMap = variableMapping[index].map;
            for(let i = 0; i < parameters.length; i++) {
                let variable = parameters[i];
                (node.parameters)[i] = varPattern(Common.makeRef("SLIST", index), varMap[variable]);
            }

            // 然后替换body中的变量
            if(isVar(node.body)) {
                // 计算此变量所在的词法节点
                let lambdaIndex = searchVarLambdaIndex(node.body, index, variableMapping);
                // 在map中查找此变量的编号
                let map = variableMapping[lambdaIndex];
                // 处理define特殊情况
                if(node.body in map.map) {
                    node.body = varPattern(Common.makeRef("SLIST", lambdaIndex), (map.map)[node.body]);
                }
                // 处理没有注册的且有点号分隔的符号
                else if(/\./gi.test(node.body)) {
                    node.body = AST.NewObject("VARIABLE", node.body);
                }
                else {
                    throw `[预处理] 变量${node.body}未定义`;
                }
            }
        }
        else if(node.type === Common.NODE_TYPE.SLIST) {
            let children = node.children;
            for(let i = 0; i < children.length; i++) {
                let s = children[i];
                if(isVar(s)) {
                    // 计算此变量所在的词法节点
                    let lambdaIndex = searchVarLambdaIndex(s, index, variableMapping);
                    if(lambdaIndex === null) {
                        // 处理没有注册的且有点号分隔的符号
                        if(/\./gi.test(s)) {
                            (node.children)[i] = AST.NewObject("VARIABLE", s);
                            continue;
                        }
                        else {
                            throw `[预处理] 变量${s}未定义`;
                        }
                    }
                    // 在map中查找此变量的编号
                    let map = variableMapping[lambdaIndex];
                    if(s in map.map) {
                        (node.children)[i] = varPattern(Common.makeRef("SLIST", lambdaIndex), (map.map)[s]);
                    }
                    else {
                        throw `[预处理] 变量${s}未定义`;
                    }
                }
            }
        }
    }
};

// 代码→完整AST
const Parser = function(SOURCE) {
    let TOKENS = Lexer(SOURCE); // 词法分析
    let AST = GenarateAST(TOKENS);
    Preprocess(AST);
    DomainAnalysis(AST);
    return AST;
};

module.exports.Lexer = Lexer;
module.exports.Parser = Parser;
