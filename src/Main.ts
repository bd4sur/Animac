
///////////////////////////////////////////////
// Main.ts
// 系统入口（外壳）

// 将Scheme代码文件编译为可执行文件
function compileCodeToExecutable(inputAbsPath: string, outputAbsPath: string) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(inputAbsPath);
    let linkedModule = LoadModule(inputAbsPath, workingDir);
    FileUtils.WriteFileSync(outputAbsPath, JSON.stringify(linkedModule, null, 2));
}

// 直接执行模块文件
function runFromExecutable(execAbsPath: string) {
    let workingDir = process.cwd();
    let moduleJson = JSON.parse(FileUtils.ReadFileSync(execAbsPath));
    let PROCESS = new Process(moduleJson);
    let RUNTIME = new Runtime(workingDir);
    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

function runFromFile(srcAbsPath: string) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(srcAbsPath);

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

    let linkedModule = LoadModuleFromCode(code, PathUtils.Join(workingDir, virtualFilename));

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
            if(PathUtils.IsAbsolutePath(sourcePath) === false) {
                sourcePath = PathUtils.Join(process.cwd(), sourcePath);
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
        if(PathUtils.IsAbsolutePath(inputPath) === false) {
            inputPath = PathUtils.Join(process.cwd(), inputPath);
        }
        outputPath = (outputPath.length > 0) ? outputPath : (PathUtils.BaseName(inputPath, ".scm") + ".json");
        if(PathUtils.IsAbsolutePath(outputPath) === false) {
            outputPath = PathUtils.Join(PathUtils.DirName(inputPath), outputPath);
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
        if(PathUtils.IsAbsolutePath(modulePath) === false) {
            modulePath = PathUtils.Join(process.cwd(), modulePath);
        }
        runFromExecutable(modulePath);
    }
    else if(option === "-r" || option === "--repl") {
        let repl = new REPL();
        repl.Start();
    }
    else if(option === "-v" || option === "--version") {
        console.log(`V${ANIMAC_CONFIG.version}`);
    }
    // 如果没有可识别的参数，则第一个参数视为输入代码路径
    else {
        let sourcePath = TrimQuotes(argv[0]);
        // 相对路径补全为绝对路径
        if(PathUtils.IsAbsolutePath(sourcePath) === false) {
            sourcePath = PathUtils.Join(process.cwd(), sourcePath);
        }
        runFromFile(sourcePath);
    }
}

Main();
