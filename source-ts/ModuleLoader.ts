
// ModuleLoader.ts
// 模块加载器


// 模块
//   模块如同Java的字节码文件，包含代码、静态资源和元数据等
class Module {
    // TODO 模块结构设计，需要注意 ①元数据 ②可序列化性 ③与Runtime和Process结构对接
    static AVM_Version: string = "V0";
    public AST: AST;
    public ILCode: Array<string>;
}

// 载入模块：本质上是静态链接

function LoadModule(path: string): Module {
    // 所有互相依赖的AST
    let allASTs: HashMap<string, AST> = new HashMap();

    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph: Array<Array<string>> = new Array();

    const fs = require("fs");

    // 递归地引入所有依赖文件，并检测循环依赖
    (function importModule(path: string): void {
        let code: string;
        try {
            code = fs.readFileSync(path, "utf-8");
        }
        catch {
            throw `[Error] 模块“${path}”未找到。`
        }

        code = `((lambda () ${code}))`;

        let moduleQualifiedName = PathUtils.GetModuleQualifiedName(path);

        let currentAST = Parse(code, moduleQualifiedName);
        allASTs.set(moduleQualifiedName, currentAST);

        for(let alias in currentAST.dependencies) {
            let dependencyPath = currentAST.dependencies.get(alias);
            dependencyGraph.push([
                moduleQualifiedName,
                PathUtils.GetModuleQualifiedName(dependencyPath)
            ]);
            // 立即检测是否有循环依赖
            let hasLoop = DetectRecursiveDependency(dependencyGraph);
            if(hasLoop) {
                throw `[Error] 模块之间存在循环依赖，无法载入模块。`;
            }
            importModule(dependencyPath);
        }
    })(path);

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
    let mainModuleQualifiedName = PathUtils.GetModuleQualifiedName(path);
    mergedModule.AST = allASTs.get(mainModuleQualifiedName);
    // TODO 按照依赖关系图的拓扑排序进行融合
    for(let moduleName in allASTs) {
        if(moduleName === mainModuleQualifiedName) continue;
        mergedModule.AST.MergeAST(allASTs.get(moduleName));
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);

    return mergedModule;
}

// 对依赖关系图作拓扑排序，进而检测是否存在环路
function DetectRecursiveDependency(dependencyGraph: Array<Array<string>>): boolean {
    // 建立邻接表
    let moduleNames: HashMap<string, number> = new HashMap();
    for(let i = 0; i < dependencyGraph.length; i++) {
        moduleNames[dependencyGraph[i][0]] = 0;
        moduleNames[dependencyGraph[i][1]] = 0;
    }
    let counter = 0;
    for(let n in moduleNames) {
        moduleNames[n] = counter;
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
        let left: number = moduleNames[dependencyGraph[i][0]];
        let right:number = moduleNames[dependencyGraph[i][1]];
        adjMatrix[left][right] = true;
    }

    // 拓扑排序
    let hasLoop = false;
    let sortedModuleIndex = new Array();
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

    return hasLoop;
}
