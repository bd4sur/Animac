
// Utility.ts
// 工具函数

// 虚拟文件系统
let ANIMAC_VFS = {};

let fs = null;
let path = null;

if (ANIMAC_CONFIG["env_type"] === "cli") {
    fs = require("fs");
    path = require("path");
}

const ANIMAC_HELP =
`Animac Scheme Implementation V${ANIMAC_CONFIG.version}
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
  -d, --debug       activate built-in web IDE (debugger) server.
  -e, --eval        evaluate code string <input>
  -h, --help        print help and copyright information.
  -i, --intp        interpret Animac VM executable file <input>.
  -r, --repl        start interactive REPL (read-eval-print-loop).
  -v, --version     print Animac version number.`;

// 顶级词法节点、顶级作用域和顶级闭包的parent字段
//   用于判断上溯结束
const TOP_NODE_HANDLE: Handle = "&TOP_NODE";

// 关键字集合
const KEYWORDS = [
    "car",    "cdr",    "cons",    "cond",    "if",    "else",    "begin", "while",
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


// 字符串散列相关
function HashString(strArray) {
    function DJB(str) {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            const charCode = str.charCodeAt(i);
            hash = ((hash << 5) + hash) + charCode; // hash * 33 + charCode
        }
        return hash >>> 0;
    }
    let s = 1;
    for (let i = 0; i < strArray.length; i++) {
        s *= DJB(strArray[i]);
    }

    return s.toString(16).slice(0, 16);
}





// 通用的require
function createModuleSystem() {
    // 模块缓存
    const moduleCache = {};

    // 核心的 require 函数
    function require(moduleId, code) {
        // 检查缓存
        if (moduleCache[moduleId]) {
            return moduleCache[moduleId].exports;
        }

        // 创建新模块
        const module = {
            id: moduleId,
            exports: {},
            loaded: false
        };

        // 立即缓存模块
        moduleCache[moduleId] = module;

        // 模块包装函数（核心）
        function wrapModule(code) {
            return new Function(
                'exports',
                'require',
                'module',
                '__filename',
                '__dirname',
                `{${code}\n}` // 包裹代码块确保作用域隔离
            );
        }

        // 执行模块代码
        try {
            const moduleFunction = wrapModule(code);
            moduleFunction.call(
                module.exports, // this 指向 exports
                module.exports, // exports 参数
                createRequire(module), // 自定义 require
                module,          // module 参数
                moduleId,        // __filename
                moduleId.split('/').slice(0, -1).join('/') || '.' // __dirname
            );
            module.loaded = true;
        } catch (error) {
            delete moduleCache[moduleId];
            throw error;
        }

        return module.exports;
    }

    // 创建模块专用的 require 函数
    function createRequire(parentModule) {
        return function (moduleId) {
            throw new Error(`Cannot require '${moduleId}' (nested requires not supported)`);
        };
    }

    return require;
}

const RequireNative = createModuleSystem();


// 路径处理
class PathUtils {
    static PathToModuleID(absolutePath: string): string {
        return absolutePath.trim()
                           .replace(/[\\\/]/gi, ".")
                           .replace(/\s/gi, "_")
                           .replace(/[\:]/gi, "")
                           .replace(/\.scm$/gi, "");
    }

    // 判断是否是所在平台的绝对路径
    static IsAbsolutePath(p: string): boolean {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.isAbsolute(p);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            return p.startsWith('/');
        }
        else {
            throw "error: unknown env type.";
        }
    }

    // 在特定平台下，将多个路径按顺序拼接成合理的绝对路径
    static Join(p1: string, p2: string): string {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.join(p1, p2);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            // 仅处理最简单的情况：p1是从根目录开始的绝对路径，p2是从p1开始的相对路径。例如“/root/a”和“b/c”简单拼接为“/root/a/b/c”
            if (p1.endsWith("/")) {
                return p1.slice(0, -1) + "/" + p2;
            }
            else {
                return p1 + "/" + p2;
            }
        }
        else {
            throw "error: unknown env type.";
        }
    }

    // 在特定平台下，返回某个路径的所在目录路径
    static DirName(p: string): string {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.dirname(p);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            let dirs = p.split("/");
            if (dirs[dirs.length-1] === "") {
                dirs = dirs.slice(0, -1);
            }
            dirs = dirs.slice(0, -1);
            return dirs.join("/");
        }
        else {
            throw "error: unknown env type.";
        }
    }

    // 在特定平台下，返回某个路径的文件名部分
    static BaseName(p: string, suffix: string): string {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.basename(p, suffix);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            let dirs = p.split("/");
            if (dirs[dirs.length-1] === "") {
                dirs = dirs.slice(0, -1);
            }
            return dirs.pop();
        }
        else {
            throw "error: unknown env type.";
        }
    }

    static cwd(): string {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return process.cwd();
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            return "/";
        }
        else {
            throw "error: unknown env type.";
        }
    }
}

// 文件操作
class FileUtils {
    static ReadFileSync(p: string): string {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return fs.readFileSync(p, "utf-8");
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            return ANIMAC_VFS[p];
        }
        else {
            throw "error: unknown env type.";
        }
    }

    static WriteFileSync(p: string, content: string): void {
        if (ANIMAC_CONFIG.env_type === "cli") {
            fs.writeFileSync(p, content, "utf-8");
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            ANIMAC_VFS[p] = content;
        }
        else {
            throw "error: unknown env type.";
        }
    }
}


// stdio操作抽象
class StdIOUtils {
    static stdout(s: string): void {
        if (ANIMAC_CONFIG.env_type === "cli") {
            process.stdout.write(s);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            ANIMAC_STDOUT_CALLBACK(s);
        }
        else {
            throw "error: unknown env type.";
        }
    }
    static stderr(s: string): void {
        if (ANIMAC_CONFIG.env_type === "cli") {
            process.stderr.write(s);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            ANIMAC_STDERR_CALLBACK(s);
        }
        else {
            throw "error: unknown env type.";
        }
    }
}

