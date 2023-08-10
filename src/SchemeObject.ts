
// SchemeObjects.ts
// 内存管理和对象定义

// TODO 完善所有对象的深拷贝

type Handle = string;

class HashMap<DummyHandle, V> extends Object{
    public set(handle: Handle, value: any): void {
        this[handle] = value;
    }
    public get(handle: Handle): any{
        return this[handle];
    }
    public has(handle: Handle): boolean {
        return (handle in this);
    }
    public Copy(): HashMap<DummyHandle, any> {
        let copy: HashMap<DummyHandle, any> = new HashMap();
        for(let addr in this) {
            let value = this.get(addr);
            if(value === undefined) continue;
            if(value instanceof SchemeObject) {
                copy.set(addr, value.Copy());
            }
            else {
                let newValue = JSON.parse(JSON.stringify(value));
                copy.set(addr, newValue);
            }
        }
        return copy;
    }
}

// 基于HashMap的对象存储区，用于实现pool、heap等
class Memory {
    // 数据Map
    public data: HashMap<Handle, any>;
    // 元数据Map（[静态标记,只读标记,使用状态标记,[主引对象把柄]]）
    public metadata: HashMap<Handle, string>;
    // 自增的计数器，用于生成把柄
    public handleCounter: number;

    constructor() {
        this.data = new HashMap();
        this.metadata = new HashMap();
        this.handleCounter = 0;
    }

    // 生成元数据字符串
    private MetaString(isStatic: boolean, isReadOnly: boolean, status: string): string {
        let str = "";
        str +=   (isStatic) ? "S" : "_";
        str += (isReadOnly) ? "R" : "_";
        switch(status) {
            case "allocated":
                str += "A"; break;
            case "modified":
                str += "M"; break;
            case "free":
                str += "F"; break;
            default:
                str += "_"; break;
        }
        return str;
    }

    // 把柄存在性判断
    public HasHandle(handle: Handle): boolean {
        return this.data.has(handle);
    }

    // 新建任意把柄
    public NewHandle(handle: Handle, isStatic: boolean | void): void {
        isStatic = isStatic || false;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated"));
    }

    // 动态分配堆对象把柄
    public AllocateHandle(typeTag: string, isStatic: boolean | void): Handle {
        isStatic = isStatic || false;
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated"));
        this.handleCounter++;
        return handle;
    }

    // 动态回收堆对象把柄：删除堆中相应位置
    public DeleteHandle (handle: Handle): void {
        delete this.data[handle];
        delete this.metadata[handle];
        // this.data.set(handle, undefined);
        // this.metadata.set(handle, this.MetaString(false, false, "free"));
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
            throw `[Error] 未分配的把柄:${handle}`;
        }
        else if(metadata[1] === "R") {
            throw `[Error] 不允许修改只读对象:${handle}`;
        }
        else if(metadata[0] === "S") {
            // console.warn(`[Warn] 修改了静态对象:${handle}`);
        }
        this.metadata.set(handle, this.MetaString((metadata[0] === "S"), false, "modified"));
        this.data.set(handle, value);
    }

    // 是否静态
    public IsStatic(handle: Handle): boolean {
        return ((this.metadata.get(handle))[0] === "S");
    }

    // 遍历
    // 注意：输入函数通过返回"break"来结束循环，通过返回其他任意值来中止一轮循环（continue）。
    public ForEach(f: (handle: Handle)=>any): void {
        for(let handle in this.data) {
            let ctrl = f(handle);
            if(ctrl === "break") break;
        }
    }

    // 深拷贝
    public Copy(): Memory {
        let copy = new Memory();
        copy.data = this.data.Copy();
        copy.metadata = this.metadata.Copy();
        copy.handleCounter = this.handleCounter;
        return copy;
    }
}

class SchemeObject {
    public type: SchemeObjectType;

    public Copy() {}
}

enum SchemeObjectType {
    STRING        = "STRING",
    // SYMBOL     = "SYMBOL",
    // NUMBER     = "NUMBER",
    // BOOLEAN    = "BOOLEAN",
    LIST          = "LIST",
      LAMBDA      = "LAMBDA",
      APPLICATION = "APPLICATION",
      QUOTE       = "QUOTE",
      QUASIQUOTE  = "QUASIQUOTE",
      UNQUOTE     = "UNQUOTE",
    CLOSURE       = "CLOSURE",
    CONTINUATION  = "CONTINUATION"
}

// 各种具体对象

// Application列表对象
class ApplicationObject extends SchemeObject {
    public parent: Handle;
    public children: Array<any>;

    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.APPLICATION;
        this.parent = parent;
        this.children = new Array<any>();
    }

    public Copy(): ApplicationObject {
        let copy = new ApplicationObject(this.parent);
        copy.type = SchemeObjectType.APPLICATION;
        copy.children = this.children.slice();
        return copy;
    }
}

// Quote列表对象
class QuoteObject extends SchemeObject {
    public parent: Handle;
    public children: Array<any>;

    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.QUOTE;
        this.parent = parent;
        this.children = new Array<any>();
    }

    public Copy(): QuoteObject {
        let copy = new QuoteObject(this.parent);
        copy.type = SchemeObjectType.QUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}

// Quasiquote列表对象
class QuasiquoteObject extends SchemeObject {
    public parent: Handle;
    public children: Array<any>;

    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.QUASIQUOTE;
        this.parent = parent;
        this.children = new Array<any>();
    }

    public Copy(): QuasiquoteObject {
        let copy = new QuasiquoteObject(this.parent);
        copy.type = SchemeObjectType.QUASIQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}

// Unquote列表对象
class UnquoteObject extends SchemeObject {
    public parent: Handle;
    public children: Array<any>;

    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.UNQUOTE;
        this.parent = parent;
        this.children = new Array<any>();
    }

    public Copy(): UnquoteObject {
        let copy = new UnquoteObject(this.parent);
        copy.type = SchemeObjectType.UNQUOTE;
        copy.children = this.children.slice();
        return copy;
    }
}

// Lambda列表对象
// [lambda, [param0, ... ], body0, ...]
class LambdaObject extends SchemeObject {
    public parent: Handle;
    public children: Array<any>;

    constructor(parent: Handle) {
        super();
        this.type = SchemeObjectType.LAMBDA;
        this.parent = parent;
        this.children = new Array<any>();
        this.children[0] = "lambda";
        this.children[1] = new Array<string>();
    }

    public Copy(): LambdaObject {
        let copy = new LambdaObject(this.parent);
        copy.type = SchemeObjectType.LAMBDA;
        copy.children = this.children.slice();
        return copy;
    }

    public addParameter(param: string): void {
        if(this.children[1].indexOf(param) < 0) { // 如果有同名的变量则不添加
            this.children[1].push(param);
        }
    }

    public addBody(body: any): void {
        this.children.push(body);
    }

    public getParameters(): Array<any> {
        return this.children[1];
    }

    public getBodies(): Array<any> {
        return this.children.slice(2);
    }

    // 用于AST融合
    public setBodies(bodies: Array<any>): void {
        this.children = this.children.slice(0, 2).concat(bodies);
    }
}

// 字符串对象
class StringObject extends SchemeObject {
    public content: string;
    constructor(str: string) {
        super();
        this.type = SchemeObjectType.STRING;
        this.content = str;
    }

    public Copy(): StringObject {
        return new StringObject(this.content);
    }
}

// 闭包（运行时堆对象）
class Closure extends SchemeObject {
    public instructionAddress: number;               // 指令地址
    public parent: Handle;            // 亲代闭包把柄
    public boundVariables: HashMap<string, any>;   // 约束变量
    public freeVariables: HashMap<string, any>;    // 自由变量
    public dirtyFlag: HashMap<string, boolean>;    // 脏标记

    constructor(instructionAddress: number,
                parent: Handle) {
        super();
        this.type = SchemeObjectType.CLOSURE;
        this.instructionAddress = instructionAddress;
        this.parent = parent;
        this.boundVariables = new HashMap<string, any>();
        this.freeVariables = new HashMap<string, any>();
        this.dirtyFlag = new HashMap<string, boolean>();
    }

    public Copy(): Closure {
        let copy = new Closure(this.instructionAddress, this.parent);
        copy.type = SchemeObjectType.CLOSURE;
        copy.boundVariables = this.boundVariables.Copy();
        copy.freeVariables = this.freeVariables.Copy();
        copy.dirtyFlag = this.dirtyFlag.Copy();
        return copy;
    }

    // 不加脏标记
    public InitBoundVariable(variable: string, value: any): void {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    public SetBoundVariable(variable: string, value: any): void {
        this.boundVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    public GetBoundVariable(variable: string): any {
        return this.boundVariables[variable];
    }
    // 不加脏标记
    public InitFreeVariable(variable: string, value: any): void {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = false;
    }
    // 加脏标记（仅用于set指令）
    public SetFreeVariable(variable: string, value: any): void {
        this.freeVariables[variable] = value;
        this.dirtyFlag[variable] = true;
    }
    public GetFreeVariable(variable: string): any {
        return this.freeVariables[variable];
    }

    public IsDirtyVariable(variable: string): boolean {
        return this.dirtyFlag[variable];
    }

    public HasBoundVariable(variable: string): boolean {
        return this.boundVariables.has(variable);
    }
    public HasFreeVariable(variable: string): boolean {
        return this.freeVariables.has(variable);
    }
}

// 续延（运行时堆对象）
class Continuation extends SchemeObject{
    public partialEnvironmentJson: string;
    public contReturnTargetLable: string;

    constructor(partialEnvironment: Object, contReturnTargetLable: string) {
        super();
        this.type = SchemeObjectType.CONTINUATION;
        this.partialEnvironmentJson = JSON.stringify(partialEnvironment);
        this.contReturnTargetLable = contReturnTargetLable;
    }

    public Copy(): Continuation {
        let copy = new Continuation(null, null);
        copy.type = SchemeObjectType.CONTINUATION;
        copy.partialEnvironmentJson = this.partialEnvironmentJson;
        copy.contReturnTargetLable = this.contReturnTargetLable;
        return copy;
    }
}
