
// ModuleLoader.ts
// 模块加载器

// 模块
class Module {
    static AVM_Version: string = "V0";   // 指示可用的AVM版本
    // public Components: Array<string>;    // 组成该模块的各个依赖模块名称的拓扑排序序列
    public AST: AST;                     // 合并后的AST
    public ILCode: Array<string>;        // 由AST编译得到的IL代码
}

// 载入模块：本质上是静态链接

function LoadModule(modulePath: string, workingDir: string): Module {
    // 所有互相依赖的AST
    let allASTs: HashMap<string, AST> = new HashMap();

    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph: Array<Array<string>> = new Array();

    // 经拓扑排序后的依赖模块序列
    let sortedModuleNames: Array<string> = new Array();

    // 递归地引入所有依赖文件，并检测循环依赖
    (function importModule(modulePath: string): void {
        // 首先处理模块路径
        if(path.isAbsolute(modulePath) === false) {
            modulePath = path.join(workingDir, modulePath);
        }

        let code: string;
        try {
            code = fs.readFileSync(modulePath, "utf-8");
        }
        catch {
            throw `[Error] 模块“${modulePath}”未找到。`
        }

        code = `((lambda () ${code}))\n`;

        let moduleQualifiedName = PathUtils.GetModuleQualifiedName(modulePath);

        let currentAST = Analyse(Parse(code, moduleQualifiedName));
        allASTs.set(moduleQualifiedName, currentAST);

        for(let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleQualifiedName,
                PathUtils.GetModuleQualifiedName(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleNames = TopologicSort(dependencyGraph);
            if(sortedModuleNames === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            importModule(dependencyPath);
        }
    })(modulePath);

    // 对每个AST中使用的 外部模块引用 作换名处理
    for(let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);

        currentAST.nodes.ForEach((nodeHandle)=> {
            let node = currentAST.nodes.Get(nodeHandle);
            if(node.type === "LAMBDA" || node.type === "APPLICATION") {
                for(let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if(isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if(prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.GetModuleQualifiedName(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }

    // 将AST融合起来，编译为单一模块
    let mergedModule: Module = new Module();
    let mainModuleQualifiedName = PathUtils.GetModuleQualifiedName(modulePath);
    mergedModule.AST = allASTs.get(mainModuleQualifiedName);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for(let i = sortedModuleNames.length - 1; i >= 0; i--) {
        let moduleName = sortedModuleNames[i];
        if(moduleName === mainModuleQualifiedName) continue;
        mergedModule.AST.MergeAST(allASTs.get(moduleName), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);

    // mergedModule.Components = sortedModuleNames;

    return mergedModule;
}

// 用于fork指令：从某个Application节点开始，构建模块
// TODO 这个函数实现不够优雅，待改进
function LoadModuleFromNode(ast: AST, nodeHandle: Handle, workingDir: string): Module {

    // 所有互相依赖的AST
    let allASTs: HashMap<string, AST> = new HashMap();

    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph: Array<Array<string>> = new Array();

    // 经拓扑排序后的依赖模块序列
    let sortedModuleNames: Array<string> = new Array();

    let mainModuleQualifiedName = `${ast.moduleQualifiedName}.forked`;

    let currentAST = ast.Copy();
    // 将目标节点移到顶级作用域
    let topLambdaNodeHandle = currentAST.GetNode(currentAST.TopApplicationNodeHandle()).children[0];
    let temp = currentAST.GetNode(topLambdaNodeHandle).children;

    // 将所在AST的顶级作用域的(define ..)搬迁到顶级作用域
    let temp2: Array<any> = new Array();
    for(let i = 2; i < temp.length; i++) {
        if(TypeOfToken(temp[i]) === "HANDLE") {
            let childNode = currentAST.GetNode(temp[i]);
            if(childNode.type === "APPLICATION" && childNode.children[0] === "define") {
                temp2.push(temp[i]);
            }
        }
    }
    temp2.push(nodeHandle);

    currentAST.GetNode(topLambdaNodeHandle).children = temp.slice(0,2).concat(temp2);
    allASTs.set(mainModuleQualifiedName, currentAST);

    for(let alias in currentAST.dependencies) {
        let dependencyPath = currentAST.dependencies.get(alias);
        dependencyGraph.push([
            mainModuleQualifiedName,
            PathUtils.GetModuleQualifiedName(dependencyPath)
        ]);
        // 检测是否有循环依赖
        sortedModuleNames = TopologicSort(dependencyGraph);
        if(sortedModuleNames === undefined) {
            throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
        }
        importModule(dependencyPath);
    }

    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(modulePath: string): void {
        // 首先处理模块路径
        if(path.isAbsolute(modulePath) === false) {
            modulePath = path.join(workingDir, modulePath);
        }

        let code: string;
        try {
            code = fs.readFileSync(modulePath, "utf-8");
        }
        catch {
            throw `[Error] 模块“${modulePath}”未找到。`
        }

        code = `((lambda () ${code}))\n`;

        let moduleQualifiedName = PathUtils.GetModuleQualifiedName(modulePath);

        let currentAST = Analyse(Parse(code, moduleQualifiedName));
        allASTs.set(moduleQualifiedName, currentAST);

        for(let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleQualifiedName,
                PathUtils.GetModuleQualifiedName(dependencyPath)
            ]);
            // 检测是否有循环依赖
            sortedModuleNames = TopologicSort(dependencyGraph);
            if(sortedModuleNames === undefined) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            importModule(dependencyPath);
        }
    }

    // 对每个AST中使用的 外部模块引用 作换名处理
    for(let moduleName in allASTs) {
        let currentAST = allASTs.get(moduleName);

        currentAST.nodes.ForEach((nodeHandle)=> {
            let node = currentAST.nodes.Get(nodeHandle);
            if(node.type === "LAMBDA" || node.type === "APPLICATION") {
                for(let i = 0; i < node.children.length; i++) {
                    let token = node.children[i];
                    if(isVariable(token) && node.children[0] !== "import") {
                        let prefix = token.split(".")[0];
                        let suffix = token.split(".").slice(1).join("");
                        if(prefix in currentAST.dependencies) {
                            // 在相应的依赖模块中查找原名，并替换
                            let targetModuleName = PathUtils.GetModuleQualifiedName(currentAST.dependencies.get(prefix));
                            let targetVarName = (allASTs.get(targetModuleName).topVariables).get(suffix);
                            node.children[i] = targetVarName;
                        }
                    }
                }
            }
        });
    }

    // 将AST融合起来，编译为单一模块
    let mergedModule: Module = new Module();
    mergedModule.AST = allASTs.get(mainModuleQualifiedName);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for(let i = sortedModuleNames.length - 1; i >= 0; i--) {
        let moduleName = sortedModuleNames[i];
        if(moduleName === mainModuleQualifiedName) continue;
        mergedModule.AST.MergeAST(allASTs.get(moduleName), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);

    // mergedModule.Components = sortedModuleNames;

    return mergedModule;
}


// 对依赖关系图作拓扑排序，进而检测是否存在环路
function TopologicSort(dependencyGraph: Array<Array<string>>): Array<string> {
    // 建立邻接表和模块名称表
    let moduleNameDict: HashMap<string, number> = new HashMap();
    for(let i = 0; i < dependencyGraph.length; i++) {
        moduleNameDict[dependencyGraph[i][0]] = 0;
        moduleNameDict[dependencyGraph[i][1]] = 0;
    }
    let counter = 0;
    let moduleName: Array<string> = new Array();
    for(let n in moduleNameDict) {
        moduleNameDict[n] = counter;
        moduleName[counter] = n;
        counter++;
    }
    let adjMatrix: Array<Array<boolean>> = new Array();
    for(let i = 0; i < counter; i++) {
        let init: Array<boolean> = new Array();
        for(let j = 0; j < counter; j++) {
            init[j] = false;
        }
        adjMatrix[i] = init;
    }
    for(let i = 0; i < dependencyGraph.length; i++) {
        let left: number = moduleNameDict[dependencyGraph[i][0]];
        let right:number = moduleNameDict[dependencyGraph[i][1]];
        adjMatrix[left][right] = true;
    }

    // 拓扑排序
    let hasLoop = false;
    let sortedModuleIndex: Array<number> = new Array();
    (function sort(adjMatrix) {
        // 计算某节点入度
        function getInDegree(vertex, adjMatrix) {
            let count = 0;
            if(!(adjMatrix[vertex])) { return -1; }
            for(let i = 0; i < adjMatrix[vertex].length; i++) {
                if(adjMatrix[vertex][i] === true) count++;
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
                hasLoop = true;
                return;
            }
            sortedModuleIndex.push(zeroInDegVertex);
            // 删除这个点
            for(let i = 0; i < adjMatrix.length; i++) {
                if(!(adjMatrix[i])) { continue; }
                adjMatrix[i][zeroInDegVertex] = false;
            }
            adjMatrix[zeroInDegVertex] = undefined;
        }
    })(adjMatrix);

    if(hasLoop) {
        return undefined;
    }
    else {
        let sortedModuleName: Array<string> = new Array();
        for(let i = 0; i < sortedModuleIndex.length; i++) {
            sortedModuleName[i] = moduleName[sortedModuleIndex[i]];
        }
        return sortedModuleName;
    }
}
