

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


let RUNTIME = new Runtime("/test");

function show_state(state) {
    console.log(state);
}

function loadFile(srcAbsPath: string, callback: ()=>any) {
    // 以代码所在路径为工作路径
    let workingDir = PathUtils.DirName(srcAbsPath);
    let linkedModule = LoadModule(srcAbsPath, workingDir);

    let PROCESS = new Process(linkedModule);
    PROCESS.PID = 0;
    RUNTIME.asyncCallback = callback;
    RUNTIME.processPool[0] = PROCESS;
    RUNTIME.AddProcess(PROCESS);
}

function execute() {
    RUNTIME.StartClock(()=>{
        show_state({
            process: RUNTIME.processPool[0],
            outputBuffer: RUNTIME.outputBuffer
        });
    });
}


function step() {
    RUNTIME.Tick(0);

    show_state({
        process: RUNTIME.processPool[0],
        outputBuffer: RUNTIME.outputBuffer
    });
}

function reset() {
    RUNTIME.outputBuffer = "";
    RUNTIME.errorBuffer = "";
    RUNTIME.processPool = new Array();
    RUNTIME.processQueue = new Array();

    show_state({
        process: RUNTIME.processPool[0],
        outputBuffer: RUNTIME.outputBuffer
    });
}
