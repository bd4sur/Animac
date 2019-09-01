
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
