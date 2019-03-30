// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// execotor.js
// 执行机
//   执行进程PC指定的代码，并访问线程内部或外部的存储区域

const child_process = require('child_process');
const path = require('path');
const Common = require('./common.js');
const Compiler = require('./compiler.js');
const Process = require('./process.js');
const ModuleLoader = require('./module-loader.js');

// 运行时
const Executor = function(PROCESS, RUNTIME/*, 预留访问VM环境的接口*/) {

    // 上溯闭包，获取变量绑定的值
    function getBoundValue(variable) {
        try {
            let curCloRef = PROCESS.CURRENT_CLOSURE_REF;
            let currentClosure = PROCESS.getClosure(curCloRef);
            while(parseInt(Common.getRefIndex(curCloRef)) >= PROCESS.FIRST_CLOSURE_INDEX && currentClosure) {
                if(variable in currentClosure.env) {
                    return (currentClosure.env)[variable];
                }
                currentClosure = PROCESS.getClosure(currentClosure.parentClosureRef);
                curCloRef = currentClosure.parentClosureRef;
            }
        }
        catch(e) {
            throw `[虚拟机错误] 变量'${variable}' at Closure${PROCESS.CURRENT_CLOSURE_REF}未定义：${e.toString()}`;
        }
    }

    // 指令解析
    function parseInstruction(instline) {
        let fields = instline.split(/\s+/i);
        let mnemonic = fields[0].toLowerCase();
        let argType = Common.TypeOfToken(fields.slice(1).join(' '));
        let argIndex = (fields.slice(1).join(' ')) ? Common.getRefIndex(fields.slice(1).join(' ')) : ''; // 暂时允许字符串
        let instObj = {
            instruction: instline,
            mnemonic: mnemonic,
            arg: fields.slice(1).join(' '),
            argType: argType, // 注意：参数类型含“REF_”
            argIndex: argIndex,
        };
        return instObj;
    }

    let state = PROCESS.STATE;


    // 取出指令行，并解析之
    let instruction = (PROCESS.INSTRUCTIONS)[PROCESS.PC];
    let instObj = parseInstruction(instruction);
    let mnemonic = instObj.mnemonic;
    let arg = instObj.arg;
    let argType = instObj.argType;
    let argIndex = instObj.argIndex;

    // console.log(instruction);

    // 指令译码
    if(/^\s*\;[\s\S]*$/.test(instruction)) { // 注释跳过
        PROCESS.PC++;
    }
    else if(Common.TypeOfToken(mnemonic) === 'LABEL') {
        PROCESS.PC++;
    }
    else if(mnemonic === 'nop') {
        PROCESS.PC++;
    }
    else if(mnemonic === 'halt') {
        // console.info(`[虚拟机通知] 进程[${PROCESS.PID}]执行完毕。`);
        PROCESS.STATE = Common.PROCESS_STATE.DEAD;
    }
    else if(mnemonic === 'display') {
        let arg = PROCESS.OPSTACK.pop();
        let str = PROCESS.ObjectToString(arg);
        console.warn(`[虚拟机通知] 输出：${str}`);
        // this.OUTPUT(str.toString());
        PROCESS.PC++;
    }
    else if(mnemonic === 'newline') {
        console.warn(`[虚拟机通知] 换行`);
        // this.OUTPUT('<br>');
        PROCESS.PC++;
    }
    else if(mnemonic === 'call') {
        // 新的栈帧入栈
        PROCESS.pushStackFrame(PROCESS.CURRENT_CLOSURE_REF, PROCESS.PC + 1);
        // 判断参数类型
        if(argType === 'KEYWORD') {
            // TODO 增加对primitive的一等支持
        }
        else if(argType === 'LABEL') {
            let instAddr = (PROCESS.LABEL_DICT)[arg];
            PROCESS.CURRENT_CLOSURE_REF = PROCESS.newClosure(instAddr, PROCESS.CURRENT_CLOSURE_REF);
            PROCESS.PC = instAddr;
        }
        else if(argType === 'REF_VARIABLE') {
            let value = getBoundValue(argIndex);
            if(Common.TypeOfToken(value) === 'LABEL') {
                let instAddr = (PROCESS.LABEL_DICT)[value];
                PROCESS.CURRENT_CLOSURE_REF = PROCESS.newClosure(instAddr, PROCESS.CURRENT_CLOSURE_REF);
                PROCESS.PC = instAddr;
            }
            else if(Common.TypeOfToken(value) === 'REF_CLOSURE') {
                let targetClosure = PROCESS.getClosure(value);
                PROCESS.CURRENT_CLOSURE_REF = value;
                PROCESS.PC = targetClosure.instructionIndex;
            }
            else if(Common.TypeOfToken(value) === 'REF_CONTINUATION') {
                let top = (PROCESS.OPSTACK).pop(); // 调用continuation必须带一个参数，TODO 这个检查在编译时完成
                let retTargetTag = PROCESS.loadContinuation(value);

                PROCESS.OPSTACK.push(top);
                // console.log(`Continuation已恢复，返回标签：${retTargetTag}`);
                PROCESS.PC = PROCESS.LABEL_DICT[retTargetTag];
            }
            else {
                throw `[虚拟机错误] 调用对象必须是代码、闭包或continuation`;
            }
        }
    }
    else if(mnemonic === 'tailcall') {
        // 判断参数类型
        if(argType === 'KEYWORD') {
            // TODO 增加对primitive的一等支持
        }
        else if(argType === 'LABEL') {
            PROCESS.PC = (PROCESS.LABEL_DICT)[arg];
        }
        else if(argType === 'REF_VARIABLE') {
            let value = getBoundValue(argIndex);
            if(Common.TypeOfToken(value) === 'LABEL') {
                let instAddr = (PROCESS.LABEL_DICT)[value];
                PROCESS.PC = instAddr;
            }
            else if(Common.TypeOfToken(value) === 'REF_CLOSURE') {
                let targetClosure = PROCESS.getClosure(value);
                PROCESS.CURRENT_CLOSURE_REF = value;
                PROCESS.PC = targetClosure.instructionIndex;
            }
            else if(Common.TypeOfToken(value) === 'REF_CONTINUATION') {
                let top = (PROCESS.OPSTACK).pop(); // 调用continuation必须带一个参数，TODO 这个检查在编译时完成
                let retTargetTag = PROCESS.loadContinuation(value);

                PROCESS.OPSTACK.push(top);
                // console.log(`Continuation已恢复，返回标签：${retTargetTag}`);
                PROCESS.PC = PROCESS.LABEL_DICT[retTargetTag];
            }
            else {
                throw `[虚拟机错误] 调用对象必须是代码或者闭包`;
            }
        }
    }
    else if(mnemonic === 'return') {
        let stackframe = (PROCESS.FSTACK).pop(); // 栈帧退栈
        PROCESS.CURRENT_CLOSURE_REF = stackframe.closure; // 修改当前闭包
        PROCESS.PC = stackframe.returnTo; // 跳转到返回地址
        stackframe = null; // 销毁当前栈帧
    }
    else if(mnemonic === 'store') {
        if(argType !== 'REF_VARIABLE') {
            throw `[虚拟机错误] store指令参数类型不是变量`;
        }
        let variable = argIndex;
        let value = (PROCESS.OPSTACK).pop();
        (PROCESS.getClosure(PROCESS.CURRENT_CLOSURE_REF).env)[variable] = value;
        // ((ENV.CLOSURES)[PROCESS.CURRENT_CLOSURE_REF.substring(1)].env)[variable] = value;
        PROCESS.PC++;
    }
    else if(mnemonic === 'load') {
        if(argType === 'LABEL') {
            let instAddr = (PROCESS.LABEL_DICT)[arg];
            let closureAddr = PROCESS.newClosure(instAddr, PROCESS.CURRENT_CLOSURE_REF);
            (PROCESS.OPSTACK).push(closureAddr);
        }
        else if(argType === 'REF_VARIABLE') {
            let variable = argIndex;
            let value = getBoundValue(variable);
            if(Common.TypeOfToken(value) === 'LABEL') { // 指令地址，需要新建闭包
                let instAddr = (PROCESS.LABEL_DICT)[value];
                let closureAddr = PROCESS.newClosure(instAddr, PROCESS.CURRENT_CLOSURE_REF);
                (PROCESS.OPSTACK).push(closureAddr);
            }
            else {
                (PROCESS.OPSTACK).push(value);
            }
        }
        else {
            (PROCESS.OPSTACK).push(arg);
        }
        PROCESS.PC++;
    }
    else if(mnemonic === 'set!') {
        let symbol = argIndex;
        let value = (PROCESS.OPSTACK).pop();
        // 沿闭包链修改，直到找到约束变量绑定，修改之
        let closureIndex = parseInt(Common.getRefIndex(PROCESS.CURRENT_CLOSURE_REF));
        while(closureIndex >= PROCESS.FIRST_CLOSURE_INDEX && closureIndex in PROCESS.CLOSURES) {
            if(symbol in ((PROCESS.CLOSURES)[closureIndex]).env) {
                (((PROCESS.CLOSURES)[closureIndex]).env)[symbol] = value;
                break;
            }
            closureIndex = parseInt(Common.getRefIndex((PROCESS.CLOSURES)[closureIndex].parentClosureRef));
        }
        PROCESS.PC++;
    }
    else if(mnemonic === 'push') {
        (PROCESS.OPSTACK).push(arg);  // 只允许立即值和标签（原形）
        PROCESS.PC++;
    }
    else if(mnemonic === 'pop') {
        (PROCESS.OPSTACK).pop();
        PROCESS.PC++;
    }
    else if(mnemonic === 'swap') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        (PROCESS.OPSTACK).push(top1);
        (PROCESS.OPSTACK).push(top2);
        PROCESS.PC++;
    }

    else if(mnemonic === 'iftrue') {
        if(argType !== 'LABEL') {
            throw `[虚拟机错误] 分支跳转指令的参数必须是标签`;
        }
        let value = (PROCESS.OPSTACK).pop();
        if(value !== '#f') {
            PROCESS.PC = (PROCESS.LABEL_DICT)[arg];
        }
        else {
            PROCESS.PC++;
        }
    }

    else if(mnemonic === 'iffalse') {
        if(argType !== 'LABEL') {
            throw `[虚拟机错误] 分支跳转指令的参数必须是标签`;
        }
        let value = (PROCESS.OPSTACK).pop();
        if(value === '#f') {
            PROCESS.PC = (PROCESS.LABEL_DICT)[arg];
        }
        else {
            PROCESS.PC++;
        }
    }

    else if(mnemonic === 'goto') {
        if(argType !== 'LABEL') {
            throw `[虚拟机错误] 分支跳转指令的参数必须是标签`;
        }
        PROCESS.PC = (PROCESS.LABEL_DICT)[arg];
    }

    else if(mnemonic === '+') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) + parseFloat(operand1)).toString());
        PROCESS.PC++;
    }
    else if(mnemonic === '-') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) - parseFloat(operand1)).toString());
        PROCESS.PC++;
    }
    else if(mnemonic === '*') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) * parseFloat(operand1)).toString());
        PROCESS.PC++;
    }
    else if(mnemonic === '/') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) / parseFloat(operand1)).toString());
        PROCESS.PC++;
    }
    else if(mnemonic === '=') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) === parseFloat(operand1)) ? "#t" : "#f");
        PROCESS.PC++;
    }
    else if(mnemonic === '<=') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) <= parseFloat(operand1)) ? "#t" : "#f");
        PROCESS.PC++;
    }
    else if(mnemonic === '>=') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) >= parseFloat(operand1)) ? "#t" : "#f");
        PROCESS.PC++;
    }
    else if(mnemonic === '<') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) < parseFloat(operand1)) ? "#t" : "#f");
        PROCESS.PC++;
    }
    else if(mnemonic === '>') {
        let top1 = (PROCESS.OPSTACK).pop();
        let top2 = (PROCESS.OPSTACK).pop();
        // TODO 类型检查与转换
        let operand1 = (isNaN(parseFloat(top1))) ? PROCESS.GetObject(top1).value : top1;
        let operand2 = (isNaN(parseFloat(top2))) ? PROCESS.GetObject(top2).value : top2;
        (PROCESS.OPSTACK).push((parseFloat(operand2) > parseFloat(operand1)) ? "#t" : "#f");
        PROCESS.PC++;
    }

    else if(mnemonic === 'not') {
        let arg = (PROCESS.OPSTACK).pop();
        let operand = (isNaN(parseFloat(arg))) ? PROCESS.GetObject(arg).value : arg;
        if(operand !== '#f') {
            (PROCESS.OPSTACK).push('#t');
        }
        else {
            (PROCESS.OPSTACK).push('#f');
        }
        PROCESS.PC++;
    }

    // TODO 逻辑不正确，待修改
    else if(mnemonic === 'atom?') {
        let arg = (PROCESS.OPSTACK).pop();
        let argtype = Common.TypeOfToken(arg);
        if(argtype === 'REF_SLIST') {
            (PROCESS.OPSTACK).push('#f');
        }
        else {
            (PROCESS.OPSTACK).push('#t');
        }
        PROCESS.PC++;
    }

    // 20190214 新增
    else if(mnemonic === 'list?') {
        let arg = (PROCESS.OPSTACK).pop();
        let argtype = Common.TypeOfToken(arg);
        if(argtype === 'REF_SLIST') {
            (PROCESS.OPSTACK).push('#t');
        }
        else {
            (PROCESS.OPSTACK).push('#f');
        }
        PROCESS.PC++;
    }

    // 20190214 新增
    else if(mnemonic === 'null?') {
        let slistRef = (PROCESS.OPSTACK).pop();
        if(Common.TypeOfToken(slistRef) === 'REF_SLIST') {
            let slist = PROCESS.GetObject(slistRef).value;
            if(slist.children.length <= 0) {
                (PROCESS.OPSTACK).push('#t');
            }
            else {
                (PROCESS.OPSTACK).push('#f');
            }
        }
        else {
            (PROCESS.OPSTACK).push('#f');
        }
        PROCESS.PC++;
    }

    // 20190214 新增
    else if(mnemonic === 'car') {
        let slistRef = (PROCESS.OPSTACK).pop();
        // 类型检查
        if(Common.TypeOfToken(slistRef) === 'REF_SLIST') {
            let slist = PROCESS.GetObject(slistRef).value;
            if(slist.children.length <= 0) {
                throw `[错误] car参数是空表`;
            }
            else {
                let first = (slist.children)[0];
                (PROCESS.OPSTACK).push(first);
            }
        }
        else { throw `[错误] car参数类型错误`; }
        PROCESS.PC++;
    }

    // 20190214 新增
    else if(mnemonic === 'cdr') {
        let slistRef = (PROCESS.OPSTACK).pop();
        // 类型检查
        if(Common.TypeOfToken(slistRef) === 'REF_SLIST') {
            let slist = PROCESS.GetObject(slistRef).value;
            if(slist.children.length <= 0) {
                throw `[错误] cdr参数是空表`;
            }
            else if(slist.type === 'LAMBDA') {
                throw `[错误] cdr参数是lambda`;
            }
            else {
                let newlist = {
                    "type": slist.type,
                    "index": null, // 待定
                    "parentIndex": slist.index,
                    "children": slist.children.slice(1),
                    "isQuoted": slist.isQuoted,
                    "parameters": [],
                    "body": slist.body,
                };
                let newref = PROCESS.NewObject('SLIST', newlist);
                newlist.index = parseInt(Common.getRefIndex(newref));
                (PROCESS.OPSTACK).push(newref);
            }
        }
        else { throw `[错误] car参数类型错误`; }
        PROCESS.PC++;
    }

    // 20190214 新增
    else if(mnemonic === 'cons') {
        let slistRef = (PROCESS.OPSTACK).pop();
        let first = (PROCESS.OPSTACK).pop();
        // 类型检查
        if(Common.TypeOfToken(slistRef) === 'REF_SLIST') {
            let slist = PROCESS.GetObject(slistRef).value;
            if(slist.type === 'LAMBDA') {
                throw `[错误] 不能在lambda列表上执行cons`;
            }
            else {
                let newlist = {
                    "type": slist.type,
                    "index": null, // 待定
                    "parentIndex": slist.index,
                    "children": [first].concat(slist.children),
                    "isQuoted": slist.isQuoted,
                    "parameters": [],
                    "body": slist.body,
                };
                let newref = PROCESS.NewObject('SLIST', newlist);
                newlist.index = parseInt(Common.getRefIndex(newref));
                (PROCESS.OPSTACK).push(newref);
            }
        }
        else { throw `[错误] cons参数类型错误`; }
        PROCESS.PC++;
    }

    else if(mnemonic === 'capturecc') {
        if(argType !== 'REF_VARIABLE') {
            throw `[虚拟机错误] capturecc指令参数类型不是变量`;
        }
        let variable = argIndex;
        let retTargetTag = `@${arg}`; // @+cont的变量引用=cont返回点的标签名称
        let contRef = PROCESS.newContinuation(retTargetTag);
        // console.log(`Continuation ${variable} 已捕获，对应的返回标签 ${retTargetTag}`);
        ((PROCESS.CLOSURES)[parseInt(Common.getRefIndex(PROCESS.CURRENT_CLOSURE_REF))].env)[variable] = contRef;
        PROCESS.PC++;
    }

    else if(mnemonic === 'gc') { // TODO 仅调试用
        PROCESS.GC();
        PROCESS.PC++;
    }

    else if(mnemonic === 'begin') { // TODO 暂且迁就编译器
        PROCESS.PC++;
    }

    else if(mnemonic === 'fork') {
        let code = arg; // $x，fork的参数必须是作为代码的SList。此list会作为((lambda () ..))的body被立即执行
        // 判断参数类型：参数必须是SList或者字符串引用
        if(argType === "REF_SLIST") {
            // 拷贝进程的AST
            let AST = JSON.parse(JSON.stringify(PROCESS.AST));
            AST.__proto__ = Common.AST.prototype;
            // 将$x对应的SList挂载到顶级lambda（$1）的body
            AST.GetObject('$1').body = [code];
            AST.GetObject(code).parentIndex = 1;
            // 编译AST
            let MODULE = Compiler.Compiler(PROCESS.MODULE_QUALIFIED_NAME+".test", PROCESS.MODULE_PATH, AST);
            // 构造新进程
            let newProcess = new Process.Process();
            // TODO: 此处的PID应当改进，保证在VM执行周期中生成的ID都不相同。
            newProcess.Init(Math.floor(Math.random() * 10000)/*PROCESS.PID+1*/, PROCESS.PID, PROCESS.USER, PROCESS.MAX_HEAP_INDEX, MODULE);
            // 在当前runtime中加入进程
            RUNTIME.AddProcess(newProcess);
        }
        else if(argType === "REF_STRING") {
            let basename = PROCESS.GetObject(arg).value;
            let absolutePath = path.join(path.dirname(PROCESS.MODULE_PATH), basename);
            let MODULE = ModuleLoader.ModuleLoader(absolutePath, Common.SYSTEM_CONFIGURATION.SOURCE_PATH);
            // 构造新进程
            let newProcess = new Process.Process();
            // TODO: 此处的PID应当改进，保证在VM执行周期中生成的ID都不相同。
            newProcess.Init(Math.floor(Math.random() * 10000)/*PROCESS.PID+1*/, PROCESS.PID, PROCESS.USER, PROCESS.MAX_HEAP_INDEX, MODULE);
            // 在当前runtime中加入进程
            RUNTIME.AddProcess(newProcess);
        }
        else {
            throw `[虚拟机错误] fork指令参数类型不正确`;
        }

        PROCESS.PC++;
    }

    // 调用native函数
    else if(mnemonic === 'callnative') {
        let arity = parseInt(arg);  // 注意：arity数含函数名称
        let nativeArgs = new Array();
        for(let i = arity - 1; i >= 0; i--) {
            nativeArgs[i] = PROCESS.OPSTACK.pop();
        }

        // 获取native函数所在的模块
        let nativeQualifiedName = nativeArgs.top();
        let nativeLibName = nativeQualifiedName.split('.')[0];
        let nativeFunctionName = nativeQualifiedName.split('.')[1];
        let nativeLib = require(`${RUNTIME.NATIVE_LIB_PATH}${nativeLibName}.js`);

        // 调用外部实现的native函数
        // TODO 应该对外部代码做一些validate
        nativeArgs.pop(); // 去掉栈顶的函数名
        (nativeLib[nativeFunctionName])(nativeArgs, PROCESS, RUNTIME); // NOTE：这里实际上体现了VM与native开发者所做的接口格式约定，类似于javah生成的那个头文件
        // TODO 虚拟机运行逻辑完全交由native库实现。因此此处需要做更多判断，或者后处理。
    }

    return state;

};

module.exports.Executor = Executor;
