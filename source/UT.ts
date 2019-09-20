
///////////////////////////////////////////////
// UT.ts
// 单元测试

const fs = require("fs");

function UT() {
    // TODO 相对路径处理
    let sourcePath = "E:/Desktop/GitRepos/AuroraScheme/testcase/main.scm";

    let targetModule = LoadModule(sourcePath);
    // fs.writeFileSync("E:/Desktop/GitRepos/AuroraScheme/testcase/Module.json", JSON.stringify(targetModule, null, 2), "utf-8");

    let PROCESS = new Process(targetModule);
    let RUNTIME = new Runtime();

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}


let argv = process.argv.slice(2);
let option = argv[0] || "";
option = option.trim().toLowerCase();

switch(option) {
    case "repl":
        let repl = new REPL();
        repl.Start();
        break;
    case "debug":
        StartDebugServer();
        break;
    case "run":
        UT();
        break;
    default:
        process.stdout.write("Bad argument(s)");
}
