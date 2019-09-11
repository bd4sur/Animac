
// REPL.ts
// Read-Eval-Print Loop

function REPL() {
    let init = true;
    let pid = 0;
    let allCode = new Array();
    let RUNTIME = new Runtime();

    process.stdin.on("data", (input)=> {
        input = input.toString();
        try {
            let code = `((lambda () ${allCode.join(" ")} ${input}))\n`;
            let AST = Analyse(Parse(code, "REPL"));
            // 删除除了最后一个节点之外的所有节点
            let globalNodes = AST.GetGlobalNodes();
            AST.SetGlobalNodes([Top(globalNodes)]);
            // 编译并组建模块
            let module: Module = new Module();
            module.AST = AST;
            module.ILCode = Compile(AST);
            // 创建VM
            if(init === true) {
                let PROCESS = new Process(module);
                pid = RUNTIME.AddProcess(PROCESS);
                init = false;
            }
            else {
                RUNTIME.processPool[pid].AST = module.AST;
                RUNTIME.processPool[pid].instructions = module.ILCode;
                RUNTIME.processPool[pid].labelMapping = new HashMap();
                RUNTIME.processPool[pid].PC = 0;
                // 标签分析
                RUNTIME.processPool[pid].LabelAnalysis();
                console.log("RT=");
                console.log(JSON.stringify(RUNTIME));
            }
            RUNTIME.StartClock();
            
            allCode.push(input);
        }
        catch(e) {
            process.stderr.write(e.toString());
        }
    });
}

