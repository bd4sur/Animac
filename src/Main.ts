
///////////////////////////////////////////////
// Main.ts
// 系统入口（外壳）

// 将Scheme代码文件编译为可执行文件
function compileCodeToExecutable(inputAbsPath: string, outputAbsPath: string) {
    // 以代码所在路径为工作路径
    let workingDir = path.dirname(inputAbsPath);
    let linkedModule = LoadModule(inputAbsPath, workingDir);
    fs.writeFileSync(outputAbsPath, JSON.stringify(linkedModule, null, 2), "utf-8");
}

// 直接执行模块文件
function runFromExecutable(execAbsPath: string) {
    let workingDir = process.cwd();
    let moduleJson = JSON.parse(fs.readFileSync(execAbsPath, "utf-8"));
    let PROCESS = new Process(moduleJson);
    let RUNTIME = new Runtime(workingDir);
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

function runFromFile(srcAbsPath: string) {
    // 以代码所在路径为工作路径
    let workingDir = path.dirname(srcAbsPath);

    let linkedModule = LoadModule(srcAbsPath, workingDir);
    // fs.writeFileSync("module.json", JSON.stringify(linkedModule, null, 2), "utf-8");

    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

function runFromCode(code: string) {
    let workingDir = process.cwd();
    let virtualFilename = "temp.scm";

    code = `((lambda () (display { ${code} }) (newline) ))\n`;

    let linkedModule = LoadModuleFromCode(code, path.join(workingDir, virtualFilename));

    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

function shellPrompt() {

}

function Main() {
    let argv = process.argv.slice(2);

    let option = (argv[0] || "").trim().toLowerCase();

    // REPL
    if(option === "") {
        let sourcePath = TrimQuotes(argv[1]);
        if(sourcePath.length > 0) {
            // 相对路径补全为绝对路径
            if(path.isAbsolute(sourcePath) === false) {
                sourcePath = path.join(process.cwd(), sourcePath);
            }
            runFromFile(sourcePath);
        }
        else {
            let repl = new REPL();
            repl.Start();
        }
    }
    // 从stdin读取代码并执行
    else if(option === "-") {
        process.stdin.on("data", (input)=>{
            runFromCode(input.toString());
        });
    }
    else if(option === "-c" || option === "--compile") {
        let inputPath = TrimQuotes(argv[1]);
        let outputPath = TrimQuotes(argv[2]);
        if(path.isAbsolute(inputPath) === false) {
            inputPath = path.join(process.cwd(), inputPath);
        }
        outputPath = (outputPath.length > 0) ? outputPath : (path.basename(inputPath, ".scm") + ".json");
        if(path.isAbsolute(outputPath) === false) {
            outputPath = path.join(path.dirname(inputPath), outputPath);
        }
        compileCodeToExecutable(inputPath, outputPath);
        console.log(`Compiled Animac VM executable file saved at: ${outputPath}\n`);
    }
    else if(option === "-d" || option === "--debug") {
        StartDebugServer();
    }
    else if(option === "-e" || option === "--eval") {
        let code = TrimQuotes(argv[1]);
        runFromCode(code.toString());
    }
    // 显示帮助信息
    else if(option === "-h" || option === "--help") {
        console.log(ANIMAC_HELP);
    }
    // 解释执行编译后的模块
    else if(option === "-i" || option === "--intp") {
        let modulePath = TrimQuotes(argv[1]);
        if(path.isAbsolute(modulePath) === false) {
            modulePath = path.join(process.cwd(), modulePath);
        }
        runFromExecutable(modulePath);
    }
    else if(option === "-r" || option === "--repl") {
        let repl = new REPL();
        repl.Start();
    }
    else if(option === "-v" || option === "--version") {
        console.log(ANIMAC_VERSION);
    }
    // 如果没有可识别的参数，则第一个参数视为输入代码路径
    else {
        let sourcePath = TrimQuotes(argv[0]);
        // 相对路径补全为绝对路径
        if(path.isAbsolute(sourcePath) === false) {
            sourcePath = path.join(process.cwd(), sourcePath);
        }
        runFromFile(sourcePath);
    }
}

Main();
