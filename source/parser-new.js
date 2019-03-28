Array.prototype.top = function() { return this[this.length - 1]; };
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
    console.log("Tokens:");
    console.log(tokens);
    return tokens;
}

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

function parseLog(msg) {
    console.log(msg);
}

function isSymbol(token) {
    if(token === 'lambda') { return false; }
    if(/[\s\(\)\[\]\{\}]/gi.test(token)) { return false; } // 不允许包含的字符
    if(/^[0-9\'\`\,]/gi.test(token)) { return false; } // 不允许开头的字符
    return true; // 其余的都是词法意义上的Symbol
}

let NODE_STACK = new Array();
let STATE_STACK = new Array();

NODE_STACK.push('$-1');

let NODES = new Array();
let NODE_COUNTER = 0;

function NewNode(nodeType, quoteType, parentRef) {
    let parentIndex = parseInt(parentRef.substring(1));
    let newNodeRef = `$${NODE_COUNTER}`;
    let node = {
        type: nodeType,
        index: NODE_COUNTER,
        parent: parentIndex,
        children: new Array(),
        body: new Array(),
        parameters: new Array(),
        quoteType: quoteType,
    };
    NODES[NODE_COUNTER] = node;
    NODE_COUNTER++;
    return newNodeRef;
}

function GetNode(nodeRef) {
    let nodeIndex = parseInt(nodeRef.substring(1));
    return NODES[nodeIndex];
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
            NODE_STACK.push(`'${tokens[index]}`);
        }
        else if(state === 'UNQUOTE') {
            NODE_STACK.push(`,${tokens[index]}`);
            /*
            let noderef = NewNode("SLIST", "UNQUOTE", NODE_STACK.top());
            GetNode(noderef).children.push('unquote');
            GetNode(noderef).children.push(tokens[index]);
            NODE_STACK.push(noderef);
            */
        }
        else {
            NODE_STACK.push(tokens[index]);
        }
        return index + 1;
    }
    else {
        throw `<Symbol>`;
    }
}

/*
【注意】
1 需要仔细定义“'”“`”“,”的行为。例如quote中的字符串会被引用成'"xxx"，这会影响中端对常量的归类，因此必须确定解引用的规则。
2 准引用列表到立即调用thunk的变换，在中端完成（同时负责处理完整形式，例如(quasiquote (...))）。
3 body现支持多个语句，所以中端后端都要相应改动。
4 允许字符串模板，例如"id=${id}"。字符串模板解析的工作由后端或者字符串native库完成。
5 Node定义有变化，需要修改common.js的相关代码。

*/

let code = `
(define test
    (Dict.new \`(
        (key1  ,value1)
        (key2  ,value2)
        (key3  ,value3))))`;

let tokens = Lexer(code);

ParseTerm(tokens, 0);

console.log(NODES);
