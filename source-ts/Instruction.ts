
// Instruction.ts
// 指令集定义

/**
# 指令集实现

## 指令列表

### 第一类：基本存取指令

- store variable 将OP栈顶对象保存到当前闭包的约束变量中
- load variable 解引用变量，并将对象压入OP栈顶
- loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
- push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
- pop 弹出并抛弃OP栈顶
- swap 交换OP栈顶的两个对象的顺序
- set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）

### 第二类：分支跳转指令

- call arg 函数调用（包括continuation、native函数）
- tailcall arg 函数尾调用
- return 函数返回
- capturecc variable 捕获当前Continuation并将其把柄保存在变量中
- iftrue label 如果OP栈顶条件不为false则跳转
- iffalse label 如果OP栈顶条件为false则跳转
- goto label 无条件跳转

### 第三类：列表操作指令

- car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
- cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
- cons 同Scheme的cons

### 第四类：算术逻辑运算和谓词

- add/sub/mul/div/mod/pow
- eqn/lt/gt/le/ge
- and/or/not（注意and和or不同于Scheme的and/or，因Scheme的and/or有短路特性，本质上是条件分支）
- atom?/list?/null?

### 第五类：其他指令

- fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
- nop 空指令
- pause 暂停当前进程
- halt 停止当前进程

*/


class Instruction {
    public type: string;
    public argType: string;
    public instruction: string;
    public mnemonic: string;
    public argument: any;

    // 解析指令，并构造为指令对象
    constructor(instString: string) {
        instString = instString.trim();
        if(/^\s*\;[\s\S]*$/.test(instString)) { // 注释
            this.type = "COMMENT";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else if(instString[0] === '@') { // 标签
            this.type = "LABEL";
            this.instruction = instString;
            this.mnemonic = undefined;
            this.argument = undefined;
            this.argType = undefined;
        }
        else { // 普通指令
            let fields = instString.split(/\s+/i);
            let mnemonic = fields[0].toLowerCase();
            let argument = fields[1];

            this.type = "INSTRUCTION";
            this.instruction = instString;
            this.mnemonic = mnemonic;
            this.argument = argument;
            this.argType = TypeOfToken(argument);
        }
    }
}





// 以下是AIL指令实现（封装成函数）

///////////////////////////////////////
// 第一类：基本存取指令
///////////////////////////////////////

// store variable 将OP栈顶对象保存到当前闭包的约束变量中
function AIL_STORE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'VARIABLE') { throw `[Error] store指令参数类型不是变量`; }

    let variable = argument;
    let value = PROCESS.PopOperand();
    PROCESS.GetCurrentClosure().InitBoundVariable(variable, value);
    PROCESS.Step();
}

// load variable 解引用变量，并将对象压入OP栈顶
function AIL_LOAD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'VARIABLE') { throw `[Error] load指令参数类型不是变量`; }

    let variable = argument;
    let value = PROCESS.Dereference(variable);
    let valueType = TypeOfToken(value);

    // 值为标签，即loadclosure。
    if(valueType === 'LABEL') {
        let label = value;
        // TODO 可复用代码 以下照抄loadclosure的实现
        let instAddress = PROCESS.GetLabelAddress(label);
        let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
        let currentClosure = PROCESS.GetCurrentClosure();
        for(let v in currentClosure.freeVariables) {
            let value = currentClosure.GetFreeVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        for(let v in currentClosure.boundVariables) {
            let value = currentClosure.GetBoundVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        PROCESS.PushOperand(newClosureHandle);
        PROCESS.Step();
    }
    else {
        PROCESS.PushOperand(value);
        PROCESS.Step();
    }
}

// loadclosure label 创建一个label处代码对应的新闭包，并将新闭包把柄压入OP栈顶
function AIL_LOADCLOSURE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    // TODO 可复用代码
    if(argType !== 'LABEL') { throw `[Error] loadclosure指令参数类型不是标签`; }

    let label = argument;
    let instAddress = PROCESS.GetLabelAddress(label);
    let newClosureHandle = PROCESS.NewClosure(instAddress, PROCESS.currentClosureHandle);
    let currentClosure = PROCESS.GetCurrentClosure();
    for(let v in currentClosure.freeVariables) {
        let value = currentClosure.GetFreeVariable(v);
        PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
    }
    for(let v in currentClosure.boundVariables) {
        let value = currentClosure.GetBoundVariable(v);
        PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
    }
    PROCESS.PushOperand(newClosureHandle);
    PROCESS.Step();
}

// push arg 将立即数|静态资源把柄|中间代码标签压入OP栈顶
function AIL_PUSH(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    // 允许所有类型的参数
    PROCESS.PushOperand(argument);
    PROCESS.Step();
}

// pop 弹出并抛弃OP栈顶
function AIL_POP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    PROCESS.PopOperand();
    PROCESS.Step();
}

// swap 交换OP栈顶的两个对象的顺序
function AIL_SWAP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    PROCESS.PushOperand(top1);
    PROCESS.PushOperand(top2);
    PROCESS.Step();
}

// set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）
function AIL_SET(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'VARIABLE') { throw `[Error] set指令参数类型不是变量`; }

    let variable = argument;
    let rightValue = PROCESS.PopOperand();
    // 修改当前闭包内部的绑定
    let currentClosure = PROCESS.GetCurrentClosure();
    if(currentClosure.HasBoundVariable(variable)) {
        PROCESS.GetCurrentClosure().SetBoundVariable(variable, rightValue); // 带脏标记
    }
    if(currentClosure.HasFreeVariable(variable)) {
        PROCESS.GetCurrentClosure().SetFreeVariable(variable, rightValue); // 带脏标记
    }
    // 沿闭包链上溯，直到找到该变量作为约束变量所在的上级闭包，修改绑定
    let currentClosureHandle: Handle = PROCESS.currentClosureHandle;
    while(currentClosureHandle !== TOP_NODE_HANDLE && PROCESS.heap.HasHandle(currentClosureHandle)) {
        let currentClosure = PROCESS.GetClosure(currentClosureHandle);
        if(currentClosure.HasBoundVariable(variable)) {
            PROCESS.GetClosure(currentClosureHandle).SetBoundVariable(variable, rightValue); // 带脏标记
            break;
        }
        currentClosureHandle = currentClosure.parent;
    }
    PROCESS.Step();
}

///////////////////////////////////////
// 第二类：分支跳转指令
///////////////////////////////////////

//call arg 函数调用（包括continuation、native函数）
function AIL_CALL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    // 新的栈帧入栈
    PROCESS.PushStackFrame(PROCESS.currentClosureHandle, PROCESS.PC + 1);

    // 判断参数类型
    if(argType === 'LABEL') {
        let label = argument;
        // TODO 可复用代码
        let instructionAddress = PROCESS.GetLabelAddress(label);
        let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);

        let currentClosure = PROCESS.GetCurrentClosure();
        for(let v in currentClosure.freeVariables) {
            let value = currentClosure.GetFreeVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        for(let v in currentClosure.boundVariables) {
            let value = currentClosure.GetBoundVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }

        PROCESS.SetCurrentClosure(newClosureHandle);
        PROCESS.Goto(instructionAddress);
    }
    else if(argType === 'VARIABLE') {
        // 首先判断是否为Native调用
        let variable: string = argument;
        if(PROCESS.IsUseNative(variable)) {
            //
            // TODO 这里重新实现原有的callnative指令
            //
        }
        else {
            let value = PROCESS.Dereference(variable);
            let valueType = TypeOfToken(value);

            if(valueType === 'KEYWORD') {
                // TODO 增加对primitive的一等支持
            }
            else if(valueType === 'LABEL') {
                let label = value;
                // TODO 可复用代码：与以上LABEL分支的处理方法相同，这里复制过来
                let instructionAddress = PROCESS.GetLabelAddress(label);
                let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
    
                let currentClosure = PROCESS.GetCurrentClosure();
                for(let v in currentClosure.freeVariables) {
                    let value = currentClosure.GetFreeVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                for(let v in currentClosure.boundVariables) {
                    let value = currentClosure.GetBoundVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
    
                PROCESS.SetCurrentClosure(newClosureHandle);
                PROCESS.Goto(instructionAddress);
            }
            // 值为把柄：可能是闭包、continuation或其他
            else if(valueType === "HANDLE") {
                let handle: Handle = value;
                let obj: any = PROCESS.heap.Get(handle);
                let objType: SchemeObjectType = obj.type;
                // 闭包：已定义的函数实例
                if(objType === SchemeObjectType.CLOSURE) {
                    let targetClosure: Closure = obj;
                    PROCESS.SetCurrentClosure(handle);
                    PROCESS.Goto(targetClosure.instructionAddress);
                }
                // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
                else if(objType === SchemeObjectType.CONTINUATION) {
                    let top = PROCESS.PopOperand();
                    let returnTargetLabel = PROCESS.LoadContinuation(handle);
                    PROCESS.PushOperand(top);
                    console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                    let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                    PROCESS.Goto(targetAddress);
                }
                else {
                    throw `[Error] call指令的参数必须是标签、闭包或续延`;
                }
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或续延`;
            }
        } // Native判断结束
    } // Variable分支结束
}

//tailcall arg 函数尾调用
function AIL_TAILCALL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    // TODO 可复用代码 与call唯一的不同就是调用前不压栈帧，所以下面这坨代码是可以整体复用的

    // 判断参数类型
    if(argType === 'LABEL') {
        let label = argument;
        // TODO 可复用代码
        let instructionAddress = PROCESS.GetLabelAddress(label);
        let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);

        let currentClosure = PROCESS.GetCurrentClosure();
        for(let v in currentClosure.freeVariables) {
            let value = currentClosure.GetFreeVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }
        for(let v in currentClosure.boundVariables) {
            let value = currentClosure.GetBoundVariable(v);
            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
        }

        PROCESS.SetCurrentClosure(newClosureHandle);
        PROCESS.Goto(instructionAddress);
    }
    else if(argType === 'VARIABLE') {
        // 首先判断是否为Native调用
        let variable: string = argument;
        if(PROCESS.IsUseNative(variable)) {
            //
            // TODO 这里重新实现原有的callnative指令
            //
        }
        else {
            let value = PROCESS.Dereference(variable);
            let valueType = TypeOfToken(value);

            if(valueType === 'KEYWORD') {
                // TODO 增加对primitive的一等支持
            }
            else if(valueType === 'LABEL') {
                let label = value;
                // TODO 可复用代码：与以上LABEL分支的处理方法相同，这里复制过来
                let instructionAddress = PROCESS.GetLabelAddress(label);
                let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
    
                let currentClosure = PROCESS.GetCurrentClosure();
                for(let v in currentClosure.freeVariables) {
                    let value = currentClosure.GetFreeVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                for(let v in currentClosure.boundVariables) {
                    let value = currentClosure.GetBoundVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
    
                PROCESS.SetCurrentClosure(newClosureHandle);
                PROCESS.Goto(instructionAddress);
            }
            // 值为把柄：可能是闭包、continuation或其他
            else if(valueType === "HANDLE") {
                let handle: Handle = value;
                let obj: any = PROCESS.heap.Get(handle);
                let objType: SchemeObjectType = obj.type;
                // 闭包：已定义的函数实例
                if(objType === SchemeObjectType.CLOSURE) {
                    let targetClosure: Closure = obj;
                    PROCESS.SetCurrentClosure(handle);
                    PROCESS.Goto(targetClosure.instructionAddress);
                }
                // 续延：调用continuation必须带一个参数，在栈顶。TODO 这个检查在编译时完成
                else if(objType === SchemeObjectType.CONTINUATION) {
                    let top = PROCESS.PopOperand();
                    let returnTargetLabel = PROCESS.LoadContinuation(handle);
                    PROCESS.PushOperand(top);
                    console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                    let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                    PROCESS.Goto(targetAddress);
                }
                else {
                    throw `[Error] call指令的参数必须是标签、闭包或续延`;
                }
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或续延`;
            }
        } // Native判断结束
    } // Variable分支结束
}

//return 函数返回
function AIL_RETURN(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let stackframe = PROCESS.PopStackFrame(); // 栈帧退栈
    PROCESS.SetCurrentClosure(stackframe.closureHandle); // 修改当前闭包
    PROCESS.Goto(stackframe.returnTargetAddress); // 跳转到返回地址
    stackframe = null; // 销毁当前栈帧
}

//capturecc variable 捕获当前Continuation并将其把柄保存在变量中
function AIL_CAPTURECC(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'VARIABLE') { throw `[Error] capturecc指令参数类型不是变量`; }

    let variable = argument;
    let retTargetLable = `@${variable}`; // NOTE【约定】cont返回点的标签名称 = @ + cont被保存的变量名称
    let contHandle = PROCESS.CaptureContinuation(retTargetLable)
    console.info(`[Info] Continuation ${variable} 已捕获，对应的返回标签 ${retTargetLable}`);
    PROCESS.GetCurrentClosure().InitBoundVariable(variable, contHandle);
    PROCESS.Step();
}

//iftrue label 如果OP栈顶条件不为false则跳转
function AIL_IFTRUE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'LABEL') { throw `[Error] iftrue指令的参数必须是标签`; }

    let label = argument;
    let condition = PROCESS.PopOperand();
    if(condition !== '#f') {
        let targetAddress = PROCESS.GetLabelAddress(label);
        PROCESS.Goto(targetAddress);
    }
    else {
        PROCESS.Step();
    }
}

//iffalse label 如果OP栈顶条件为false则跳转
function AIL_IFFALSE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'LABEL') { throw `[Error] iffalse指令的参数必须是标签`; }

    let label = argument;
    let condition = PROCESS.PopOperand();
    if(condition === '#f') {
        let targetAddress = PROCESS.GetLabelAddress(label);
        PROCESS.Goto(targetAddress);
    }
    else {
        PROCESS.Step();
    }
}

//goto label 无条件跳转
function AIL_GOTO(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);
    if(argType !== 'LABEL') { throw `[Error] goto指令的参数必须是标签`; }

    let label = argument;
    let targetAddress = PROCESS.GetLabelAddress(label);
    PROCESS.Goto(targetAddress);
}

///////////////////////////////////////
// 第三类：列表操作指令
///////////////////////////////////////

// car 取 OP栈顶的把柄对应的列表 的第一个元素 的把柄
function AIL_CAR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);

}

// cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
function AIL_CDR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);

}

// cons 同Scheme的cons
function AIL_CONS(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);

}

///////////////////////////////////////
// 第四类：算术逻辑运算和谓词
///////////////////////////////////////

// add 实数加法
function AIL_ADD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = operand2 + operand1;
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// sub 实数减法
function AIL_SUB(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = operand2 - operand1;
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// mul 实数乘法
function AIL_MUL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = operand2 * operand1;
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// div 实数除法
function AIL_DIV(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        if(operand1 <= Number.EPSILON || operand1 >= -Number.EPSILON) {
            throw `[Error] 除零`;
        }
        let result = operand2 / operand1;
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// mod 求余
function AIL_MOD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = operand2 % operand1;
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// pow 求幂
function AIL_POW(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = Math.pow(operand2, operand1);
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// eqn =
function AIL_EQN(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = (Math.abs(operand2-operand1) <= Number.EPSILON) ? "#t" : "#f";
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// ge >=
function AIL_GE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = (operand2 >= operand1) ? "#t" : "#f";
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// le <=
function AIL_LE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = (operand2 <= operand1) ? "#t" : "#f";
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// gt >
function AIL_GT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = (operand2 > operand1) ? "#t" : "#f";
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// lt <
function AIL_LT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    // 类型检查与转换
    if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
        let operand1 = parseFloat(top1);
        let operand2 = parseFloat(top2);
        let result = (operand2 < operand1) ? "#t" : "#f";
        PROCESS.PushOperand(result);
        PROCESS.Step();
    }
    else {
        throw `[Error] 指令参数类型不正确`;
    }
}

// not
function AIL_NOT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top = PROCESS.PopOperand();
    PROCESS.PushOperand((top === "#f") ? "#t" : "#f");
    PROCESS.Step();
}

// and
function AIL_AND(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    if(top1 === "#f" || top2 === "#f") {
        PROCESS.PushOperand("#f");
    }
    else {
        PROCESS.PushOperand("#t");
    }
    PROCESS.Step();
}

// or
function AIL_OR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let top1 = PROCESS.PopOperand();
    let top2 = PROCESS.PopOperand();
    if(top1 !== "#f" && top2 !== "#f") {
        PROCESS.PushOperand("#t");
    }
    else {
        PROCESS.PushOperand("#f");
    }
    PROCESS.Step();
}

// TODO 还有几个谓词待实现


///////////////////////////////////////
// 第五类：其他指令
///////////////////////////////////////

// fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
function AIL_FORK(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let argType = TypeOfToken(argument);

}

// display arg 调试输出
function AIL_DISPLAY(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    let content = PROCESS.OPSTACK.pop();
    let contentType = TypeOfToken(content);
    if(contentType === "HANDLE") {
        let obj = PROCESS.heap.Get(content);
        if(obj.type === "STRING") {
            console.log(`[Info] 输出：${TrimQuotes(obj.content)}`);
        }
        else {
            // TODO 待实现LIST转字符串的函数
        }
    }
    else {
        console.info(`[Info] 输出：${String(content)}`);
    }
    PROCESS.Step();
}

// newline 调试输出换行
function AIL_NEWLINE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    console.info(`[Info] 换行`);
    PROCESS.Step();
}

// nop 空指令
function AIL_NOP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    PROCESS.Step();
}

// pause 暂停当前进程
function AIL_PAUSE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    PROCESS.SetState(ProcessState.SUSPENDED);
}

// halt 停止当前进程
function AIL_HALT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
    PROCESS.SetState(ProcessState.STOPPED);
}


// 执行（一条）中间语言指令
// 执行的效果从宏观上看就是修改了进程内部和运行时环境的状态，并且使用运行时环境提供的接口和资源

function Execute(PROCESS: Process, RUNTIME: Runtime) {
    // 取出当前指令
    let instruction = PROCESS.CurrentInstruction();
    let mnemonic = instruction.mnemonic;
    let argument = instruction.argument;

    // 译码：分配执行路径
    if(instruction.type === "COMMENT" || instruction.type === "LABEL") {
        PROCESS.Step(); // 跳过注释和标签
    }

    else if(mnemonic === "store")       { AIL_STORE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "load")        { AIL_LOAD(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "loadclosure") { AIL_LOADCLOSURE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "push")        { AIL_PUSH(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "pop")         { AIL_POP(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "swap")        { AIL_SWAP(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "set")         { AIL_SET(argument, PROCESS, RUNTIME); }

    else if(mnemonic === 'call')        { AIL_CALL(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'tailcall')    { AIL_TAILCALL(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'return')      { AIL_RETURN(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'capturecc')   { AIL_CAPTURECC(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'iftrue')      { AIL_IFTRUE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'iffalse')     { AIL_IFFALSE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'goto')        { AIL_GOTO(argument, PROCESS, RUNTIME); }

    else if(mnemonic === 'car')         { AIL_CAR(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'cdr')         { AIL_CDR(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'cons')        { AIL_CONS(argument, PROCESS, RUNTIME); }

    else if(mnemonic === 'add')         { AIL_ADD(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'sub')         { AIL_SUB(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'mul')         { AIL_MUL(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'div')         { AIL_DIV(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'mod')         { AIL_MOD(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'pow')         { AIL_POW(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'eqn')         { AIL_EQN(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'ge')          { AIL_GE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'le')          { AIL_LE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'gt')          { AIL_GT(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'lt')          { AIL_LT(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'not')         { AIL_NOT(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'and')         { AIL_AND(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'or')          { AIL_OR(argument, PROCESS, RUNTIME); }

    // TODO 还有几个谓词待实现

    else if(mnemonic === 'fork')        { AIL_FORK(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'display')     { AIL_DISPLAY(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'newline')     { AIL_NEWLINE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === "nop")         { AIL_NOP(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'pause')       { AIL_PAUSE(argument, PROCESS, RUNTIME); }
    else if(mnemonic === 'halt')        { AIL_HALT(argument, PROCESS, RUNTIME); }
}
