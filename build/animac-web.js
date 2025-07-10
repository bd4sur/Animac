// config.ts
// 全局配置
const ANIMAC_CONFIG = {
    "version": "2025.7",
    "env_type": "web", // 运行环境："cli" or "web"
    "is_debug": false,
    "is_gc_enabled": true, // 是否启用GC
    "gc_interval": 5000, // GC时间间隔（ms）
};
let ANIMAC_STDOUT_CALLBACK = (x) => { };
let ANIMAC_STDERR_CALLBACK = (x) => { };
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
const ANIMAC_HELP = `Animac Scheme Implementation V${ANIMAC_CONFIG.version}
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
  -e, --eval        evaluate code string <input>
  -h, --help        print help and copyright information.
  -i, --intp        interpret Animac VM executable file <input>.
  -r, --repl        start interactive REPL (read-eval-print-loop).
  -v, --version     print Animac version number.`;
// 顶级词法节点、顶级作用域和顶级闭包的parent字段
//   用于判断上溯结束
const TOP_NODE_HANDLE = "&TOP_NODE";
// 关键字集合
const KEYWORDS = [
    "car", "cdr", "cons", "get_item", "set_item!", "length",
    "cond", "if", "else", "begin", "while", "break", "continue",
    "+", "-", "*", "/", "=", "%", "pow",
    "and", "or", "not", ">", "<", ">=", "<=", "eq?",
    "define", "set!", "null?", "atom?", "list?", "number?",
    "display", "newline",
    "write", "read",
    "call/cc",
    "import", "native",
    "fork",
    "quote", "quasiquote", "unquote",
];
// Primitive对应的AIL指令
const PrimitiveInstruction = {
    "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod",
    "=": "eqn", "<": "lt", ">": "gt", "<=": "le", ">=": "ge",
    "set!": "set", "set_item!": "set_item"
};
// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}
// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if (str === undefined)
        return "";
    if (str[0] === '"' && str[str.length - 1] === '"') {
        str = str.substring(1, str.length - 1);
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t').replace(/\\b/gi, '\b');
        return str;
    }
    else {
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t').replace(/\\b/gi, '\b');
        return str;
    }
}
// 根据字面的格式，判断token类型
function TypeOfToken(token) {
    if (token === undefined || token === null) {
        return token;
    }
    else if (typeof token === "boolean") {
        return "BOOLEAN";
    }
    else if (typeof token === "number") {
        return "NUMBER";
    }
    else if (typeof token !== "string" || token === "lambda") {
        return undefined;
    }
    else if (KEYWORDS.indexOf(token) >= 0) {
        return "KEYWORD";
    }
    else if (token === '#t' || token === '#f') {
        return "BOOLEAN";
    }
    else if (isNaN(parseFloat(token)) === false) {
        return "NUMBER";
    }
    else if (token[0] === ':') {
        return "PORT";
    }
    else if (token[0] === '&') {
        return "HANDLE";
    }
    else if (token[0] === '\'') {
        return "SYMBOL";
    }
    else if (token[0] === '@') {
        return "LABEL";
    }
    else if (token[0] === '"' && token[token.length - 1] === '"') {
        return "STRING";
    }
    else {
        return "VARIABLE";
    }
}
// 判断token是不是变量
function isVariable(token) {
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
            return new Function('exports', 'require', 'module', '__filename', '__dirname', `{${code}\n}` // 包裹代码块确保作用域隔离
            );
        }
        // 执行模块代码
        try {
            const moduleFunction = wrapModule(code);
            moduleFunction.call(module.exports, // this 指向 exports
            module.exports, // exports 参数
            createRequire(module), // 自定义 require
            module, // module 参数
            moduleId, // __filename
            moduleId.split('/').slice(0, -1).join('/') || '.' // __dirname
            );
            module.loaded = true;
        }
        catch (error) {
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
    static PathToModuleID(absolutePath) {
        return absolutePath.trim()
            .replace(/[\\\/]/gi, ".")
            .replace(/\s/gi, "_")
            .replace(/[\:]/gi, "")
            .replace(/\.scm$/gi, "");
    }
    // 判断是否是所在平台的绝对路径
    static IsAbsolutePath(p) {
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
    static Join(p1, p2) {
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
    static DirName(p) {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.dirname(p);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            let dirs = p.split("/");
            if (dirs[dirs.length - 1] === "") {
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
    static BaseName(p, suffix) {
        if (ANIMAC_CONFIG.env_type === "cli") {
            return path.basename(p, suffix);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            let dirs = p.split("/");
            if (dirs[dirs.length - 1] === "") {
                dirs = dirs.slice(0, -1);
            }
            return dirs.pop();
        }
        else {
            throw "error: unknown env type.";
        }
    }
    static cwd() {
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
    static ReadFileSync(p) {
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
    static WriteFileSync(p, content) {
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
    static stdout(s) {
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
    static stderr(s) {
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
ANIMAC_VFS["/lib/File.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;




// nativelib/File.js
// File本地库








// (File.read filePath:String callback:(s:String->undefined)) : undefined
function read(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let filePathHandle = PROCESS.PopOperand();

    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }

    PROCESS.Step(); // 立刻退出，执行下一指令

    fs.readFile(filePath, {encoding:"utf-8"}, (error, data)=> {
        if(error) {
            PROCESS.OPSTACK.push("#f"); // TODO native函数的错误处理仍需细化
        }
        else {
            // 构造字符串对象
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: String(data)
            };
            PROCESS.heap.Set(strHandle, strObject);
            PROCESS.OPSTACK.push(strHandle);
        }

        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            // NOTE 返回到地址为1的指令，即halt指令
            RUNTIME.CallAsync(1, callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            // 返回到中断发生时的PC
            RUNTIME.CallAsync(PROCESS.PC, callback, PROCESS, RUNTIME);
        }
    });
}

// (File.readSync filePath:String) : String
function readSync(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }
    let data = fs.readFileSync(filePath, {encoding:"utf-8"}).toString();
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: data
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (File.writeString filePath:String strdata:String flag:String callback:(err->Boolean)) : undefined
function writeString(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

    let flagHandle = PROCESS.PopOperand();
    let flag = TrimQuotes(PROCESS.heap.Get(flagHandle).content) || "w";

    let strdataHandle = PROCESS.PopOperand();
    let strdata = TrimQuotes(PROCESS.heap.Get(strdataHandle).content);

    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }

    PROCESS.Step(); // 立刻退出，执行下一指令

    fs.writeFile(filePath, strdata, {encoding:"utf-8", flag: flag}, (error)=> {
        if(error) {
            PROCESS.OPSTACK.push("#f"); // TODO native函数的错误处理仍需细化
        }
        else {
            PROCESS.OPSTACK.push("#t");
        }

        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            PROCESS.PC = 0; // TODO 此处可优化 NOTE 使得回调函数栈帧的返回地址是地址为1的指令，即halt指令
            RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);
        }
    });
}

// (File.writeStringSync filePath:String strdata:String flag:String) : undefined
function writeStringSync(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let flagHandle = PROCESS.PopOperand();
    let flag = TrimQuotes(PROCESS.heap.Get(flagHandle).content) || "w";

    let strdataHandle = PROCESS.PopOperand();
    let strdata = TrimQuotes(PROCESS.heap.Get(strdataHandle).content);

    let filePathHandle = PROCESS.PopOperand();
    let filePath = TrimQuotes(PROCESS.heap.Get(filePathHandle).content);
    if(path.isAbsolute(filePath) === false) {
        filePath = path.join(RUNTIME.workingDir, filePath);
    }
    fs.writeFileSync(filePath, strdata, {encoding:"utf-8", flag: flag});
    PROCESS.Step();
}

module.exports.read = read;
module.exports.readSync = readSync;
module.exports.writeString = writeString;
module.exports.writeStringSync = writeStringSync;
`;
ANIMAC_VFS["/lib/HTTPS.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;




// nativelib/HTTPS.js
// HTTPS本地库






function Request(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(\`开始阻塞(file)\`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let urlHandle = PROCESS.PopOperand();
        let url = new URL(TrimQuotes(PROCESS.heap.Get(urlHandle).content));

        function callback() {
            console.log(\`HTTPS执行完毕\`);
            PROCESS.SetState("RUNNING");
            PROCESS.Step();
            // 唤醒
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }

        // 响应数据
        let responseData = '';

        // HTTPS异步请求
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            port: 443,
            method: 'GET',
        }, (res)=> {
            res.on('data', (data) => {
                responseData += data;
            });
            res.on('end', () => {
                // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
                let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
                let strObject = {
                    type: "STRING",
                    content: responseData
                };
                PROCESS.heap.Set(strHandle, strObject);
                PROCESS.OPSTACK.push(strHandle);

                callback();
            });
        });
        req.on('error', (e) => {
            // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: e.toString()
            };
            PROCESS.heap.Set(strHandle, strObject);
            PROCESS.OPSTACK.push(strHandle);

            callback();
            return;
        });
        req.end();
    }
}

module.exports.Request = Request;
`;
ANIMAC_VFS["/lib/LLM.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;



// 
// Nano Language Model - Inference Engine on Web Browser
//
//   BD4SUR 2024-10 2025-07
//
//   Forked from:
//     - https://github.com/karpathy/llama2.c
//     - https://github.com/epicure/llama2.js
// 

// ===============================================================================
// 全局状态和缓冲区
// ===============================================================================

const LLM_RUNNING_IN_PREFILLING = 11;
const LLM_RUNNING_IN_DECODING   = 12;
const LLM_STOPPED_WITH_ERROR    = -1;
const LLM_STOPPED_NORMALLY      = 20;
const LLM_STOPPED_IN_PREFILLING = 21;
const LLM_STOPPED_IN_DECODING   = 22;

let LLM = { config: {}, param: {} };
let TOKENIZER = { config: {}, trie: {} };
let LoRA = null;
let FWD_BUFFER;

let GENERATION_ARGS = {};
let SESSION = {};

let is_generating = false;


// ===============================================================================
// 读取并解析模型文件
// ===============================================================================

function load_model_from_base64(base64Data) {

    let file_buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)).buffer.slice(0);

    const SIZE_OF_DTYPE = 4;
    const header_length = 256;

    let offset = 0;

    ////////////////////////////////////////////////////
    // 读取文件头

    let header = new Int32Array(file_buffer.slice(0, header_length));

    let magic_number_0 = header[0];
    let magic_number_1 = header[1];

    if(magic_number_0 !== 0x42443453 || magic_number_1 !== 0x55524c4d) {
        console.error("Error: Corrupted or wrong model file!");
        return false;
    }

    let major_version = header[2];
    let minor_version = header[3];

    let model_type = header[4];
    let config_length = header[5]; // 暂不使用

    ////////////////////////////////////////////////////
    // 读取模型结构参数

    LLM.config = {
        block_size: 0,
        vocab_size: 0,
        n_layer: 0,
        n_embd: 0,
        n_head: 0,
        n_kv_head: 0,
        n_hidden: 0,
        is_shared_classifier: 0
    };

    let cfg_keys = Object.keys(LLM.config);
    header.slice(6, 6 + cfg_keys.length).forEach((v, i) => { LLM.config[cfg_keys[i]] = v; });

    offset += header_length;

    ////////////////////////////////////////////////////
    // 读取词表、构建词元编解码器

    let byte_count = 0;

    let stoi = {};
    let itos = [];
    let special_tokens = {};

    let tokenizer_field_bytes = new Uint32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE))[0];
    let vocab_size = new Uint32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE))[0];

    while(byte_count < tokenizer_field_bytes - 8) { // 不含tokenizer_field_bytes和vocab_size字段的8个字节
        let token_header = new Uint8Array(file_buffer.slice(offset, offset += 4));
        byte_count += 4;
        let token_id     = new Uint32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE))[0];
        byte_count += 4;

        let token_length = token_header[0];
        let is_special   = token_header[1] === 1; // 0-false 1-true
        let reserved_0   = token_header[2]; // 预留
        let reserved_1   = token_header[3]; // 预留

        let token = "";
        for(let i = 0; i < token_length; i++) {
            let unicode = new Uint32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE))[0];
            byte_count += 4;
            token += String.fromCodePoint(unicode);
        }

        stoi[token] = token_id;
        itos[token_id] = token;

        if(is_special) {
            special_tokens[token] = token_id;
        }
    }

    TOKENIZER.config = {
        vocab_size: vocab_size,
        stoi: stoi,
        itos: itos,
        special_tokens: special_tokens
    };

    TOKENIZER.trie = new TrieTree(TOKENIZER.config.itos);

    ////////////////////////////////////////////////////
    // 读取模型权重

    const cfg = LLM.config;
    const is_shared_weights = cfg.is_shared_classifier > 0 ? 1 : 0;
    const head_dim = ((cfg.n_embd / cfg.n_head)^0);

    LLM.param = {
        token_embedding: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.vocab_size * cfg.n_embd)),
        rms_norm_attn:   new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd)),
        wq:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_embd)),
        wk:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_kv_head * head_dim)),
        wv:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_kv_head * head_dim)),
        wo:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_embd)),
        rms_norm_ffn:    new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd)),
        w1:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_hidden)),
        w2:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_hidden)),
        w3:              new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_layer * cfg.n_embd * cfg.n_hidden)),
        rms_norm_final:  new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.n_embd)),
        token_classifier: null,
        freq_cis_real:   new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.block_size * head_dim / 2)),
        freq_cis_imag:   new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * cfg.block_size * head_dim / 2)),
    };

    LLM.param.token_classifier = is_shared_weights ? LLM.param.token_embedding : offset;


    ////////////////////////////////////////////////////
    // 构建前向传播数值的缓冲区

    let kv_dim = (cfg.n_embd * cfg.n_kv_head) / cfg.n_head;

    FWD_BUFFER = {
        x:       new Float32Array(cfg.n_embd),   // activation at current time stamp (dim,)
        xb:      new Float32Array(cfg.n_embd),   // same, but inside a residual branch (dim,)
        xb2:     new Float32Array(cfg.n_embd),   // an additional buffer just for convenience (dim,)
        hb:      new Float32Array(cfg.n_hidden), // buffer for hidden dimension in the ffn (hidden_dim,)
        hb2:     new Float32Array(cfg.n_hidden), // buffer for hidden dimension in the ffn (hidden_dim,)
        q:       new Float32Array(cfg.n_embd),   // query (dim,)
    //  k:       new Float32Array(kv_dim),       // key (kv_dim,)
    //  v:       new Float32Array(kv_dim),       // value (kv_dim,)
        k_cache: new Float32Array(cfg.n_layer * cfg.block_size * kv_dim),   // key cache (layer, block_size, kv_dim)
        v_cache: new Float32Array(cfg.n_layer * cfg.block_size * kv_dim),   // value cache (layer, block_size, kv_dim)
        att:     new Float32Array(cfg.n_head * cfg.block_size), // buffer for scores/attention values (n_heads, block_size)
        logits:  new Float32Array(cfg.vocab_size), // output logits
    };

    return true;
}




function load_lora(file_buffer) {

    const SIZE_OF_DTYPE = 4;
    const header_length = 256;

    let offset = 0;

    ////////////////////////////////////////////////////
    // 读取文件头

    let header = new Int32Array(file_buffer.slice(0, header_length));

    let magic_number_0 = header[0];
    let magic_number_1 = header[1];

    if(magic_number_0 !== 0x42443453 || magic_number_1 !== 0x55524c4d) {
        console.error("Error: Corrupted or wrong model file!");
        return false;
    }

    let major_version = header[2];
    let minor_version = header[3];

    let model_type = header[4];
    let config_length = header[5]; // 暂不使用

    if(model_type !== 10) {
        console.error("Error: Not a LoRA module!");
        return false;
    }

    ////////////////////////////////////////////////////
    // 读取LoRA超参数

    LoRA = { config: {}, param: {} };

    LoRA.config = {
        lora_rank: 0,
        lora_alpha: 0,
        n_layer: 0,     // 用于校验
        n_embd: 0,      // 用于校验
        n_head: 0,      // 用于校验
        n_kv_head: 0,   // 用于校验
        n_hidden: 0,    // 用于校验
        lora_config: 0  // 预留：用于控制LoRA用到哪些层
    };

    let cfg_keys = Object.keys(LoRA.config);
    header.slice(6, 6 + cfg_keys.length).forEach((v, i) => { LoRA.config[cfg_keys[i]] = v; });

    offset += header_length;

    ////////////////////////////////////////////////////
    // 读取LoRA模型参数

    const llm_cfg  = LLM.config;
    const lora_cfg = LoRA.config;
    const head_dim = ((llm_cfg.n_embd / llm_cfg.n_head)^0);
    const kv_dim = head_dim * llm_cfg.n_kv_head;

    // 校验LoRA模块与基座模型是否匹配
    if (llm_cfg.n_layer !== lora_cfg.n_layer ||
        llm_cfg.n_embd !== lora_cfg.n_embd ||
        llm_cfg.n_head !== lora_cfg.n_head ||
        llm_cfg.n_kv_head !== lora_cfg.n_kv_head ||
        llm_cfg.n_hidden !== lora_cfg.n_hidden) {
        console.error("Error: LoRA module does not fit the base model.");
        return false;
    }

    // offset += 8; // param_count字段占用8个字节，仅用于C实现的推理引擎，这里不读取，直接跳过

    LoRA.param = {
        wq_lora_a: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * lora_cfg.lora_rank * llm_cfg.n_embd)),
        wq_lora_b: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * llm_cfg.n_embd * lora_cfg.lora_rank)),
        wk_lora_a: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * lora_cfg.lora_rank * llm_cfg.n_embd)),
        wk_lora_b: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * kv_dim * lora_cfg.lora_rank)),
        wv_lora_a: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * lora_cfg.lora_rank * llm_cfg.n_embd)),
        wv_lora_b: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * kv_dim * lora_cfg.lora_rank)),
        wo_lora_a: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * lora_cfg.lora_rank * llm_cfg.n_embd)),
        wo_lora_b: new Float32Array(file_buffer.slice(offset, offset += SIZE_OF_DTYPE * llm_cfg.n_layer * llm_cfg.n_embd * lora_cfg.lora_rank)),
    };

    ////////////////////////////////////////////////////
    // 初始化LoRA数值缓冲区

    FWD_BUFFER.q0 = new Float32Array(lora_cfg.lora_rank);   // query  LoRA branch (lora_cfg.lora_rank,)
    FWD_BUFFER.k0 = new Float32Array(lora_cfg.lora_rank);   // key    LoRA branch (lora_cfg.lora_rank,)
    FWD_BUFFER.v0 = new Float32Array(lora_cfg.lora_rank);   // value  LoRA branch (lora_cfg.lora_rank,)
    FWD_BUFFER.o0 = new Float32Array(lora_cfg.lora_rank);   // output LoRA branch (lora_cfg.lora_rank,)
    FWD_BUFFER.q1 = new Float32Array(llm_cfg.n_embd);       // query  LoRA branch (dim,)
    FWD_BUFFER.k1 = new Float32Array(kv_dim);               // key    LoRA branch (kv_dim,)
    FWD_BUFFER.v1 = new Float32Array(kv_dim);               // value  LoRA branch (kv_dim,)
    FWD_BUFFER.o1 = new Float32Array(llm_cfg.n_embd);       // output LoRA branch (kv_dim,)

    return true;
}


function unload_lora() {
    LoRA = null;
}


// ===============================================================================
// 基础算子
//   所有算子都是C风格的：函数本身不返回值，通过参数引用的buffer来传递计算结果。
// ===============================================================================

function accum(a, b, size) {
    for (let i = 0; i < size; i++) {
        a[i] += b[i];
    }
}

function scale(a, k, size) {
    for (let i = 0; i < size; i++) {
        a[i] *= k;
    }
}

function rms_norm(o, x, weight, size) {
    // calculate sum of squares
    let ss = 0.0;
    for (let j = 0; j < size; j++) {
        ss += x[j] * x[j];
    }
    ss /= size;
    ss += 1e-5;
    ss = 1.0 / Math.sqrt(ss);
    // normalize and scale
    for (let j = 0; j < size; j++) {
        o[j] = weight[j] * (ss * x[j]);
    }
}

function softmax(x, size) {
    // find max value (for numerical stability)
    let max_val = x[0];
    for (let i = 1; i < size; i++) {
        if (x[i] > max_val) {
            max_val = x[i];
        }
    }
    // exp and sum
    let sum = 0.0;
    for (let i = 0; i < size; i++) {
        x[i] = Math.exp(x[i] - max_val);
        sum += x[i];
    }
    // normalize
    for (let i = 0; i < size; i++) {
        x[i] /= sum;
    }
}

// 矩阵乘：绝大多数的计算量都花费在这个算子上面
function _matmul(xout, x, w, n, d) {
    // W (d,n) @ x (n,) -> xout (d,)
    for (let i = 0; i < d; i++) {
        let val = 0.0;
        for (let j = 0; j < n; j++) {
            val += w[i * n + j] * x[j];
        }
        xout[i] = val;
    }
}


// ===============================================================================
// 核心函数：语言模型前向传播
//   Args:
//     token - I   词元编码（在token_embedding中的列号，或者说词表中的编号）。
//                 NOTE 为什么只输入1个词元？因为过往输入的词元已经被保存在KV-Cache中了。
//     pos   - I   当前词元的位置，从0开始。
//     llm   - I   语言模型对象，包括模型结构参数和权重等。
//     lora  - I   LoRA模块对象。如果为null，则不使用LoRA。
//     buf   - IO  数据缓冲区，通过此缓冲区，张量在各层之间传播。
//   Return:
//     最后一层输出的logits。
// ===============================================================================

function llm_forward(token, pos, llm, lora, buf) {

    let cfg = llm.config;
    let w = llm.param;
    let s = buf;

    // 使用LoRA？
    let use_lora = (lora !== null);
    let a = null;
    let lora_rank = null;
    let lora_alpha = null;
    if(use_lora) {
        a = lora.param;
        lora_rank = lora.config.lora_rank;
        lora_alpha = lora.config.lora_alpha;
    }

    let x = s.x;
    const dim = cfg.n_embd; // Q的维度（每个注意力头的维度*h）
    const kv_dim = dim * (cfg.n_kv_head / cfg.n_head); // KV的维度=每个注意力头的维度*m
    const kv_mul = cfg.n_head / cfg.n_kv_head;
    const hidden_dim = cfg.n_hidden;
    const head_dim = dim / cfg.n_head; // 每个注意力头的维度，对于QKV都是相同的

    // copy the token embedding into x
    x.set(w.token_embedding.subarray(token * dim, (token + 1) * dim));
    
    // pluck out the "pos" row of freq_cis_real and freq_cis_imag
    const freq_cis_real_row = w.freq_cis_real.subarray(pos * head_dim / 2, (pos + 1) * head_dim / 2);
    const freq_cis_imag_row = w.freq_cis_imag.subarray(pos * head_dim / 2, (pos + 1) * head_dim / 2);

    // forward all the layers
    for(let l = 0; l < cfg.n_layer; l++) {
        // attention rmsnorm
        rms_norm(s.xb, x, w.rms_norm_attn.subarray(l * dim, (l + 1) * dim), dim);

        // save key,value at this time step (pos) to our kv cache
        const loff = l * cfg.block_size * kv_dim; // kv cache layer offset for convenience
        s.k = s.k_cache.subarray(loff + pos * kv_dim, loff + (pos + 1) * kv_dim);
        s.v = s.v_cache.subarray(loff + pos * kv_dim, loff + (pos + 1) * kv_dim);

        // qkv matmuls for this position
        _matmul(s.q, s.xb, w.wq.subarray(l * dim * dim,    (l + 1) * dim * dim),    dim, dim);
        _matmul(s.k, s.xb, w.wk.subarray(l * dim * kv_dim, (l + 1) * dim * kv_dim), dim, kv_dim);
        _matmul(s.v, s.xb, w.wv.subarray(l * dim * kv_dim, (l + 1) * dim * kv_dim), dim, kv_dim);

        // 计算QKV的低秩分解分支，并将其累加到原来的输出上
        if(use_lora) {
            _matmul(s.q0, s.xb, a.wq_lora_a.subarray(l * lora_rank * dim, (l + 1) * lora_rank * dim), dim, lora_rank);
            _matmul(s.k0, s.xb, a.wk_lora_a.subarray(l * lora_rank * dim, (l + 1) * lora_rank * dim), dim, lora_rank);
            _matmul(s.v0, s.xb, a.wv_lora_a.subarray(l * lora_rank * dim, (l + 1) * lora_rank * dim), dim, lora_rank);

            _matmul(s.q1, s.q0, a.wq_lora_b.subarray(l * dim    * lora_rank, (l + 1) * dim    * lora_rank), lora_rank, dim);
            _matmul(s.k1, s.k0, a.wk_lora_b.subarray(l * kv_dim * lora_rank, (l + 1) * kv_dim * lora_rank), lora_rank, kv_dim);
            _matmul(s.v1, s.v0, a.wv_lora_b.subarray(l * kv_dim * lora_rank, (l + 1) * kv_dim * lora_rank), lora_rank, kv_dim);

            scale(s.q1, (lora_alpha / lora_rank), dim);
            scale(s.k1, (lora_alpha / lora_rank), kv_dim);
            scale(s.v1, (lora_alpha / lora_rank), kv_dim);

            accum(s.q, s.q1, dim);
            accum(s.k, s.k1, kv_dim);
            accum(s.v, s.v1, kv_dim);
        }

        // RoPE旋转位置编码实现方式1：使用模型提供的旋转系数
        for (let h = 0; h < cfg.n_head; h++) {
            const q = s.q.subarray(h * head_dim, (h + 1) * head_dim);
            for (let i = 0; i < head_dim; i += 2) {
                const q0 = q[i];
                const q1 = q[i + 1];
                const fcr = freq_cis_real_row[i / 2];
                const fci = freq_cis_imag_row[i / 2];
                q[i] = q0 * fcr - q1 * fci;
                q[i + 1] = q0 * fci + q1 * fcr;
            }
        }
        for (let m = 0; m < cfg.n_kv_head; m++) {
            const k = s.k.subarray(m * head_dim, (m + 1) * head_dim);
            for (let i = 0; i < head_dim; i += 2) {
                const k0 = k[i];
                const k1 = k[i + 1];
                const fcr = freq_cis_real_row[i / 2];
                const fci = freq_cis_imag_row[i / 2];
                k[i] = k0 * fcr - k1 * fci;
                k[i + 1] = k0 * fci + k1 * fcr;
            }
        }

        /*
        // RoPE旋转位置编码实现方式2：直接计算旋转系数
        for (let i = 0; i < dim; i += 2) {
            let ih = i % head_dim;
            let freq = 1.0 / Math.pow(10000.0, ih / head_dim);
            let val = pos * freq;
            let fcr = Math.cos(val);
            let fci = Math.sin(val);

            if(i < kv_dim) {
                let kr = s.k[i];
                let ki = s.k[i+1];
                s.k[i]   = kr * fcr - ki * fci;
                s.k[i+1] = kr * fci + ki * fcr;
            }
            let qr = s.q[i];
            let qi = s.q[i+1];
            s.q[i]   = qr * fcr - qi * fci;
            s.q[i+1] = qr * fci + qi * fcr;
        }
        */

        // 分组查询多头注意力（GQA-MHA），遍历所有的Q注意力头
        for (let h = 0; h < cfg.n_head; h++) {
            // KV分组注意力头的序号
            let m = ((h / kv_mul)^0);
            // get the query vector for this head
            const qh = s.q.subarray(h * head_dim, (h + 1) * head_dim);
            // attention scores for this head
            const att = s.att.subarray(h * cfg.block_size, (h + 1) * cfg.block_size);
            // 计算因果自注意力，包括当前时间步 iterate over all timesteps, including the current one
            for (let t = 0; t <= pos; t++) {
                // get the key vector for this head and at this timestep
                const kh = s.k_cache.subarray(loff + t * kv_dim + m * head_dim, loff + (t + 1) * kv_dim + m * head_dim);
                // calculate the attention score as the dot product of q and k
                let score = 0.0;
                for (let i = 0; i < head_dim; i++) {
                    score += qh[i] * kh[i];
                }
                score /= Math.sqrt(head_dim);
                // save the score to the attention buffer
                att[t] = score;
            }

            // softmax the scores to get attention weights, from 0..pos inclusively
            softmax(att, pos + 1);

            // weighted sum of the values, store back into xb
            for (let i = 0; i < head_dim; i++) {
                let val = 0.0;
                for (let t = 0; t <= pos; t++) {
                    const vh = s.v_cache.subarray(loff + t * kv_dim + m * head_dim, loff + (t + 1) * kv_dim + m * head_dim);
                    val += att[t] * vh[i]; // NOTE bad locality
                    // val += att[t] * s.v_cache[loff + t * kv_dim + m * head_dim + i]; // NOTE bad locality
                }
                s.xb[h * head_dim + i] = val;
            }
        }

        // final matmul to get the output of the attention
        _matmul(s.xb2, s.xb, w.wo.subarray(l * dim * dim, (l + 1) * dim * dim), dim, dim);

        // 计算output的低秩分解分支，并将其累加到原来的输出上
        if(use_lora) {
            _matmul(s.o0, s.xb, a.wo_lora_a.subarray(l * lora_rank * dim, (l + 1) * lora_rank * dim), dim, lora_rank);
            _matmul(s.o1, s.o0, a.wo_lora_b.subarray(l * dim    * lora_rank, (l + 1) * dim    * lora_rank), lora_rank, dim);
            scale(s.o1, (lora_alpha / lora_rank), dim);
            accum(s.xb2, s.o1, dim);
        }

        // residual connection back into x
        accum(x, s.xb2, dim);

        // ffn rmsnorm
        rms_norm(s.xb, x, w.rms_norm_ffn.subarray(l * dim, (l + 1) * dim), dim);

        // Now for FFN in PyTorch we have: self.w2(F.silu(self.w1(x)) * self.w3(x))
        _matmul(s.hb, s.xb, w.w1.subarray(l * dim * hidden_dim, (l + 1) * dim * hidden_dim), dim, hidden_dim);
        _matmul(s.hb2, s.xb, w.w3.subarray(l * dim * hidden_dim, (l + 1) * dim * hidden_dim), dim, hidden_dim);

        // SwiGLU non-linearity
        for (let i = 0; i < hidden_dim; i++) {
            let val = s.hb[i];
            // silu(x)=x*σ(x), where σ(x) is the logistic sigmoid
            val *= (1.0 / (1.0 + Math.exp(-val)));
            // elementwise multiply with w3(x)
            val *= s.hb2[i];
            s.hb[i] = val;
        }

        // final matmul to get the output of the ffn
        _matmul(s.xb, s.hb, w.w2.subarray(l * dim * hidden_dim, (l + 1) * dim * hidden_dim), hidden_dim, dim);

        // residual connection
        accum(x, s.xb, dim);
    }

    // final rmsnorm
    rms_norm(x, x, w.rms_norm_final, dim);

    // classifier into logits
    _matmul(s.logits, x, w.token_classifier, cfg.n_embd, cfg.vocab_size);

    return s.logits;
}

// ===============================================================================
// 词元编解码、分词器（基于Trie树）
// ===============================================================================

function TrieTree(vocab) {
    this.root = {};
    this.max_token_length = 0;
    this.END_CHAR = "__end__";
    for(let i = 0; i < vocab.length; i++) {
        let word = vocab[i];
        if(word.length > this.max_token_length) {
            this.max_token_length = word.length;
        }
        let current_dict = this.root;
        for(let j = 0; j < word.length; j++) {
            c = word[j];
            if(c in current_dict) {
                current_dict = current_dict[c];
            }
            else {
                current_dict[c] = {};
                current_dict = current_dict[c];
            }
        }
        current_dict[this.END_CHAR] = this.END_CHAR;
    }
}

TrieTree.prototype.match = function(token) {
    let current_dict = this.root;
    for(let j = 0; j < token.length; j++) {
        c = token[j];
        if(c in current_dict !== true) {
            return false;
        }
        current_dict = current_dict[c];
    }
    return (this.END_CHAR in current_dict);
};

TrieTree.prototype.tokenize = function(text) {
    let tokens = [];
    while(text.length > 0) {
        for(let n = this.max_token_length; n > 0; n--) {
            let prefix = text.slice(0, n);
            if(n === 1 || this.match(prefix) === true) {
                tokens.push(prefix);
                text = text.slice(n);
                break;
            }
        }
    }
    return tokens;
};

// 字符串 → 词元编码序列
function encode_string_to_ids(text) {
    let tlist = TOKENIZER.trie.tokenize(text);
    let idlist = [];
    let vocab = TOKENIZER.config.stoi;
    for(let i = 0; i < tlist.length; i++) {
        c = tlist[i];
        if(c in vocab) {
            idlist.push(vocab[c]);
        }
        else {
            idlist.push(1); // <|unknown|>
        }
    }
    return idlist;
}

// 词元编码序列 → 字符串
function decode_ids_to_string(idlist) {
    let tlist = [];
    for(let i = 0; i < idlist.length; i++) {
        id = idlist[i];
        tlist.push(TOKENIZER.config.itos[id]);
    }
    return tlist.join("");
}


// ===============================================================================
// 采样策略
// ===============================================================================

// 贪心采样：返回概率最大的下标
function sample_argmax(logits, vsize) {
    let max_i = 0;
    let max_p = logits[0];
    for (let i = 1; i < vsize; i++) {
        if (logits[i] > max_p) {
            max_i = i;
            max_p = logits[i];
        }
    }
    return max_i;
}

// 概率采样（香草味的）
function sample_multinomial(prob_dist, n) {
    // sample index from prob_dist, they must sum to 1
    const r = Math.random();
    // const r = 0.5; // TODO
    let cdf = 0.0;
    for (let i = 0; i < n; i++) {
        cdf += prob_dist[i];
        if(cdf > r) {
            return i;
        }
    }
    return n - 1; // in case of rounding errors
}

// 概率采样之改进：Top-K采样，只在概率排名前K个词元中采样
function sample_top_k(prob_dist, vsize, k) {
    let probindex = [];
    for (let i = 0; i < vsize; i++) {
        probindex.push({index: i, prob: prob_dist[i]});
    }
    probindex.sort((a, b) => b.prob - a.prob);
    let top_tokens = probindex.slice(0, k);
    // 计算累积概率，用于归一化概率
    let cumulative_prob = 0.0;
    for (let i = 0; i < top_tokens.length; i++) {
        cumulative_prob += top_tokens[i].prob;
    }
    // 在只有前K个词元的列表上执行概率采样
    const r = Math.random() * cumulative_prob;
    let cdf = 0.0;
    for (let i = 0; i < top_tokens.length; i++) {
        cdf += probindex[i].prob;
        if(cdf > r) {
            return probindex[i].index;
        }
    }
    return vsize - 1; // in case of rounding errors
}

// Top-P采样（核采样）：只在累积概率达到p的概率最高的若干个词元中采样
function sample_top_p(probabilities, n, top_p) {
    const cutoff = (1.0 - top_p) / (n - 1);
    let n0 = 0;
    let probindex = [];
    for (let i = 0; i < n; i++) {
        if (probabilities[i] >= cutoff) {
            probindex.push({index: i, prob: probabilities[i]});
            n0++;
        }
    }
    probindex.sort((a, b) => b.prob - a.prob);

    // truncate the list where cumulative probability exceeds top_p
    let cumulative_prob = 0.0;
    let last_idx = n0 - 1; // in case of rounding errors consider all elements
    for (let i = 0; i < n0; i++) {
        cumulative_prob += probindex[i].prob;
        if (cumulative_prob > top_p) {
            last_idx = i;
            break; // we've exceeded top_p by including last_idx
        }
    }

    // sample from the truncated list
    const r = Math.random() * cumulative_prob;
    let cdf = 0.0;
    for (let i = 0; i <= last_idx; i++) {
        cdf += probindex[i].prob;
        if(cdf > r) {
            return probindex[i].index;
        }
    }
    return probindex[last_idx].index; // in case of rounding errors
}


// ===============================================================================
// 会话相关API，依赖于全局状态
// ===============================================================================

function llm_context_init(model_file_base64, lora_file_base64) {
    load_model_from_base64(model_file_base64);
}

function llm_session_init(prompt, max_seq_len, repetition_penalty, temperature, top_p, top_k) {

    GENERATION_ARGS = {
        top_p: top_p,
        top_k: top_k,
        temperature: temperature,
        repetition_penalty: repetition_penalty,
        max_seq_len: max_seq_len
    };

    if (GENERATION_ARGS.max_seq_len <= 0 || GENERATION_ARGS.max_seq_len > LLM.config.block_size) {
        GENERATION_ARGS.max_seq_len = LLM.config.block_size;
    }

    let prompt_tokens = encode_string_to_ids(prompt);

    SESSION = {
        prompt: prompt,
        num_prompt_tokens: prompt_tokens.length,
        max_seq_len: GENERATION_ARGS.max_seq_len,
        output_ids: prompt_tokens,
        output_count: 0,
        output_text: "",
        next_token: prompt_tokens[0] || 0,
        pos: 0,
        is_prefilling: false,
        t_0: 0,
        t_1: 0,
        tps: 0,
    };
}

function generate_next_token(output_ids, pos, is_prefilling) {

    let next_token = output_ids[pos];

    llm_forward(next_token, pos, LLM, LoRA, FWD_BUFFER);

    // Pre-fill: if we are still processing the input prompt, force the next prompt token
    if (is_prefilling) {
        next_token = output_ids[pos + 1];
        return next_token;
    }
    // Auto-regressive Decode
    else {
        // 复读惩罚：对过往出现过的词元施加惩罚，词元出现得越多，概率越低: ref arxiv:1909.05858
        let tokenset = new Set(output_ids);
        for(tk of tokenset.keys()) {
            FWD_BUFFER.logits[tk] /= GENERATION_ARGS.repetition_penalty;
        }

        // 温度采样：当温度设为0时，退化为贪心采样
        if(GENERATION_ARGS.temperature == 0.0) {
            // greedy argmax sampling
            next_token = sample_argmax(FWD_BUFFER.logits, LLM.config.vocab_size);
        }
        else {
            for (let q = 0; q < LLM.config.vocab_size; q++) {
                FWD_BUFFER.logits[q] /= GENERATION_ARGS.temperature;
            }

            softmax(FWD_BUFFER.logits, LLM.config.vocab_size);

            if(GENERATION_ARGS.top_p > 0 && GENERATION_ARGS.top_p < 1) {
                next_token = sample_top_p(FWD_BUFFER.logits, LLM.config.vocab_size, GENERATION_ARGS.top_p);
            }
            else if(GENERATION_ARGS.top_k > 0) {
                next_token = sample_top_k(FWD_BUFFER.logits, LLM.config.vocab_size, GENERATION_ARGS.top_k);
            }
            else {
                next_token = sample_multinomial(FWD_BUFFER.logits, LLM.config.vocab_size);
            }
        }
    }
    return next_token;
}

function llm_session_step() {
    if (SESSION.pos < SESSION.max_seq_len) {
        if (SESSION.t_0 === 0) { SESSION.t_0 = new Date().getTime(); }

        SESSION.is_prefilling = (SESSION.pos < SESSION.num_prompt_tokens - 1) ? true : false;

        SESSION.next_token = generate_next_token(SESSION.output_ids, SESSION.pos, SESSION.is_prefilling);

        if (SESSION.is_prefilling === false) {
            SESSION.output_ids.push(SESSION.next_token);
            SESSION.output_text = decode_ids_to_string(SESSION.output_ids);
        }

        SESSION.pos++;

        if (SESSION.next_token === 0 || SESSION.next_token === 3) {
            return LLM_STOPPED_NORMALLY;
        }
        else {
            return (SESSION.is_prefilling) ? LLM_RUNNING_IN_PREFILLING : LLM_RUNNING_IN_DECODING;
        }
    }
    else {
        return LLM_STOPPED_WITH_ERROR;
    }
}


////////////////////////////////////////////////////////////////////////////
//
//  以下是 Animac 的宿主本地接口
//
////////////////////////////////////////////////////////////////////////////




// (LLM.init modelFileBase64:string) : void
function init(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let modelFileBase64Handle = PROCESS.PopOperand();
    let modelFileBase64 = TrimQuotes(PROCESS.heap.Get(modelFileBase64Handle).content);
    llm_context_init(modelFileBase64, null);
    PROCESS.Step();
}

// (LLM.new_session   prompt:String   max_seq_len:String   repetition_penalty:number   temperature:number   top_p:number   top_k:number) : string
function new_session(PROCESS, RUNTIME) {
    let top_k = Number(PROCESS.PopOperand());
    let top_p = Number(PROCESS.PopOperand());
    let temperature = Number(PROCESS.PopOperand());
    let repetition_penalty = Number(PROCESS.PopOperand());
    let max_seq_len = Number(PROCESS.PopOperand());

    let promptHandle = PROCESS.PopOperand();
    let prompt = TrimQuotes(PROCESS.heap.Get(promptHandle).content);

    llm_session_init(prompt, max_seq_len, repetition_penalty, temperature, top_p, top_k);

    PROCESS.Step();
}

function step(PROCESS, RUNTIME) {

    let status = llm_session_step();

    SESSION.tps = (SESSION.pos - 1) / (new Date().getTime() - SESSION.t_0) * 1000;

    let statusStr = "";
    if (status === LLM_RUNNING_IN_PREFILLING) {
        statusStr = "pre-filling";
    }
    else if (status === LLM_RUNNING_IN_DECODING) {
        statusStr = "decoding";
    }
    else if (status === LLM_STOPPED_NORMALLY || status === LLM_STOPPED_WITH_ERROR) {
        statusStr = "finished";
    }
    // 构造字符串对象
    let statusStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let statusStrObject = {
        type: "STRING",
        content: String(statusStr)
    };
    PROCESS.heap.Set(statusStrHandle, statusStrObject);

    // 构造字符串对象
    let outputStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let outputStrObject = {
        type: "STRING",
        content: String(SESSION.output_text)
    };
    PROCESS.heap.Set(outputStrHandle, outputStrObject);

    // 构造列表对象
    let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let newList = {
        type: "QUOTE",
        parent: null,
        children: [statusStrHandle, outputStrHandle, SESSION.tps],
    }
    PROCESS.heap.Set(newListHandle, newList);
    PROCESS.OPSTACK.push(newListHandle);

    PROCESS.Step(); // 退出，执行下一指令
}

// 返回语言模型的结构参数
//   返回值是一个S列表的把柄，S列表各项分别为
//  '(block_size, vocab_size, n_layer, n_embd, n_head, n_kv_head, head_dim, n_hidden, is_shared_classifier)
function get_config(PROCESS, RUNTIME) {
    // 构造列表对象
    let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let newList = {
        type: "QUOTE",
        parent: null,
        children: [
            LLM.config.block_size,
            LLM.config.vocab_size,
            LLM.config.n_layer,
            LLM.config.n_embd,
            LLM.config.n_head,
            LLM.config.n_kv_head,
            LLM.config.n_embd / LLM.config.n_head,
            LLM.config.n_hidden,
            LLM.config.is_shared_classifier
        ],
    }
    PROCESS.heap.Set(newListHandle, newList);
    PROCESS.OPSTACK.push(newListHandle);

    PROCESS.Step(); // 退出，执行下一指令
}


// 返回语言模型的参数
//   返回值是一个嵌套S列表的把柄，S列表各项分别为
//    0                1              2   3   4   5   6             7   8   9   10              11                12             13
//  '(token_embedding, rms_norm_attn, wq, wk, wv, wo, rms_norm_ffn, w1, w2, w3, rms_norm_final, token_classifier, freq_cis_real, freq_cis_imag)
function get_param(PROCESS, RUNTIME) {

    // token_embedding
    let token_embedding_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let token_embedding_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.token_embedding),
    }
    PROCESS.heap.Set(token_embedding_handle, token_embedding_obj);

    // rms_norm_attn
    let rms_norm_attn_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let rms_norm_attn_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.rms_norm_attn),
    }
    PROCESS.heap.Set(rms_norm_attn_handle, rms_norm_attn_obj);

    // wq
    let wq_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let wq_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.wq),
    }
    PROCESS.heap.Set(wq_handle, wq_obj);

    // wk
    let wk_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let wk_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.wk),
    }
    PROCESS.heap.Set(wk_handle, wk_obj);

    // wv
    let wv_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let wv_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.wv),
    }
    PROCESS.heap.Set(wv_handle, wv_obj);

    // wo
    let wo_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let wo_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.wo),
    }
    PROCESS.heap.Set(wo_handle, wo_obj);

    // rms_norm_ffn
    let rms_norm_ffn_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let rms_norm_ffn_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.rms_norm_ffn),
    }
    PROCESS.heap.Set(rms_norm_ffn_handle, rms_norm_ffn_obj);

    // w1
    let w1_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let w1_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.w1),
    }
    PROCESS.heap.Set(w1_handle, w1_obj);

    // w2
    let w2_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let w2_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.w2),
    }
    PROCESS.heap.Set(w2_handle, w2_obj);

    // w3
    let w3_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let w3_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.w3),
    }
    PROCESS.heap.Set(w3_handle, w3_obj);

    // rms_norm_final
    let rms_norm_final_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let rms_norm_final_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.rms_norm_final),
    }
    PROCESS.heap.Set(rms_norm_final_handle, rms_norm_final_obj);

    // freq_cis_real
    let freq_cis_real_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let freq_cis_real_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.freq_cis_real),
    }
    PROCESS.heap.Set(freq_cis_real_handle, freq_cis_real_obj);

    // freq_cis_imag
    let freq_cis_imag_handle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let freq_cis_imag_obj = {
        type: "QUOTE",
        parent: null,
        children: Array.from(LLM.param.freq_cis_imag),
    }
    PROCESS.heap.Set(freq_cis_imag_handle, freq_cis_imag_obj);
    
    // 构造列表对象
    let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let newList = {
        type: "QUOTE",
        parent: null,
        children: [
            token_embedding_handle,
            rms_norm_attn_handle,
            wq_handle,
            wk_handle,
            wv_handle,
            wo_handle,
            rms_norm_ffn_handle,
            w1_handle,
            w2_handle,
            w3_handle,
            rms_norm_final_handle,
            token_embedding_handle, // token_classifier === token_embedding
            freq_cis_real_handle,
            freq_cis_imag_handle
        ],
    }
    PROCESS.heap.Set(newListHandle, newList);
    PROCESS.OPSTACK.push(newListHandle);

    PROCESS.Step(); // 退出，执行下一指令
}

function encode(PROCESS, RUNTIME) {
    let promptHandle = PROCESS.PopOperand();
    let prompt = TrimQuotes(PROCESS.heap.Get(promptHandle).content);
    let ids = encode_string_to_ids(prompt);

    // 构造列表对象
    let idListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
    let idListObj = {
        type: "QUOTE",
        parent: null,
        children: ids,
    }
    PROCESS.heap.Set(idListHandle, idListObj);
    PROCESS.OPSTACK.push(idListHandle);

    PROCESS.Step(); // 退出，执行下一指令
}

function decode(PROCESS, RUNTIME) {
    let token_id = PROCESS.PopOperand();
    let tk = decode_ids_to_string([token_id]);

    // 构造字符串对象
    let tokenStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let tokenStrObject = {
        type: "STRING",
        content: String(tk)
    };
    PROCESS.heap.Set(tokenStrHandle, tokenStrObject);
    PROCESS.OPSTACK.push(tokenStrHandle);

    PROCESS.Step();
}

// (LLM.matmul xout x w xout_offset w_offset n d)
function matmul(PROCESS, RUNTIME) {
    let d = Number(PROCESS.PopOperand());
    let n = Number(PROCESS.PopOperand());
    let w_offset = Number(PROCESS.PopOperand());
    let xout_offset = Number(PROCESS.PopOperand());
    let w_handle = PROCESS.PopOperand();
    let x_handle = PROCESS.PopOperand();
    let xout_handle = PROCESS.PopOperand();

    let xout = PROCESS.heap.Get(xout_handle);
    let x = PROCESS.heap.Get(x_handle);
    let w = PROCESS.heap.Get(w_handle);

    for (let i = 0; i < d; i++) {
        let val = 0;
        for (let j = 0; j < n; j++) {
            val += w.children[w_offset + i * n + j] * x.children[j];
        }
        xout.children[xout_offset + i] = val;
    }

    PROCESS.Step();
}

module.exports.init = init;
module.exports.new_session = new_session;
module.exports.step = step;

module.exports.get_config = get_config;
module.exports.get_param = get_param;

module.exports.encode = encode;
module.exports.decode = decode;

module.exports.matmul = matmul;

`;
ANIMAC_VFS["/lib/Math.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;




// (Math.PI) : Number
function PI(PROCESS, RUNTIME) {
    PROCESS.OPSTACK.push(Number(Math.PI));
    PROCESS.Step();
}

// (Math.pow base:Number exponent:Number) : Number
function pow(PROCESS, RUNTIME) {
    let exponent = PROCESS.PopOperand();
    let base = PROCESS.PopOperand();
    let res = Math.pow(Number(base), Number(exponent));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.sqrt x:Number) : Number
function sqrt(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.sqrt(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.exp x:Number) : Number
function exp(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.exp(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log x:Number) : Number
function log(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log10 x:Number) : Number
function log10(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log10(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.log2 x:Number) : Number
function log2(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.log2(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.sin x:Number) : Number
function sin(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.sin(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.cos x:Number) : Number
function cos(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.cos(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.tan x:Number) : Number
function tan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.tan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.atan x:Number) : Number
function atan(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.atan(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.floor x:Number) : Number
function floor(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.floor(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.ceil x:Number) : Number
function ceil(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.ceil(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.round x:Number) : Number
function round(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.round(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.to_fixed x:Number n:Number) : Number
function to_fixed(PROCESS, RUNTIME) {
    let n = PROCESS.PopOperand();
    let x = PROCESS.PopOperand();
    let res = Number(x).toFixed(Number(n));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.abs x:Number) : Number
function abs(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    let res = Math.abs(Number(x));
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

// (Math.random) : Number
function random(PROCESS, RUNTIME) {
    let res = Math.random();
    PROCESS.OPSTACK.push(res);
    PROCESS.Step();
}

module.exports.PI = PI;
module.exports.pow = pow;
module.exports.sqrt = sqrt;
module.exports.exp = exp;
module.exports.log = log;
module.exports.log10 = log10;
module.exports.log2 = log2;
module.exports.sin = sin;
module.exports.cos = cos;
module.exports.tan = tan;
module.exports.atan = atan;
module.exports.floor = floor;
module.exports.ceil = ceil;
module.exports.round = round;
module.exports.to_fixed = to_fixed;
module.exports.abs = abs;
module.exports.random = random;
`;
ANIMAC_VFS["/lib/String.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;






// (String.length str:String) : Number
function length(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    PROCESS.OPSTACK.push(Number(str.length));
    PROCESS.Step();
}

// (String.atom_to_string x:Boolean|Number|Symbol) : String
function atom_to_string(PROCESS, RUNTIME) {
    let x = PROCESS.PopOperand();
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: String(x)
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (String.concat str1:String str2:String) : String
function concat(PROCESS, RUNTIME) {
    let str2Handle = PROCESS.PopOperand();
    let str2 = TrimQuotes(PROCESS.heap.Get(str2Handle).content);
    let str1Handle = PROCESS.PopOperand();
    let str1 = TrimQuotes(PROCESS.heap.Get(str1Handle).content);
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: str1.concat(str2)
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (String.charCodeAt index:Number str:String) : Number
function charCodeAt(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    let index = Number(PROCESS.PopOperand());
    PROCESS.OPSTACK.push(Number(str.charCodeAt(index)));
    PROCESS.Step();
}

// (String.fromCharCode charcode:Number) : String
function fromCharCode(PROCESS, RUNTIME) {
    let charcode = PROCESS.PopOperand();
    // 构造字符串对象
    let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let strObject = {
        type: "STRING",
        content: String.fromCharCode(Number(charcode))
    };
    PROCESS.heap.Set(strHandle, strObject);
    PROCESS.OPSTACK.push(strHandle);
    PROCESS.Step();
}

// (String.slice str:String start:Number end:Number) : String
function slice(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let end = Number(PROCESS.PopOperand());
    let start = Number(PROCESS.PopOperand());
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    // 构造字符串对象
    let newStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let newStrObject = {
        type: "STRING",
        content: String(str.slice(start, end))
    };
    PROCESS.heap.Set(newStrHandle, newStrObject);
    PROCESS.OPSTACK.push(newStrHandle);
    PROCESS.Step();
}

// (String.equals str1:String str2:String) : Boolean
function equals(PROCESS, RUNTIME) {
    let str2Handle = PROCESS.PopOperand();
    let str2 = TrimQuotes(PROCESS.heap.Get(str2Handle).content);
    let str1Handle = PROCESS.PopOperand();
    let str1 = TrimQuotes(PROCESS.heap.Get(str1Handle).content);

    PROCESS.OPSTACK.push((String(str1) === String(str2)) ? "#t" : "#f");
    PROCESS.Step();
}

// (String.charAt str:String index:Number) : String
function charAt(PROCESS, RUNTIME) {
    // 注意参数退栈顺序与参数列表顺序相反
    let index = Number(PROCESS.PopOperand());
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);

    // 构造字符串对象
    let newStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
    let newStrObject = {
        type: "STRING",
        content: (index < 0 || index >= str.length) ? "" : String(str[index])
    };
    PROCESS.heap.Set(newStrHandle, newStrObject);
    PROCESS.OPSTACK.push(newStrHandle);
    PROCESS.Step();
}

// (String.parseNumber x:String) : Number|#undefined
function parseNumber(PROCESS, RUNTIME) {
    let strHandle = PROCESS.PopOperand();
    let str = TrimQuotes(PROCESS.heap.Get(strHandle).content);
    let num = Number(str);
    PROCESS.OPSTACK.push(isNaN(num) ? "#undefined" : num);
    PROCESS.Step();
}

module.exports.length = length;
module.exports.atom_to_string = atom_to_string;
module.exports.concat = concat;
module.exports.charCodeAt = charCodeAt;
module.exports.fromCharCode = fromCharCode;
module.exports.slice = slice;
module.exports.equals = equals;
module.exports.charAt = charAt;
module.exports.parseNumber = parseNumber;
`;
ANIMAC_VFS["/lib/System.js"] = `// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
    else {
        str = str.replace(/\\\\n/gi, "\\n").replace(/\\\\r/gi, "\\r").replace(/\\\\"/gi, '"').replace(/\\\\t/gi, '\\t').replace(/\\\\b/gi, '\\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;








function exec(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(\`开始阻塞(System)\`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let cmdStrHandle = PROCESS.PopOperand();
        let cmdStr = TrimQuotes(PROCESS.heap.Get(cmdStrHandle).content);

        child_process.exec(cmdStr, {encoding: "UTF-8"}, (error, stdout, stderr)=> {
            if(error) {
                console.error(error);
                // console.warn(\`进程 \${PROCESS.PID} 恢复。\`);
                PROCESS.SetState("RUNNING");
                PROCESS.Step();
                return;
            }
            // 恢复进程状态
            // /console.warn(\`进程 \${PROCESS.PID} 恢复。\`);
            PROCESS.SetState("RUNNING");

            // 首先构造字符串对象
            // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
            let stdoutStrHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let stdoutStrObject = {
                type: "STRING",
                content: stdout.toString()
            };
            PROCESS.heap.Set(stdoutStrHandle, stdoutStrObject);

            PROCESS.OPSTACK.push(stdoutStrHandle);

            PROCESS.Step();

            // NOTE 取消异步回调设计。所有涉及阻塞的操作均设计成同步的。
            // let currentPC = PROCESS.PC;
            // RUNTIME.AIL_CALL(callback, PROCESS, RUNTIME);

            // 进程重新加入进程队列，并重启时钟
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        });
    }
}

// (System.set_timeout time_ms:Number callback:(void->undefined)) : Number(计时器编号)
function set_timeout(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let time_ms = PROCESS.PopOperand();

    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

    let timer = setTimeout(() => {
        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            // NOTE 返回到地址为1的指令，即halt指令
            RUNTIME.CallAsync(1, callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            // 返回到中断发生时的PC
            RUNTIME.CallAsync(PROCESS.PC, callback, PROCESS, RUNTIME);
        }
    }, time_ms);

    PROCESS.OPSTACK.push(Number(timer));
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.set_interval time_ms:Number callback:(void->undefined)) : Number(计时器编号)
function set_interval(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let callback = PROCESS.PopOperand();
    let time_ms = PROCESS.PopOperand();

    // 异步回调闭包需要设置为keepalive，防止被GC
    PROCESS.heap.SetKeepalive(callback, true);

    let timer = setInterval(() => {
        // 若进程已经执行完毕，则将其重新加入进程队列，重启时钟，执行回调函数
        if(PROCESS.state === "STOPPED") {
            // NOTE 返回到地址为1的指令，即halt指令
            RUNTIME.CallAsync(1, callback, PROCESS, RUNTIME);
            // 恢复进程状态
            PROCESS.SetState("RUNNING");
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }
        // 若进程尚未执行完毕，直接调用回调
        else {
            // 返回到中断发生时的PC
            RUNTIME.CallAsync(PROCESS.PC, callback, PROCESS, RUNTIME);
        }
    }, time_ms);

    PROCESS.OPSTACK.push(Number(timer));
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.clear_timeout timer:Number) : void
function clear_timeout(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let timer = PROCESS.PopOperand();
    clearTimeout(timer);
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.clear_interval timer:Number) : void
function clear_interval(PROCESS, RUNTIME) {
    // 从栈中获取参数，注意顺序是反的
    let timer = PROCESS.PopOperand();
    clearInterval(timer);
    PROCESS.Step(); // 退出，执行下一指令
}

// (System.timestamp) : Number
function timestamp(PROCESS, RUNTIME) {
    PROCESS.OPSTACK.push(Number(Date.now()));
    PROCESS.Step();
}

module.exports.exec = exec;
module.exports.set_timeout = set_timeout;
module.exports.set_interval = set_interval;
module.exports.clear_timeout = clear_timeout;
module.exports.clear_interval = clear_interval;
module.exports.timestamp = timestamp;
`;
// Memory.ts
// 内存管理
class HashMap extends Object {
    set(handle, value) {
        this[handle] = value;
    }
    get(handle) {
        return this[handle];
    }
    has(handle) {
        return (handle in this);
    }
    Copy() {
        let copy = new HashMap();
        for (let addr in this) {
            let value = this.get(addr);
            if (value === undefined)
                continue;
            if (value instanceof SchemeObject) {
                copy.set(addr, value.Copy());
            }
            else {
                let newValue = JSON.parse(JSON.stringify(value));
                copy.set(addr, newValue);
            }
        }
        return copy;
    }
}
// 基于HashMap的对象存储区，用于实现pool、heap等
class Memory {
    constructor() {
        this.data = new HashMap();
        this.metadata = new HashMap();
        this.handleCounter = 0;
    }
    // 生成元数据字符串
    // NOTE 增加新字段时，需要修改所有波及的硬编码下标
    MetaString(isStatic, isReadOnly, status, isKeepalive) {
        let str = "";
        str += (isStatic) ? "S" : "_";
        str += (isReadOnly) ? "R" : "_";
        switch (status) {
            case "allocated":
                str += "A";
                break;
            case "modified":
                str += "M";
                break;
            case "free":
                str += "F";
                break;
            default:
                str += "_";
                break;
        }
        str += (isKeepalive === true) ? "A" : "_"; // 声明为保持存活的对象，保证不会被GC清理，一般用于涉及尾调用的闭包对象
        return str;
    }
    // 把柄存在性判断
    HasHandle(handle) {
        return this.data.has(handle);
    }
    // 新建任意把柄
    NewHandle(handle, isStatic) {
        isStatic = isStatic || false;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated", false));
    }
    // 动态分配堆对象把柄
    AllocateHandle(typeTag, isStatic) {
        isStatic = isStatic || false;
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        if (ANIMAC_CONFIG.is_debug !== true) {
            handle = "&" + HashString([handle, String(Math.random())]);
        }
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated", false));
        this.handleCounter++;
        return handle;
    }
    // 动态回收堆对象把柄：删除堆中相应位置
    DeleteHandle(handle) {
        if (this.metadata[handle][3] === "A") { // metadata的keepalive标记
            console.warn(`[Memory.DeleteHandle] 把柄 ${handle} 声明为keepalive，不可删除`);
            return;
        }
        delete this.data[handle];
        delete this.metadata[handle];
        // this.data.set(handle, undefined);
        // this.metadata.set(handle, this.MetaString(false, false, "free"));
    }
    SetKeepalive(handle, isKeepalive) {
        if (this.metadata.has(handle)) {
            let meta = this.metadata[handle];
            let new_meta = [meta[0], meta[1], meta[2], ((isKeepalive === true) ? "A" : "_")].join("");
            this.metadata[handle] = new_meta;
        }
        else {
            throw `[Memory.SetKeepalive] 空把柄:${handle}`;
        }
    }
    // 根据把柄获取对象
    Get(handle) {
        if (this.data.has(handle)) {
            return this.data.get(handle);
        }
        else {
            throw `[Memory.Get] 空把柄:${handle}`;
        }
    }
    // 设置把柄的对象值
    Set(handle, value) {
        let metadata = this.metadata.get(handle);
        if (this.data.has(handle) === false) {
            throw `[Error] 未分配的把柄:${handle}`;
        }
        else if (metadata[1] === "R") {
            throw `[Error] 不允许修改只读对象:${handle}`;
        }
        else if (metadata[0] === "S") {
            // console.warn(`[Warn] 修改了静态对象:${handle}`);
        }
        this.metadata.set(handle, this.MetaString((metadata[0] === "S"), false, "modified", false));
        this.data.set(handle, value);
    }
    // 是否静态
    IsStatic(handle) {
        return ((this.metadata.get(handle))[0] === "S");
    }
    // 遍历
    // 注意：输入函数通过返回"break"来结束循环，通过返回其他任意值来中止一轮循环（continue）。
    ForEach(f) {
        for (let handle in this.data) {
            let ctrl = f(handle);
            if (ctrl === "break")
                break;
        }
    }
    // 深拷贝
    Copy() {
        let copy = new Memory();
        copy.data = this.data.Copy();
        copy.metadata = this.metadata.Copy();
        copy.handleCounter = this.handleCounter;
        return copy;
    }
}
// Object.ts
// 数据对象定义
class SchemeObject {
    Copy() { }
}
var SchemeObjectType;
(function (SchemeObjectType) {
    SchemeObjectType["STRING"] = "STRING";
    // SYMBOL     = "SYMBOL",
    // NUMBER     = "NUMBER",
    // BOOLEAN    = "BOOLEAN",
    SchemeObjectType["LIST"] = "LIST";
    SchemeObjectType["LAMBDA"] = "LAMBDA";
    SchemeObjectType["APPLICATION"] = "APPLICATION";
    SchemeObjectType["QUOTE"] = "QUOTE";
    SchemeObjectType["QUASIQUOTE"] = "QUASIQUOTE";
    SchemeObjectType["UNQUOTE"] = "UNQUOTE";
    SchemeObjectType["CLOSURE"] = "CLOSURE";
    SchemeObjectType["CONTINUATION"] = "CONTINUATION";
})(SchemeObjectType || (SchemeObjectType = {}));
// 各种具体对象
// Application列表对象
class ApplicationObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.APPLICATION;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new ApplicationObject(this.parent);
        copy.type = SchemeObjectType.APPLICATION;
        copy.children = this.children.slice();
        return copy;
    }
}
// Quote列表对象
class QuoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new QuoteObject(this.parent);
        copy.type = SchemeObjectType.QUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Quasiquote列表对象
class QuasiquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.QUASIQUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new QuasiquoteObject(this.parent);
        copy.type = SchemeObjectType.QUASIQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Unquote列表对象
class UnquoteObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.UNQUOTE;
        this.parent = parent;
        this.children = new Array();
    }
    Copy() {
        let copy = new UnquoteObject(this.parent);
        copy.type = SchemeObjectType.UNQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}
// Lambda列表对象
// [lambda, [param0, ... ], body0, ...]
class LambdaObject extends SchemeObject {
    constructor(parent) {
        super();
        this.type = SchemeObjectType.LAMBDA;
        this.parent = parent;
        this.children = new Array();
        this.children[0] = "lambda";
        this.children[1] = new Array();
    }
    Copy() {
        let copy = new LambdaObject(this.parent);
        copy.type = SchemeObjectType.LAMBDA;
        copy.children = this.children.slice();
        return copy;
    }
    addParameter(param) {
        if (this.children[1].indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.children[1].push(param);
        }
    }
    addBody(body) {
        this.children.push(body);
    }
    getParameters() {
        return this.children[1];
    }
    getBodies() {
        return this.children.slice(2);
    }
    // 用于AST融合
    setBodies(bodies) {
        this.children = this.children.slice(0, 2).concat(bodies);
    }
}
// 字符串对象
class StringObject extends SchemeObject {
    constructor(str) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
    }
    Copy() {
        return new StringObject(this.content);
    }
}
// 闭包（运行时堆对象）
class Closure extends SchemeObject {
    constructor(instructionAddress, parent) {
        super();
        this.type = SchemeObjectType.CLOSURE;
        this.instructionAddress = instructionAddress;
        this.parent = parent;
        this.boundVariables = new HashMap();
        this.freeVariables = new HashMap();
        this.dirtyFlag = new HashMap();
    }
    Copy() {
        let copy = new Closure(this.instructionAddress, this.parent);
        copy.type = SchemeObjectType.CLOSURE;
        copy.boundVariables = this.boundVariables.Copy();
        copy.freeVariables = this.freeVariables.Copy();
        copy.dirtyFlag = this.dirtyFlag.Copy();
        return copy;
    }
    // 不加脏标记
    InitBoundVariable(variable, value) {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    SetBoundVariable(variable, value) {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    GetBoundVariable(variable) {
        return this.boundVariables[variable];
    }
    // 不加脏标记
    InitFreeVariable(variable, value) {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    SetFreeVariable(variable, value) {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    GetFreeVariable(variable) {
        return this.freeVariables[variable];
    }
    IsDirtyVariable(variable) {
        return this.dirtyFlag[variable];
    }
    HasBoundVariable(variable) {
        return this.boundVariables.has(variable);
    }
    HasFreeVariable(variable) {
        return this.freeVariables.has(variable);
    }
}
// 续延（运行时堆对象）
class Continuation extends SchemeObject {
    constructor(partialEnvironment, contReturnTargetLable) {
        super();
        this.type = SchemeObjectType.CONTINUATION;
        this.partialEnvironmentJson = JSON.stringify(partialEnvironment);
        this.contReturnTargetLable = contReturnTargetLable;
    }
    Copy() {
        let copy = new Continuation(null, null);
        copy.type = SchemeObjectType.CONTINUATION;
        copy.partialEnvironmentJson = this.partialEnvironmentJson;
        copy.contReturnTargetLable = this.contReturnTargetLable;
        return copy;
    }
}
// Lexer.ts
// 词法分析
// 词法分析：源码→Token序列
function Lexer(code) {
    // 转义恢复
    code = code.replace(/\&lt\;/gi, '<');
    code = code.replace(/\&gt\;/gi, '>');
    // 在末尾加一个换行
    code = [code, '\n'].join('');
    let tokens = new Array();
    let token_temp = new Array();
    for (let i = 0; i < code.length; i++) {
        // 跳过注释
        if (code[i] === ';') {
            while (code[i] !== '\n' && code[i] !== '\r') {
                i++;
            }
            continue;
        }
        // 括号等定界符
        else if (code[i - 1] !== '\\' &&
            (code[i] === '(' || code[i] === ')' || code[i] === '[' || code[i] === ']' ||
                code[i] === '{' || code[i] === '}' || code[i] === '\'' || code[i] === ',' || code[i] === '`' || code[i] === '"')) {
            if (token_temp.length > 0) {
                let new_token = token_temp.join('');
                tokens.push({
                    string: new_token,
                    index: i - new_token.length
                });
                token_temp = [];
            }
            if (code[i] === '"') {
                let string_lit = code.substring(i).match(/".*?(?<!\\)"/gi);
                if (string_lit !== null) {
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
        else if (code[i] === ' ' || code[i] === '\t' || code[i] === '\n' || code[i] === '\r') {
            if (token_temp.length > 0) {
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
    let newTokens = new Array();
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].string === '{') {
            newTokens.push({
                string: '(',
                index: tokens[i].index
            });
            newTokens.push({
                string: 'begin',
                index: tokens[i].index + 1
            });
        }
        else if (tokens[i].string === '}') {
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
// Parser.ts
// 语法分析：将代码解析成AST，但不加分析
var NodeType;
(function (NodeType) {
    NodeType["LAMBDA"] = "LAMBDA";
    NodeType["APPLICATION"] = "APPLICATION";
    NodeType["QUOTE"] = "QUOTE";
    NodeType["QUASIQUOTE"] = "QUASIQUOTE";
    NodeType["STRING"] = "STRING";
    NodeType["SYMBOL"] = "SYMBOL";
    NodeType["NUMBER"] = "NUMBER";
    NodeType["BOOLEAN"] = "BOOLEAN";
})(NodeType || (NodeType = {}));
class AST {
    constructor(source, absolutePath) {
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
    Copy() {
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
    IsNativeCall(variable) {
        let varPrefix = variable.split(".")[0];
        return this.natives.has(varPrefix);
    }
    // 取出某节点
    GetNode(handle) {
        return this.nodes.Get(handle);
    }
    // 创建一个Lambda节点，保存，并返回其把柄
    MakeLambdaNode(parentHandle) {
        // NOTE 每个节点把柄都带有模块ID，这样做的目的是：不必在AST融合过程中调整每个AST的把柄。下同。
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.LAMBDA`, true);
        let lambdaObject = new LambdaObject(parentHandle);
        this.nodes.Set(handle, lambdaObject);
        this.lambdaHandles.push(handle);
        return handle;
    }
    // 创建一个Application节点，保存，并返回其把柄
    MakeApplicationNode(parentHandle, quoteType) {
        let handle;
        let node;
        switch (quoteType) {
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
    MakeStringNode(str) {
        let handle = this.nodes.AllocateHandle(`${this.moduleID}.STRING`, true);
        let node = new StringObject(str);
        this.nodes.Set(handle, node);
        return handle;
    }
    //////////////////////////
    // 顶级节点操作
    //////////////////////////
    // 查找最顶级Application的把柄（用于尾调用起始位置、AST融合等场合）
    TopApplicationNodeHandle() {
        let TopHandle = null;
        this.nodes.ForEach((nodeHandle) => {
            if (this.nodes.Get(nodeHandle).parent === TOP_NODE_HANDLE) {
                TopHandle = nodeHandle;
                return "break";
            }
        });
        return TopHandle;
    }
    // 查找顶级Lambda（全局作用域）节点的把柄
    TopLambdaNodeHandle() {
        return this.nodes.Get(this.TopApplicationNodeHandle()).children[0];
    }
    // 获取位于全局作用域的节点列表
    GetGlobalNodes() {
        return this.nodes.Get(this.TopLambdaNodeHandle()).getBodies();
    }
    // 设置全局作用域的节点列表
    SetGlobalNodes(bodies) {
        this.nodes.Get(this.TopLambdaNodeHandle()).setBodies(bodies);
    }
    // 将某个节点转换回Scheme代码
    // TODO 对于Quote列表的输出效果可以优化
    NodeToString(nodeHandle) {
        let str = '';
        if (TypeOfToken(nodeHandle) === "VARIABLE") {
            if (this.variableMapping.has(nodeHandle)) {
                return this.variableMapping.get(nodeHandle);
            }
            else {
                return String(nodeHandle);
            }
        }
        else if (TypeOfToken(nodeHandle) === "SYMBOL") {
            return String(nodeHandle.substring(1));
        }
        else if (TypeOfToken(nodeHandle) !== "HANDLE") {
            return String(nodeHandle);
        }
        else {
            let node = this.GetNode(nodeHandle);
            let type = node.type;
            if (type === "STRING") {
                return node.content;
            }
            else if (type === "APPLICATION" || type === "QUOTE" || type === "QUASIQUOTE" || type === "UNQUOTE") {
                /*if(type === "QUOTE") str = "'(";
                else if(type === "QUASIQUOTE") str = "`(";
                else if(type === "UNQUOTE") str = ",(";
                else str = "(";*/
                if (node.children.length > 0) {
                    str = "(";
                    for (let i = 0; i < node.children.length - 1; i++) {
                        str += this.NodeToString(node.children[i]);
                        str += " ";
                    }
                    str += this.NodeToString(node.children[node.children.length - 1]);
                }
                else if (node.children.length === 0) {
                    str = "'(";
                }
                str += ')';
            }
            else if (type === "LAMBDA") {
                str = "(lambda (";
                // parameters
                let parameters = node.getParameters();
                if (parameters.length > 0) {
                    for (let i = 0; i < parameters.length - 1; i++) {
                        str += this.NodeToString(parameters[i]);
                        str += " ";
                    }
                    str += this.NodeToString(parameters[parameters.length - 1]);
                }
                str += ') ';
                // body
                let bodies = node.getBodies();
                if (bodies.length > 0) {
                    for (let i = 0; i < bodies.length - 1; i++) {
                        str += this.NodeToString(bodies[i]);
                        str += " ";
                    }
                    str += this.NodeToString(bodies[bodies.length - 1]);
                }
                str += ')';
            }
            return str;
        }
    }
    // 融合另一个AST（注意，把柄需完全不同，否则会冲突报错）
    // TODO 这里细节比较复杂，需要写一份文档描述
    MergeAST(anotherAST, order) {
        order = order || "top"; // 默认顺序为在顶部融合
        this.source += "\n";
        this.source += anotherAST.source;
        // 注意：为了维持词法作用域关系，不可以简单地将两个nodes并列起来，而应该将源AST的顶级Lambda节点追加到目标AST的顶级Lambda节点的bodie中
        // 1 融合
        anotherAST.nodes.ForEach((hd) => {
            let node = anotherAST.nodes.Get(hd);
            this.nodes.NewHandle(hd, true); // 任何把柄在使用前都需要先注册，以初始化元数据
            this.nodes.Set(hd, node); // TODO：建议深拷贝
        });
        // 2 重组
        let sourceGlobalNodeHandles = anotherAST.GetGlobalNodes();
        let targetTopLambdaNodeHandle = this.TopLambdaNodeHandle();
        let targetGlobalNodeHandles = this.GetGlobalNodes();
        // 依赖（源）节点应挂载到前面
        if (order === "top") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(sourceGlobalNodeHandles.concat(targetGlobalNodeHandles));
        }
        else if (order === "bottom") {
            this.nodes.Get(targetTopLambdaNodeHandle).setBodies(targetGlobalNodeHandles.concat(sourceGlobalNodeHandles));
        }
        // 修改被挂载节点的parent字段
        for (let i = 0; i < sourceGlobalNodeHandles.length; i++) {
            this.nodes.Get(sourceGlobalNodeHandles[i]).parent = targetTopLambdaNodeHandle;
        }
        // 3、删除原来的顶级App节点和顶级Lambda节点
        this.nodes.DeleteHandle(anotherAST.TopLambdaNodeHandle());
        this.nodes.DeleteHandle(anotherAST.TopApplicationNodeHandle());
        for (let hd in anotherAST.nodeIndexes) {
            let oldValue = anotherAST.nodeIndexes.get(hd);
            this.nodeIndexes.set(hd, oldValue + this.source.length);
        }
        for (let hd of anotherAST.lambdaHandles) {
            if (hd === anotherAST.TopLambdaNodeHandle())
                continue; // 注意去掉已删除的顶级Lambda节点
            this.lambdaHandles.push(hd);
        }
        for (let hd of anotherAST.tailcall) {
            if (hd === anotherAST.TopApplicationNodeHandle())
                continue; // 注意去掉已删除的顶级Application节点
            this.tailcall.push(hd);
        }
        for (let hd in anotherAST.variableMapping) {
            let oldValue = anotherAST.variableMapping.get(hd);
            this.variableMapping.set(hd, oldValue);
        }
        for (let hd in anotherAST.topVariables) {
            let oldValue = anotherAST.topVariables.get(hd);
            this.topVariables.set(hd, oldValue);
        }
        for (let hd in anotherAST.dependencies) {
            let oldValue = anotherAST.dependencies.get(hd);
            this.dependencies.set(hd, oldValue);
        }
        for (let hd in anotherAST.natives) {
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
function Parse(code, absolutePath) {
    let ast = new AST(code, absolutePath);
    let tokens = Lexer(code);
    // 节点把柄栈
    let NODE_STACK = new Array();
    NODE_STACK.push(TOP_NODE_HANDLE);
    // 状态栈
    let STATE_STACK = new Array();
    // 解析输出
    function parseLog(msg) {
        // console.log(msg);
    }
    // 判断是否为定界符
    function isSymbol(token) {
        if (token === "(" || token === ")" || token === "{" || token === "}" || token === "[" || token === "]") {
            return false;
        }
        if (/^[\'\`\,]/gi.test(token)) {
            return false;
        } // 不允许开头的字符
        return true; // 其余的都是词法意义上的Symbol
    }
    ///////////////////////////////
    //  递归下降分析
    ///////////////////////////////
    function ParseTerm(tokens, index) {
        let quoteState = Top(STATE_STACK);
        if (quoteState !== "QUOTE" && quoteState !== "QUASIQUOTE" && tokens[index].string === '(' && tokens[index + 1].string === 'lambda') {
            parseLog('<Term> → <Lambda>');
            return ParseLambda(tokens, index);
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'quote') {
            parseLog('<Term> → <Quote>');
            let nextIndex = ParseQuote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] quote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'unquote') {
            parseLog('<Term> → <Unquote>');
            let nextIndex = ParseUnquote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] unquote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '(' && tokens[index + 1].string === 'quasiquote') {
            parseLog('<Term> → <Quasiquote>');
            let nextIndex = ParseQuasiquote(tokens, index + 1);
            if (tokens[nextIndex].string === ')') {
                return nextIndex + 1;
            }
            else {
                throw `[Error] quasiquote 右侧括号未闭合。`;
            }
        }
        else if (tokens[index].string === '\'') {
            parseLog('<Term> → <Quote>');
            return ParseQuote(tokens, index);
        }
        else if (tokens[index].string === ',') {
            parseLog('<Term> → <Unquote>');
            return ParseUnquote(tokens, index);
        }
        else if (tokens[index].string === '`') {
            parseLog('<Term> → <Quasiquote>');
            return ParseQuasiquote(tokens, index);
        }
        else if (tokens[index].string === '(') {
            parseLog('<Term> → <SList>');
            return ParseSList(tokens, index);
        }
        else if (isSymbol(tokens[index].string)) {
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
        let quoteType = Top(STATE_STACK);
        let listHandle = ast.MakeApplicationNode(Top(NODE_STACK), ((quoteType) ? quoteType : false));
        NODE_STACK.push(listHandle);
        ast.nodeIndexes.set(listHandle, tokens[index].index);
        let nextIndex = ParseSListSeq(tokens, index + 1);
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<SList>`;
        }
    }
    function ParseSListSeq(tokens, index) {
        parseLog('<SListSeq> → <Term> ※ <SListSeq> | ε');
        if (index >= tokens.length)
            throw `[Error] SList右侧括号未闭合。`; // TODO 完善错误提示
        let currentToken = tokens[index].string;
        if (currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken)) {
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
    function ParseLambda(tokens, index) {
        parseLog('<Lambda> → ( ※ lambda <ArgList> <Body> )');
        // Action：pushLambda() 向节点栈内压入一个新的Lambda，忽略状态。
        let lambdaHandle = ast.MakeLambdaNode(Top(NODE_STACK));
        NODE_STACK.push(lambdaHandle);
        ast.nodeIndexes.set(lambdaHandle, tokens[index].index);
        let nextIndex = ParseArgList(tokens, index + 2);
        nextIndex = ParseBody(tokens, nextIndex);
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<Lambda>`;
        }
    }
    function ParseArgList(tokens, index) {
        parseLog('<ArgList> → ( ※1 <ArgListSeq> ※2)');
        // Action1
        STATE_STACK.push("PARAMETER");
        let nextIndex = ParseArgListSeq(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        if (tokens[nextIndex].string === ')') {
            return nextIndex + 1;
        }
        else {
            throw `<ArgList>`;
        }
    }
    function ParseArgListSeq(tokens, index) {
        parseLog('<ArgListSeq> → <ArgSymbol> ※ <ArgListSeq> | ε');
        if (isSymbol(tokens[index].string)) {
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
    function ParseArgSymbol(tokens, index) {
        parseLog('<ArgSymbol> → <Symbol>');
        return ParseSymbol(tokens, index);
    }
    function ParseBody(tokens, index) {
        parseLog('<Body> → <BodyTerm> ※ <Body_>');
        let nextIndex = ParseBodyTerm(tokens, index);
        // Action：从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
        let bodyNode = NODE_STACK.pop();
        ast.GetNode(Top(NODE_STACK)).addBody(bodyNode);
        nextIndex = ParseBodyTail(tokens, nextIndex);
        return nextIndex;
    }
    function ParseBodyTail(tokens, index) {
        parseLog('<Body_> → <BodyTerm> ※ <Body_> | ε');
        let currentToken = tokens[index].string;
        if (currentToken === "(" || currentToken === "'" || currentToken === "," ||
            currentToken === "`" || isSymbol(currentToken)) {
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
    function ParseBodyTerm(tokens, index) {
        parseLog('<BodyTerm> → <Term>');
        return ParseTerm(tokens, index);
    }
    function ParseQuote(tokens, index) {
        parseLog('<Quote> → \' ※1 <QuoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUOTE');
        let nextIndex = ParseQuoteTerm(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }
    function ParseUnquote(tokens, index) {
        parseLog('<Unquote> → , ※1 <UnquoteTerm> ※2');
        // Action1
        STATE_STACK.push('UNQUOTE');
        let nextIndex = ParseUnquoteTerm(tokens, index + 1);
        // Action2
        STATE_STACK.pop();
        return nextIndex;
    }
    function ParseQuasiquote(tokens, index) {
        parseLog('<Quasiquote> → ` ※1 <QuasiquoteTerm> ※2');
        // Action1
        STATE_STACK.push('QUASIQUOTE');
        let nextIndex = ParseQuasiquoteTerm(tokens, index + 1);
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
        let currentToken = tokens[index].string;
        if (isSymbol(currentToken)) {
            // Action
            let state = Top(STATE_STACK);
            if (state === 'QUOTE' || state === 'QUASIQUOTE') {
                let type = TypeOfToken(currentToken);
                // 被quote的常量和字符串不受影响
                if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken)); // 压入number
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken); // 压入string
                }
                // 被quote的变量和关键字（除了quote、unquote和quasiquote），变成symbol
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "PORT" ||
                    (currentToken !== "quasiquote" && currentToken !== "quote" && currentToken !== "unquote")) {
                    NODE_STACK.push(`'${currentToken}`);
                }
                else { // 含boolean在内的变量、把柄等
                    NODE_STACK.push(currentToken);
                }
            }
            else if (state === 'UNQUOTE') {
                let type = TypeOfToken(currentToken);
                // 符号会被解除引用
                if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken.replace(/^\'*/gi, "")); // VARIABLE
                }
                // 其他所有类型不受影响
                else if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`;
                }
            }
            else {
                let type = TypeOfToken(currentToken);
                if (type === "NUMBER") {
                    NODE_STACK.push(parseFloat(currentToken));
                }
                else if (type === "STRING") {
                    let stringHandle = ast.MakeStringNode(currentToken);
                    NODE_STACK.push(stringHandle);
                    ast.nodeIndexes.set(stringHandle, tokens[index].index);
                }
                else if (type === "SYMBOL") {
                    NODE_STACK.push(currentToken);
                }
                else if (type === "VARIABLE" || type === "KEYWORD" || type === "BOOLEAN" || type === "PORT") {
                    NODE_STACK.push(currentToken); // VARIABLE原样保留，在作用域分析的时候才被录入AST
                }
                else {
                    throw `<Symbol> Illegal symbol.`;
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
    function PreprocessAnalysis() {
        // 遍历所有的node，寻找预处理指令
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // (import <Alias> <Path>)
            if (nodeType === "APPLICATION" && node.children[0] === "import") {
                let moduleAlias = node.children[1]; // 模块的别名
                let pathStringHandle = node.children[2]; // 模块路径字符串（的把柄）
                let pathStringObject = ast.GetNode(pathStringHandle); // 若不存在，会抛出异常
                if (pathStringObject.type !== "STRING") {
                    throw `[预处理] import的来源路径必须写成字符串`;
                }
                // 将相对路径扩展为绝对路径
                let modulePath = TrimQuotes(pathStringObject.content);
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    let basePath = PathUtils.DirName(absolutePath); // 当前模块所在的目录
                    modulePath = PathUtils.Join(basePath, modulePath); // 将依赖模块的路径拼接为绝对路径
                }
                ast.dependencies.set(moduleAlias, modulePath);
            }
            // (native <NativeLibName>)
            else if (nodeType === "APPLICATION" && node.children[0] === "native") {
                let nativeLibName = node.children[1];
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
// Parser.ts
// 作用域和尾调用分析：分析并处理AST
class Scope {
    constructor(parent) {
        this.parent = parent;
        this.children = new Array();
        this.boundVariables = new Array();
    }
    addChild(child) {
        this.children.push(child);
    }
    addParameter(param) {
        if (this.boundVariables.indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.boundVariables.push(param);
        }
    }
}
function Analyse(ast) {
    let scopes = new HashMap();
    ///////////////////////////////
    //  作用域解析，变量换名
    ///////////////////////////////
    // 从某个节点开始，向上查找某个变量归属的Lambda节点
    function searchVarLambdaHandle(variable, fromNodeHandle) {
        let currentNodeHandle = fromNodeHandle;
        while (currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if (node.type === "LAMBDA") {
                // 注意：从scopes中获取换名前的作用域信息
                let bounds = scopes.get(currentNodeHandle).boundVariables;
                if (bounds.indexOf(variable) >= 0) {
                    return currentNodeHandle;
                }
            }
            currentNodeHandle = node.parent;
        }
        return null; // 变量未定义
    }
    // 查找某个node上面最近的lambda节点的地址
    function nearestLambdaHandle(fromNodeHandle) {
        let currentNodeHandle = fromNodeHandle;
        while (currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if (node.type === "LAMBDA") {
                return currentNodeHandle;
            }
            currentNodeHandle = node.parent;
        }
        return null;
    }
    // 生成模块内唯一的变量名
    function MakeUniqueVariable(lambdaHandle, variable) {
        if (ANIMAC_CONFIG.is_debug !== true) {
            return "V" + HashString([lambdaHandle.substring(1), variable]);
        }
        else {
            return `${lambdaHandle.substring(1)}.${variable}`;
        }
    }
    // 以下是作用域解析：需要对所有node扫描两遍
    function ScopeAnalysis() {
        // 顶级Lambda的把柄
        let topLambdaHandle = ast.lambdaHandles[0];
        // 首先初始化所有scope
        for (let nodeHandle of ast.lambdaHandles) {
            let scope = new Scope(null);
            scopes.set(nodeHandle, scope);
        }
        // 第1趟扫描：在scopes中注册作用域的树状嵌套关系；处理define行为
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点
            if (nodeType === "LAMBDA") {
                // 寻找上级lambda节点
                let parentLambdaHandle = nearestLambdaHandle(node.parent);
                // 非顶级lambda
                if (parentLambdaHandle !== null) {
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
            else if (nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle = nearestLambdaHandle(nodeHandle);
                if (parentLambdaHandle !== null) {
                    let definedVariable = node.children[1];
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
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点：替换parameter和bodies中出现的所有Variable
            if (nodeType === "LAMBDA") {
                // 处理Lambda节点的parameters
                for (let i = 0; i < node.getParameters().length; i++) {
                    let originVar = (node.getParameters())[i];
                    let newVar = MakeUniqueVariable(nodeHandle, originVar);
                    (ast.GetNode(nodeHandle).getParameters())[i] = newVar;
                    ast.variableMapping.set(newVar, originVar);
                }
                // 处理body中出现的单独的变量（例如(lambda (x) *x*)）
                for (let i = 2; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if (isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if (lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if (!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`;
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
            else if (nodeType === "APPLICATION" || nodeType === "UNQUOTE" || nodeType === "QUASIQUOTE") {
                // 跳过若干特殊类型的node
                let first = node.children[0];
                if (["native", "import"].indexOf(first) >= 0) {
                    return; // 相当于continue;
                }
                for (let i = 0; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if (isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if (lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if (!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`;
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
                if (first === "define" && node.parent === topLambdaHandle) {
                    let newVarName = node.children[1];
                    let originVarName = ast.variableMapping.get(newVarName);
                    if (ast.topVariables.has(originVarName)) {
                        throw `[Error] 顶级变量“${originVarName}”@Position ${ast.nodeIndexes.get(nodeHandle)} 重复。`;
                    }
                    else {
                        ast.topVariables.set(originVarName, newVarName);
                    }
                }
            }
        }); // 所有节点扫描完毕
    }
    // 尾位置分析（参照R5RS的归纳定义）
    function TailCallAnalysis(item, isTail) {
        if (TypeOfToken(item) === "HANDLE") {
            let node = ast.GetNode(item);
            if (node.type === "APPLICATION") {
                let first = node.children[0];
                // if 特殊构造
                if (first === "if") {
                    TailCallAnalysis(node.children[1], false);
                    TailCallAnalysis(node.children[2], isTail);
                    TailCallAnalysis(node.children[3], isTail);
                }
                // cond 特殊构造
                else if (first === "cond") {
                    for (let i = 1; i < node.children.length; i++) {
                        let clauseNode = ast.GetNode(node.children[i]);
                        TailCallAnalysis(clauseNode.children[0], false);
                        TailCallAnalysis(clauseNode.children[1], isTail);
                    }
                }
                // 其他构造，含and、or，这些形式的尾位置是一样的
                else {
                    for (let i = 0; i < node.children.length; i++) {
                        let _istail = false;
                        if ((i === node.children.length - 1) &&
                            (node.children[0] === 'begin' || node.children[0] === 'and' || node.children[0] === 'or')) {
                            _istail = isTail;
                        }
                        TailCallAnalysis(node.children[i], _istail);
                    }
                    if (isTail) {
                        ast.tailcall.push(item); // 标记为尾（调用）位置
                    }
                }
            }
            else if (node.type === "LAMBDA") {
                let bodies = node.getBodies();
                for (let i = 0; i < bodies.length; i++) {
                    if (i === bodies.length - 1) {
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
    // 作用域解析
    ScopeAnalysis();
    // 尾调用分析
    TailCallAnalysis(ast.TopApplicationNodeHandle(), true);
    return ast;
}
// Compiler.ts
// 编译器：AST→ILCode
//////////////////////////////////////////////////
//
//  编译器：将AST编译成中间语言代码
//
//////////////////////////////////////////////////
function Compile(ast) {
    // 编译得到的中间语言指令序列
    let ILCode = new Array();
    // while块的标签跟踪栈：用于处理break/continue
    let whileTagStack = new Array();
    ///////////////////////////////
    //  工具函数
    ///////////////////////////////
    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `${ast.moduleID}.ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        if (ANIMAC_CONFIG.is_debug !== true) {
            return HashString([uniqueString]);
        }
        else {
            return uniqueString;
        }
    }
    // 增加一条新指令
    function AddInstruction(instStr) {
        if (instStr.trim()[0] === ";") {
            // ILCode.push(instStr);
        }
        else {
            ILCode.push(instStr.trim());
        }
    }
    ////////////////////////////////////////////////
    //  从所有的Lambda节点开始，递归地编译每个节点
    ////////////////////////////////////////////////
    // 编译Lambda节点
    function CompileLambda(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ FUNCTION “${nodeHandle}” BEGIN`);
        // 函数开始标签：格式约定为@+LambdaHandle
        AddInstruction(`@${nodeHandle}`);
        // 按参数列表逆序，插入store指令
        // 【已解决】TODO 参数列表里通过define获得的参数，不需要在这里出现
        let parameters = node.getParameters();
        for (let i = parameters.length - 1; i >= 0; i--) {
            AddInstruction(`store ${parameters[i]}`);
        }
        // 逐个编译函数体，等价于begin块
        let bodies = node.getBodies();
        for (let i = 0; i < bodies.length; i++) {
            let body = bodies[i];
            let bodyType = TypeOfToken(body);
            if (bodyType === "HANDLE") {
                let bodyObj = ast.GetNode(body);
                let bodyObjType = bodyObj.type;
                if (bodyObjType === "LAMBDA") {
                    AddInstruction(`loadclosure @${body}`);
                }
                else if (bodyObjType === "QUOTE") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "QUASIQUOTE") {
                    CompileQuasiquote(body);
                }
                else if (bodyObjType === "STRING") {
                    AddInstruction(`push ${body}`);
                }
                else if (bodyObjType === "APPLICATION" || bodyObjType === "UNQUOTE") {
                    CompileApplication(body);
                }
                else {
                    throw `[Error] 意外的函数体节点类型。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(bodyType) >= 0 || ast.IsNativeCall(body)) {
                if (body === "break" || body === "continue") {
                    throw `[Error] lambda块内不允许出现break和continue。`;
                }
                else {
                    AddInstruction(`push ${body}`);
                }
            }
            else if (bodyType === "VARIABLE") {
                AddInstruction(`load ${body}`);
            }
            else {
                throw `[Error] 意外的函数体类型。`;
            }
        }
        // 返回指令
        AddInstruction(`return`);
        AddInstruction(`;; 🛑 FUNCTION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译CallCC
    function CompileCallCC(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ Call/cc “${nodeHandle}” BEGIN`);
        // 参数：lambda（必须是thunk）或者引用thunk的变量
        let thunk = node.children[1];
        // cont临时变量，同时也构成cont返回标签
        let contName = `CC_${thunk}_${UniqueString()}`;
        AddInstruction(`;; ✅ Current Continuation captured, stored in “${contName}”`);
        // 捕获CC，并使用此CC调用thunk
        AddInstruction(`capturecc ${contName}`);
        AddInstruction(`load ${contName}`);
        if (TypeOfToken(thunk) === "HANDLE") {
            let thunkNode = ast.GetNode(thunk);
            // TODO Thunk类型检查
            if (thunkNode.type === "LAMBDA") {
                AddInstruction(`call @${thunk}`);
            }
            else {
                throw `[Error] call/cc的参数必须是Thunk。`;
            }
        }
        else if (TypeOfToken(thunk) === "VARIABLE") {
            // TODO Thunk类型检查
            AddInstruction(`call ${thunk}`);
        }
        else {
            throw `[Error] call/cc的参数必须是Thunk。`;
        }
        // cont返回标签
        AddInstruction(`@${contName}`);
        AddInstruction(`;; 🛑 Call/cc “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译define
    function CompileDefine(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ DEFINE “${nodeHandle}” BEGIN`);
        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if (rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if (rightValueNode.type === "LAMBDA") {
                AddInstruction(`push @${rightValue}`); // 注意：define并不对Lambda节点求值（即，生成闭包实例）
            }
            else if (rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if (rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            if (rightValue === "break" || rightValue === "continue") {
                throw `[Error] define右值不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${rightValue}`);
            }
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }
        // store
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if (leftVariableType === "VARIABLE") {
            AddInstruction(`store ${leftVariable}`);
        }
        else {
            throw `[Error] define左值必须是变量名称。`;
        }
        AddInstruction(`;; 🛑 DEFINE “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译set!
    function CompileSet(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ SET! “${nodeHandle}” BEGIN`);
        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if (rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if (rightValueNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${rightValue}`); // 注意：set!对Lambda节点求值（即，生成闭包实例）
            }
            else if (rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if (rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if (rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            if (rightValue === "break" || rightValue === "continue") {
                throw `[Error] set!右值不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${rightValue}`);
            }
        }
        else if (rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }
        // set
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if (leftVariableType === "VARIABLE") {
            AddInstruction(`set ${leftVariable}`);
        }
        else {
            throw `[Error] set!左值必须是变量名称。`;
        }
        AddInstruction(`;; 🛑 SET! “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // TODO 编译begin
    /*
    function CompileBegin(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ BEGIN “${nodeHandle}” BEGIN`);

        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();

        // 遍历每个分支
        for(let i = 1; i < node.children.length; i++) {
            let child = node.children[i];
            let childType = TypeOfToken(child);
            if(childType === "HANDLE") {
                let trueBranchNode = ast.GetNode(child);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                AddInstruction(`push ${child}`);
            }
            else if(childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }

            // 只保留最后一个child的压栈结果，其他的全部pop掉
            if(i !== node.children.length - 1) {
                AddInstruction(`pop`);
            }
        } // 分支遍历结束

        AddInstruction(`;; 🛑 BEGIN “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    */
    // 编译cond
    function CompileCond(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ COND “${nodeHandle}” BEGIN`);
        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();
        // 遍历每个分支
        for (let i = 1; i < node.children.length; i++) {
            let clauseNode = ast.GetNode(node.children[i]);
            // 插入开始标签（实际上第一个分支不需要）
            AddInstruction(`@COND_BRANCH_${uqStr}_${i}`);
            // 处理分支条件（除了else分支）
            let predicate = clauseNode.children[0];
            if (predicate !== "else") {
                let predicateType = TypeOfToken(predicate);
                if (predicateType === "HANDLE") {
                    let predicateNode = ast.GetNode(predicate);
                    if (predicateNode.type === "APPLICATION") {
                        CompileApplication(predicate);
                    }
                    // 其余情况，统统作push处理
                    else {
                        AddInstruction(`push ${predicate}`);
                    }
                }
                // TODO 此处可以作优化
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
                    if (predicate === "break" || predicate === "continue") {
                        throw `[Error] cond条件表达式不允许出现break和continue。`;
                    }
                    else {
                        AddInstruction(`push ${predicate}`);
                    }
                }
                else if (predicateType === "VARIABLE") {
                    AddInstruction(`load ${predicate}`);
                }
                else {
                    throw `[Error] 意外的cond分支条件。`;
                }
                // 如果不是最后一个分支，则跳转到下一条件；如果是最后一个分支，则跳转到结束标签
                if (i === node.children.length - 1) {
                    AddInstruction(`iffalse @COND_END_${uqStr}`);
                }
                else {
                    AddInstruction(`iffalse @COND_BRANCH_${uqStr}_${(i + 1)}`);
                }
            }
            // 处理分支主体
            let branch = clauseNode.children[1];
            let branchType = TypeOfToken(branch);
            if (branchType === "HANDLE") {
                let branchNode = ast.GetNode(branch);
                if (branchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${branch}`); // 返回闭包
                }
                else if (branchNode.type === "QUOTE") {
                    AddInstruction(`push ${branch}`);
                }
                else if (branchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(branch);
                }
                else if (branchNode.type === "STRING") {
                    AddInstruction(`push ${branch}`);
                }
                else if (branchNode.type === "APPLICATION" || branchNode.type === "UNQUOTE") {
                    CompileApplication(branch);
                }
                else {
                    throw `[Error] 意外的if-true分支。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(branchType) >= 0 || ast.IsNativeCall(branch)) {
                if (branch === "break" || branch === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (branch === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${branch}`);
                }
            }
            else if (branchType === "VARIABLE") {
                AddInstruction(`load ${branch}`);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
            // 插入收尾语句（区分else分支和非else分支）
            if (predicate === "else" || i === node.children.length - 1) {
                AddInstruction(`@COND_END_${uqStr}`);
                break; // 忽略else后面的所有分支
            }
            else {
                AddInstruction(`goto @COND_END_${uqStr}`);
            }
        } // 分支遍历结束
        AddInstruction(`;; 🛑 COND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译if
    function CompileIf(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ IF “${nodeHandle}” BEGIN`);
        // 标签
        let uqStr = UniqueString();
        let trueTag = `@IF_TRUE_${uqStr}`; // true分支标签
        let endTag = `@IF_END_${uqStr}`; // if语句结束标签
        // 处理分支条件
        let predicate = node.children[1];
        let predicateType = TypeOfToken(predicate);
        if (predicateType === "HANDLE") {
            let predicateNode = ast.GetNode(predicate);
            if (predicateNode.type === "APPLICATION") {
                CompileApplication(predicate);
            }
            // 其余情况，统统作push处理
            else {
                AddInstruction(`push ${predicate}`);
            }
        }
        // TODO 此处可以作优化
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
            if (predicate === "break" || predicate === "continue") {
                throw `[Error] if条件表达式不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${predicate}`);
            }
        }
        else if (predicateType === "VARIABLE") {
            AddInstruction(`load ${predicate}`);
        }
        else {
            throw `[Error] 意外的if分支条件。`;
        }
        // 两个分支（children[2]和children[3]）既可以同时存在，也可以只存在t分支，但是t分支是必须存在的。
        if (node.children[2] !== undefined) {
            // 如果t分支和f分支同时存在，则认为取f分支的概率较大，使用iftrue指令，将f分支的IL指令放在t分支前面
            if (node.children[3] !== undefined) {
                AddInstruction(`iftrue ${trueTag}`);
                // 处理false分支
                let falseBranch = node.children[3];
                let falseBranchType = TypeOfToken(falseBranch);
                if (falseBranchType === "HANDLE") {
                    let falseBranchNode = ast.GetNode(falseBranch);
                    if (falseBranchNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${falseBranch}`); // 返回闭包
                    }
                    else if (falseBranchNode.type === "QUOTE") {
                        AddInstruction(`push ${falseBranch}`);
                    }
                    else if (falseBranchNode.type === "QUASIQUOTE") {
                        CompileQuasiquote(falseBranch);
                    }
                    else if (falseBranchNode.type === "STRING") {
                        AddInstruction(`push ${falseBranch}`);
                    }
                    else if (falseBranchNode.type === "APPLICATION" || falseBranchNode.type === "UNQUOTE") {
                        CompileApplication(falseBranch);
                    }
                    else {
                        throw `[Error] 意外的if-false分支。`;
                    }
                }
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(falseBranchType) >= 0 || ast.IsNativeCall(falseBranch)) {
                    if (falseBranch === "break" || falseBranch === "continue") {
                        let whileTags = Top(whileTagStack);
                        if (whileTags !== undefined) {
                            if (falseBranch === "break") {
                                AddInstruction(`goto ${whileTags[1]}`); // endTag
                            }
                            else {
                                AddInstruction(`goto ${whileTags[0]}`); // condTag
                            }
                        }
                        else {
                            throw `[Error] break或continue没有对应的while表达式。`;
                        }
                    }
                    else {
                        AddInstruction(`push ${falseBranch}`);
                    }
                }
                else if (falseBranchType === "VARIABLE") {
                    AddInstruction(`load ${falseBranch}`);
                }
                else {
                    throw `[Error] 意外的if-false分支。`;
                }
                // 跳转到结束标签
                AddInstruction(`goto ${endTag}`);
                // 添加true分支标签
                AddInstruction(trueTag);
            }
            // 或者，如果只存在t分支，f分支不存在，则在t分支前添加一个条件跳转指令
            //   NOTE 只有t分支的形式(if p t)等效于(and p t)
            else {
                AddInstruction(`iffalse ${endTag}`);
            }
            // 以下编译t分支（true分支必须存在）
            let trueBranch = node.children[2];
            let trueBranchType = TypeOfToken(trueBranch);
            if (trueBranchType === "HANDLE") {
                let trueBranchNode = ast.GetNode(trueBranch);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${trueBranch}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${trueBranch}`);
                }
                else if (trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(trueBranch);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${trueBranch}`);
                }
                else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(trueBranch);
                }
                else {
                    throw `[Error] 意外的if-true分支。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(trueBranchType) >= 0 || ast.IsNativeCall(trueBranch)) {
                if (trueBranch === "break" || trueBranch === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (trueBranch === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${trueBranch}`);
                }
            }
            else if (trueBranchType === "VARIABLE") {
                AddInstruction(`load ${trueBranch}`);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
            // 结束标签
            AddInstruction(endTag);
            AddInstruction(`;; 🛑 IF “${nodeHandle}” END   `);
            AddInstruction(`;;`);
        }
        else {
            throw `[Error] if表达式中不存在true分支。`;
        }
    }
    // 编译while
    function CompileWhile(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ WHILE “${nodeHandle}” BEGIN`);
        // 标签
        let uqStr = UniqueString();
        let condTag = `@WHILE_COND_${uqStr}`; // 循环条件标签
        let endTag = `@WHILE_END_${uqStr}`; // 循环结束标签
        // 进入while块，将标签压入while块标签跟踪栈，用于处理块内本级的break/continue
        whileTagStack.push([condTag, endTag]);
        // 添加循环条件标签
        AddInstruction(condTag);
        // 循环条件
        let cond = node.children[1];
        let condType = TypeOfToken(cond);
        if (condType === "HANDLE") {
            let condNode = ast.GetNode(cond);
            if (condNode.type === "APPLICATION") {
                CompileApplication(cond);
            }
            // 其余情况，统统作push处理
            else {
                AddInstruction(`push ${cond}`);
            }
        }
        // TODO 此处可以作优化
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(condType) >= 0 || ast.IsNativeCall(cond)) {
            AddInstruction(`push ${cond}`);
        }
        else if (condType === "VARIABLE") {
            AddInstruction(`load ${cond}`);
        }
        else {
            throw `[Error] 意外的while循环条件。`;
        }
        // 如果循环条件为#f，则跳出循环，否则执行紧接着的循环体
        AddInstruction(`iffalse ${endTag}`);
        // 循环体
        let loopBody = node.children[2];
        let loopBodyType = TypeOfToken(loopBody);
        if (loopBodyType === "HANDLE") {
            let loopBodyNode = ast.GetNode(loopBody);
            if (loopBodyNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${loopBody}`); // 返回闭包
            }
            else if (loopBodyNode.type === "QUOTE") {
                AddInstruction(`push ${loopBody}`);
            }
            else if (loopBodyNode.type === "QUASIQUOTE") {
                CompileQuasiquote(loopBody);
            }
            else if (loopBodyNode.type === "STRING") {
                AddInstruction(`push ${loopBody}`);
            }
            else if (loopBodyNode.type === "APPLICATION" || loopBodyNode.type === "UNQUOTE") {
                CompileApplication(loopBody);
            }
            else {
                throw `[Error] 意外的if-false分支。`;
            }
        }
        else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(loopBodyType) >= 0 || ast.IsNativeCall(loopBody)) {
            if (loopBody === "break" || loopBody === "continue") {
                let whileTags = Top(whileTagStack);
                if (whileTags !== undefined) {
                    if (loopBody === "break") {
                        AddInstruction(`goto ${whileTags[1]}`); // endTag
                    }
                    else {
                        AddInstruction(`goto ${whileTags[0]}`); // condTag
                    }
                }
                else {
                    throw `[Error] break或continue没有对应的while表达式。`;
                }
            }
            else {
                AddInstruction(`push ${loopBody}`);
            }
        }
        else if (loopBodyType === "VARIABLE") {
            AddInstruction(`load ${loopBody}`);
        }
        else {
            throw `[Error] 意外的if-false分支。`;
        }
        // 跳转回循环条件标签
        AddInstruction(`goto ${condTag}`);
        // 结束标签
        AddInstruction(endTag);
        // 退出while块，标签从while块标签跟踪栈弹出
        whileTagStack.pop();
        AddInstruction(`;; 🛑 WHILE “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译and
    function CompileAnd(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ AND “${nodeHandle}” BEGIN`);
        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@AND_END_${uqStr}`;
        let falseTag = `@AND_FALSE_${uqStr}`;
        // 遍历每一项
        for (let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);
            if (clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的and clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                if (clause === "break" || clause === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (clause === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${clause}`);
                }
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            else {
                throw `[Error] 意外的and clause。`;
            }
            // 每个分支后面都要作判断
            AddInstruction(`iffalse ${falseTag}`);
        }
        // 没有任何一项为假，则返回#t，结束
        AddInstruction(`push #t`);
        AddInstruction(`goto ${endTag}`);
        // 有任何一项为#f都会跳到这里，返回#f，结束
        AddInstruction(falseTag);
        AddInstruction(`push #f`);
        // 结束标签
        AddInstruction(endTag);
        AddInstruction(`;; 🛑 AND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译or
    function CompileOr(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ OR “${nodeHandle}” BEGIN`);
        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@OR_END_${uqStr}`;
        let trueTag = `@OR_FALSE_${uqStr}`;
        // 遍历每一项
        for (let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);
            if (clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if (trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if (trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if (trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if (trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的 or clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                if (clause === "break" || clause === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (clause === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${clause}`);
                }
            }
            else if (clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            else {
                throw `[Error] 意外的 or clause。`;
            }
            // 每个分支后面都要作判断
            AddInstruction(`iftrue ${trueTag}`);
        }
        // 没有任何一项为真（非假），则返回#f，结束
        AddInstruction(`push #f`);
        AddInstruction(`goto ${endTag}`);
        // 有任何一项为#t（非#f）都会跳到这里，返回#t，结束
        AddInstruction(trueTag);
        AddInstruction(`push #t`);
        // 结束标签
        AddInstruction(endTag);
        AddInstruction(`;; 🛑 OR “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译准引用节点
    function CompileQuasiquote(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        for (let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            if (TypeOfToken(child) === "HANDLE") {
                let childObj = ast.GetNode(child);
                if (childObj.type === "APPLICATION" || childObj.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else if (childObj.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(TypeOfToken(child)) >= 0 || ast.IsNativeCall(child)) {
                if (child === "break" || child === "continue") {
                    throw `[Error] quasiquote内部不允许出现break和continue。`;
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if (TypeOfToken(child) === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
        }
        AddInstruction(`push ${node.children.length}`);
        AddInstruction(`concat`);
    }
    // 编译复杂的Application节点（即首项为待求值的Application的Application，此时需要作η变换）
    // (A 1 2 ..) → ((lambda (F x y ..) (F x y ..)) A 1 2 ..)
    function CompileComplexApplication(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ C'APPLICATION “${nodeHandle}” BEGIN`);
        let children = node.children;
        let uqStr = UniqueString();
        // 调用(TempFunc A 1 2 ..)开始点
        let startTag = `@APPLY_BEGIN_${uqStr}`;
        AddInstruction(`goto ${startTag}`);
        // 构造临时函数
        // 临时函数的开始点标签和返回点标签
        let tempLambdaName = `TEMP_LAMBDA_${uqStr}`;
        let tempLambdaRetName = `TEMP_LAMBDA_RETURN_TARGET_${uqStr}`;
        // 临时函数的形式参数列表
        let tempLambdaParams = new Array();
        for (let i = 0; i < children.length; i++) {
            tempLambdaParams[i] = `TEMP_LAMBDA_PARAM${i}_${uqStr}`;
        }
        // 临时函数开始
        AddInstruction(`;; >>>>>> Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(`@${tempLambdaName}`);
        // 执行η变换
        for (let i = children.length - 1; i >= 0; i--) {
            AddInstruction(`store ${tempLambdaParams[i]}`);
        }
        for (let i = 1; i < children.length; i++) {
            AddInstruction(`load ${tempLambdaParams[i]}`);
        }
        AddInstruction(`tailcall ${tempLambdaParams[0]}`);
        // 以下二选一
        // AddInstruction(`goto @${tempLambdaRetName}`); // 不用return，直接返回调用临时函数的位置
        AddInstruction(`return`);
        // 主体开始
        AddInstruction(`;; >>>>>> Call Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(startTag);
        // 编译(TempFunc A 1 2 ..)形式
        for (let i = 0; i < children.length; i++) {
            let child = children[i];
            let childType = TypeOfToken(child);
            if (childType === "HANDLE") {
                let childNode = ast.GetNode(child);
                if (childNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if (childNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if (childNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if (childNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if (childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                if (child === "break" || child === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (child === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if (childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }
        }
        // 调用临时函数
        // 以下二选一
        // AddInstruction(`goto @${tempLambdaName}`); // 不用call
        AddInstruction(`call @${tempLambdaName}`);
        // 临时函数调用返回点
        AddInstruction(`@${tempLambdaRetName}`);
        AddInstruction(`;; 🛑 C'APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 编译一般的Application节点
    function CompileApplication(nodeHandle) {
        let node = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ APPLICATION “${nodeHandle}” BEGIN`);
        let children = node.children;
        // 判断Application类型，根据不同的类型，执行不同的编译流程
        // 空表
        if (children.length <= 0) {
            return;
        }
        let first = children[0];
        let firstType = TypeOfToken(first);
        // 以下是几种特殊形式
        if (first === 'import') {
            return;
        }
        else if (first === 'native') {
            return;
        }
        // TODO else if(first === 'begin')   { return CompileBegin(nodeHandle); }
        else if (first === 'call/cc') {
            return CompileCallCC(nodeHandle);
        }
        else if (first === 'define') {
            return CompileDefine(nodeHandle);
        }
        else if (first === 'set!') {
            return CompileSet(nodeHandle);
        }
        else if (first === 'cond') {
            return CompileCond(nodeHandle);
        }
        else if (first === 'if') {
            return CompileIf(nodeHandle);
        }
        else if (first === 'while') {
            return CompileWhile(nodeHandle);
        }
        else if (first === 'and') {
            return CompileAnd(nodeHandle);
        }
        else if (first === 'or') {
            return CompileOr(nodeHandle);
        }
        else if (first === 'fork') {
            AddInstruction(`fork ${children[1]}`);
            return;
        }
        // 首项是待求值的Application，需要进行η变换
        if (firstType === "HANDLE" && ast.GetNode(first).type === "APPLICATION") {
            CompileComplexApplication(nodeHandle);
            return;
        }
        // 首项是合法的原子对象，包括变量、Native、Primitive、Lambda
        else if (["HANDLE", "VARIABLE", "KEYWORD"].indexOf(firstType) >= 0) {
            // 首先处理参数
            for (let i = 1; i < children.length; i++) { // 处理参数列表
                let child = children[i];
                let childType = TypeOfToken(child);
                if (childType === "HANDLE") {
                    let childNode = ast.GetNode(child);
                    if (childNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${child}`); // 返回闭包
                    }
                    else if (childNode.type === "QUOTE") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (childNode.type === "QUASIQUOTE") {
                        CompileQuasiquote(child);
                    }
                    else if (childNode.type === "STRING") {
                        AddInstruction(`push ${child}`);
                    }
                    else if (childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                        CompileApplication(child);
                    }
                    else {
                        throw `[Error] 意外的 child。`;
                    }
                }
                else if (["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                    if (child === "break" || child === "continue") {
                        let whileTags = Top(whileTagStack);
                        if (whileTags !== undefined) {
                            if (child === "break") {
                                AddInstruction(`goto ${whileTags[1]}`); // endTag
                            }
                            else {
                                AddInstruction(`goto ${whileTags[0]}`); // condTag
                            }
                        }
                        else {
                            throw `[Error] break或continue没有对应的while表达式。`;
                        }
                    }
                    else {
                        AddInstruction(`push ${child}`);
                    }
                }
                else if (childType === "VARIABLE") {
                    AddInstruction(`load ${child}`);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            // 处理调用。需要做这样几件事情：
            // 1、确保首项是合法的可调用项，变量、Native、Primitive、Lambda
            // 2、处理import的外部变量名称（Native不必处理，保留原形）
            //    TODO 外部变量的处理方式根据整个系统对多模块的支持方式不同而不同。这里采取的策略是：暂不处理，交给运行时的模块加载器去动态地处理。
            // 3、处理尾递归
            // Primitive
            if (firstType === "KEYWORD") {
                if (first === "break" || first === "continue") {
                    throw `[Error] break和continue不可出现在列表的第一项。`;
                }
                else if (first !== 'begin') { // begin不加入指令序列
                    if (first in PrimitiveInstruction) {
                        AddInstruction(`${PrimitiveInstruction[first]}`);
                    }
                    else {
                        AddInstruction(`${first}`);
                    }
                }
            }
            // 尾调用
            else if (ast.tailcall.indexOf(nodeHandle) >= 0) {
                if (firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`tailcall @${first}`);
                }
                else if (firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`tailcall ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
            else {
                if (firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`call @${first}`);
                }
                else if (firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`call ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
        }
        else {
            throw `[Error] 不可调用的首项。`;
        }
        AddInstruction(`;; 🛑 APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    // 开始编译整个AST
    function CompileAll() {
        // 注释
        AddInstruction(`;;`);
        AddInstruction(`;; Aurora Intermediate Language (AIL) Code`);
        AddInstruction(`;;   Module: ${ast.moduleID}`);
        AddInstruction(`;;   Generated by ASCompiler V0`); // TODO 编译器版本号
        AddInstruction(`;;`);
        // 程序入口（顶级Lambda）
        let topLambdaHandle = ast.lambdaHandles[0];
        AddInstruction(`;; 🐟🐟🐟🐟🐟 Program Entry 🐟🐟🐟🐟🐟`);
        AddInstruction(`call @${topLambdaHandle}`);
        AddInstruction(`halt`);
        AddInstruction(`;; 🐟🐟🐟🐟🐟  Program End  🐟🐟🐟🐟🐟`);
        AddInstruction(`;;`);
        // 从所有的Lambda节点开始顺序编译
        // 这类似于C语言，所有的函数都是顶级的
        for (let i = 0; i < ast.lambdaHandles.length; i++) {
            CompileLambda(ast.lambdaHandles[i]);
        }
    }
    // 开始编译，并组装成模块
    CompileAll();
    return ILCode;
}
// Linker.ts
// 模块链接器：从一份代码（文件或者字符串）出发，递归查找所有依赖模块，并将其全部链接为一个完整的模块
// 模块
class Module {
}
Module.AVM_Version = "V0"; // 指示可用的AVM版本
// 载入模块：本质上是静态链接
function LoadModule(modulePath, workingDir) {
    // 所有互相依赖的AST：{moduleID -> AST}
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    // 递归地引入所有依赖文件，并检测循环依赖
    (function importModule(modulePath, basePath) {
        // 将相对路径拼接为绝对路径
        if (PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(basePath, modulePath);
        }
        let code;
        try {
            code = FileUtils.ReadFileSync(modulePath);
        }
        catch (_a) {
            throw `[Error] 模块“${modulePath}”未找到。`;
        }
        code = `((lambda () ${code}))\n`;
        let currentAST = Analyse(Parse(code, modulePath));
        let moduleID = PathUtils.PathToModuleID(modulePath);
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, currentBasePath);
        }
    })(modulePath, workingDir);
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    let mainModuleID = PathUtils.PathToModuleID(modulePath);
    mergedModule.AST = allASTs.get(mainModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === mainModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    // mergedModule.Components = sortedModuleIDs;
    return mergedModule;
}
// 用于fork指令：从某个Application节点开始，构建模块
// TODO 这个函数实现不够优雅，待改进
function LoadModuleFromNode(ast, nodeHandle, workingDir) {
    // 所有互相依赖的AST
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    let mainModuleID = `${ast.moduleID}.forked`;
    let currentAST = ast.Copy();
    // 将目标节点移到顶级作用域
    let topLambdaNodeHandle = currentAST.GetNode(currentAST.TopApplicationNodeHandle()).children[0];
    let temp = currentAST.GetNode(topLambdaNodeHandle).children;
    // 将所在AST的顶级作用域的(define ..)搬迁到顶级作用域
    let temp2 = new Array();
    for (let i = 2; i < temp.length; i++) {
        if (TypeOfToken(temp[i]) === "HANDLE") {
            let childNode = currentAST.GetNode(temp[i]);
            if (childNode.type === "APPLICATION" && childNode.children[0] === "define") {
                temp2.push(temp[i]);
            }
        }
    }
    temp2.push(nodeHandle);
    currentAST.GetNode(topLambdaNodeHandle).children = temp.slice(0, 2).concat(temp2);
    allASTs.set(mainModuleID, currentAST);
    for (let alias in currentAST.dependencies) {
        let dependencyPath = currentAST.dependencies.get(alias);
        dependencyGraph.push([
            mainModuleID,
            PathUtils.PathToModuleID(dependencyPath)
        ]);
        // 检测是否有循环依赖
        sortedModuleIDs = TopologicSort(dependencyGraph);
        if (sortedModuleIDs === undefined) {
            throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
        }
        importModule(dependencyPath, workingDir);
    }
    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(modulePath, basePath) {
        // 将相对路径拼接为绝对路径
        if (PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(workingDir, modulePath);
        }
        let code;
        try {
            code = FileUtils.ReadFileSync(modulePath);
        }
        catch (_a) {
            throw `[Error] 模块“${modulePath}”未找到。`;
        }
        code = `((lambda () ${code}))\n`;
        let currentAST = Analyse(Parse(code, modulePath));
        let moduleID = PathUtils.PathToModuleID(modulePath);
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, currentBasePath);
        }
    }
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    mergedModule.AST = allASTs.get(mainModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === mainModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    // mergedModule.Components = sortedModuleIDs;
    return mergedModule;
}
// 直接从代码构建模块：用于REPL、eval(code)、直接解释小段代码等场合
// 其中virtualDir用于确定模块的ID
function LoadModuleFromCode(code, virtualDir) {
    // 所有互相依赖的AST
    let allASTs = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleIDs = new Array();
    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(pathOrCode, isPath, basePath) {
        let code;
        let moduleID;
        let modulePath;
        if (isPath) {
            try {
                // 将相对路径拼接为绝对路径
                modulePath = pathOrCode;
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    modulePath = PathUtils.Join(basePath, modulePath);
                }
                code = FileUtils.ReadFileSync(modulePath);
                code = `((lambda () ${code}))\n`;
            }
            catch (_a) {
                throw `[Error] 模块“${modulePath}”未找到。`;
            }
        }
        else {
            modulePath = virtualDir;
            code = pathOrCode;
        }
        moduleID = PathUtils.PathToModuleID(modulePath);
        let currentAST = Analyse(Parse(code, modulePath));
        allASTs.set(moduleID, currentAST);
        for (let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleID,
                PathUtils.PathToModuleID(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleIDs = TopologicSort(dependencyGraph);
            if (sortedModuleIDs === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            // 递归引入下一层依赖，其中基准路径为当前遍历的模块的dirname
            let currentBasePath = PathUtils.DirName(dependencyPath);
            importModule(dependencyPath, true, currentBasePath);
        }
    }
    importModule(code, false, virtualDir);
    // 对每个AST中使用的 外部模块引用 作换名处理
    for (let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);
        currentAST.nodes.ForEach((nodeHandle) => {
            let node = currentAST.nodes.Get(nodeHandle);
            if (node.type === "LAMBDA" || node.type === "APPLICATION") {
                for (let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if (isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if (prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.PathToModuleID(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }
    // 将AST融合起来，编译为单一模块
    let mergedModule = new Module();
    let replModuleID = PathUtils.PathToModuleID(virtualDir);
    mergedModule.AST = allASTs.get(replModuleID);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for (let i = sortedModuleIDs.length - 1; i >= 0; i--) {
        let mdID = sortedModuleIDs[i];
        if (mdID === replModuleID)
            continue;
        mergedModule.AST.MergeAST(allASTs.get(mdID), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    return mergedModule;
}
// 对依赖关系图作拓扑排序，进而检测是否存在环路
function TopologicSort(dependencyGraph) {
    // 建立邻接表和模块名称表
    let moduleNameDict = new HashMap();
    for (let i = 0; i < dependencyGraph.length; i++) {
        moduleNameDict[dependencyGraph[i][0]] = 0;
        moduleNameDict[dependencyGraph[i][1]] = 0;
    }
    let counter = 0;
    let moduleName = new Array();
    for (let n in moduleNameDict) {
        moduleNameDict[n] = counter;
        moduleName[counter] = n;
        counter++;
    }
    let adjMatrix = new Array();
    for (let i = 0; i < counter; i++) {
        let init = new Array();
        for (let j = 0; j < counter; j++) {
            init[j] = false;
        }
        adjMatrix[i] = init;
    }
    for (let i = 0; i < dependencyGraph.length; i++) {
        let left = moduleNameDict[dependencyGraph[i][0]];
        let right = moduleNameDict[dependencyGraph[i][1]];
        adjMatrix[left][right] = true;
    }
    // 拓扑排序
    let hasLoop = false;
    let sortedModuleIndex = new Array();
    (function sort(adjMatrix) {
        // 计算某节点入度
        function getInDegree(vertex, adjMatrix) {
            let count = 0;
            if (!(adjMatrix[vertex])) {
                return -1;
            }
            for (let i = 0; i < adjMatrix[vertex].length; i++) {
                if (adjMatrix[vertex][i] === true)
                    count++;
            }
            return count;
        }
        while (sortedModuleIndex.length < adjMatrix.length) {
            // 计算入度为0的点
            let zeroInDegVertex = null;
            for (let i = 0; i < adjMatrix.length; i++) {
                let indeg = getInDegree(i, adjMatrix);
                if (indeg === 0) {
                    zeroInDegVertex = i;
                    break;
                }
            }
            if (zeroInDegVertex === null) {
                hasLoop = true;
                return;
            }
            sortedModuleIndex.push(zeroInDegVertex);
            // 删除这个点
            for (let i = 0; i < adjMatrix.length; i++) {
                if (!(adjMatrix[i])) {
                    continue;
                }
                adjMatrix[i][zeroInDegVertex] = false;
            }
            adjMatrix[zeroInDegVertex] = undefined;
        }
    })(adjMatrix);
    if (hasLoop) {
        return undefined;
    }
    else {
        let sortedModuleName = new Array();
        for (let i = 0; i < sortedModuleIndex.length; i++) {
            sortedModuleName[i] = moduleName[sortedModuleIndex[i]];
        }
        return sortedModuleName;
    }
}
// Process.ts
// 进程数据结构
// 栈帧
class StackFrame {
    constructor(closureHandle, target) {
        this.closureHandle = closureHandle;
        this.returnTargetAddress = target;
    }
}
// 进程状态枚举
var ProcessState;
(function (ProcessState) {
    ProcessState["READY"] = "READY";
    ProcessState["RUNNING"] = "RUNNING";
    ProcessState["SLEEPING"] = "SLEEPING";
    ProcessState["SUSPENDED"] = "SUSPENDED";
    ProcessState["STOPPED"] = "STOPPED";
})(ProcessState || (ProcessState = {}));
class Process {
    /* 构造器 */
    // TODO 待实现，目前仅供测试
    constructor(modul) {
        // 执行机核心：栈、闭包和续延
        this.PC = 0; // 程序计数器（即当前执行的指令索引）
        this.PID = 0;
        this.parentPID = 0;
        this.state = ProcessState.READY;
        this.AST = modul.AST;
        this.instructions = modul.ILCode;
        this.labelMapping = new HashMap();
        this.heap = new Memory();
        this.PC = 0;
        this.currentClosureHandle = TOP_NODE_HANDLE;
        this.OPSTACK = new Array();
        this.FSTACK = new Array();
        //////////////////////////////
        //  TODO 进程初始化
        //////////////////////////////
        // AST中的静态对象移动到heap中
        // TODO：建议深拷贝
        this.heap = this.AST.nodes;
        // 标签分析
        this.LabelAnalysis();
        // 顶级闭包
        this.heap.NewHandle(TOP_NODE_HANDLE);
        this.heap.Set(TOP_NODE_HANDLE, new Closure(-1, TOP_NODE_HANDLE));
    }
    /* 栈和闭包操作 */
    // 向操作数栈中压入值
    PushOperand(value) {
        this.OPSTACK.push(value);
    }
    // 从操作数栈中弹出一个值
    PopOperand() {
        return this.OPSTACK.pop();
    }
    // 压入函数调用栈帧
    PushStackFrame(closureHandle, returnTarget) {
        let sf = new StackFrame(closureHandle, returnTarget);
        this.FSTACK.push(sf);
    }
    // 弹出函数调用栈帧
    PopStackFrame() {
        return this.FSTACK.pop();
    }
    // 新建闭包并返回把柄
    NewClosure(instructionAddress, parent) {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.heap.AllocateHandle("CLOSURE");
        // 新建一个空的闭包对象
        let closure = new Closure(instructionAddress, parent);
        // 存到堆区
        this.heap.Set(newClosureHandle, closure);
        return newClosureHandle;
    }
    // 根据闭包把柄获取闭包
    GetClosure(closureHandle) {
        return this.heap.Get(closureHandle);
    }
    // 获取进程的当前闭包
    GetCurrentClosure() {
        return this.heap.Get(this.currentClosureHandle);
    }
    // 设置进程的当前闭包
    SetCurrentClosure(closureHandle) {
        this.currentClosureHandle = closureHandle;
    }
    // 变量解引用（解引/用引）
    Dereference(variableName) {
        let currentClosure = this.GetCurrentClosure();
        // 查找约束变量
        if (currentClosure.HasBoundVariable(variableName)) {
            return currentClosure.GetBoundVariable(variableName);
        }
        // 查找自由变量：上溯闭包，找到词法定义环境（约束变量绑定所在的闭包），根据脏标记状态决定选取 当前闭包的自由变量取值 或者 词法定义环境的约束变量取值
        let closureHandle = this.currentClosureHandle;
        let closure = null;
        while (closureHandle !== TOP_NODE_HANDLE) {
            closure = this.GetClosure(closureHandle);
            if (closure.HasBoundVariable(variableName)) {
                // 检查脏标记：如果约束变量绑定带了脏标记，意味着这个变量已经在其他衍生环境中被修改（并波及到词法定义位置），因此需要使用约束变量绑定中的（新）值
                if (closure.IsDirtyVariable(variableName)) {
                    return closure.GetBoundVariable(variableName);
                }
                else {
                    if (currentClosure.HasFreeVariable(variableName)) {
                        return currentClosure.GetFreeVariable(variableName);
                    }
                    else {
                        throw `[Error] 自由变量'${variableName}' at Closure${closureHandle}不存在（不合理的情况）`;
                    }
                }
            }
            closureHandle = closure.parent;
        }
        throw `[Error] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }
    GC() {
        // NOTE 可达性分析的根节点有哪些？
        // - 当前闭包
        // - 当前闭包和函数调用栈对应闭包内的变量绑定
        // - 操作数栈内的把柄
        // - 函数调用栈内所有栈帧对应的闭包把柄
        // - 所有continuation中保留的上面的各项
        let gcroots = new Array();
        let currentProcess = this;
        function GCRoot(currentClosureHandle, OPSTACK, FSTACK) {
            let currentClosure = currentProcess.heap.Get(currentClosureHandle);
            gcroots.push(currentClosureHandle);
            for (let bound in currentClosure.boundVariables) {
                let boundValue = currentClosure.GetBoundVariable(bound);
                if (TypeOfToken(boundValue) === "HANDLE") {
                    gcroots.push(boundValue);
                }
            }
            for (let free in currentClosure.freeVariables) {
                let freeValue = currentClosure.GetFreeVariable(free);
                if (TypeOfToken(freeValue) === "HANDLE") {
                    gcroots.push(freeValue);
                }
            }
            for (let r of OPSTACK) {
                if (TypeOfToken(r) === "HANDLE") {
                    gcroots.push(r);
                }
            }
            for (let f of FSTACK) {
                let closure = currentProcess.heap.Get(f.closureHandle);
                if (closure.type === "CLOSURE") {
                    gcroots.push(f.closureHandle);
                    let currentClosure = closure;
                    for (let bound in currentClosure.boundVariables) {
                        let boundValue = currentClosure.GetBoundVariable(bound);
                        if (TypeOfToken(boundValue) === "HANDLE") {
                            gcroots.push(boundValue);
                        }
                    }
                    for (let free in currentClosure.freeVariables) {
                        let freeValue = currentClosure.GetFreeVariable(free);
                        if (TypeOfToken(freeValue) === "HANDLE") {
                            gcroots.push(freeValue);
                        }
                    }
                }
            }
        }
        // 分析虚拟机基础环境中的GC根
        GCRoot(this.currentClosureHandle, this.OPSTACK, this.FSTACK);
        this.heap.ForEach((hd) => {
            let obj = this.heap.Get(hd);
            if (obj.type === "CONTINUATION") {
                // 获取续体，并反序列化之
                let cont = obj;
                let newConfiguration = JSON.parse(cont.partialEnvironmentJson);
                // 将续体内部环境加入GC根
                GCRoot(newConfiguration.currentClosureHandle, newConfiguration.OPSTACK, newConfiguration.FSTACK);
            }
            else
                return;
        });
        // 仅标记列表和字符串，不处理闭包和续延。清除也是。
        let alives = new HashMap();
        let thisProcess = this;
        function GCMark(handle) {
            if (alives.has(handle))
                return;
            if (TypeOfToken(handle) !== "HANDLE")
                return;
            else if (thisProcess.heap.HasHandle(handle) !== true)
                return; // 被清理掉的对象
            let obj = thisProcess.heap.Get(handle);
            if (obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "APPLICATION") {
                alives.set(handle, true);
                for (let child of obj.children) {
                    GCMark(child);
                }
            }
            else if (obj.type === "STRING") {
                alives.set(handle, true);
            }
            else if (obj.type === "CLOSURE") {
                alives.set(handle, true);
                let currentClosure = obj;
                GCMark(currentClosure.parent);
                for (let bound in currentClosure.boundVariables) {
                    let boundValue = currentClosure.GetBoundVariable(bound);
                    if (TypeOfToken(boundValue) === "HANDLE") {
                        GCMark(boundValue);
                    }
                }
                for (let free in currentClosure.freeVariables) {
                    let freeValue = currentClosure.GetFreeVariable(free);
                    if (TypeOfToken(freeValue) === "HANDLE") {
                        GCMark(freeValue);
                    }
                }
            }
        }
        for (let root of gcroots) {
            GCMark(root);
        }
        // 清理
        let gcount = 0;
        let count = 0;
        this.heap.ForEach((hd) => {
            count++;
            let obj = this.heap.Get(hd);
            let isStatic = (this.heap.metadata.get(hd).charAt(0) === "S");
            if (isStatic)
                return;
            else if (obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "STRING" || obj.type === "CLOSURE") {
                if (alives.get(hd) !== true) {
                    this.heap.DeleteHandle(hd);
                    // console.info(`[GC] 回收对象 ${hd}。`);
                    gcount++;
                }
            }
            else
                return;
        });
        if (ANIMAC_CONFIG.is_debug === true && gcount > 0) {
            console.info(`[GC] 已回收 ${gcount} / ${count} 个对象。`);
        }
    }
    /* 程序流程控制 */
    // 获取并解析当前指令
    CurrentInstruction() {
        let instString = (this.instructions)[this.PC];
        return new Instruction(instString);
    }
    // 解析标签为指令索引（地址）
    GetLabelAddress(label) {
        return this.labelMapping.get(label);
    }
    // 前进一步（PC加一）
    Step() {
        this.PC++;
    }
    // 前进一步跳转到（PC置数）
    Goto(instructionAddress) {
        this.PC = instructionAddress;
    }
    // 捕获当前续延并返回其把柄
    CaptureContinuation(contReturnTargetLable) {
        // 首先保存当前的（部分）进程环境
        let partialEnvironment = {
            currentClosureHandle: this.currentClosureHandle,
            OPSTACK: this.OPSTACK,
            FSTACK: this.FSTACK
        };
        // 新建续延对象
        let cont = new Continuation(partialEnvironment, contReturnTargetLable);
        // 分配一个续延把柄
        let contHandle = this.heap.AllocateHandle("CONTINUATION");
        // 将续延存到堆区
        this.heap.Set(contHandle, cont);
        return contHandle;
    }
    // 恢复指定的续延，并返回其返回目标位置的标签
    LoadContinuation(continuationHandle) {
        // 获取续延，并反序列化之
        let cont = this.heap.Get(continuationHandle);
        let newConfiguration = JSON.parse(cont.partialEnvironmentJson);
        // 恢复续延保存的环境
        this.currentClosureHandle = newConfiguration.currentClosureHandle;
        this.OPSTACK = newConfiguration.OPSTACK;
        this.FSTACK = newConfiguration.FSTACK;
        // 返回续延的返回位置标签
        return cont.contReturnTargetLable;
    }
    /* 反射相关 */
    // 中间语言指令序列的标签分析
    LabelAnalysis() {
        for (let i = 0; i < this.instructions.length; i++) {
            if ((this.instructions[i].trim())[0] === "@") {
                this.labelMapping.set(this.instructions[i].trim(), i);
            }
        }
    }
    /* 进程状态控制 */
    // 设置进程状态
    SetState(pstate) {
        this.state = pstate;
    }
}
// Runtime.ts
// 运行时环境
var VMState;
(function (VMState) {
    VMState["IDLE"] = "IDLE";
    VMState["RUNNING"] = "RUNNING";
})(VMState || (VMState = {}));
class Runtime {
    constructor(workingDir) {
        this.tickCounter = 0; // 虚拟机调度机计数器：用于计量时间片切换（Tick）的次数
        this.gcTimestamp = 0; // GC时间戳：用于控制GC的时间频率
        this.processPool = new Array();
        this.processQueue = new Array();
        this.ports = new HashMap();
        this.outputFIFO = new Array();
        this.errorFIFO = new Array();
        this.workingDir = workingDir;
        this.callbackOnTick = (rt) => null;
        this.callbackOnEvent = (rt) => null;
        this.callbackOnHalt = (rt) => null;
        this.callbackOnError = (rt) => null;
    }
    AllocatePID() {
        return this.processPool.length;
    }
    AddProcess(p) {
        // 检查是否已存在此线程
        if (this.processPool[p.PID] === undefined) {
            this.processPool[p.PID] = p;
        }
        this.processQueue.push(p.PID); // 加入队尾
        return p.PID;
    }
    //=================================================================
    //                       以下是进程调度器
    //=================================================================
    Tick(timeslice) {
        if (this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        // 取出队头线程
        let currentPID = this.processQueue.shift();
        let currentProcess = this.processPool[currentPID];
        currentProcess.state = ProcessState.RUNNING;
        // 执行时间片
        while (timeslice >= 0) {
            this.Execute(currentProcess, this);
            timeslice--;
            if (currentProcess.state === ProcessState.RUNNING) {
                continue;
            }
            else if (currentProcess.state === ProcessState.SLEEPING) {
                break;
            }
            else if (currentProcess.state === ProcessState.STOPPED) {
                // TODO REPL不能清理
                // delete this.processPool[currentPID]; // 清理掉执行完的进程
                break;
            }
        }
        // 后处理
        if (currentProcess.state === ProcessState.RUNNING) {
            // 仍在运行的进程加入队尾
            currentProcess.state = ProcessState.READY;
            this.processQueue.push(currentPID);
        }
        this.callbackOnTick(this);
        if (this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        else {
            return VMState.RUNNING;
        }
    }
    StartClock() {
        /* NOTE 【执行时钟设计说明】为什么要用setInterval？
            设想两个进程，其中一个是常驻的无限循环进程，另一个是需要执行某Node.js异步操作的进程。
            根据Node.js的事件循环特性，如果单纯使用while(1)实现，则异步操作永远得不到执行。
            但如果单纯用setInterval实现，则性能极差。
            那么可以折中一下：
            程序的执行，在一个短的时间周期内（称为计算周期ComputingPhase），使用while()循环全力计算。
            全力计算一段时间后，由setInterval控制，结束当前计算周期，给异步事件处理的机会。
            计算周期的长度COMPUTATION_PHASE_LENGTH决定了VM的性能，以及异步事件响应的速度。
            如果COMPUTATION_PHASE_LENGTH=1，则退化为完全由setInterval控制的执行时钟，性能最差。
            如果COMPUTATION_PHASE_LENGTH=∞，则退化为完全由while控制的执行时钟，性能最佳，但异步事件得不到执行。
        */
        function Run() {
            let vmState = VMState.IDLE;
            let COMPUTATION_PHASE_LENGTH = 100; // TODO 这个值可以调整
            while (COMPUTATION_PHASE_LENGTH >= 0) {
                vmState = this.Tick(1000);
                this.tickCounter++;
                COMPUTATION_PHASE_LENGTH--;
                if (vmState === VMState.IDLE) {
                    break;
                }
            }
            // 对所有进程执行垃圾回收
            let currentTimestamp = Date.now();
            if (ANIMAC_CONFIG.is_gc_enabled === true && currentTimestamp - this.gcTimestamp > ANIMAC_CONFIG.gc_interval) {
                this.gcTimestamp = currentTimestamp;
                for (let i = 0; i < this.processQueue.length; i++) {
                    let pid = this.processQueue[i];
                    let process = this.processPool[pid];
                    process.GC();
                    // console.log(`[GC] 进程${pid}已完成GC`);
                }
            }
            return vmState;
        }
        let CLOCK = setInterval(() => {
            try {
                let vmState = Run.call(this);
                this.callbackOnEvent(this);
                if (vmState === VMState.IDLE) {
                    clearInterval(CLOCK);
                    this.callbackOnHalt(this);
                }
            }
            catch (e) {
                this.Error(e.toString());
                this.Error(`\n`);
                this.callbackOnError(this);
            }
        }, 0);
    }
    //=================================================================
    //                      以下是控制台输入输出
    //=================================================================
    Output(str) {
        StdIOUtils.stdout(str);
        this.outputFIFO.push(str);
    }
    Error(str) {
        StdIOUtils.stderr(str);
        this.errorFIFO.push(str);
    }
    //=================================================================
    //                  以下是AIL指令实现（封装成函数）
    //=================================================================
    ///////////////////////////////////////
    // 第一类：基本存取指令
    ///////////////////////////////////////
    // store variable 将OP栈顶对象保存到当前闭包的约束变量中
    AIL_STORE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] store指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.PopOperand();
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, value);
        PROCESS.Step();
    }
    // load variable 解引用变量，并将对象压入OP栈顶
    AIL_LOAD(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] load指令参数类型不是变量`;
        }
        let variable = argument;
        let value = PROCESS.Dereference(variable);
        let valueType = TypeOfToken(value);
        // 值为标签，即loadclosure。
        if (valueType === 'LABEL') {
            let label = value;
            let instAddress = PROCESS.GetLabelAddress(label);
            let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
            let currentClosure = PROCESS.GetCurrentClosure();
            for (let v in currentClosure.freeVariables) {
                let value = currentClosure.GetFreeVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            for (let v in currentClosure.boundVariables) {
                let value = currentClosure.GetBoundVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            PROCESS.PushOperand(newClosureHandle);
            PROCESS.Step();
        }
        else {
            PROCESS.PushOperand(value);
            PROCESS.Step();
        }
    }
    // loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
    AIL_LOADCLOSURE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] loadclosure指令参数类型不是标签`;
        }
        let label = argument;
        let instAddress = PROCESS.GetLabelAddress(label);
        let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
        let currentClosure = PROCESS.GetCurrentClosure();
        for (let v in currentClosure.freeVariables) {
            let value = currentClosure.GetFreeVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        for (let v in currentClosure.boundVariables) {
            let value = currentClosure.GetBoundVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        PROCESS.PushOperand(newClosureHandle);
        PROCESS.Step();
    }
    // push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
    AIL_PUSH(argument, PROCESS, RUNTIME) {
        // 允许所有类型的参数
        PROCESS.PushOperand(argument);
        PROCESS.Step();
    }
    // pop 弹出并抛弃OP栈顶
    AIL_POP(argument, PROCESS, RUNTIME) {
        PROCESS.PopOperand();
        PROCESS.Step();
    }
    // swap 交换OP栈顶的两个对象的顺序
    AIL_SWAP(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        PROCESS.PushOperand(top1);
        PROCESS.PushOperand(top2);
        PROCESS.Step();
    }
    // set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）
    AIL_SET(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] set指令参数类型不是变量`;
        }
        let variable = argument;
        let rightValue = PROCESS.PopOperand();
        // 修改当前闭包内部的绑定
        let currentClosure = PROCESS.GetCurrentClosure();
        if (currentClosure.HasFreeVariable(variable)) {
            PROCESS.GetCurrentClosure().SetFreeVariable(variable, rightValue); // 带脏标记
        }
        // 沿闭包链上溯，直到找到该变量的词法定义环境（作为约束变量所在的上级闭包），修改绑定
        let currentClosureHandle = PROCESS.currentClosureHandle;
        while (currentClosureHandle !== TOP_NODE_HANDLE && PROCESS.heap.HasHandle(currentClosureHandle)) {
            let currentClosure = PROCESS.GetClosure(currentClosureHandle);
            if (currentClosure.HasBoundVariable(variable)) {
                PROCESS.GetClosure(currentClosureHandle).SetBoundVariable(variable, rightValue); // 带脏标记
                break;
            }
            currentClosureHandle = currentClosure.parent;
        }
        PROCESS.Step();
    }
    ///////////////////////////////////////
    // 第二类：分支跳转指令
    ///////////////////////////////////////
    // 辅助函数：本地宿主函数调用
    CallNative(target, PROCESS, RUNTIME) {
        // NOTE native不压栈帧
        let nativeModuleName = target.split(".")[0];
        let nativeFunctionName = target.split(".").slice(1).join("");
        if (ANIMAC_CONFIG.env_type === "cli") {
            // 引入Native模块
            let nativeModulePath = PathUtils.Join(PathUtils.cwd(), `lib/${nativeModuleName}.js`);
            let nativeModule = require(nativeModulePath);
            // 调用Native模块内部的函数
            (nativeModule[nativeFunctionName])(PROCESS, RUNTIME);
        }
        else if (ANIMAC_CONFIG.env_type === "web") {
            // 引入Native模块
            let nativeModulePath = `/lib/${nativeModuleName}.js`;
            let nativeModule = RequireNative(nativeModuleName, ANIMAC_VFS[nativeModulePath]);
            // 调用Native模块内部的函数
            (nativeModule[nativeFunctionName])(PROCESS, RUNTIME);
        }
        else {
            throw "error: unknown env type.";
        }
    }
    // 辅助函数：可以任意指定返回指令地址的函数调用（非尾调用）。这一函数用于支持异步过程调用（如事件回调），同时也用于实现普通的同步过程调用。
    CallAsync(returnTarget, argument, PROCESS, RUNTIME) {
        let target;
        if (TypeOfToken(argument) === "VARIABLE") {
            // 首先判断是否为Native调用
            let variable = argument;
            if (PROCESS.AST.IsNativeCall(variable)) {
                this.CallNative(variable, PROCESS, RUNTIME);
                return;
            }
            else {
                target = PROCESS.Dereference(variable);
            }
        }
        else {
            target = argument;
        }
        let targetType = TypeOfToken(target);
        if (PROCESS.AST.IsNativeCall(target)) {
            this.CallNative(target, PROCESS, RUNTIME);
            return;
        }
        else if (targetType === "KEYWORD") {
            // NOTE primitive不压栈帧
            let mnemonic = PrimitiveInstruction[target] || target;
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
        else if (targetType === "LABEL") {
            PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
            let instructionAddress = PROCESS.GetLabelAddress(target);
            let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
            let currentClosure = PROCESS.GetCurrentClosure();
            for (let v in currentClosure.freeVariables) {
                let value = currentClosure.GetFreeVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            for (let v in currentClosure.boundVariables) {
                let value = currentClosure.GetBoundVariable(v);
                PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
            }
            PROCESS.SetCurrentClosure(newClosureHandle);
            PROCESS.Goto(instructionAddress);
        }
        else if (targetType === "HANDLE") {
            let handle = target;
            let obj = PROCESS.heap.Get(handle);
            let objType = obj.type;
            // 闭包：函数实例
            if (objType === SchemeObjectType.CLOSURE) {
                PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
                let targetClosure = obj;
                PROCESS.SetCurrentClosure(handle);
                PROCESS.Goto(targetClosure.instructionAddress);
            }
            // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
            else if (objType === SchemeObjectType.CONTINUATION) {
                PROCESS.PushStackFrame(PROCESS.currentClosureHandle, returnTarget); // 新的栈帧入栈
                let top = PROCESS.PopOperand();
                let returnTargetLabel = PROCESS.LoadContinuation(handle);
                PROCESS.PushOperand(top);
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
            }
        }
        else {
            throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
        }
    }
    //call arg 函数调用（包括continuation、native函数）
    AIL_CALL(argument, PROCESS, RUNTIME) {
        this.CallAsync(PROCESS.PC + 1, argument, PROCESS, RUNTIME);
    }
    //tailcall arg 函数尾调用
    AIL_TAILCALL(argument, PROCESS, RUNTIME) {
        // 与call唯一的不同就是调用前不压栈帧，所以下面这坨代码是可以整体复用的
        let target;
        if (TypeOfToken(argument) === "VARIABLE") {
            // 首先判断是否为Native调用
            let variable = argument;
            if (PROCESS.AST.IsNativeCall(variable)) {
                this.CallNative(variable, PROCESS, RUNTIME);
                return;
            }
            else {
                target = PROCESS.Dereference(variable);
            }
        }
        else {
            target = argument;
        }
        let targetType = TypeOfToken(target);
        if (PROCESS.AST.IsNativeCall(target)) {
            this.CallNative(target, PROCESS, RUNTIME);
            return;
        }
        else if (targetType === "KEYWORD") {
            // NOTE primitive不压栈帧
            let mnemonic = PrimitiveInstruction[target] || target;
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
        else if (targetType === "LABEL") {
            let instructionAddress = PROCESS.GetLabelAddress(target);
            let currentClosure = PROCESS.GetCurrentClosure();
            if (currentClosure.instructionAddress !== instructionAddress) {
                let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
                for (let v in currentClosure.freeVariables) {
                    let value = currentClosure.GetFreeVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                for (let v in currentClosure.boundVariables) {
                    let value = currentClosure.GetBoundVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                PROCESS.SetCurrentClosure(newClosureHandle);
            }
            PROCESS.Goto(instructionAddress);
        }
        else if (targetType === "HANDLE") {
            let handle = target;
            let obj = PROCESS.heap.Get(handle);
            let objType = obj.type;
            // 闭包：函数实例
            if (objType === SchemeObjectType.CLOSURE) {
                let targetClosure = obj;
                PROCESS.SetCurrentClosure(handle);
                PROCESS.Goto(targetClosure.instructionAddress);
            }
            // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
            else if (objType === SchemeObjectType.CONTINUATION) {
                let top = PROCESS.PopOperand();
                let returnTargetLabel = PROCESS.LoadContinuation(handle);
                PROCESS.PushOperand(top);
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
            }
        }
        else {
            throw `[Error] call指令的参数必须是标签、闭包或Continuation`;
        }
    }
    //return 函数返回
    AIL_RETURN(argument, PROCESS, RUNTIME) {
        let stackframe = PROCESS.PopStackFrame(); // 栈帧退栈
        PROCESS.SetCurrentClosure(stackframe.closureHandle); // 修改当前闭包
        PROCESS.Goto(stackframe.returnTargetAddress); // 跳转到返回地址
        stackframe = null; // 销毁当前栈帧
    }
    //capturecc variable 捕获当前Continuation并将其把柄保存在变量中
    AIL_CAPTURECC(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'VARIABLE') {
            throw `[Error] capturecc指令参数类型不是变量`;
        }
        let variable = argument;
        let retTargetLable = `@${variable}`; // NOTE【约定】cont返回点的标签名称 = @ + cont被保存的变量名称
        let contHandle = PROCESS.CaptureContinuation(retTargetLable);
        // console.info(`[Info] Continuation ${variable} 已捕获，对应的返回标签 ${retTargetLable}`);
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, contHandle);
        PROCESS.Step();
    }
    //iftrue label 如果OP栈顶条件不为false则跳转
    AIL_IFTRUE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] iftrue指令的参数必须是标签`;
        }
        let label = argument;
        let condition = PROCESS.PopOperand();
        if (condition !== '#f') {
            let targetAddress = PROCESS.GetLabelAddress(label);
            PROCESS.Goto(targetAddress);
        }
        else {
            PROCESS.Step();
        }
    }
    //iffalse label 如果OP栈顶条件为false则跳转
    AIL_IFFALSE(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] iffalse指令的参数必须是标签`;
        }
        let label = argument;
        let condition = PROCESS.PopOperand();
        if (condition === '#f') {
            let targetAddress = PROCESS.GetLabelAddress(label);
            PROCESS.Goto(targetAddress);
        }
        else {
            PROCESS.Step();
        }
    }
    //goto label 无条件跳转
    AIL_GOTO(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType !== 'LABEL') {
            throw `[Error] goto指令的参数必须是标签`;
        }
        let label = argument;
        let targetAddress = PROCESS.GetLabelAddress(label);
        PROCESS.Goto(targetAddress);
    }
    ///////////////////////////////////////
    // 第三类：列表操作指令
    ///////////////////////////////////////
    // car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
    AIL_CAR(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let firstElement = listObj.children[0];
                PROCESS.PushOperand(firstElement);
                PROCESS.Step();
            }
            else {
                throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    // cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
    AIL_CDR(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if (listObj.children.length <= 0) {
                    throw `[Error] cdr参数不能是空表。`;
                }
                let newListHandle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList;
                if (listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(1);
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    // cons 同Scheme的cons
    AIL_CONS(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand();
        let firstElement = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let newListHandle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList;
                if (listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(); // 复制数组
                newList.children.unshift(firstElement); // 并在左侧插入元素
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }
    ///////////////////////////////////////
    // 第四类：算术逻辑运算和谓词
    ///////////////////////////////////////
    // add 实数加法
    AIL_ADD(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 + operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // sub 实数减法
    AIL_SUB(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 - operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // mul 实数乘法
    AIL_MUL(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 * operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // div 实数除法
    AIL_DIV(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            if (operand1 <= Number.EPSILON && operand1 >= -Number.EPSILON) {
                throw `[Error] 除零`;
            }
            let result = operand2 / operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // mod 求余
    AIL_MOD(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = operand2 % operand1;
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // pow 求幂
    AIL_POW(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = Math.pow(operand2, operand1);
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // eqn =
    AIL_EQN(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (Math.abs(operand2 - operand1) <= Number.EPSILON) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // ge >=
    AIL_GE(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 >= operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // le <=
    AIL_LE(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 <= operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // gt >
    AIL_GT(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 > operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // lt <
    AIL_LT(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if (TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            let result = (operand2 < operand1) ? "#t" : "#f";
            PROCESS.PushOperand(result);
            PROCESS.Step();
        }
        else {
            throw `[Error] 指令参数类型不正确`;
        }
    }
    // not
    AIL_NOT(argument, PROCESS, RUNTIME) {
        let top = PROCESS.PopOperand();
        PROCESS.PushOperand((top === "#f") ? "#t" : "#f");
        PROCESS.Step();
    }
    // and
    AIL_AND(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (top1 === "#f" || top2 === "#f") {
            PROCESS.PushOperand("#f");
        }
        else {
            PROCESS.PushOperand("#t");
        }
        PROCESS.Step();
    }
    // or
    AIL_OR(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (top1 !== "#f" && top2 !== "#f") {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // eq?
    // TODO eq?的逻辑需要进一步精确化
    AIL_ISEQ(argument, PROCESS, RUNTIME) {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if (String(top1) === String(top2)) {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // null?
    AIL_ISNULL(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if (listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if (listObj.children.length <= 0) {
                    PROCESS.PushOperand("#t");
                }
                else {
                    PROCESS.PushOperand("#f");
                }
            }
            else {
                PROCESS.PushOperand("#f");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // atom?
    AIL_ISATOM(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            PROCESS.PushOperand("#f");
        }
        else {
            PROCESS.PushOperand("#t");
        }
        PROCESS.Step();
    }
    // list?
    AIL_ISLIST(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if (listObj.type === "STRING") {
                PROCESS.PushOperand("#f");
            }
            else {
                PROCESS.PushOperand("#t");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    // number?
    AIL_ISNUMBER(argument, PROCESS, RUNTIME) {
        let arg = PROCESS.PopOperand();
        if (TypeOfToken(arg) === 'NUMBER') {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }
    ///////////////////////////////////////
    // 第五类：其他指令
    ///////////////////////////////////////
    // fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
    AIL_FORK(argument, PROCESS, RUNTIME) {
        let argType = TypeOfToken(argument);
        if (argType === "HANDLE") {
            let node = PROCESS.heap.Get(argument);
            if (node.type === "APPLICATION") {
                let basePath = PathUtils.DirName(PROCESS.AST.absolutePath);
                let modul = LoadModuleFromNode(PROCESS.AST, argument, basePath);
                let newProcess = new Process(modul);
                // 分配新的PID
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else if (node.type === "STRING") {
                let modulePath = TrimQuotes(node.content);
                // 将相对路径拼接为绝对路径
                let basePath = PathUtils.DirName(PROCESS.AST.absolutePath);
                if (PathUtils.IsAbsolutePath(modulePath) === false) {
                    modulePath = PathUtils.Join(basePath, modulePath);
                }
                let forkedModule = LoadModule(modulePath, basePath);
                // 构造新进程，并分配PID
                let newProcess = new Process(forkedModule);
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else {
                throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
            }
        }
        else {
            throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
        }
        PROCESS.Step();
    }
    // display arg 调试输出
    AIL_DISPLAY(argument, PROCESS, RUNTIME) {
        let content = PROCESS.OPSTACK.pop();
        let contentType = TypeOfToken(content);
        if (contentType === "HANDLE") {
            let obj = PROCESS.heap.Get(content);
            if (obj.type === "STRING") {
                RUNTIME.Output(`${TrimQuotes(obj.content)}`);
            }
            else {
                let str = PROCESS.AST.NodeToString(content);
                RUNTIME.Output(`${str}`);
            }
        }
        else {
            if (content === undefined) {
                RUNTIME.Output(`#undefined`);
            }
            else {
                RUNTIME.Output(`${String(content)}`);
            }
        }
        PROCESS.Step();
    }
    // newline 调试输出换行
    AIL_NEWLINE(argument, PROCESS, RUNTIME) {
        RUNTIME.Output(`\n`);
        PROCESS.Step();
    }
    // read 读端口内容
    AIL_READ(argument, PROCESS, RUNTIME) {
        let port = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(port) === 'PORT') {
            PROCESS.PushOperand(RUNTIME.ports.get(port));
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }
    // write 写端口内容
    AIL_WRITE(argument, PROCESS, RUNTIME) {
        let value = PROCESS.PopOperand();
        let port = PROCESS.PopOperand();
        // 类型检查
        if (TypeOfToken(port) === 'PORT') {
            RUNTIME.ports.set(port, value);
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }
    // nop 空指令
    AIL_NOP(argument, PROCESS, RUNTIME) {
        PROCESS.Step();
    }
    // pause 暂停当前进程
    AIL_PAUSE(argument, PROCESS, RUNTIME) {
        PROCESS.SetState(ProcessState.SUSPENDED);
    }
    // halt 停止当前进程
    AIL_HALT(argument, PROCESS, RUNTIME) {
        PROCESS.SetState(ProcessState.STOPPED);
    }
    // get_item 获取列表元素
    AIL_GET_ITEM(argument, PROCESS, RUNTIME) {
        let index = PROCESS.PopOperand(); // 参数2
        let listHandle = PROCESS.PopOperand(); // 参数1
        if (TypeOfToken(listHandle) === "HANDLE" && TypeOfToken(index) === "NUMBER") {
            let value = PROCESS.heap.Get(listHandle).children[parseInt(index)];
            PROCESS.PushOperand(value);
            PROCESS.Step();
        }
        else {
            throw `[Error] get_item参数类型不正确`;
        }
    }
    // set_item 修改列表元素（有副作用的原位修改）
    AIL_SET_ITEM(argument, PROCESS, RUNTIME) {
        let value = PROCESS.PopOperand(); // 参数3
        let index = PROCESS.PopOperand(); // 参数2
        let listHandle = PROCESS.PopOperand(); // 参数1
        if (TypeOfToken(listHandle) === "HANDLE" && TypeOfToken(index) === "NUMBER") {
            let listobj = PROCESS.heap.Get(listHandle);
            if (parseInt(index) >= listobj.children.length) {
                throw `[Error] set_item!下标越界`;
            }
            else {
                listobj.children[parseInt(index)] = value;
                PROCESS.Step();
            }
        }
        else {
            throw `[Error] set_item!参数类型不正确`;
        }
    }
    // append 在列表尾部增加元素（有副作用的原位修改）
    AIL_APPEND(argument, PROCESS, RUNTIME) {
        let value = PROCESS.PopOperand(); // 参数2
        let listHandle = PROCESS.PopOperand(); // 参数1
        if (TypeOfToken(listHandle) === "HANDLE") {
            PROCESS.heap.Get(listHandle).children.push(value);
            PROCESS.Step();
        }
        else {
            throw `[Error] append!参数类型不正确`;
        }
    }
    // length 获取列表元素
    AIL_LENGTH(argument, PROCESS, RUNTIME) {
        let listHandle = PROCESS.PopOperand(); // 参数1
        if (TypeOfToken(listHandle) === "HANDLE") {
            let listlen = PROCESS.heap.Get(listHandle).children.length;
            PROCESS.PushOperand(Number(listlen));
            PROCESS.Step();
        }
        else {
            throw `[Error] length参数类型不正确`;
        }
    }
    // concat 将若干元素连接为新列表，同时修改各子列表的parent字段为自身把柄
    // 栈参数：child1 child2 ... n
    AIL_CONCAT(argument, PROCESS, RUNTIME) {
        let length = parseInt(PROCESS.PopOperand());
        let children = new Array();
        for (let i = length - 1; i >= 0; i--) {
            children[i] = PROCESS.PopOperand();
        }
        let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
        let newList = new QuoteObject(TOP_NODE_HANDLE);
        for (let i = 0; i < length; i++) {
            newList.children[i] = children[i];
            // 设置子节点的parent字段
            if (TypeOfToken(children[i]) === "HANDLE") {
                let childObj = PROCESS.heap.Get(children[i]);
                if (childObj.type === "QUOTE" || childObj.type === "QUASIQUOTE" || childObj.type === "UNQUOTE" || childObj.type === "APPLICATION") {
                    PROCESS.heap.Get(children[i]).parent = newListHandle;
                }
            }
        }
        PROCESS.heap.Set(newListHandle, newList);
        PROCESS.PushOperand(newListHandle);
        PROCESS.Step();
    }
    // duplicate 递归复制对象，并分配把柄
    AIL_DUPLICATE(argument, PROCESS, RUNTIME) {
        // 堆对象深拷贝，并分配新的堆地址
        function DeepCopy(sourceHandle, parentHandle) {
            if (TypeOfToken(sourceHandle) === "HANDLE") {
                // 跳过已经被复制的对象（非静态对象）
                // if(PROCESS.heap.HasHandle(handle) !== true || PROCESS.heap.IsStatic(sourceHandle) === false) {
                //     return sourceHandle;
                // }
                let newObject = PROCESS.heap.Get(sourceHandle).Copy();
                let newHandle = PROCESS.heap.AllocateHandle(newObject.type, false);
                if (["QUOTE", "QUASIQUOTE", "UNQUOTE", "APPLICATION", "LAMBDA"].indexOf(newObject.type) >= 0) {
                    newObject.parent = parentHandle;
                    for (let i = 0; i < newObject.children.length; i++) {
                        (newObject.children)[i] = DeepCopy((newObject.children)[i], newHandle);
                    }
                }
                PROCESS.heap.Set(newHandle, newObject);
                return newHandle;
            }
            else {
                return sourceHandle;
            }
        }
        let handle = PROCESS.PopOperand();
        if (TypeOfToken(handle) !== "HANDLE") {
            throw `[Error] duplicate参数类型不正确`;
        }
        else {
            let parentHandle = PROCESS.heap.Get(handle).parent;
            PROCESS.PushOperand(DeepCopy(handle, parentHandle));
            PROCESS.Step();
        }
    }
    // 执行（一条）中间语言指令
    // 执行的效果从宏观上看就是修改了进程内部和运行时环境的状态，并且使用运行时环境提供的接口和资源
    Execute(PROCESS, RUNTIME) {
        // 取出当前指令
        let instruction = PROCESS.CurrentInstruction();
        let mnemonic = instruction.mnemonic;
        let argument = instruction.argument;
        // 译码：分配执行路径
        if (instruction.type === "COMMENT" || instruction.type === "LABEL") {
            PROCESS.Step(); // 跳过注释和标签
        }
        else {
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
    }
    ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME) {
        if (mnemonic === "store") {
            this.AIL_STORE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "load") {
            this.AIL_LOAD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "loadclosure") {
            this.AIL_LOADCLOSURE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "push") {
            this.AIL_PUSH(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "pop") {
            this.AIL_POP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "swap") {
            this.AIL_SWAP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "set") {
            this.AIL_SET(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'call') {
            this.AIL_CALL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'tailcall') {
            this.AIL_TAILCALL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'return') {
            this.AIL_RETURN(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'capturecc') {
            this.AIL_CAPTURECC(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'iftrue') {
            this.AIL_IFTRUE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'iffalse') {
            this.AIL_IFFALSE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'goto') {
            this.AIL_GOTO(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'car') {
            this.AIL_CAR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'cdr') {
            this.AIL_CDR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'cons') {
            this.AIL_CONS(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'add') {
            this.AIL_ADD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'sub') {
            this.AIL_SUB(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'mul') {
            this.AIL_MUL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'div') {
            this.AIL_DIV(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'mod') {
            this.AIL_MOD(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'pow') {
            this.AIL_POW(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'eqn') {
            this.AIL_EQN(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'ge') {
            this.AIL_GE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'le') {
            this.AIL_LE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'gt') {
            this.AIL_GT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'lt') {
            this.AIL_LT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'not') {
            this.AIL_NOT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'and') {
            this.AIL_AND(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'or') {
            this.AIL_OR(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'eq?') {
            this.AIL_ISEQ(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'null?') {
            this.AIL_ISNULL(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'atom?') {
            this.AIL_ISATOM(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'list?') {
            this.AIL_ISLIST(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'number?') {
            this.AIL_ISNUMBER(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'fork') {
            this.AIL_FORK(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'display') {
            this.AIL_DISPLAY(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'newline') {
            this.AIL_NEWLINE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'read') {
            this.AIL_READ(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'write') {
            this.AIL_WRITE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === "nop") {
            this.AIL_NOP(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'pause') {
            this.AIL_PAUSE(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'halt') {
            this.AIL_HALT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'get_item') {
            this.AIL_GET_ITEM(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'set_item') {
            this.AIL_SET_ITEM(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'length') {
            this.AIL_LENGTH(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'concat') {
            this.AIL_CONCAT(argument, PROCESS, RUNTIME);
        }
        else if (mnemonic === 'duplicate') {
            this.AIL_DUPLICATE(argument, PROCESS, RUNTIME);
        }
    }
}
// Instruction.ts
// 指令集定义
/**
# 指令集实现

## 指令列表

### 第一类：基本存取指令

- store variable 将OP栈顶对象保存到当前闭包的约束变量中
- load variable 解引用变量，并将对象压入OP栈顶
- loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
- push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
- pop 弹出并抛弃OP栈顶
- swap 交换OP栈顶的两个对象的顺序
- set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）

### 第二类：分支跳转指令

- call arg 函数调用（包括continuation、native函数）
- tailcall arg 函数尾调用
- return 函数返回
- capturecc variable 捕获当前Continuation并将其把柄保存在变量中
- iftrue label 如果OP栈顶条件不为false则跳转
- iffalse label 如果OP栈顶条件为false则跳转
- goto label 无条件跳转

### 第三类：列表操作指令

- car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
- cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
- cons 同Scheme的cons

### 第四类：算术逻辑运算和谓词

- add/sub/mul/div/mod/pow
- eqn/lt/gt/le/ge
- and/or/not（注意and和or不同于Scheme的and/or，因Scheme的and/or有短路特性，本质上是条件分支）
- atom?/list?/null?

### 第五类：其他指令

- fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
- nop 空指令
- pause 暂停当前进程
- halt 停止当前进程

*/
class Instruction {
    // 解析指令，并构造为指令对象
    constructor(instString) {
        instString = instString.trim();
        if (/^\s*\;[\s\S]*$/.test(instString)) { // 注释
            this.type = "COMMENT";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else if (instString[0] === '@') { // 标签
            this.type = "LABEL";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else { // 普通指令
            let fields = instString.split(/\s+/i);
            let mnemonic = fields[0].toLowerCase();
            let argument = fields[1];
            this.type = "INSTRUCTION";
            this.instruction = instString;
            this.mnemonic = mnemonic;
            this.argument = argument;
            this.argType = TypeOfToken(argument);
        }
    }
}
// 创建新的VM实例：其中workingDir是VM的工作目录，默认为/test
function AnimacInstance(workingDir) {
    this.RUNTIME = new Runtime(workingDir);
}
AnimacInstance.prototype = {
    loadFromFile: function (srcAbsPath, pid) {
        let workingDir = PathUtils.DirName(srcAbsPath); // 以代码所在路径为工作路径
        let linkedModule = LoadModule(srcAbsPath, workingDir);
        let PROCESS = new Process(linkedModule);
        PROCESS.PID = pid;
        this.RUNTIME.AddProcess(PROCESS);
    },
    loadFromString: function (code, mockAbsPath, pid) {
        code = `((lambda () (display { ${code} }) (newline) ))\n`;
        let linkedModule = LoadModuleFromCode(code, mockAbsPath);
        let PROCESS = new Process(linkedModule);
        PROCESS.PID = pid;
        this.RUNTIME.AddProcess(PROCESS);
    },
    start: function () {
        this.RUNTIME.StartClock();
    },
    step: function () {
        let vmState = this.RUNTIME.Tick(0);
        // 对所有进程执行垃圾回收
        if (ANIMAC_CONFIG.is_gc_enabled === true) {
            for (let i = 0; i < this.RUNTIME.processQueue.length; i++) {
                let pid = this.RUNTIME.processQueue[i];
                let process = this.RUNTIME.processPool[pid];
                process.GC();
                // console.log(`[GC] 进程${pid}已完成GC`);
            }
        }
        return vmState;
    },
    setCallback: function (callbackOnTick, callbackOnEvent, callbackOnHalt, callbackOnError) {
        this.RUNTIME.callbackOnTick = callbackOnTick;
        this.RUNTIME.callbackOnEvent = callbackOnEvent;
        this.RUNTIME.callbackOnHalt = callbackOnHalt;
        this.RUNTIME.callbackOnError = callbackOnError;
    }
};
