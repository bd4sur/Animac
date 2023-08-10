
///////////////////////////////////////////////
// UT.ts
// 单元测试

const fs = require("fs");

function UT(sourcePath: string | void) {
    // TODO 相对路径处理
    sourcePath = sourcePath || "E:/Desktop/GitRepos/Animac/testcase/main.scm";

    let targetModule = LoadModule(sourcePath);
    // fs.writeFileSync("E:/Desktop/GitRepos/Animac/testcase/Module.json", JSON.stringify(targetModule, null, 2), "utf-8");

    let PROCESS = new Process(targetModule);
    let RUNTIME = new Runtime();

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}


let argv = process.argv.slice(2);
let option = argv[0] || "";
option = option.trim().toLowerCase();
let sourcePath = TrimQuotes(argv[1]);

switch(option) {
    case "debug":
        StartDebugServer();
        break;
    case "run":
        UT(sourcePath);
        break;
    case "test":
        UT();
        break;
    default:
    case "repl":
        let repl = new REPL();
        repl.Start();
        break;
}
