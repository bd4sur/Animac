// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// nativelib/File.js
// File本地库

const fs = require('fs');

const Common = require('../common.js');
const Executor = require('../executor.js');

// 首次尝试实现JS调用Scheme（通过回调）
// 实现思路是模拟另外一个VM实例
// 如果native里面调用了native，那么相应地VM实例也是嵌套的
// 但无论如何嵌套，都是针对同一个进程进行操作
// 在这种机制下，涉及continuation的操作，结果的正确性目前还不清楚。
const read = function(avmArgs, avmProcess, avmRuntime) {
    if(avmProcess.STATE === Common.PROCESS_STATE.SLEEPING) {
        avmProcess.STATE = Common.PROCESS_STATE.SLEEPING;
    }
    else {
        // console.log(`开始阻塞(file)`);
        avmProcess.STATE = Common.PROCESS_STATE.SLEEPING;

        let path = avmProcess.GetObject(avmArgs[0]).value;
        let callback = avmArgs[1];
        fs.readFile(path, {encoding:"utf-8"}, (error, data)=> {
            if(error) {
                console.error(error);
                avmProcess.STATE = Common.PROCESS_STATE.RUNNING;
                avmProcess.PC++;
            }

            avmProcess.STATE = Common.PROCESS_STATE.RUNNING;

            // 执行Scheme回调 (lambda (content) ...)
            let strRef = avmProcess.NewObject('STRING', data.toString());
            avmProcess.OPSTACK.push(strRef);

            let currentPC = avmProcess.PC;

            ///////////////////////////////////
            // 执行调用回调的操作
            // 以下照抄executor实现
            ///////////////////////////////////

            // 新的栈帧入栈
            avmProcess.pushStackFrame(avmProcess.CURRENT_CLOSURE_REF, avmProcess.PC + 1);
            // 判断参数类型
            if(Common.TypeOfToken(callback) === 'KEYWORD') {
                // TODO 增加对primitive的一等支持
            }
            else if(Common.TypeOfToken(callback) === 'LABEL') {
                let instAddr = (avmProcess.LABEL_DICT)[arg];
                avmProcess.CURRENT_CLOSURE_REF = avmProcess.newClosure(instAddr, avmProcess.CURRENT_CLOSURE_REF);
                avmProcess.PC = instAddr;
            }
            else if(Common.TypeOfToken(callback) === 'REF_CLOSURE') {
                let targetClosure = avmProcess.getClosure(callback);
                avmProcess.CURRENT_CLOSURE_REF = callback;
                avmProcess.PC = targetClosure.instructionIndex;
            }
            else {
                throw `[Native:File.read] 回调函数必须是函数或闭包`;
            }
            // 将自身从runtime的睡眠线程中换到线程池中，并重启时钟
            avmRuntime.AddProcess(avmProcess);
            // 执行Scheme回调函数，直至返回此条指令的下一条指令的位置
            avmRuntime.StartClock(avmProcess.PC === currentPC + 1);
            /*
            while(1) {
            // let newVM = setInterval(()=> {
                if(avmProcess.PC === currentPC + 1) {
                    // clearInterval(newVM);
                    // return;
                    break;
                }
                if(avmProcess.STATE !== Common.PROCESS_STATE.SLEEPING) {
                    Executor.Executor(avmProcess, avmRuntime);
                }
            // }, 0);
            }
            */
        });
    }
};

module.exports.read = read;
