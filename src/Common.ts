
// Utility.ts
// 工具函数

const fs = require("fs");
const path = require("path");
const http = require('http');
const url = require('url');

const ANIMAC_VERSION = "V2023-alpha";

const ANIMAC_HELP =
`Animac Scheme Implementation ${ANIMAC_VERSION}
Copyright (c) 2019~2023 BD4SUR
https://github.com/bd4sur/Animac

Usage: node animac.js [option] <input> <output>

Options:
  (no option)       read and run Scheme code from file <input>.
                      if no <input> argument provided, start interactive REPL.
  -                 read and run Scheme code from stdin.
  -c, --compile     compile Scheme code file <input> to Animac VM executable file <output>.
                      will not execute the compiled executable.
                      default <output> is in the curent working directory.
  -d, --debug       activate built-in debugger.
  -e, --eval        evaluate code string <input>
  -h, --help        print help and copyright information.
  -i, --intp        interpret Animac VM executable file <input>.
  -r, --repl        start interactive REPL (read-eval-print-loop).
  -v, --version     print Animac version number.`;

// 状态常量
const SUCCEED = 0;

// 顶级词法节点、顶级作用域和顶级闭包的parent字段
//   用于判断上溯结束
const TOP_NODE_HANDLE: Handle = "&TOP_NODE";

// 关键字集合
const KEYWORDS = [
    "car",    "cdr",    "cons",    "cond",    "if",    "else",    "begin",
    "+",      "-",      "*",       "/",       "=",     "%",       "pow",
    "and",     "or",    "not",     ">",       "<",     ">=",      "<=",    "eq?",
    "define", "set!",   "null?",   "atom?",   "list?", "number?",
    "display","newline",
    "write",  "read",
    "call/cc",
    "import", "native",
    "fork",
    "quote",  "quasiquote",  "unquote",
];


// Primitive对应的AIL指令

const PrimitiveInstruction = {
    "+": "add",    "-": "sub",    "*": "mul",    "/": "div",    "%": "mod",
    "=": "eqn",    "<": "lt",     ">": "gt",     "<=": "le",    ">=": "ge",
    "set!": "set"
};


// 取数组/栈的栈顶
function Top(arr: Array<any>): any {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str: string): string {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
    else {
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t');
        return str;
    }
}

// 根据字面的格式，判断token类型
function TypeOfToken(token: any): string {
    if(token === undefined || token === null) {
        return token;
    }
    else if(typeof token === "boolean") {
        return "BOOLEAN";
    }
    else if(typeof token === "number") {
        return "NUMBER";
    }
    else if(typeof token !== "string" || token === "lambda") {
        return undefined;
    }
    else if(KEYWORDS.indexOf(token) >= 0){
        return "KEYWORD";
    }
    else if(token === '#t' || token === '#f') {
        return "BOOLEAN";
    }
    else if(isNaN(parseFloat(token)) === false) {
        return "NUMBER";
    }
    else if(token[0] === ':') {
        return "PORT";
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

// 路径处理
class PathUtils {
    static PathToModuleID(absolutePath: string): string {
        return absolutePath.trim()
                           .replace(/[\\\/]/gi, ".")
                           .replace(/\s/gi, "_")
                           .replace(/[\:]/gi, "")
                           .replace(/\.scm$/gi, "");
    }
}
