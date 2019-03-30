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
        if(code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' || code[i] === '{' || code[i] === '}' || code[i] === '\''  || code[i] === ','  || code[i] === '`' || code[i] === '"') {
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

    // 处理begin的大括号
    let newTokens = new Array();
    for(let i = 0; i < tokens.length; i++) {
        if(tokens[i] === '{') {
            newTokens.push('(');
            newTokens.push('begin');
        }
        else if(tokens[i] === '}') {
            newTokens.push(')');
        }
        else {
            newTokens.push(tokens[i]);
        }
    }

    // 处理quote、quasiquote和unquote
    let newTokens2 = new Array();
    let skipMark = "0(SKIP)0";
    for(let i = 0; i < newTokens.length; i++) {
        if(newTokens[i] === skipMark) {
            continue;
        }
        if(newTokens[i] === '(' && (
            newTokens[i+1] === 'quote' ||
            newTokens[i+1] === 'unquote' ||
            newTokens[i+1] === 'quasiquote')) {
            // 去掉(*quote对应的括号
            let bracketCount = 0
            for(let j = i+1; j < newTokens.length; j++) {
                if(newTokens[j] === '(') { bracketCount++; }
                else if(newTokens[j] === ')') {
                    if(bracketCount === 0) { newTokens[j] = skipMark; break;}
                    else {bracketCount--; }
                }
            }
            if(newTokens[i+1] === 'quote') { newTokens2.push('\''); }
            else if(newTokens[i+1] === 'quasiquote') { newTokens2.push('`'); }
            else if(newTokens[i+1] === 'unquote') { newTokens2.push(','); }
            i++;
        }
        else {
            newTokens2.push(newTokens[i]);
        }
    }

    // console.log("Tokens:");
    // console.log(newTokens2);
    return newTokens2;
};

/*
          <Term> ::= <SList> | <Lambda> | <Quote> | <Unquote> | <Quasiquote> | <Symbol>
         <SList> ::= ( ※ <SListSeq> )
      <SListSeq> ::= <Term> ※ <SListSeq> | ε
        <Lambda> ::= ( ※ lambda <ArgList> <Body> )
       <ArgList> ::= ( ※1 <ArgListSeq> ※2)
    <ArgListSeq> ::= <ArgSymbol> ※ <ArgListSeq> | ε
     <ArgSymbol> ::= <Symbol>
          <Body> ::= <BodyTerm> ※ <Body_>
         <Body_> ::= <BodyTerm> ※ <Body_> | ε
      <BodyTerm> ::= <Term>
         <Quote> ::= ' ※1 <QuoteTerm> ※2
       <Unquote> ::= , ※1 <UnquoteTerm> ※2
    <Quasiquote> ::= ` ※1 <QuasiquoteTerm> ※2
     <QuoteTerm> ::= <Term>
   <UnquoteTerm> ::= <Term>
<QuasiquoteTerm> ::= <Term>
        <Symbol> ::= ※ SYMBOL
*/

// 递归下降分析+尾位置标记
// 生成AST
const GenarateAST = function(TOKENS) {

    function parseLog(msg) {
        // console.log(msg);
    }

    function isSymbol(token) {
        if(token === 'lambda') { return false; }
        // 关于下一行注释掉的说明：词法分析阶段这些就已经被消灭掉了
        if(token === "(" || token === ")" || token === "{" || token === "}" || token === "[" || token === "]"){ return false; }
        if(/^[\'\`\,]/gi.test(token)) { return false; } // 不允许开头的字符
        return true; // 其余的都是词法意义上的Symbol
    }

    let AST = new Common.AST();

    let NODE_STACK = new Array();
    let STATE_STACK = new Array();

    NODE_STACK.push('');

    function NewNode(nodeType, quoteType, parentRef) {
        let parentIndex = isNaN(parseInt(parentRef.substring(1))) ? void(0) : parseInt(parentRef.substring(1));
        // TODO 此处过于随意，应该与Common中定义的类型保持一致
        let node = {
            type: nodeType,
            index: 0, // 待定
            parentIndex: parentIndex,
            children: new Array(),
            body: new Array(),
            parameters: new Array(),
            quoteType: quoteType,
        };
        let newNodeRef = AST.NewObject(Common.OBJECT_TYPE.SLIST, node);
        // TODO 修改index字段的工作应该整合进AST.NewObject这个函数中。
        node.index = Common.getRefIndex(newNodeRef);
        return newNodeRef;
    }

    function GetNode(nodeRef) {
        return AST.GetObject(nodeRef);
    }

    // type: STRING/SYMBOL/VARIABLE/CONSTANT
    function NewAtom(atomType, atom) {
        let newAtomRef = AST.NewObject(atomType, atom);
        return newAtomRef;
    }

    function ParseTerm(tokens, index) {
        if(tokens[index] === '(' && tokens[index+1] === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if(tokens[index] === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
        }
        else if(tokens[index] === '\'') {
            parseLog('<Term> → <Quote>');
            return ParseQuote(tokens, index);
        }
        else if(tokens[index] === ',') {
            parseLog('<Term> → <Unquote>');
            return ParseUnquote(tokens, index);
        }
        else if(tokens[index] === '`') {
            parseLog('<Term> → <Quasiquote>');
            return ParseQuasiquote(tokens, index);
        }
        else if(isSymbol(tokens[index])) {
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
        let quoteType = STATE_STACK.top();
        let newSListRef = NewNode("SLIST", (quoteType) ? quoteType : false, NODE_STACK.top());
        NODE_STACK.push(newSListRef);

        let nextIndex = ParseSListSeq(tokens, index+1);

        if(tokens[nextIndex] === ')') { return nextIndex + 1; }
        else { throw `<SList>`; }
    }

    function ParseSListSeq(tokens, index) {
        parseLog('<SListSeq> → <Term> ※ <SListSeq> | ε');
        let currentToken = tokens[index];
        if( currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken))
        {
            let nextIndex = ParseTerm(tokens, index);

            // Action：从节点栈顶弹出节点，追加到新栈顶节点的children中。
            let childnode = NODE_STACK.pop();
            GetNode(NODE_STACK.top()).children.push(childnode);
        
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
        let newLambdaRef = NewNode("LAMBDA", false, NODE_STACK.top());
        NODE_STACK.push(newLambdaRef);

        let nextIndex = ParseArgList(tokens, index+2);
        nextIndex = ParseBody(tokens, nextIndex);

        if(tokens[nextIndex] === ')') { return nextIndex + 1; }
        else { throw `<Lambda>`; }
    }

    function ParseArgList(tokens, index) {
        parseLog('<ArgList> → ( ※1 <ArgListSeq> ※2)');
        // Action1
        STATE_STACK.push("PARAMETER");
        let nextIndex = ParseArgListSeq(tokens, index+1);
        // Action2
        STATE_STACK.pop();

        if(tokens[nextIndex] === ')') { return nextIndex + 1; }
        else { throw `<ArgList>`; }
    }

    function ParseArgListSeq(tokens, index) {
        parseLog('<ArgListSeq> → <ArgSymbol> ※ <ArgListSeq> | ε');
        if(isSymbol(tokens[index])) {
            let nextIndex = ParseArgSymbol(tokens, index);

            // Action：从节点栈顶弹出节点（必须是符号），追加到新栈顶Lambda节点的parameters中。
            let paramnode = NODE_STACK.pop();
            GetNode(NODE_STACK.top()).parameters.push(paramnode);
        
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
        let bodynode = NODE_STACK.pop();
        GetNode(NODE_STACK.top()).body.push(bodynode);

        nextIndex = ParseBodyTail(tokens, nextIndex);
        return nextIndex;
    }

    function ParseBodyTail(tokens, index) {
        parseLog('<Body_> → <BodyTerm> ※ <Body_> | ε');
        let currentToken = tokens[index];
        if( currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken))
        {
            let nextIndex = ParseBodyTerm(tokens, index);

            // Action：从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
            let bodynode = NODE_STACK.pop();
            GetNode(NODE_STACK.top()).body.push(bodynode);

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
        let nextIndex = ParseQuoteTerm(tokens, index+1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }

    function ParseUnquote(tokens, index) {
        parseLog('<Unquote> → , ※1 <UnquoteTerm> ※2');
        // Action1
        STATE_STACK.push('UNQUOTE');
        let nextIndex = ParseUnquoteTerm(tokens, index+1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }

    function ParseQuasiquote(tokens, index) {
        parseLog('<Quasiquote> → ` ※1 <QuasiquoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUASIQUOTE');
        let nextIndex = ParseQuasiquoteTerm(tokens, index+1);
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
        if(isSymbol(tokens[index])) {
            // Action
            let state = STATE_STACK.top();
            if(state === 'QUOTE' || state === 'QUASIQUOTE') {
                let type = Common.TypeOfToken(tokens[index]);
                // 被quote的常量和字符串不受影响
                if(type === "NUMBER") {
                    NODE_STACK.push(NewAtom("CONSTANT", tokens[index]));
                }
                else if(type === "STRING") {
                    NODE_STACK.push(NewAtom("STRING", tokens[index]));
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(tokens[index]);
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if(type === "VARIABLE" || ((type === "KEYWORD") && 
                        tokens[index] !== "quasiquote" || tokens[index] !== "quote" || tokens[index] !== "unquote")) {
                    NODE_STACK.push(NewAtom("SYMBOL", `'${tokens[index]}`));
                }
                else { // 含boolean
                    NODE_STACK.push(tokens[index]);
                }
            }
            else if(state === 'UNQUOTE') {
                let type = Common.TypeOfToken(tokens[index]);
                // 符号会被解除引用
                if(type === "SYMBOL") {
                    NODE_STACK.push(NewAtom("VARIABLE", tokens[index].replace(/^\'*/gi, "")));
                }
                // 其他所有类型不受影响
                else if(type === "NUMBER") {
                    NODE_STACK.push(NewAtom("CONSTANT", tokens[index]));
                }
                else if(type === "STRING") {
                    NODE_STACK.push(NewAtom("STRING", tokens[index]));
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
                    NODE_STACK.push(tokens[index]); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`
                }
/*
                let noderef = NewNode("SLIST", "UNQUOTE", NODE_STACK.top());
                GetNode(noderef).children.push('unquote');
                let atomRef = NewAtom("VARIABLE", tokens[index]);
                GetNode(noderef).children.push(atomRef);
                NODE_STACK.push(noderef);
*/
            }
            else {
                let type = Common.TypeOfToken(tokens[index]);
                if(type === "NUMBER") {
                    NODE_STACK.push(NewAtom("CONSTANT", tokens[index]));
                }
                else if(type === "STRING") {
                    NODE_STACK.push(NewAtom("STRING", tokens[index]));
                }
                else if(type === "SYMBOL") {
                    NODE_STACK.push(NewAtom("SYMBOL", tokens[index]));
                }
                else if(type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN") {
                    NODE_STACK.push(tokens[index]); // VARIABLE原样保留，在作用域分析的时候才被录入AST
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

    // 尾位置标记（参照R5RS的归纳定义）
    function markTailCall(nodeRef, isTail) {
        if(Common.TypeOfToken(nodeRef) !== "REF_SLIST") { return; }
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
            for(let i = 0; i < node.body.length; i++) {
                if(i === node.body.length - 1) {
                    markTailCall((node.body)[i], true);
                }
                else {
                    markTailCall((node.body)[i], false);
                }
            }
        }
        else {
            return;
        }
    }

    function TailCallAnalysis() {
        markTailCall(Common.makeRef(Common.OBJECT_TYPE.SLIST, 0), false);
    }

    function parseBegin(tokens) {
        ParseTerm(tokens, 0);
    }

    parseBegin(TOKENS);         // 递归下降
    // TailCallAnalysis();         // 尾位置标注

    return AST;

};


// 预处理语句分析
const Preprocess = function(AST) {
    for(let index = 0; index < AST.slists.length; index++) {
        let node = AST.GetObject(Common.makeRef("SLIST", index));
        if(!node) {continue;}
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
        if(!node) {continue;}
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
        if(!node) {continue;}
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
            for(let i = 0; i < node.body.length; i++) {
                let bodyItem = node.body[i];
                if(isVar(bodyItem)) {
                    // 计算此变量所在的词法节点
                    let lambdaIndex = searchVarLambdaIndex(bodyItem, index, variableMapping);
                    // 在map中查找此变量的编号
                    let map = variableMapping[lambdaIndex];
                    // 处理define特殊情况
                    if(bodyItem in map.map) {
                        node.body[i] = varPattern(Common.makeRef("SLIST", lambdaIndex), (map.map)[bodyItem]);
                    }
                    // 处理没有注册的且有点号分隔的符号
                    else if(/\./gi.test(bodyItem)) {
                        node.body[i] = AST.NewObject("VARIABLE", bodyItem);
                    }
                    else {
                        throw `[预处理] 变量${bodyItem}未定义`;
                    }
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
