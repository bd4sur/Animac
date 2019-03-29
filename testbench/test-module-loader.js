const Common = require('../source/common.js');
const Process = require('../source/process.js');
const ModuleLoader = require('../source/module-loader.js');
const Executor = require('../source/executor.js');

// 载入模块（依赖分析→编译）
let MODULE = ModuleLoader.ModuleLoader('./testcase/aurora/testcase/main.scm', './testcase');
console.log(`编译完成`);

// 初始化进程
let PROCESS = new Process.Process();
PROCESS.Init(1, 0, "Test", 10000, MODULE);
console.log(`进程初始化完成`);

let state = Common.PROCESS_STATE.DEFAULT;
while(state !== Common.PROCESS_STATE.DEAD) {
    state = Executor.Executor(PROCESS);
}
