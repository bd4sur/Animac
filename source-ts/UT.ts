
///////////////////////////////////////////////
// UT.ts
// 单元测试

const fs = require("fs");

function UT() {
    // TODO 相对路径处理
    let sourcePath = "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.main.scm";

    let targetModule = LoadModule(sourcePath);
    fs.writeFileSync("E:/Desktop/GitRepos/AuroraScheme/testcase/Module.json", JSON.stringify(targetModule, null, 2), "utf-8");

    // 捎带着测试一下AVM
    let process = new Process(targetModule);

    while(process.state !== ProcessState.STOPPED) {
        // console.log(process.CurrentInstruction().instruction);
        Execute(process, null);
    }
}

UT();

