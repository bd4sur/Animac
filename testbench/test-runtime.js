const Common = require('../source/common.js');
const Process = require('../source/process.js');
const ModuleLoader = require('../source/module-loader.js');
const Runtime = require('../source/runtime.js');

// 载入模块（依赖分析→编译）
// let modulePath = './testcase/aurora/testcase/factorial.scm';
// let modulePath = './testcase/aurora/testcase/factorial-cps.scm';
// let modulePath = './testcase/aurora/testcase/factorial-purecps.scm';
// let modulePath = './testcase/aurora/testcase/fork.scm';
// let modulePath = './testcase/aurora/testcase/generator.scm';
// let modulePath = './testcase/aurora/testcase/main.scm';
// let modulePath = './testcase/aurora/testcase/man-or-boy-test.scm';
// let modulePath = './testcase/aurora/testcase/native.scm';
// let modulePath = './testcase/aurora/testcase/quicksort.scm';
// let modulePath = './testcase/aurora/testcase/yin-yang-puzzle.scm';
let modulePath = './testcase/aurora/testcase/church-encoding.scm';

let MODULE = ModuleLoader.ModuleLoader(modulePath, './testcase');

// 初始化进程
let PROCESS = new Process.Process();
PROCESS.Init(1, 0, "Test", 10000, MODULE);

// 初始化环境
let RUNTIME = new Runtime.Runtime();
RUNTIME.AddProcess(PROCESS);

// 启动
RUNTIME.StartClock(false);
