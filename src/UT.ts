
///////////////////////////////////////////////
// UT.ts
// 单元测试

function UT(sourcePath: string) {
    // 处理相对路径
    if(path.isAbsolute(sourcePath) === false) {
        sourcePath = path.join(process.cwd(), sourcePath);
    }
    // 以代码所在路径为工作路径
    let workingDir = path.dirname(sourcePath);

    let linkedModule = LoadModule(sourcePath, workingDir);
    // fs.writeFileSync("module.json", JSON.stringify(linkedModule, null, 2), "utf-8");

    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);

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
    default:
    case "repl":
        let repl = new REPL();
        repl.Start();
        break;
}
