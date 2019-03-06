const fs = require('fs');
const Compiler = require('../source/compiler.js');
const Parser = require('../source/parser.js');

// 测试时修改此处
const sourcePath = "./demo"; // 代码基准目录
const modulePath = "/aurora/testcase/"; // 模块目录
const moduleFileName = "yin-yang-puzzle.scm"; // 模块文件名（与模块名相同）

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
    
});


