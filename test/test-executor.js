const fs = require('fs');
const Common = require('../source/common.js');
const Compiler = require('../source/compiler.js');
const Parser = require('../source/parser.js');
const Process = require('../source/process.js');
const Executor = require('../source/executor.js');

// 测试时修改此处
const sourcePath = "./demo"; // 代码基准目录
const modulePath = "/aurora/testcase/"; // 模块目录
const moduleFileName = "factorial-purecps.scm"; // 模块文件名（与模块名相同）

let moduleFilePath = [sourcePath, modulePath, moduleFileName].join('');
let moduleName = moduleFileName.replace(/\.[^\.]*$/gi, "");
let moduleQualifiedName = modulePath.substring(1).replace(/\//gi, ".") + moduleName;

let outFilePath = ["./asm/", moduleQualifiedName, ".json"].join('');

fs.readFile(moduleFilePath, {encoding:"utf-8"}, (error, data)=> {
    if(error) {
        throw error;
    }
    let source = data.toString();

    // 包裹第一层Lambda
    source = ["((lambda () (begin", source, ")))"].join('\n');

    // 语法分析，生成静态资源表和AST
    let AST = Parser.Parser(source);
    let MODULE = Compiler.Compiler(moduleQualifiedName, AST);

    console.log(`编译完成`);

    // 初始化进程
    let PROCESS = new Process.Process();
    PROCESS.Init(1, 0, "Test", 10000, MODULE);

    console.log(`进程初始化完成`);

    let state = Common.PROCESS_STATE.DEFAULT;
    while(state !== Common.PROCESS_STATE.DEAD) {
        state = Executor.Executor(PROCESS);
    }


    /*
    function outputTarget() {
        fs.writeFile(outFilePath, JSON.stringify(MODULE, "", 2), {flag:'w'}, (error)=> {
            if(error) { throw error; }
            console.log(`[SSC] Module '${moduleFilePath}': `);
            console.log(`[SSC]   Target code @ '${outFilePath}'.`);
            console.log(`[SSC]   Successfully Compiled. (${new Date().toISOString()})`);
        });
    }

    fs.exists("./asm/", (isExist)=> {
        if(isExist) {
            outputTarget();
        }
        else {
            fs.mkdir("./asm/", (error)=> {
                if(error) { throw error; }
                outputTarget();
             });
        }
    });
    */
    
});










