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
const Compiler = require('../source/compiler.js');

// 模块加载器
const ModuleLoader = function(mainModulePath, SOURCE_PATH) {

    // 辅助过程：从某个位置获取模块代码
    let SOURCE_CACHE = new Object();
    function fetchSource(basename, currentPath) {
        let absolutePath = getAbsolutePath(basename, currentPath);
        let source = null;
        if(!(absolutePath in SOURCE_CACHE)) {
            console.log(`[SSC] 首次读取源文件：${basename}`);
            source = fs.readFileSync(absolutePath, {encoding:"utf-8"}).toString();
            SOURCE_CACHE[absolutePath] = source;
        }
        else {
            console.log(`[SSC] 缓存命中：${basename}`);
            source = SOURCE_CACHE[absolutePath];
        }
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

    // 辅助过程：将AST中所有alias替换为对应的模块全限定名
    function replaceAlias(AST) {
        let aliases = AST.aliases;
        for(let alias in aliases) {
            let origin = aliases[alias];
            for(let i = 0; i < AST.variables.length; i++) {
                let variable = AST.variables[i];
                let regex = new RegExp(`^${alias}\\.`, "g");
                if(regex.test(variable)) {
                    AST.variables[i] = variable.replace(regex, `${origin}.`);
                }
            }
        }
    }

    // 辅助过程：将AST中所有defined的变量替换为模块的全限定名
    function replaceDefinedVariables(AST, qName) {
        for(let i = 0; i < AST.variables.length; i++) {
            let variable = AST.variables[i];
            if(/^\%MODULE\_QUALIFIED\_NAME\%\./g.test(variable)) {
                AST.variables[i] = variable.replace(/^\%MODULE\_QUALIFIED\_NAME\%\./g, `${qName}.`);
            }
        }
    }

    // 辅助过程：AST融合（AST1←AST2）
    function mergeAST(AST1, AST2) {
        // 引用index平移
        function refShift(ref, shamt) {
            return Common.makeRef(Common.getRefType(ref), (parseInt(Common.getRefIndex(ref)) + shamt));
        }

        // 查找AST1相同的全限定变量的ref
        function findSameVarRef(variable) {
            if(!(/\./gi.test(variable))) { return null; }
            else {
                for(let i = 0; i < AST1.variables.length; i++) {
                    if(AST1.variables[i] === variable) {
                        return Common.makeRef("VARIABLE", i);
                    }
                }
                return null;
            }
        }

        // AST2的variable的ref到相同的AST1的var的ref的映射
        let sameVariableRefMapping = new Object();

        // variables融合
        let variablesOffset = AST1.variables.length;
        for(let i = 0; i < AST2.variables.length; i++) {
            let mergedRef = findSameVarRef(AST2.variables[i]);
            if(!mergedRef) {
                AST1.variables[variablesOffset + i] = AST2.variables[i];
            }
            else {
                sameVariableRefMapping[Common.makeRef("VARIABLE", i)] = mergedRef;
            }
        }

        // strings融合
        let stringsOffset = AST1.strings.length;
        for(let i = 0; i < AST2.strings.length; i++) {
            AST1.strings[stringsOffset + i] = AST2.strings[i];
        }

        // symbols融合
        let symbolsOffset = AST1.symbols.length;
        for(let i = 0; i < AST2.symbols.length; i++) {
            AST1.symbols[symbolsOffset + i] = AST2.symbols[i];
        }

        // constants融合
        let constantsOffset = AST1.constants.length;
        for(let i = 0; i < AST2.constants.length; i++) {
            AST1.constants[constantsOffset + i] = AST2.constants[i];
        }

        // slists融合
        let slistsOffset = AST1.slists.length;
        // 忽略外层包裹的((lambda () (begin ...)))节点
        for(let i = 3; i < AST2.slists.length; i++) {
            let node = AST2.slists[i];
            node.index = node.index + slistsOffset;
            // 注意：对parentIndex=2作特殊处理（AST2的顶级节点统一挂接到AST1的外层begin节点上）
            node.parentIndex = (node.parentIndex === 2) ? 2 : node.parentIndex + slistsOffset;
            if(node.parentIndex === 2) {
                AST1.slists[2].children.push(Common.makeRef("SLIST", node.index));
            }
            // children ref平移
            for(let c = 0; c < node.children.length; c++) {
                let ref = node.children[c];
                let type = Common.getRefType(ref);
                if(type === "VARIABLE") {
                    if(ref in sameVariableRefMapping) {
                        node.children[c] = sameVariableRefMapping[ref];
                    }
                    else {
                        node.children[c] = refShift(ref, variablesOffset);
                    }
                }
                if(type === "STRING")   { node.children[c] = refShift(ref, stringsOffset); }
                if(type === "SYMBOL")   { node.children[c] = refShift(ref, symbolsOffset); }
                if(type === "CONSTANT") { node.children[c] = refShift(ref, constantsOffset); }
                if(type === "SLIST")    { node.children[c] = refShift(ref, slistsOffset); }
            }
            // parameters ref平移
            for(let c = 0; c < node.parameters.length; c++) {
                let ref = node.parameters[c];
                let type = Common.getRefType(ref);
                if(type === "VARIABLE") {
                    if(ref in sameVariableRefMapping) {
                        node.parameters[c] = sameVariableRefMapping[ref];
                    }
                    else {
                        node.parameters[c] = refShift(ref, variablesOffset);
                    }
                }
                else { throw `[SSC·模块加载器] lambda参数必须是变量`; }
            }
            // body ref平移
            let type = Common.getRefType(node.body);
            if(type === "VARIABLE") {
                if(node.body in sameVariableRefMapping) {
                    node.body = sameVariableRefMapping[node.body];
                }
                else {
                    node.body = refShift(node.body, variablesOffset);
                }
            }
            if(type === "STRING")   { node.body = refShift(node.body, stringsOffset); }
            if(type === "SYMBOL")   { node.body = refShift(node.body, symbolsOffset); }
            if(type === "CONSTANT") { node.body = refShift(node.body, constantsOffset); }
            if(type === "SLIST")    { node.body = refShift(node.body, slistsOffset); }

            AST1.slists[slistsOffset + i] = node;
        }

        // refIndexes融合
        AST1.refIndexes['STRING'] += AST2.refIndexes['STRING'];
        AST1.refIndexes['SLIST'] += AST2.refIndexes['SLIST'];
        AST1.refIndexes['SYMBOL'] += AST2.refIndexes['SYMBOL'];
        AST1.refIndexes['VARIABLE'] += AST2.refIndexes['VARIABLE'];
        AST1.refIndexes['CONSTANT'] += AST2.refIndexes['CONSTANT'];

    }

    // 建立依赖关系（有向无环图），并返回拓扑排序后的序列。若存在环路，则报错。
    function dependencyAnalysis(basename, currentPath) {
        let moduleCount = 0;
        let qualifiedNames = new Array(); // id→qname
        let qualifiedNameDict = new Object(); // qname→id
        let moduleAbsolutePaths = new Array(); // id→path
        let ASTs = new Array(); // id→ast
        let adjMatrix = new Array(); // [first][second]，邻接矩阵
        try {
            (function traverse(basename, currentPath) {
                let currentQName = getQualifiedName(basename, currentPath, SOURCE_PATH);
                if(!(currentQName in qualifiedNameDict)) {
                    qualifiedNameDict[currentQName] = moduleCount;
                    qualifiedNames[moduleCount] = currentQName;
                    let absolutePath = getAbsolutePath(basename, currentPath);
                    moduleAbsolutePaths[moduleCount] = absolutePath;
                    let source = fetchSource(basename, currentPath);
                    source = ["((lambda () (begin", source, ")))"].join('\n');
                    ASTs[moduleCount] = Parser.Parser(source);
                    moduleCount++;
                }

                let AST = ASTs[qualifiedNameDict[currentQName]];
                let dependencies = AST.dependencies;
                // 修改基准路径
                let newCurrentPath = path.dirname(getAbsolutePath(basename, currentPath));
                // 递归地分析
                for(let alias in dependencies) {
                    let depBasename = dependencies[alias];
                    let depQName = getQualifiedName(depBasename, newCurrentPath, SOURCE_PATH);

                    traverse(depBasename, newCurrentPath);

                    // 将AST.dependencies中的路径替换为全限定名
                    AST.aliases[alias] = depQName;
                    // 构建邻接矩阵，用于计算拓扑排序
                    let first = qualifiedNameDict[currentQName];
                    let second = qualifiedNameDict[depQName];
                    if(!(first in adjMatrix)) {
                        adjMatrix[first] = new Array();
                    }
                    else if(adjMatrix[first][second] === 1) {
                        return;
                    }
                    adjMatrix[first][second] = 1;
                }
            })(basename, currentPath);
        }
        catch(e) {
            throw `[SSC·模块加载器] 模块加载失败（可能是由于文件不存在、循环依赖等问题，详见→）（${e}）`;
        }
        for(let i = 0; i < moduleCount; i++) {
            if(!(adjMatrix[i])) { adjMatrix[i] = new Array(); }
            for(let j = 0; j < moduleCount; j++) {
                adjMatrix[i][j] = (adjMatrix[i][j] === 1) ? 1 : 0;
            }
        }

        // 拓扑排序
        let sortedModuleIndex = new Array();
        (function sort(adjMatrix) {
            // 计算某节点入度
            function getInDegree(vertex, adjMatrix) {
                let count = 0;
                if(!(adjMatrix[vertex])) { return -1; }
                for(let i = 0; i < adjMatrix[vertex].length; i++) {
                    if(adjMatrix[vertex][i] === 1) count++;
                }
                return count;
            }
            while(sortedModuleIndex.length < adjMatrix.length) {
                // 计算入度为0的点
                let zeroInDegVertex = null;
                for(let i = 0; i < adjMatrix.length; i++) {
                    let indeg = getInDegree(i, adjMatrix);
                    if(indeg === 0) {
                        zeroInDegVertex = i;
                        break;
                    }
                }
                if(zeroInDegVertex === null) {
                    throw `[SSC·模块加载器] 出现循环依赖`; // 不会到这里
                }
                sortedModuleIndex.push(zeroInDegVertex);
                // 删除这个点
                for(let i = 0; i < adjMatrix.length; i++) {
                    if(!(adjMatrix[i])) { continue; }
                    adjMatrix[i][zeroInDegVertex] = 0;
                }
                adjMatrix[zeroInDegVertex] = undefined;
            }
        })(adjMatrix);

        // 返回经排序后的结果
        let moduleSeries = new Array();
        for(let i = 0; i < moduleCount; i++) {
            let index = sortedModuleIndex[i];
            moduleSeries.push({
                AST: ASTs[index],
                qualifiedName: qualifiedNames[index],
                modulePath: moduleAbsolutePaths[index],
            });
        }

        return moduleSeries;
    }

    // let rootPath = process.cwd();
    // console.log(`当前绝对路径（工程根目录）：${rootPath}`);

    let mainModuleBasename = path.basename(mainModulePath);
    let currentPath = path.dirname(mainModulePath);
    let moduleQualifiedName = getQualifiedName(mainModuleBasename, currentPath, SOURCE_PATH);

    // 依赖关系分析
    let modules = dependencyAnalysis(mainModuleBasename, currentPath);

    // 别名和全限定名替换
    for(let i = 0; i < modules.length; i++) {
        replaceAlias(modules[i].AST);
        replaceDefinedVariables(modules[i].AST, modules[i].qualifiedName);
    }

    // AST融合
    let AST = modules[0].AST;
    for(let i = 1; i < modules.length; i++) {
        mergeAST(AST, modules[i].AST);
    }

    // 编译
    let MODULE = Compiler.Compiler(moduleQualifiedName, AST);
    return MODULE;
};

module.exports.ModuleLoader = ModuleLoader;
