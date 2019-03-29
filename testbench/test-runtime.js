const Common = require('../source/common.js');
const Process = require('../source/process.js');
const ModuleLoader = require('../source/module-loader.js');
const Runtime = require('../source/runtime.js');

// 载入模块（依赖分析→编译）
let MODULE = ModuleLoader.ModuleLoader('./testcase/aurora/testcase/native.scm', './testcase');

// 初始化进程
let PROCESS = new Process.Process();
PROCESS.Init(1, 0, "Test", 10000, MODULE);

// 初始化环境
let RUNTIME = new Runtime.Runtime();
RUNTIME.AddProcess(PROCESS);

// 假装有调度器
setInterval(()=> {
    RUNTIME.Tick();
}, 0);
