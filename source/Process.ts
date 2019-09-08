
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
        // 首先查找约束变量
        if(currentClosure.HasBoundVariable(variableName)) {
            return currentClosure.GetBoundVariable(variableName);
        }
        // 然后查找自由变量
        let freeVarValue: any = null;
        if(currentClosure.HasFreeVariable(variableName)) {
            freeVarValue = currentClosure.GetFreeVariable(variableName);
        }
        // 上溯闭包
        let closureHandle = this.currentClosureHandle;
        while(closureHandle !== TOP_NODE_HANDLE) {
            currentClosure = this.GetClosure(closureHandle);
            if(currentClosure.HasBoundVariable(variableName)) {
                // 比对这个值与freeVar的值，如果一致则直接返回，如果不一致，以上溯的结果为准
                let boundVal: any = currentClosure.GetBoundVariable(variableName);
                if(freeVarValue !== boundVal) {
                    // 检查脏标记：
                    if(currentClosure.IsDirtyVariable(variableName)) {
                        return boundVal;
                    }
                    else {
                        return freeVarValue;
                    }
                }
                return boundVal;
            }
            closureHandle = currentClosure.parent;
        }
        throw `[Error] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }

    public GC() {
        // 获取当前所有闭包空间的全部绑定、以及操作数栈内的把柄，作为可达性分析的根节点
        let gcroots: Array<any> = new Array();

        this.heap.ForEach((hd)=> {
            let obj = this.heap.Get(hd);
            if(obj.type === "CLOSURE") {
                let currentClosure = obj;
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
        });

        for(let r of this.OPSTACK) {
            if(TypeOfToken(r) === "HANDLE") {
                gcroots.push(r);
            }
        }

        // 仅标记列表和字符串，不处理闭包和续延。清除也是。
        let alives: HashMap<string, boolean> = new HashMap();
        let thisProcess = this;
        function GCMark(handle) {
            if(TypeOfToken(handle) !== "HANDLE") return;
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
            else if(obj.type === "QUOTE" || obj.type === "QUASIQUOTE" || obj.type === "UNQUOTE" || obj.type === "STRING") {
                if(alives.get(hd) !== true) {
                    this.heap.DeleteHandle(hd);
                    gcount++;
                }
            }
            else return;
        });

        console.info(`[GC] 已回收 ${gcount} / ${count} 个对象。`);
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
    private LabelAnalysis(): void {
        for(let i = 0; i < this.instructions.length; i++) {
            if((this.instructions[i].trim())[0] === "@") {
                this.labelMapping.set(this.instructions[i].trim(), i);
            }
        }
    }

    // 判断某变量是否使用了某Native模块（通过读取this.ast.natives得知）
    public IsUseNative(variable: string): boolean {
        let varPrefix = variable.split(".")[0];
        return this.AST.natives.has(varPrefix);
    }

    /* 进程状态控制 */

    // 设置进程状态
    public SetState(pstate: ProcessState): void {
        this.state = pstate;
    }
}

