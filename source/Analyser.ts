
// Parser.ts
// 作用域和尾调用分析：分析并处理AST

function Analyse(ast: AST): AST{

    let scopes: HashMap<Handle, Scope> = new HashMap();

    ///////////////////////////////
    //  作用域解析，变量换名
    ///////////////////////////////

    // 从某个节点开始，向上查找某个变量归属的Lambda节点
    function searchVarLambdaHandle(variable: string, fromNodeHandle: Handle): Handle {
        let currentNodeHandle: Handle = fromNodeHandle;
        while(currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if(node.type === "LAMBDA") {
                // 注意：从scopes中获取换名前的作用域信息
                let bounds: Array<string> = scopes.get(currentNodeHandle).boundVariables;
                if(bounds.indexOf(variable) >= 0) {
                    return currentNodeHandle;
                }
            }
            currentNodeHandle = node.parent;
        }
        return null; // 变量未定义
    }

    // 查找某个node上面最近的lambda节点的地址
    function nearestLambdaHandle(fromNodeHandle: Handle): Handle {
        let currentNodeHandle: Handle = fromNodeHandle;
        while(currentNodeHandle !== TOP_NODE_HANDLE) {
            let node = ast.GetNode(currentNodeHandle);
            if(node.type === "LAMBDA") {
                return currentNodeHandle;
            }
            currentNodeHandle = node.parent;
        }
        return null;
    }

    // 生成模块内唯一的变量名
    function MakeUniqueVariable(lambdaHandle: Handle, variable: string): string {
        return `${lambdaHandle.substring(1)}.${variable}`;
    }

    // 以下是作用域解析：需要对所有node扫描两遍
    function ScopeAnalysis(): void {
        // 顶级Lambda的把柄
        let topLambdaHandle: Handle = ast.lambdaHandles[0];

        // 首先初始化所有scope
        for(let nodeHandle of ast.lambdaHandles) {
            let scope: Scope = new Scope(null);
            scopes.set(nodeHandle, scope);
        }

        // 第1趟扫描：在scopes中注册作用域的树状嵌套关系；处理define行为
        ast.nodes.ForEach((nodeHandle) => {
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;
            // Lambda节点
            if(nodeType === "LAMBDA") {
                // 寻找上级lambda节点
                let parentLambdaHandle: Handle = nearestLambdaHandle(node.parent);
                // 非顶级lambda
                if(parentLambdaHandle !== null) {
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
            else if(nodeType === "APPLICATION" && node.children[0] === "define") {
                // 寻找define结构所在的lambda节点
                let parentLambdaHandle: Handle = nearestLambdaHandle(nodeHandle);
                if(parentLambdaHandle !== null) {
                    let definedVariable: string = node.children[1];
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
        ast.nodes.ForEach((nodeHandle)=>{
            let node = ast.GetNode(nodeHandle);
            let nodeType = node.type;

            // Lambda节点：替换parameter和bodies中出现的所有Variable
            if(nodeType === "LAMBDA") {
                // 处理Lambda节点的parameters
                for(let i = 0; i < node.getParameters().length; i++) {
                    let originVar = (node.getParameters())[i];
                    let newVar: string = MakeUniqueVariable(nodeHandle, originVar);
                    (ast.GetNode(nodeHandle).getParameters())[i] = newVar;
                    ast.variableMapping.set(newVar, originVar);
                }
                // 处理body中出现的单独的变量（例如(lambda (x) *x*)）
                for(let i = 2; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if(isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if(lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if(!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`
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
            else if(nodeType === "APPLICATION" || nodeType === "UNQUOTE" || nodeType === "QUASIQUOTE") {
                // 跳过若干特殊类型的node
                let first = node.children[0];
                if(["native", "import"].indexOf(first) >= 0) {
                    return; // 相当于continue;
                }
                for(let i = 0; i < node.children.length; i++) {
                    let child = (node.children)[i];
                    if(isVariable(child)) {
                        // 查找此变量所在的lambda
                        let lambdaHandle = searchVarLambdaHandle(child, nodeHandle);
                        // 未定义的变量：①是native或者import的模块中的变量，②是未定义变量
                        if(lambdaHandle === null) {
                            let variablePrefix = child.split(".")[0];
                            // 如果第一个点号前的变量名前缀并非已声明的Native模块名或者外部模块别名，则判定为未定义变量
                            if(!(ast.natives.has(variablePrefix) || ast.dependencies.has(variablePrefix))) {
                                throw `[作用域解析] 变量"${child}"未定义。`
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
                if(first === "define" && node.parent === topLambdaHandle) {
                    let newVarName = node.children[1];
                    let originVarName = ast.variableMapping.get(newVarName);
                    if(ast.topVariables.has(originVarName)) {
                        throw `[Error] 顶级变量“${originVarName}”@Position ${ast.nodeIndexes.get(nodeHandle)} 重复。`
                    }
                    else {
                        ast.topVariables.set(originVarName, newVarName);
                    }
                }
            }
        }); // 所有节点扫描完毕
    }


    // 尾位置分析（参照R5RS的归纳定义）
    function TailCallAnalysis(item: any, isTail: boolean) {
        if(TypeOfToken(item) === "HANDLE") {
            let node = ast.GetNode(item);
            if(node.type === "APPLICATION") {
                let first = node.children[0];
                // if 特殊构造
                if(first === "if") {
                    TailCallAnalysis(node.children[1], false);
                    TailCallAnalysis(node.children[2], true);
                    TailCallAnalysis(node.children[3], true);
                }
                // cond 特殊构造
                else if(first === "cond") {
                    for(let i = 1; i < node.children.length; i++) {
                        let clauseNode = ast.GetNode(node.children[i]);
                        TailCallAnalysis(clauseNode.children[0], false);
                        TailCallAnalysis(clauseNode.children[1], true);
                    }
                }
                // 其他构造，含and、or，这些形式的尾位置是一样的
                else {
                    for(let i = 0; i < node.children.length; i++) {
                        let istail = false;
                        if ((i === node.children.length - 1) &&
                            (node.children[0] === 'begin' || node.children[0] === 'and' || node.children[0] === 'or')) {
                            istail = true;
                        }
                        TailCallAnalysis(node.children[i], istail);
                    }
                    if(isTail) {
                        ast.tailcall.push(item); // 标记为尾（调用）位置
                    }
                }
            }
            else if(node.type === "LAMBDA") {
                let bodies = node.getBodies();
                for(let i = 0; i < bodies.length; i++) {
                    if(i === bodies.length - 1) {
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

