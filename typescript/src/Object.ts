// Object.ts
// 数据对象定义

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
