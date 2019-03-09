// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// module-loader.js
// 模块加载器
// 输入：SOURCE（Scheme源代码，可能引用其他代码）
// 输出：MODULE（经整合、命名空间分析、编译的模块文件）

const fs = require('fs');
const path = require('path');
const Common = require('./common.js');
const Parser = require('../source/parser.js');

// 模块加载器
const ModuleLoader = function() {

    // 辅助过程：从某个位置获取模块代码
    function fetchSource(basename, currentPath) {
        let absolutePath = getAbsolutePath(basename, currentPath);
        let source = fs.readFileSync(absolutePath, {encoding:"utf-8"}).toString();
        return source;
    }

    // 辅助过程：获得模块的绝对路径
    function getAbsolutePath(
        moduleName,          // import语句中的模块名
        currentAbsolutePath  // 当前所在的源码绝对路径
    ) {
        return path.join(currentAbsolutePath, moduleName);
    }

    // 辅助过程：由模块路径解析得到模块的全限定名
    function getQualifiedName(
        moduleName,          // import语句中的模块名
        currentAbsolutePath, // 当前所在的源码绝对路径
        sourceAbsolutePath   // 工程中源码目录的绝对路径
    ) {
        let absoluteModulePath = path.join(currentAbsolutePath, moduleName);
        let absoluteSourcePath = path.normalize(sourceAbsolutePath);
        let relativeModulePath = absoluteModulePath.replace(absoluteSourcePath, "");
        let moduleNameWithoutExt = relativeModulePath.replace(/\.[^\.]*$/gi, "");
        let qualifiedName = (moduleNameWithoutExt.split(/[\/\\]/gi)).filter(e=>{return (e.length > 0) ? e : "";}).join(".");
        return qualifiedName;
    }

    // 辅助过程：将某个alias全部替换为全限定名
    function replaceAliasWithQualifiedName(AST, alias, qName) {
        // TODO
    }

    // TODO 以下是测试代码，去掉

    let rootPath = process.cwd();
    console.log(`当前绝对路径（工程根目录）：${rootPath}`);

    const SOURCE_PATH = './source';
    let currentPath = './source/aurora/testcase';

    let moduleName = '../hahaha/喵喵喵.scm';
    console.log(currentPath);
    let importeeQName = getQualifiedName(moduleName, currentPath, SOURCE_PATH);
    console.log(importeeQName);
    let importeePath = getAbsolutePath(moduleName, currentPath)
    console.log(importeePath);
    currentPath = path.dirname(importeePath);
    console.log(currentPath);

};

// TODO 测试，去掉
ModuleLoader();

module.exports.ModuleLoader = ModuleLoader;
