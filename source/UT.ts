
///////////////////////////////////////////////
// UT.ts
// 单元测试

const fs = require("fs");

function UT() {
    // TODO 相对路径处理
    let sourcePath = "E:/Desktop/GitRepos/AuroraScheme/testcase/quasiquote.scm";

    let targetModule = LoadModule(sourcePath);
    fs.writeFileSync("E:/Desktop/GitRepos/AuroraScheme/testcase/Module.json", JSON.stringify(targetModule, null, 2), "utf-8");

    let PROCESS = new Process(targetModule);
    let RUNTIME = new Runtime();

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

// UT();
REPL();

