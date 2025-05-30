

function runFromCode(code: string) {
    let workingDir = "/test";
    let virtualFilename = "a.scm";

    code = `((lambda () (display { ${code} }) (newline) ))\n`;

    let linkedModule = LoadModuleFromCode(code, PathUtils.Join(workingDir, virtualFilename));

    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(()=>{});
}

function runFromFile(srcAbsPath: string, callback: ()=>any) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(srcAbsPath);

    let linkedModule = LoadModule(srcAbsPath, workingDir);

    let PROCESS = new Process(linkedModule);
    let RUNTIME = new Runtime(workingDir);

    RUNTIME.AddProcess(PROCESS);
    RUNTIME.StartClock(callback);
}
