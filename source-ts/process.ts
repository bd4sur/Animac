// 状态常量
const SUCCEED = 0;

// 把柄
class Handle {
    public handleString: string;
    public handleIndex: number;
    public handleType: HandleType;

    constructor(handleType: HandleType, index: number) {
        this.handleType = handleType;
        this.handleIndex = index;
        this.handleString = `${HandleType[this.handleType]}${this.handleIndex}`;
    }
}

// 把柄的类型枚举
enum HandleType {
    STRING = "SYMBLE",
    SYMBOL = "SYMBOL",
    CONSTANT = "CONSTANT",
    LIST = "LIST",
    VARIABLE = "VARIABLE",
    CLOSURE = "CLOSURE",
    CONTINUATION = "CONTINUATION"
};

// 基于哈希表（Map）的对象存储区，用于实现pool、heap等
interface Map<K, V> {
    getByHandle(handle: Handle): any;
    setByHandle(handle: Handle, value: any): void;
    deleteByHandle(handle: Handle): void;
    hasHandle(handle: Handle): boolean;
}

Map.prototype.getByHandle = function(handle: Handle): any {
    return this.get(handle.handleString);
};
Map.prototype.setByHandle = function(handle: Handle, value: any): void {
    this.set(handle.handleString, value);
};
Map.prototype.deleteByHandle = function(handle: Handle): void {
    delete this[handle.handleString];
};
Map.prototype.hasHandle = function(handle: Handle): boolean {
    return this.has(handle.handleString);
};


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

    // 静态资源池和堆
    public pool: Map<string, any>;             // 静态资源池
    public heap: Map<string, any>;             // 堆

    public heapOffset: number = 0;          // 堆起始地址（即pool的length）
    public maxHeapIndex: number = 0;        // 堆最大地址

    // 把柄分配计数器
    //   注：每分配一个新把柄，计数器就加一，以保证每个新把柄都与已有的不同
    public handleCounter: number = 0;       // 把柄计数器

    // 执行机核心：栈、闭包和续延
    public PC: number = 0;                  // 程序计数器（即当前执行的指令索引）
    public currentClosureHandle: Handle;    // 当前闭包把柄

    public OPSTACK: Array<any>;             // 操作数栈
    public FSTACK: Array<StackFrame>;       // 调用栈（活动记录栈）

    public CLOSURES: Map<string, any>;       // 闭包区
    public CONTINUATIONS: Map<string, any>;  // Continuation区

    /* 进程私有内存操作 */

    // 动态分配堆对象把柄
    public NewHandle(handleType: HandleType): Handle {
        let handleIndex = this.handleCounter;
        let handle = new Handle(handleType, handleIndex);
        this.handleCounter++;
        return handle;
    }

    // 动态回收堆对象把柄：删除堆中相应位置
    public DeleteHandle (handle: Handle): void {
        this.heap.deleteByHandle(handle);
    }

    // 根据把柄获取对象
    public GetObject(handle: Handle): any {
        if(this.pool.hasHandle(handle)) {
            return this.pool.getByHandle(handle);
        }
        else if(this.heap.hasHandle(handle)){
            return this.heap.getByHandle(handle);
        }
        else {
            throw `[GetObject] 空引用`;
        }
    }

    // 设置把柄的对象值
    public SetObject(handle: Handle, value: any): void {
        this.heap.setByHandle(handle, value);
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
    public NewClosure(instructionIndex: number, parentClosureHandle: Handle): Handle {
        // 首先申请一个新的闭包把柄
        let newClosureHandle = this.NewHandle(HandleType.CLOSURE);
        // 新建一个空的闭包对象
        let closure = new Closure(instructionIndex, parentClosureHandle);
        // 将闭包存到闭包存储中（TODO：未来也可以统一存到堆区）
        this.CLOSURES.setByHandle(newClosureHandle, closure);

        return newClosureHandle;
    }

    // 根据闭包把柄获取闭包
    public GetClosure(closureHandle: Handle): Closure {
        return this.CLOSURES.getByHandle(closureHandle);
    }

    // 获取进程的当前闭包
    public GetCurrentClosure(): Closure {
        return this.CLOSURES.getByHandle(this.currentClosureHandle);
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
        throw `[Dereference] 变量'${variableName}' at Closure${this.currentClosureHandle.handleString}未定义`;
    }

    /* 程序流程控制 */

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
        let contHandle = this.NewHandle(HandleType.CONTINUATION);
        // 将续延存到续延存储中（TODO：未来也可以统一存到堆区）
        this.CONTINUATIONS.setByHandle(contHandle, cont);

        return contHandle;
    }

    // 恢复指定的续延，并返回其返回目标位置的标签
    public LoadContinuation(continuationHandle): string {
        // 获取续延，并反序列化之
        let cont: Continuation = this.CONTINUATIONS.get(continuationHandle);
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

