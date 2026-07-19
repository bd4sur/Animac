
// 创建新的VM实例：其中workingDir是VM的工作目录，默认为/test
function AnimacInstance(workingDir: string) {
    this.RUNTIME = new Runtime(workingDir);
}

AnimacInstance.prototype = {
    loadFromFile: function(srcAbsPath: string, pid: number) {
        let workingDir = PathUtils.DirName(srcAbsPath); // 以代码所在路径为工作路径
        let linkedModule = LoadModule(srcAbsPath, workingDir);

        let PROCESS = new Process(linkedModule);
        PROCESS.PID = pid;
        this.RUNTIME.AddProcess(PROCESS);
    },

    loadFromString: function(code: string, mockAbsPath: string, pid: number) {
        code = `((lambda () (display { ${code} }) (newline) ))\n`;
        let linkedModule = LoadModuleFromCode(code, mockAbsPath);

        let PROCESS = new Process(linkedModule);
        PROCESS.PID = pid;
        this.RUNTIME.AddProcess(PROCESS);
    },

    start: function() {
        this.RUNTIME.StartClock();
    },

    step: function() {
        let vmState = this.RUNTIME.Tick(0);
        // 对所有进程执行垃圾回收
        if (ANIMAC_CONFIG.is_gc_enabled === true) {
            for (let i = 0; i < this.RUNTIME.processQueue.length; i++) {
                let pid = this.RUNTIME.processQueue[i];
                let process = this.RUNTIME.processPool[pid];
                process.GC();
                // console.log(`[GC] 进程${pid}已完成GC`);
            }
        }
        return vmState;
    },

    setCallback: function(
        callbackOnTick: (x: Runtime)=>any,
        callbackOnEvent: (x: Runtime)=>any,
        callbackOnHalt: (x: Runtime)=>any,
        callbackOnError: (x: Runtime)=>any
    ) {
        this.RUNTIME.callbackOnTick  = callbackOnTick;
        this.RUNTIME.callbackOnEvent = callbackOnEvent;
        this.RUNTIME.callbackOnHalt  = callbackOnHalt;
        this.RUNTIME.callbackOnError = callbackOnError;
    }
};
