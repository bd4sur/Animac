
// Runtime.ts
// 运行时环境

type PID = number;

enum VMState {
    IDLE = "IDLE",
    RUNNING = "RUNNING"
}

class Runtime {
    public processPool: Array<Process>;  // 进程池
    public processQueue: Array<PID>;     // 进程队列

    public ports: HashMap<string, any>;  // 端口：对进程间共享资源的抽象 TODO 增加PortObject类

    public outputBuffer: string;
    public errorBuffer: string;

    public asyncCallback: ()=>any;       // 异步事件回调（主要是用于REPL中处理异步事件返回对控制台的刷新操作）

    constructor() {
        this.processPool = new Array();
        this.processQueue = new Array();
        this.ports = new HashMap();
        this.asyncCallback = ()=>{};
        this.outputBuffer = "";
        this.errorBuffer = "";
    }

    public AllocatePID(): number {
        return this.processPool.length;
    }

    public AddProcess(p: Process): PID {
        // 检查是否已存在此线程
        if(this.processPool[p.PID] === undefined) {
            this.processPool[p.PID] = p;
        }
        this.processQueue.push(p.PID); // 加入队尾
        return p.PID;
    }

    //=================================================================
    //                       以下是进程调度器
    //=================================================================

    public Tick(timeslice: number) {
        if(this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        // 取出队头线程
        let currentPID = this.processQueue.shift();
        let currentProcess = this.processPool[currentPID];
        currentProcess.state = ProcessState.RUNNING;
        // 执行时间片
        while(timeslice >= 0) {
            this.Execute(currentProcess, this);
            timeslice--;
            if(currentProcess.state === ProcessState.RUNNING) {
                continue;
            }
            else if(currentProcess.state === ProcessState.SLEEPING) {
                break;
            }
            else if(currentProcess.state === ProcessState.STOPPED) {
                // TODO REPL不能清理
                // delete this.processPool[currentPID]; // 清理掉执行完的进程
                break;
            }
        }
        // 后处理
        if(currentProcess.state === ProcessState.RUNNING) {
            // 仍在运行的进程加入队尾
            // currentProcess.GC(); // TODO 垃圾回收仍然不完善
            currentProcess.state = ProcessState.READY;
            this.processQueue.push(currentPID);
        }

        if(this.processQueue.length <= 0) {
            return VMState.IDLE;
        }
        else {
            return VMState.RUNNING;
        }
    }

    public StartClock(callback: ()=>any) {
        /* NOTE 【执行时钟设计说明】为什么要用setInterval？
            设想两个进程，其中一个是常驻的无限循环进程，另一个是需要执行某Node.js异步操作的进程。
            根据Node.js的事件循环特性，如果单纯使用while(1)实现，则异步操作永远得不到执行。
            但如果单纯用setInterval实现，则性能极差。
            那么可以折中一下：
            程序的执行，在一个短的时间周期内（称为计算周期ComputingPhase），使用while()循环全力计算。
            全力计算一段时间后，由setInterval控制，结束当前计算周期，给异步事件处理的机会。
            计算周期的长度COMPUTATION_PHASE_LENGTH决定了VM的性能，以及异步事件响应的速度。
            如果COMPUTATION_PHASE_LENGTH=1，则退化为完全由setInterval控制的执行时钟，性能最差。
            如果COMPUTATION_PHASE_LENGTH=∞，则退化为完全由while控制的执行时钟，性能最佳，但异步事件得不到执行。
        */

        function Run() {
            let COMPUTATION_PHASE_LENGTH = 100; // TODO 这个值可以调整
            while(COMPUTATION_PHASE_LENGTH >= 0) {
                let avmState = this.Tick(1000);
                COMPUTATION_PHASE_LENGTH--;
                if(avmState === VMState.IDLE) {
                    clearInterval(CLOCK);
                    callback();
                    break;
                }
            }
        }

        let CLOCK = setInterval(()=>{
            try {
                Run.call(this);
            }
            catch(e) {
                this.Error(e.toString());
                this.Error(`\n`);
            }
        }, 0);
    }


    //=================================================================
    //                      以下是控制台输入输出
    //=================================================================

    public Output(str: string): void {
        process.stdout.write(str);
        this.outputBuffer += str;
    }

    public Error(str: string): void {
        process.stderr.write(str);
        this.errorBuffer += str;
    }


    //=================================================================
    //                  以下是AIL指令实现（封装成函数）
    //=================================================================



    ///////////////////////////////////////
    // 第一类：基本存取指令
    ///////////////////////////////////////

    // store variable 将OP栈顶对象保存到当前闭包的约束变量中
    public AIL_STORE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);
        if(argType !== 'VARIABLE') { throw `[Error] store指令参数类型不是变量`; }

        let variable = argument;
        let value = PROCESS.PopOperand();
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, value);
        PROCESS.Step();
    }

    // load variable 解引用变量，并将对象压入OP栈顶
    public AIL_LOAD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);
        if(argType !== 'VARIABLE') { throw `[Error] load指令参数类型不是变量`; }

        let variable = argument;
        let value = PROCESS.Dereference(variable);
        let valueType = TypeOfToken(value);

        // 值为标签，即loadclosure。
        if(valueType === 'LABEL') {
            let label = value;

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
    public AIL_LOADCLOSURE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);

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
    public AIL_PUSH(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        // 允许所有类型的参数
        PROCESS.PushOperand(argument);
        PROCESS.Step();
    }

    // pop 弹出并抛弃OP栈顶
    public AIL_POP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        PROCESS.PopOperand();
        PROCESS.Step();
    }

    // swap 交换OP栈顶的两个对象的顺序
    public AIL_SWAP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        PROCESS.PushOperand(top1);
        PROCESS.PushOperand(top2);
        PROCESS.Step();
    }

    // set variable 修改某变量的值为OP栈顶的对象（同Scheme的set!）
    public AIL_SET(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_CALL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);
        // 新的栈帧入栈
        PROCESS.PushStackFrame(PROCESS.currentClosureHandle, PROCESS.PC + 1);

        // 判断参数类型
        if(argType === 'LABEL') {
            let label = argument;

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
        else if(argType === 'HANDLE') { // 闭包或续延（用于回调参数的情况）
            let handle: Handle = argument;
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
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] call指令的参数必须是标签、闭包或续延`;
            }
        }
        else if(argType === 'VARIABLE') {
            // TODO 可复用
            function CallNative(id) {
                let nativeModuleName = id.split(".")[0];
                let nativeFunctionName = id.split(".").slice(1).join("");
                // 引入Native模块
                let nativeModule = require(`./lib/${nativeModuleName}.js`);
                // 调用Native模块内部的函数
                (nativeModule[nativeFunctionName])(PROCESS, RUNTIME);
            }
            // 首先判断是否为Native调用
            let variable: string = argument;
            if(PROCESS.AST.IsNativeCall(variable)) {
                CallNative(variable);
            }
            else {
                let value = PROCESS.Dereference(variable);
                let valueType = TypeOfToken(value);

                if(PROCESS.AST.IsNativeCall(value)) {
                    CallNative(value);
                }
                else if(valueType === 'KEYWORD') {
                    // NOTE primitive不压栈帧
                    PROCESS.PopStackFrame();
                    let mnemonic = PrimitiveInstruction[value] || value;
                    this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
                }
                else if(valueType === 'LABEL') {
                    let label = value;

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
                        // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
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
    public AIL_TAILCALL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);
        // 与call唯一的不同就是调用前不压栈帧，所以下面这坨代码是可以整体复用的

        // 判断参数类型
        if(argType === 'LABEL') {
            let label = argument;

            let instructionAddress = PROCESS.GetLabelAddress(label);
            let currentClosure = PROCESS.GetCurrentClosure();

            if(currentClosure.instructionAddress !== instructionAddress) {
                let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
                for(let v in currentClosure.freeVariables) {
                    let value = currentClosure.GetFreeVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                for(let v in currentClosure.boundVariables) {
                    let value = currentClosure.GetBoundVariable(v);
                    PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                }
                PROCESS.SetCurrentClosure(newClosureHandle);
            }

            PROCESS.Goto(instructionAddress);
        }
        else if(argType === 'HANDLE') { // 闭包或续延（用于回调参数的情况）
            let handle: Handle = argument;
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
                // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                PROCESS.Goto(targetAddress);
            }
            else {
                throw `[Error] tailcall指令的参数必须是标签、闭包或续延`;
            }
        }
        else if(argType === 'VARIABLE') {
            // TODO 可复用
            function CallNative(id) {
                let nativeModuleName = id.split(".")[0];
                let nativeFunctionName = id.split(".").slice(1).join("");
                // 引入Native模块
                let nativeModule = require(`./nativelib/${nativeModuleName}.js`);
                // 调用Native模块内部的函数
                (nativeModule[nativeFunctionName])(PROCESS, RUNTIME);
            }
            // 首先判断是否为Native调用
            let variable: string = argument;
            if(PROCESS.AST.IsNativeCall(variable)) {
                CallNative(variable);
            }
            else {
                let value = PROCESS.Dereference(variable);
                let valueType = TypeOfToken(value);

                if(PROCESS.AST.IsNativeCall(value)) {
                    CallNative(value);
                }
                else if(valueType === 'KEYWORD') {
                    let mnemonic = PrimitiveInstruction[value] || value;
                    this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
                }
                else if(valueType === 'LABEL') {
                    let label = value;

                    let instructionAddress = PROCESS.GetLabelAddress(label);
                    let currentClosure = PROCESS.GetCurrentClosure();

                    if(currentClosure.instructionAddress !== instructionAddress) {
                        let newClosureHandle = PROCESS.NewClosure(instructionAddress, PROCESS.currentClosureHandle);
                        for(let v in currentClosure.freeVariables) {
                            let value = currentClosure.GetFreeVariable(v);
                            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                        }
                        for(let v in currentClosure.boundVariables) {
                            let value = currentClosure.GetBoundVariable(v);
                            PROCESS.GetClosure(newClosureHandle).InitFreeVariable(v, value);
                        }
                        PROCESS.SetCurrentClosure(newClosureHandle);
                    }

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
                        // console.info(`[Info] Continuation已恢复，返回标签：${returnTargetLabel}`);
                        let targetAddress = PROCESS.GetLabelAddress(returnTargetLabel);
                        PROCESS.Goto(targetAddress);
                    }
                    else {
                        throw `[Error] tailcall指令的参数必须是标签、闭包或续延`;
                    }
                }
                else {
                    throw `[Error] tailcall指令的参数必须是标签、闭包或续延`;
                }
            } // Native判断结束
        } // Variable分支结束
    }

    //return 函数返回
    public AIL_RETURN(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let stackframe = PROCESS.PopStackFrame(); // 栈帧退栈
        PROCESS.SetCurrentClosure(stackframe.closureHandle); // 修改当前闭包
        PROCESS.Goto(stackframe.returnTargetAddress); // 跳转到返回地址
        stackframe = null; // 销毁当前栈帧
    }

    //capturecc variable 捕获当前Continuation并将其把柄保存在变量中
    public AIL_CAPTURECC(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);
        if(argType !== 'VARIABLE') { throw `[Error] capturecc指令参数类型不是变量`; }

        let variable = argument;
        let retTargetLable = `@${variable}`; // NOTE【约定】cont返回点的标签名称 = @ + cont被保存的变量名称
        let contHandle = PROCESS.CaptureContinuation(retTargetLable)
        // console.info(`[Info] Continuation ${variable} 已捕获，对应的返回标签 ${retTargetLable}`);
        PROCESS.GetCurrentClosure().InitBoundVariable(variable, contHandle);
        PROCESS.Step();
    }

    //iftrue label 如果OP栈顶条件不为false则跳转
    public AIL_IFTRUE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_IFFALSE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_GOTO(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_CAR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if(TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if(listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let firstElement = listObj.children[0];
                PROCESS.PushOperand(firstElement);
                PROCESS.Step();
            }
            else {
                throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] car的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }

    // cdr 取 OP栈顶的把柄对应的列表 的尾表（临时对象） 的把柄
    public AIL_CDR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let listHandle = PROCESS.PopOperand();
        // 类型检查
        if(TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if(listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if(listObj.children.length <= 0) {
                    throw `[Error] cdr参数不能是空表。`;
                }
                let newListHandle: Handle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList: QuoteObject | QuasiquoteObject;
                if(listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(1);
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cdr的参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }

    // cons 同Scheme的cons
    public AIL_CONS(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let listHandle = PROCESS.PopOperand();
        let firstElement = PROCESS.PopOperand();
        // 类型检查
        if(TypeOfToken(listHandle) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(listHandle);
            if(listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                let newListHandle: Handle = PROCESS.heap.AllocateHandle(listObj.type, false);
                let newList: QuoteObject | QuasiquoteObject;
                if(listObj.type === "QUOTE") {
                    newList = new QuoteObject(listHandle);
                }
                else {
                    newList = new QuasiquoteObject(listHandle);
                }
                newList.children = listObj.children.slice(); // 复制数组
                newList.children.unshift(firstElement);      // 并在左侧插入元素
                PROCESS.heap.Set(newListHandle, newList);
                PROCESS.PushOperand(newListHandle);
                PROCESS.Step();
            }
            else {
                throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
            }
        }
        else {
            throw `[Error] cons的第2个参数必须是引用（quote）列表或准引用（quasiquote）列表。`;
        }
    }

    ///////////////////////////////////////
    // 第四类：算术逻辑运算和谓词
    ///////////////////////////////////////

    // add 实数加法
    public AIL_ADD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_SUB(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_MUL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_DIV(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        // 类型检查与转换
        if(TypeOfToken(top1) === "NUMBER" && TypeOfToken(top2) === "NUMBER") {
            let operand1 = parseFloat(top1);
            let operand2 = parseFloat(top2);
            if(operand1 <= Number.EPSILON && operand1 >= -Number.EPSILON) {
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
    public AIL_MOD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_POW(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_EQN(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_GE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_LE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_GT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_LT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_NOT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let top = PROCESS.PopOperand();
        PROCESS.PushOperand((top === "#f") ? "#t" : "#f");
        PROCESS.Step();
    }

    // and
    public AIL_AND(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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
    public AIL_OR(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
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

    // eq?
    // TODO eq?的逻辑需要进一步精确化
    public AIL_ISEQ(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let top1 = PROCESS.PopOperand();
        let top2 = PROCESS.PopOperand();
        if(String(top1) === String(top2)) {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }

    // null?
    public AIL_ISNULL(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let arg = PROCESS.PopOperand();
        if(TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if(listObj.type === "QUOTE" || listObj.type === "QUASIQUOTE") {
                if(listObj.children.length <= 0) {
                    PROCESS.PushOperand("#t");
                }
                else {
                    PROCESS.PushOperand("#f");
                }
            }
            else {
                PROCESS.PushOperand("#f");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }

    // atom?
    public AIL_ISATOM(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let arg = PROCESS.PopOperand();
        if(TypeOfToken(arg) === 'HANDLE') {
            PROCESS.PushOperand("#f");
        }
        else {
            PROCESS.PushOperand("#t");
        }
        PROCESS.Step();
    }

    // list?
    public AIL_ISLIST(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let arg = PROCESS.PopOperand();
        if(TypeOfToken(arg) === 'HANDLE') {
            let listObj = PROCESS.heap.Get(arg);
            if(listObj.type === "STRING") {
                PROCESS.PushOperand("#f");
            }
            else {
                PROCESS.PushOperand("#t");
            }
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }

    // number?
    public AIL_ISNUMBER(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let arg = PROCESS.PopOperand();
        if(TypeOfToken(arg) === 'NUMBER') {
            PROCESS.PushOperand("#t");
        }
        else {
            PROCESS.PushOperand("#f");
        }
        PROCESS.Step();
    }

    ///////////////////////////////////////
    // 第五类：其他指令
    ///////////////////////////////////////

    // fork handle 参数为某列表或者某个外部源码文件路径的字符串的把柄，新建一个进程，并行运行
    public AIL_FORK(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let argType = TypeOfToken(argument);

        if(argType === "HANDLE") {
            let node = PROCESS.heap.Get(argument);
            if(node.type === "APPLICATION") {
                let modul = LoadModuleFromNode(PROCESS.AST, argument);
                let newProcess = new Process(modul);
                // 分配新的PID
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else if(node.type === "STRING"){
                let modulePath = TrimQuotes(node.content);
                let forkedModule = LoadModule(modulePath);
                // 构造新进程，并分配PID
                let newProcess = new Process(forkedModule);
                newProcess.PID = RUNTIME.AllocatePID();
                newProcess.parentPID = PROCESS.PID;
                // 在当前runtime中加入进程
                RUNTIME.AddProcess(newProcess);
            }
            else {
                throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
            }
        }
        else {
            throw `[Error] fork指令参数必须是列表或者外部模块的路径。`;
        }
        PROCESS.Step();
    }

    // display arg 调试输出
    public AIL_DISPLAY(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let content = PROCESS.OPSTACK.pop();
        let contentType = TypeOfToken(content);
        if(contentType === "HANDLE") {
            let obj = PROCESS.heap.Get(content);
            if(obj.type === "STRING") {
                RUNTIME.Output(`${TrimQuotes(obj.content)}`);
            }
            else {
                let str = PROCESS.AST.NodeToString(content);
                RUNTIME.Output(`${str}`);
            }
        }
        else {
            RUNTIME.Output(`${String(content)}`);
        }
        PROCESS.Step();
    }

    // newline 调试输出换行
    public AIL_NEWLINE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        RUNTIME.Output(`\n`);
        PROCESS.Step();
    }

    // read 读端口内容
    public AIL_READ(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let port = PROCESS.PopOperand();
        // 类型检查
        if(TypeOfToken(port) === 'PORT') {
            PROCESS.PushOperand(RUNTIME.ports.get(port));
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }

    // write 写端口内容
    public AIL_WRITE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let value = PROCESS.PopOperand();
        let port = PROCESS.PopOperand();
        // 类型检查
        if(TypeOfToken(port) === 'PORT') {
            RUNTIME.ports.set(port, value);
            PROCESS.Step();
        }
        else {
            throw `[Error] read指令参数必须是端口。`;
        }
    }

    // nop 空指令
    public AIL_NOP(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        PROCESS.Step();
    }

    // pause 暂停当前进程
    public AIL_PAUSE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        PROCESS.SetState(ProcessState.SUSPENDED);
    }

    // halt 停止当前进程
    public AIL_HALT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        PROCESS.SetState(ProcessState.STOPPED);
    }

    // set-child! handle 修改列表元素
    public AIL_SETCHILD(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let index = PROCESS.PopOperand();
        let value = PROCESS.PopOperand();
        if(TypeOfToken(argument) === "HANDLE") {
            PROCESS.heap.Get(argument).children[parseInt(index)] = value;
            PROCESS.Step();
        }
        else {
            throw `[Error] set-child!参数类型不正确`;
        }
    }

    // concat 将若干元素连接为新列表，同时修改各子列表的parent字段为自身把柄
    // 栈参数：child1 child2 ... n
    public AIL_CONCAT(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        let length = parseInt(PROCESS.PopOperand());
        let children = new Array();
        for(let i = length - 1; i >= 0; i--) {
            children[i] = PROCESS.PopOperand();
        }

        let newListHandle = PROCESS.heap.AllocateHandle("QUOTE", false);
        let newList = new QuoteObject(TOP_NODE_HANDLE);

        for(let i = 0; i < length ; i++) {
            newList.children[i] = children[i];
            // 设置子节点的parent字段
            if(TypeOfToken(children[i]) === "HANDLE") {
                let childObj = PROCESS.heap.Get(children[i]);
                if(childObj.type === "QUOTE" || childObj.type === "QUASIQUOTE" || childObj.type === "UNQUOTE" || childObj.type === "APPLICATION") {
                    PROCESS.heap.Get(children[i]).parent = newListHandle;
                }
            }
        }

        PROCESS.heap.Set(newListHandle, newList);
        PROCESS.PushOperand(newListHandle);
        PROCESS.Step();
    }

    // duplicate 递归复制对象，并分配把柄
    public AIL_DUPLICATE(argument: string, PROCESS: Process, RUNTIME: Runtime): void {
        // 堆对象深拷贝，并分配新的堆地址
        function DeepCopy(sourceHandle: Handle, parentHandle: Handle): Handle {
            if(TypeOfToken(sourceHandle) === "HANDLE") {
                // 跳过已经被复制的对象（非静态对象）
                // if(PROCESS.heap.HasHandle(handle) !== true || PROCESS.heap.IsStatic(sourceHandle) === false) {
                //     return sourceHandle;
                // }
                let newObject = PROCESS.heap.Get(sourceHandle).Copy();
                let newHandle = PROCESS.heap.AllocateHandle(newObject.type, false);
                if(["QUOTE", "QUASIQUOTE", "UNQUOTE", "APPLICATION", "LAMBDA"].indexOf(newObject.type) >= 0) {
                    newObject.parent = parentHandle;
                    for(let i = 0; i < newObject.children.length; i++) {
                        (newObject.children)[i] = DeepCopy((newObject.children)[i], newHandle);
                    }
                }
                PROCESS.heap.Set(newHandle, newObject);
                return newHandle;
            }
            else {
                return sourceHandle;
            }
        }

        let handle = PROCESS.PopOperand();
        if(TypeOfToken(handle) !== "HANDLE") {
            throw `[Error] duplicate参数类型不正确`;
        }
        else {
            let parentHandle = PROCESS.heap.Get(handle).parent;
            PROCESS.PushOperand(DeepCopy(handle, parentHandle));
            PROCESS.Step();
        }
    }

    // 执行（一条）中间语言指令
    // 执行的效果从宏观上看就是修改了进程内部和运行时环境的状态，并且使用运行时环境提供的接口和资源

    public Execute(PROCESS: Process, RUNTIME: Runtime) {
        // 取出当前指令
        let instruction = PROCESS.CurrentInstruction();
        let mnemonic = instruction.mnemonic;
        let argument = instruction.argument;
        // 译码：分配执行路径
        if(instruction.type === "COMMENT" || instruction.type === "LABEL") {
            PROCESS.Step(); // 跳过注释和标签
        }
        else {
            this.ExecuteOneInst(mnemonic, argument, PROCESS, RUNTIME);
        }
    }

    public ExecuteOneInst(mnemonic: string, argument: any, PROCESS: Process, RUNTIME: Runtime) {
             if(mnemonic === "store")       { this.AIL_STORE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "load")        { this.AIL_LOAD(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "loadclosure") { this.AIL_LOADCLOSURE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "push")        { this.AIL_PUSH(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "pop")         { this.AIL_POP(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "swap")        { this.AIL_SWAP(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "set")         { this.AIL_SET(argument, PROCESS, RUNTIME); }

        else if(mnemonic === 'call')        { this.AIL_CALL(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'tailcall')    { this.AIL_TAILCALL(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'return')      { this.AIL_RETURN(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'capturecc')   { this.AIL_CAPTURECC(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'iftrue')      { this.AIL_IFTRUE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'iffalse')     { this.AIL_IFFALSE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'goto')        { this.AIL_GOTO(argument, PROCESS, RUNTIME); }

        else if(mnemonic === 'car')         { this.AIL_CAR(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'cdr')         { this.AIL_CDR(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'cons')        { this.AIL_CONS(argument, PROCESS, RUNTIME); }

        else if(mnemonic === 'add')         { this.AIL_ADD(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'sub')         { this.AIL_SUB(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'mul')         { this.AIL_MUL(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'div')         { this.AIL_DIV(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'mod')         { this.AIL_MOD(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'pow')         { this.AIL_POW(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'eqn')         { this.AIL_EQN(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'ge')          { this.AIL_GE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'le')          { this.AIL_LE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'gt')          { this.AIL_GT(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'lt')          { this.AIL_LT(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'not')         { this.AIL_NOT(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'and')         { this.AIL_AND(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'or')          { this.AIL_OR(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'eq?')         { this.AIL_ISEQ(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'null?')       { this.AIL_ISNULL(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'atom?')       { this.AIL_ISATOM(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'list?')       { this.AIL_ISLIST(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'number?')     { this.AIL_ISNUMBER(argument, PROCESS, RUNTIME); }

        else if(mnemonic === 'fork')        { this.AIL_FORK(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'display')     { this.AIL_DISPLAY(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'newline')     { this.AIL_NEWLINE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'read')        { this.AIL_READ(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'write')       { this.AIL_WRITE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === "nop")         { this.AIL_NOP(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'pause')       { this.AIL_PAUSE(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'halt')        { this.AIL_HALT(argument, PROCESS, RUNTIME); }

        else if(mnemonic === 'set-child!')  { this.AIL_SETCHILD(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'concat')      { this.AIL_CONCAT(argument, PROCESS, RUNTIME); }
        else if(mnemonic === 'duplicate')   { this.AIL_DUPLICATE(argument, PROCESS, RUNTIME); }
    }

}