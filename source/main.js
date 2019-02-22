// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// main.js
// 主入口
//   将一组Scheme源码经模块加载器编译成单一模块
//   然后生成一个运行时环境，即VM实例，执行之

const Common = require('common.js'); // 引入公用模块
