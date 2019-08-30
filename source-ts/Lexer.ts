
// Lexer.ts
// 词法分析

interface Token {
    string: string;
    index: number;
}

// 词法分析：源码→Token序列
function Lexer(code: string): Array<Token> {
    // 转义恢复
    code = code.replace(/\&lt\;/gi, '<');
    code = code.replace(/\&gt\;/gi, '>');
    // 在末尾加一个换行
    code = [code, '\n'].join('');

    let tokens: Array<Token> = new Array();
    let token_temp: Array<string> = new Array();

    for(let i = 0; i < code.length; i++) {
        // 跳过注释
        if(code[i] === ';') {
            while(code[i] !== '\n' && code[i] !== '\r') {
                i++;
            }
            continue;
        }
        // 括号等定界符
        else if(code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' || code[i] === '{' || code[i] === '}' || code[i] === '\''  || code[i] === ','  || code[i] === '`' || code[i] === '"') {
            if(token_temp.length > 0) {
                let new_token = token_temp.join('');
                tokens.push({
                    string: new_token,
                    index: i - new_token.length
                });
                token_temp = [];
            }
            if(code[i] === '"') {
                let string_lit = code.substring(i).match(/\"[^\"]*?\"/gi);
                if(string_lit !== null) {
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
        else if(code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r') {
            if(token_temp.length > 0) {
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
    let newTokens: Array<Token> = new Array();
    for(let i = 0; i < tokens.length; i++) {
        if(tokens[i].string === '{') {
            newTokens.push({
                string: '(',
                index: tokens[i].index
            });
            newTokens.push({
                string: 'begin',
                index: tokens[i].index + 1
            });
        }
        else if(tokens[i].string === '}') {
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
