// 状态常量
const SUCCEED = 0;

type Handle = string;

interface Metadata {
    static: boolean,
    readOnly: boolean,
    status: string, // allocated modified free ...
    referrer: Array<Handle|void>
}

// 基于哈希表（Map）的对象存储区，用于实现pool、heap等
class Memory {
    // 数据Map
    public data: Map<Handle, any>;
    // 元数据Map（[静态标记,只读标记,使用状态标记,[主引对象把柄]]）
    public metadata: Map<Handle, Metadata>;
    // 自增的计数器，用于生成把柄
    public handleCounter: number;

    // 动态分配堆对象把柄
    public NewHandle(typeTag: string, referrer: Handle|void): Handle {
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        this.metadata.set(handle, {
            static: false,
            readOnly: false,
            status: 'allocated',
            referrer: [referrer]
        });
        this.handleCounter++;
        return handle;
    }

    // 动态回收堆对象把柄：删除堆中相应位置
    public DeleteHandle (handle: Handle): void {
        this.data.delete(handle);
        this.metadata.set(handle, {
            static: false,
            readOnly: false,
            status: 'free',
            referrer: null
        });
    }

    // 根据把柄获取对象
    public Get(handle: Handle): any {
        if(this.data.has(handle)) {
            return this.data.get(handle);
        }
        else {
            throw `[Memory.Get] 空把柄:${handle}`;
        }
    }

    // 设置把柄的对象值
    public Set(handle: Handle, value: any): void {
        let metadata = this.metadata.get(handle);
        if(this.data.has(handle) === false) {
            throw `[Memory.Set] 未分配的把柄:${handle}`;
        }
        else if(metadata.readOnly) {
            throw `[Memory.Set] 不允许修改只读对象:${handle}`;
        }
        else if(metadata.static) {
            console.warn(`[Memory.Set] 修改了静态对象:${handle}`);
        }
        else {
            metadata.status = 'modified';
            this.metadata.set(handle, metadata);
            this.data.set(handle, value);
        }
    }
}

// 栈帧
class StackFrame {
    public closureHandle: Handle;     // 闭包把柄
    public returnTargetIndex: number; // 返回指令地址

    constructor(closureHandle: Handle, target: number) {
        this.closureHandle = closureHandle;
        this.returnTargetIndex = target;
    }
}

// 闭包
class Closure {
    public instructionIndex: number;        // 指令地址
    public parentClosureHandle: Handle;     // 亲代闭包把柄
    public bound: Map<string, any>;         // 约束变量
    public upvalue: Map<string, any>;       // 自由变量
    public dirtyFlag: Map<string, boolean>; // 脏标记

    constructor(instructionIndex: number,
                parentClosureHandle: Handle) {
        this.instructionIndex = instructionIndex;
        this.parentClosureHandle = parentClosureHandle;
        this.bound = new Map<string, any>();
        this.upvalue = new Map<string, any>();
        this.dirtyFlag = new Map<string, boolean>();
    }
}

// 续延
class Continuation {
    public partialEnvironmentJson: string;
    public contReturnTargetLable: string;

    constructor(partialEnvironment: Object, contReturnTargetLable: string) {
        this.partialEnvironmentJson = JSON.stringify(partialEnvironment);
        this.contReturnTargetLable = contReturnTargetLable;
    }
}

interface Instruction {
    isLabel: boolean,
    instruction: string,
    mnemonic: string,
    argument: any
}

class Process {
    // 进程基本信息
    public processID: number;                  // 进程ID
    public parentProcessID: number;            // 父进程PID
    public childrenProcessID: Array<number>;   // 子进程PID列表
    public user: string;                       // 进程所属用户
    public moduleQualifiedName: string;        // 主模块全限定名
    public modulePath: string;                 // 主模块源文件路径

    // 进程状态
    public priority: number;                   // 进程优先级
    public state: number;                      // 进程状态

    // 进程程序区
    public instructions: Array<string>;        // 指令序列
    public labelMapping: Map<string, number>;  // 标签-指令索引映射

    // 堆 TODO 闭包区和Continuation区也统一存储在堆区
    public heap: Memory;                       // 堆存储区（静态资源+运行时动态分配）
    // public CLOSURES: Map<string, any>;       // 闭包区
    // public CONTINUATIONS: Map<string, any>;  // Continuation区

    // 把柄分配计数器
    //   注：每分配一个新把柄，计数器就加一，以保证每个新把柄都与已有的不同
    public handleCounter: number = 0;       // 把柄计数器

    // 执行机核心：栈、闭包和续延
    public PC: number = 0;                  // 程序计数器（即当前执行的指令索引）
    public currentClosureHandle: Handle;    // 当前闭包把柄

    public OPSTACK: Array<any>;             // 操作数栈
    public FSTACK: Array<StackFrame>;       // 调用栈（活动记录栈）

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
    public NewClosure(instructionIndex: number, parentClosureHandle: Handle): Handle {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.heap.NewHandle("CLOSURE");
        // 新建一个空的闭包对象
        let closure = new Closure(instructionIndex, parentClosureHandle);
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
        if(variableName in currentClosure.bound) {
            return currentClosure.bound.get(variableName);
        }
        // 然后查找自由变量
        let upvalueVal: any = null;
        if(variableName in currentClosure.upvalue) {
            upvalueVal = currentClosure.upvalue.get(variableName);
        }
        // 上溯闭包
        let closureHandle = this.currentClosureHandle;
        while(closureHandle !== null) {
            if(variableName in currentClosure.bound) {
                // 比对这个值与upvalue的值，如果一致则直接返回，如果不一致，以上溯的结果为准
                let boundVal: any = currentClosure.bound.get(variableName);
                if(upvalueVal !== boundVal) {
                    // 检查脏标记：
                    if(currentClosure.dirtyFlag.get(variableName)) {
                        return boundVal;
                    }
                    else {
                        return upvalueVal;
                    }
                }
                return boundVal;
            }
            currentClosure = this.GetClosure(currentClosure.parentClosureHandle);
            closureHandle = currentClosure.parentClosureHandle;
        }
        throw `[Dereference] 变量'${variableName}' at Closure${this.currentClosureHandle}未定义`;
    }

    /* 程序流程控制 */

    // 获取并解析当前指令
    public CurrentInstruction(): Instruction {
        let instString: string = (this.instructions)[this.PC];
        if(instString[0] === '@') {
            return {
                isLabel: true,
                instruction: instString,
                mnemonic: undefined,
                argument: undefined
            };
        }
        else {
            let fields = instString.split(/\s+/i);
            let mnemonic = fields[0].toLowerCase();
            let argument = fields[1];
            return {
                isLabel: false,
                instruction: instString,
                mnemonic: mnemonic,
                argument: argument
            };
        }
    }

    // 解析标签为指令索引（地址）
    public ParseLabel(label: string): number {
        return this.labelMapping.get(label);
    }

    // 前进一步（PC加一）
    public Step(): void {
        this.PC++;
    }

    // 前进一步跳转到（PC置数）
    public Goto(instructionIndex: number): void {
        this.PC = instructionIndex;
    }

    // 捕获当前续延并返回其把柄
    public CaptureContinuation(contReturnTargetLable): Handle {
        // 首先保存当前的（部分）进程环境
        let partialEnvironment: Object = {
            currentClosureHandle: this.currentClosureHandle,
            OPSTACK: this.OPSTACK,
            FSTACK: this.FSTACK
        };
        // 新建续延对象
        let cont = new Continuation(partialEnvironment, contReturnTargetLable);
        // 分配一个续延把柄
        let contHandle = this.heap.NewHandle("CONTINUATION");
        // 将续延存到堆区
        this.heap.Set(contHandle, cont);

        return contHandle;
    }

    // 恢复指定的续延，并返回其返回目标位置的标签
    public LoadContinuation(continuationHandle): string {
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

    /* 进程状态控制 */

    // 设置进程状态
    public SetProcessState(pstate: number): void {
        this.state = pstate;
    }
}

