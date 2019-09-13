
// REPL.ts
// Read-Eval-Print Loop

function LoadModuleFromCode(code: string, REPLModuleQualifiedName: string): Module {
    // 所有互相依赖的AST
    let allASTs: HashMap<string, AST> = new HashMap();
    // 依赖关系图：[[模块名, 依赖模块名], ...]
    let dependencyGraph: Array<Array<string>> = new Array();
    // 经拓扑排序后的依赖模块序列
    let sortedModuleNames: Array<string> = new Array();

    const fs = require("fs");

    // 递归地引入所有依赖文件，并检测循环依赖
    function importModule(pathOrCode: string, isPath: boolean): void {
        let code: string;
        let moduleQualifiedName: string;
        if(isPath) {
            try {
                code = fs.readFileSync(pathOrCode, "utf-8");
                code = `((lambda () ${code}))\n`;
                moduleQualifiedName = PathUtils.GetModuleQualifiedName(pathOrCode);
            }
            catch {
                throw `[Error] 模块“${pathOrCode}”未找到。`
            }
        }
        else {
            code = pathOrCode;
            moduleQualifiedName = REPLModuleQualifiedName;
        }

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
            importModule(dependencyPath, true);
        }
    }

    importModule(code, false);

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
    mergedModule.AST = allASTs.get(REPLModuleQualifiedName);
    // 按照依赖关系图的拓扑排序进行融合
    // NOTE 由于AST融合是将被融合（依赖）的部分放在前面，所以这里需要逆序进行
    for(let i = sortedModuleNames.length - 1; i >= 0; i--) {
        let moduleName = sortedModuleNames[i];
        if(moduleName === REPLModuleQualifiedName) continue;
        mergedModule.AST.MergeAST(allASTs.get(moduleName), "top");
    }
    // 编译
    mergedModule.ILCode = Compile(mergedModule.AST);
    return mergedModule;
}

class REPL {
    public allCode: Array<string>;
    public RUNTIME: Runtime;
    public inputBuffer: Array<string>;

    constructor() {
        this.allCode = new Array();
        this.RUNTIME = new Runtime();
        this.inputBuffer = new Array();
    }

    public run(input: string, callback: ()=>any): void {
        try {
            let code = `((lambda () ${this.allCode.join(" ")} (display ${input}) (newline) ))\n`;

            let mod = LoadModuleFromCode(code, "REPL");

            let proc = new Process(mod);
            proc.PID = 0;

            this.RUNTIME.asyncCallback = callback;  // NOTE 用于文件读写等异步操作结束之后执行
            this.RUNTIME.processPool[0] = proc;
            this.RUNTIME.AddProcess(proc);
            this.RUNTIME.StartClock(callback);

            // TODO 仅保留有副作用的语句
            if(/define|set!|native|import/gi.test(input)) {
                this.allCode.push(input);
            }
        }
        catch(e) {
            process.stderr.write(`${e.toString()}\n`);
            callback();
        }
    }

    public CountBrackets(input: string): number {
        let bcount = 0;
        for(let i = 0; i < input.length; i++) {
            if(input[i] === "(" || input[i] === "{") bcount++;
            else if(input[i] === ")" || input[i] === "}") bcount--;
        }
        return bcount;
    }

    public ReadEvalPrint(input: string): void {
        input = input.toString();
        if(input.trim() === ".help") {
            this.RUNTIME.Output(`AuroraScheme\n`);
            this.RUNTIME.Output(`Copyright (c) 2019 mikukonai@GitHub, Licenced under MIT.\n`);
            this.RUNTIME.Output(`https://github.com/mikukonai/AuroraScheme\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`REPL Command Reference:\n`);
            this.RUNTIME.Output(`  .exit     exit the REPL.\n`);
            this.RUNTIME.Output(`  .reset    reset the REPL to initial state.\n`);
            this.RUNTIME.Output(`  .help     show usage and copyright information.\n`);
            this.RUNTIME.Output(`\n`);
            this.RUNTIME.Output(`> `);
            return;
        }
        else if(input.trim() === ".exit") {
            process.exit();
        }
        else if(input.trim() === ".reset") {
            this.allCode = new Array();
            this.RUNTIME.Output(`REPL已重置。\n`);
            this.RUNTIME.Output(`> `);
            return;
        }

        this.inputBuffer.push(input);
        let code = this.inputBuffer.join("");
        let indentLevel = this.CountBrackets(code);
        if(indentLevel === 0) {
            this.inputBuffer = new Array();
            this.run(code, ()=> {
                if(this.RUNTIME.processPool[0] !== undefined && this.RUNTIME.processPool[0].state === ProcessState.SLEEPING) {
                    return;
                }
                else {
                    this.RUNTIME.Output("> ");
                }
            });
        }
        else if(indentLevel > 0) {
            let prompt = "...";
            let icount = indentLevel - 1;
            while(icount > 0) {
                prompt += "..";
                icount--;
            }
            this.RUNTIME.Output(`${prompt} `);
        }
        else {
            this.inputBuffer = new Array();
            this.RUNTIME.Error(`[REPL Error] 括号不匹配\n`);
        }
    }

    public Start(): void {
        this.RUNTIME.Output(`AuroraScheme REPL\n`);
        this.RUNTIME.Output(`Type ".help" for more information.\n`);
        this.RUNTIME.Output(`> `);

        process.stdin.on("data", (input)=>{this.ReadEvalPrint(input);});
    }
}
