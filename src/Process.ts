
// Process.ts
// 进程数据结构

// 栈帧
class StackFrame {
    public closureHandle: Handle;     // 闭包把柄
    public returnTargetAddress: number; // 返回指令地址

    constructor(closureHandle: Handle, target: number) {
        this.closureHandle = closureHandle;
        this.returnTargetAddress = target;
    }
}

// 进程状态枚举
enum ProcessState {
    READY = "READY",
    RUNNING = "RUNNING",
    SLEEPING = "SLEEPING",
    SUSPENDED = "SUSPENDED",
    STOPPED = "STOPPED"
}

class Process {
    // 进程基本信息
    public PID: PID;                           // 进程ID
    public parentPID: PID;                     // 父进程PID

    // 进程状态
    public state: ProcessState;                // 进程状态

    // 代码AST
    public AST: AST;                           // 源码的AST

    // 进程程序区
    public instructions: Array<string>;        // 指令序列
    public labelMapping: HashMap<string, number>;  // 标签-指令索引映射

    // 堆 TODO 闭包区和Continuation区也统一存储在堆区
    public heap: Memory;                       // 堆存储区（静态资源+运行时动态分配）

    // 执行机核心：栈、闭包和续延
    public PC: number = 0;                  // 程序计数器（即当前执行的指令索引）
    public currentClosureHandle: Handle;    // 当前闭包把柄

    public OPSTACK: Array<any>;             // 操作数栈
    public FSTACK: Array<StackFrame>;       // 调用栈（活动记录栈）

    /* 构造器 */
    // TODO 待实现，目前仅供测试
    constructor(modul: Module) {
        this.PID = 0;
        this.parentPID = 0;

        this.state = ProcessState.READY;

        this.AST = modul.AST;

        this.instructions = modul.ILCode;

        this.labelMapping = new HashMap();

        this.heap = new Memory();

        this.PC = 0;
        this.currentClosureHandle = TOP_NODE_HANDLE;

        this.OPSTACK = new Array();
        this.FSTACK = new Array();

        //////////////////////////////
        //  TODO 进程初始化
        //////////////////////////////

        // AST中的静态对象移动到heap中
        // TODO：建议深拷贝
        this.heap = this.AST.nodes;

        // 标签分析
        this.LabelAnalysis();

        // 顶级闭包
        this.heap.NewHandle(TOP_NODE_HANDLE);
        this.heap.Set(TOP_NODE_HANDLE, new Closure(-1, TOP_NODE_HANDLE));
    }

    /* 栈和闭包操作 */

    // 向操作数栈中压入值
    public PushOperand(value: any): void {
        this.OPSTACK.push(value);
    }

    // 从操作数栈中弹出一个值
    public PopOperand(): any {
        return this.OPSTACK.pop();
    }

    // 压入函数调用栈帧
    public PushStackFrame(closureHandle: Handle, returnTarget: number): void {
        let sf = new StackFrame(closureHandle, returnTarget);
        this.FSTACK.push(sf);
    }

    // 弹出函数调用栈帧
    public PopStackFrame(): StackFrame {
        return this.FSTACK.pop();
    }

    // 新建闭包并返回把柄
    public NewClosure(instructionAddress: number, parent: Handle): Handle {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.heap.AllocateHandle("CLOSURE");
        // 新建一个空的闭包对象
        let closure = new Closure(instructionAddress, parent);
        // 存到堆区
        this.heap.Set(newClosureHandle, closure);

        return newClosureHandle;
    }

    // 根据闭包把柄获取闭包
    public GetClosure(closureHandle: Handle): Closure {
        return this.heap.Get(closureHandle);
    }

    // 获取进程的当前闭包
    public GetCurrentClosure(): Closure {
        return this.heap.Get(this.currentClosureHandle);
    }

    // 设置进程的当前闭包
    public SetCurrentClosure (closureHandle: Handle): void {
        this.currentClosureHandle = closureHandle;
    }

    // 变量解引用（解引/用引）
    public Dereference(variableName: string): any {
        let currentClosure: Closure = this.GetCurrentClosure();
        // 查找约束变量
        if(currentClosure.HasBoundVariable(variableName)) {
            return currentClosure.GetBoundVariable(variableName);
        }
        // 查找自由变量：上溯闭包，找到词法定义环境（约束变量绑定所在的闭包），根据脏标记状态决定选取 当前闭包的自由变量取值 或者 词法定义环境的约束变量取值
        let closureHandle = this.currentClosureHandle;
        let closure = null;
        while(closureHandle !== TOP_NODE_HANDLE) {
            closure = this.GetClosure(closureHandle);
            if(closure.HasBoundVariable(variableName)) {
                // 检查脏标记：如果约束变量绑定带了脏标记，意味着这个变量已经在其他衍生环境中被修改（并波及到词法定义位置），因此需要使用约束变量绑定中的（新）值
                if(closure.IsDirtyVariable(variableName)) {
                    return closure.GetBoundVariable(variableName);
                }
                else {
                    if(currentClosure.HasFreeVariable(variableName)) {
                        return currentClosure.GetFreeVariable(variableName);
                    }
                    else {
                        throw `[Error] 自由变量'${variableName}' at Closure${closureHandle}不存在（不合理的情况）`;
                    }
                }
            }
            closureHandle = closure.parent;
        }
        throw `[Error] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }

    public GC() {
        // NOTE 可达性分析的根节点有哪些？
        // - 当前闭包
        // - 当前闭包和函数调用栈对应闭包内的变量绑定
        // - 操作数栈内的把柄
        // - 函数调用栈内所有栈帧对应的闭包把柄
        // - 所有continuation中保留的上面的各项

        let gcroots: Array<any> = new Array();
        let currentProcess = this;

        function GCRoot(currentClosureHandle: Handle, OPSTACK: Array<any>, FSTACK: Array<StackFrame>) {
            let currentClosure = currentProcess.heap.Get(currentClosureHandle);
            gcroots.push(currentClosureHandle);
    
            for(let bound in currentClosure.boundVariables) {
                let boundValue = currentClosure.GetBoundVariable(bound);
                if(TypeOfToken(boundValue) === "HANDLE") {
                    gcroots.push(boundValue);
                }
            }
            for(let free in currentClosure.freeVariables) {
                let freeValue = currentClosure.GetFreeVariable(free);
                if(TypeOfToken(freeValue) === "HANDLE") {
                    gcroots.push(freeValue);
                }
            }
    
            for(let r of OPSTACK) {
                if(TypeOfToken(r) === "HANDLE") {
                    gcroots.push(r);
                }
            }
    
            for(let f of FSTACK) {
                let closure = currentProcess.heap.Get(f.closureHandle);
                if(closure.type === "CLOSURE") {
                    gcroots.push(f.closureHandle);
                    let currentClosure = closure;
                    for(let bound in currentClosure.boundVariables) {
                        let boundValue = currentClosure.GetBoundVariable(bound);
                        if(TypeOfToken(boundValue) === "HANDLE") {
                            gcroots.push(boundValue);
                        }
                    }
                    for(let free in currentClosure.freeVariables) {
                        let freeValue = currentClosure.GetFreeVariable(free);
                        if(TypeOfToken(freeValue) === "HANDLE") {
                            gcroots.push(freeValue);
                        }
                    }
                }
            }
        }

        // 分析虚拟机基础环境中的GC根
        GCRoot(this.currentClosureHandle, this.OPSTACK, this.FSTACK);

        this.heap.ForEach((hd)=> {
            let obj = this.heap.Get(hd);
            if(obj.type === "CONTINUATION") {
                // 获取续体，并反序列化之
                let cont: Continuation = obj;
                let newConfiguration: any = JSON.parse(cont.partialEnvironmentJson);
                // 将续体内部环境加入GC根
                GCRoot(newConfiguration.currentClosureHandle, newConfiguration.OPSTACK, newConfiguration.FSTACK);
            }
            else return;
        });

        // 仅标记列表和字符串，不处理闭包和续延。清除也是。
        let alives: HashMap<string, boolean> = new HashMap();
        let thisProcess = this;
        function GCMark(handle) {
            if(alives.has(handle)) return;
            if(TypeOfToken(handle) !== "HANDLE") return;
            else if(thisProcess.heap.HasHandle(handle) !== true) return; // 被清理掉的对象
            let obj = thisProcess.heap.Get(handle);
            if(obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "APPLICATION") {
                alives.set(handle, true);
                for(let child of obj.children) {
                    GCMark(child);
                }
            }
            else if(obj.type === "STRING"){
                alives.set(handle, true);
            }
            else if(obj.type === "CLOSURE"){
                alives.set(handle, true);

                let currentClosure = obj;
                GCMark(currentClosure.parent);
                for(let bound in currentClosure.boundVariables) {
                    let boundValue = currentClosure.GetBoundVariable(bound);
                    if(TypeOfToken(boundValue) === "HANDLE") {
                        GCMark(boundValue);
                    }
                }
                for(let free in currentClosure.freeVariables) {
                    let freeValue = currentClosure.GetFreeVariable(free);
                    if(TypeOfToken(freeValue) === "HANDLE") {
                        GCMark(freeValue);
                    }
                }
            }
        }

        for(let root of gcroots) {
            GCMark(root);
        }

        // 清理
        let gcount = 0;
        let count = 0;
        this.heap.ForEach((hd)=> {
            count++;
            let obj = this.heap.Get(hd);
            let isStatic = (this.heap.metadata.get(hd).charAt(0) === "S");
            if(isStatic) return;
            else if(obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "STRING" || obj.type === "CLOSURE") {
                if(alives.get(hd) !== true) {
                    this.heap.DeleteHandle(hd);
                    // console.info(`[GC] 回收对象 ${hd}。`);
                    gcount++;
                }
            }
            else return;
        });
        if(ANIMAC_CONFIG.is_debug === true && gcount > 0) {
            console.info(`[GC] 已回收 ${gcount} / ${count} 个对象。`);
        }
    }

    /* 程序流程控制 */

    // 获取并解析当前指令
    public CurrentInstruction(): Instruction {
        let instString: string = (this.instructions)[this.PC];
        return new Instruction(instString);
    }

    // 解析标签为指令索引（地址）
    public GetLabelAddress(label: string): number {
        return this.labelMapping.get(label);
    }

    // 前进一步（PC加一）
    public Step(): void {
        this.PC++;
    }

    // 前进一步跳转到（PC置数）
    public Goto(instructionAddress: number): void {
        this.PC = instructionAddress;
    }

    // 捕获当前续延并返回其把柄
    public CaptureContinuation(contReturnTargetLable: string): Handle {
        // 首先保存当前的（部分）进程环境
        let partialEnvironment: Object = {
            currentClosureHandle: this.currentClosureHandle,
            OPSTACK: this.OPSTACK,
            FSTACK: this.FSTACK
        };
        // 新建续延对象
        let cont = new Continuation(partialEnvironment, contReturnTargetLable);
        // 分配一个续延把柄
        let contHandle = this.heap.AllocateHandle("CONTINUATION");
        // 将续延存到堆区
        this.heap.Set(contHandle, cont);

        return contHandle;
    }

    // 恢复指定的续延，并返回其返回目标位置的标签
    public LoadContinuation(continuationHandle: Handle): string {
        // 获取续延，并反序列化之
        let cont: Continuation = this.heap.Get(continuationHandle);
        let newConfiguration: any = JSON.parse(cont.partialEnvironmentJson);
        // 恢复续延保存的环境
        this.currentClosureHandle = newConfiguration.currentClosureHandle;
        this.OPSTACK = newConfiguration.OPSTACK;
        this.FSTACK = newConfiguration.FSTACK;
        // 返回续延的返回位置标签
        return cont.contReturnTargetLable;
    }

    /* 反射相关 */

    // 中间语言指令序列的标签分析
    public LabelAnalysis(): void {
        for(let i = 0; i < this.instructions.length; i++) {
            if((this.instructions[i].trim())[0] === "@") {
                this.labelMapping.set(this.instructions[i].trim(), i);
            }
        }
    }

    /* 进程状态控制 */

    // 设置进程状态
    public SetState(pstate: ProcessState): void {
        this.state = pstate;
    }
}

