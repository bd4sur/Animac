// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// process.js
// 进程
//   进程是具有独立存储空间的用户任务单元。在VM中，多个进程可以在调度器的调度下并发执行。
//   一般而言，每个独立运行的模块，都对应一个运行时的进程。
//   进程可以被其他进程创建，形成亲子关系树。逻辑上，所有的用户进程都是虚拟机“init”线程的子孙进程。

const Common = require('./common.js'); // 引入公用模块

// 运行时对象（注意与AST中的对象相区分）
const RuntimeObject = function(type, value) {
    this.type = type;   // 类型
    this.value = value; // 值：JS对象
};

// 进程数据结构
const Process = function() {
    // 进程基本信息
    this.PID = 0;                // 进程ID
    this.PARENT = 0;             // 父进程PID
    this.CHILDREN = new Array(); // 子进程PID列表
    this.USER = null;            // 进程所属用户
    this.MODULE_QUALIFIED_NAME = null;  // 主模块全限定名
    this.MODULE_PATH = null;     // 主模块源文件路径

    // 进程状态
    this.PRIORITY = 0;    // 进程优先级
    this.STATE = 0;       // 进程状态

    // 进程私有的运行时数据
    this.INSTRUCTIONS = new Array();  // 指令序列
    this.LABEL_DICT = new Array();    // 标签-指令索引映射

    // 堆和池统称为“进程内存”
    this.POOL = new Array();          // 静态资源池
    this.HEAP = new Array();          // 进程私有堆

    this.HEAP_OFFSET = 0;             // 堆起始地址（即POOL的length）
    this.MAX_HEAP_INDEX = 0;          // 堆最大地址

    this.REF_INDEX = new Object();    // 引用序号计数器（用于引用分配）

    this.REFMAP = new Object();       // 引用地址映射（用于引用→池/堆地址的转换）

    this.OPSTACK = new Array();       // 操作数栈
    this.FSTACK = new Array();        // 调用栈（活动记录栈）
    this.CLOSURES = new Array();      // 闭包区
    this.FIRST_CLOSURE_INDEX = -1;     // 闭包起始索引（用于有效闭包判断）
    this.MAX_CLOSURE_INDEX = 0;       // 闭包最大索引（用于闭包索引分配）

    this.CONTINUATIONS = new Array(); // Continuation区
    this.MAX_CONTINUATION_INDEX = 0;  // Cont最大索引，用于索引分配

    this.PC = 0;                      // 程序计数器（即当前执行的指令索引）
    this.CURRENT_CLOSURE_REF = 0;     // 当前闭包寄存器
    this.WDT = 100000;                // 看门狗计数器（仅调试用，防止程序跑飞卡死）

    // 其他信息（外部资源、锁等）
    // 待补充

};

Process.prototype = {
    Init: function(PID, parentPID, user, maxMemorySize, compiledModule) {
        const PROGRAM_START_FROM = 0;

        // 进程基本信息
        this.PID = PID;
        this.PARENT = parentPID;
        this.CHILDREN = new Array();
        this.USER = user;
        // 20190311
        this.MODULE_QUALIFIED_NAME = compiledModule.qualifiedName;
        this.MODULE_PATH = compiledModule.modulePath;

        // 进程状态
        this.PRIORITY = 0;
        this.STATE = Common.PROCESS_STATE.DEFAULT;

        // 进程私有的运行时数据
        this.INSTRUCTIONS = compiledModule.ASM;
        this.LABEL_DICT = compiledModule.labelDict;

        // 堆和池统称为“进程内存”
        this.POOL = new Array();          // 静态资源池
        this.HEAP = new Array();          // 进程私有堆

        this.MAX_HEAP_INDEX = maxMemorySize;

        this.REF_INDEX = new Object();
        // TODO 如果有新的对象类型，这里需要增加
        this.REF_INDEX["STRING"      ] = 0;
        this.REF_INDEX["SLIST"       ] = 0;
        this.REF_INDEX["SYMBOL"      ] = 0;
        this.REF_INDEX["VARIABLE"    ] = 0;
        this.REF_INDEX["CONSTANT"    ] = 0;
        this.REF_INDEX["CLOSURE"     ] = 0;
        this.REF_INDEX["CONTINUATION"] = 0;

        this.REFMAP = new Object();

        this.OPSTACK = new Array();
        this.FSTACK = new Array();
        this.CLOSURES = new Array();
        this.FIRST_CLOSURE_INDEX = -1;
        this.MAX_CLOSURE_INDEX = 0;

        this.CONTINUATIONS = new Array();
        this.MAX_CONTINUATION_INDEX = 0;

        this.PC = PROGRAM_START_FROM;
        this.WDT = 100000;

        // 保留模块的AST
        this.AST = compiledModule.AST;

        // 将AST载入POOL
        let poolCounter = 0;
        let resources = compiledModule.AST;
        // 添加变量
        const newHeapObject = function(objType, obj) {
            (this.POOL)[poolCounter] = new RuntimeObject(objType, (objType === Common.OBJECT_TYPE.STRING) ? Common.trimQuotes(obj) : obj);
            let newref = `${Common.REF_PREFIX[objType]}${this.REF_INDEX[objType]}`;
            (this.REFMAP)[newref] = poolCounter;
            (this.REF_INDEX)[objType]++;
            poolCounter++;
        };

        for(let obj of resources.variables) {
            newHeapObject.call(this, "VARIABLE", obj);
        }
        // 添加符号
        for(let obj of resources.symbols) {
            newHeapObject.call(this, "SYMBOL", obj);
        }
        // 添加字符串
        for(let obj of resources.strings) {
            newHeapObject.call(this, "STRING", obj);
        }
        // 添加常数
        for(let obj of resources.constants) {
            newHeapObject.call(this, "CONSTANT", obj);
        }
        // 添加SList
        for(let obj of resources.slists) {
            newHeapObject.call(this, "SLIST", obj);
        }

        // 【重要】将堆地址起始值设置到最大池地址之后，保证二者空间不重叠
        this.HEAP_OFFSET = poolCounter;

        // 初始化调用栈
        this.CURRENT_CLOSURE_REF = this.newClosure(PROGRAM_START_FROM, "^-1");
        this.pushStackFrame(this.CURRENT_CLOSURE_REF, PROGRAM_START_FROM);
    },

    // 新建栈帧
    pushStackFrame: function(closureRef, returnTo) {
        (this.FSTACK).push({
            closure: closureRef,
            returnTo: returnTo,
        });
    },

    // 新建闭包
    newClosure: function(instructionIndex, parentClosureRef) {
        let closure = {
            instructionIndex: instructionIndex,
            parentClosureRef: parentClosureRef,
            env: new Object(),
            upvalue: new Object(),
        };
        (this.CLOSURES)[this.MAX_CLOSURE_INDEX] = closure;
        let newIndex = this.MAX_CLOSURE_INDEX;
        (this.MAX_CLOSURE_INDEX)++;
        return `${Common.REF_PREFIX["CLOSURE"]}${newIndex}`;
    },

    // 取出闭包
    getClosure: function(closureRef) {
        let closureIndex = parseInt(Common.getRefIndex(closureRef));
        return this.CLOSURES[closureIndex];
    },

    // 新建Continuation
    newContinuation: function(retTarget) {
        let partialEnv = {
            CURRENT_CLOSURE_REF: this.CURRENT_CLOSURE_REF,
            OPSTACK: this.OPSTACK,
            FSTACK: this.FSTACK,
            FIRST_CLOSURE_INDEX: this.FIRST_CLOSURE_INDEX,
            MAX_CLOSURE_INDEX: this.MAX_CLOSURE_INDEX,
        };
        let continuation = {
            json: JSON.stringify(partialEnv),
            retTarget: retTarget,
        };
        (this.CONTINUATIONS)[this.MAX_CONTINUATION_INDEX] = continuation;
        let newIndex = this.MAX_CONTINUATION_INDEX;
        (this.MAX_CONTINUATION_INDEX)++;
        return `${Common.REF_PREFIX["CONTINUATION"]}${newIndex}`;
    },

    // 恢复Cont保存的进程状态
    loadContinuation: function(contRef) {
        let cont = this.CONTINUATIONS[parseInt(Common.getRefIndex(contRef))];
        let newConfiguration = JSON.parse(cont.json);

        this.CURRENT_CLOSURE_REF = newConfiguration.CURRENT_CLOSURE_REF;
        this.OPSTACK = newConfiguration.OPSTACK;
        this.FSTACK = newConfiguration.FSTACK;
        this.FIRST_CLOSURE_INDEX = newConfiguration.FIRST_CLOSURE_INDEX;
        this.MAX_CLOSURE_INDEX = newConfiguration.MAX_CLOSURE_INDEX;

        return cont.retTarget;
    },

    // 从进程内存中取出对象
    GetObject: function(reference) {
        if(!isNaN(reference) || reference === '#f' || reference === '#t') {
            return new RuntimeObject(Common.OBJECT_TYPE.CONSTANT, reference.toString());
        }
        // 将引用转换到物理地址
        let addr = this.REFMAP[reference];
        // 先查找池空间
        if(addr in this.POOL) {
            return (this.POOL)[addr];
        }
        else if(addr in this.HEAP) {
            return (this.HEAP)[addr];
        }
        else {
            throw `[警告] 空引用`;
        }
    },

    // 在堆中分配空间，存储对象，并返回其引用
    NewObject: function(type, value) {
        // 依据type，分配新引用
        let reference = '';
        if( type === Common.OBJECT_TYPE.STRING   ||
            type === Common.OBJECT_TYPE.SLIST    ||
            type === Common.OBJECT_TYPE.SYMBOL   ||
            type === Common.OBJECT_TYPE.VARIABLE ||
            type === Common.OBJECT_TYPE.CONSTANT ) {
            let refPrefix = Common.REF_PREFIX[type];
            reference = `${refPrefix}${this.REF_INDEX[type]}`;
            this.REF_INDEX[type]++;
        }
        else {
            throw `[错误] 类型错误。`;
        }

        // 分配新的堆地址（小地址端第一个空位，概念上每个空位都可以放下一个对象，无大小限制。TODO：此处可优化）
        let newHeapIndex = this.MAX_HEAP_INDEX;
        for(let i = this.HEAP_OFFSET; i < this.MAX_HEAP_INDEX; i++) {
            if(!(this.HEAP[i])) {
                newHeapIndex = i;
                break;
            }
        }
        // 引用-物理地址映射
        (this.REFMAP)[reference] = newHeapIndex;
        // 存储对象
        (this.HEAP)[newHeapIndex] = new RuntimeObject(type, (type === Common.OBJECT_TYPE.STRING) ? Common.trimQuotes(value) : value);
        // 返回引用
        return reference;
    },


    // 将对象转换为相应的字符串
    ObjectToString: function(ref) {
        if(Common.TypeOfToken(ref) === "KEYWORD" || !(/^REF\_/g.test(Common.TypeOfToken(ref)))) {
            return ref;
        }
        let obj = this.GetObject(ref);
        let type = obj.type;
        if(type === Common.OBJECT_TYPE.CONSTANT || type === Common.OBJECT_TYPE.VARIABLE) {
            return obj.value;
        }
        else if(type === Common.OBJECT_TYPE.SYMBOL) {
            return obj.value;
        }
        else if(type === Common.OBJECT_TYPE.STRING) {
            return obj.value;
        }
        else if(type === Common.OBJECT_TYPE.SLIST) {
            let node = obj.value;
            let str = '';
            if(node.type === 'SLIST') {
                str = (node.isQuoted) ? "'(" : "(";
                if(node.children.length > 0) {
                    for(let i = 0; i < node.children.length-1; i++) {
                        str += this.ObjectToString.call(this, node.children[i]);
                        str += " ";
                    }
                    str += this.ObjectToString.call(this, node.children[node.children.length-1]);
                }
                str += ')';
            }
            else if(node.type === 'LAMBDA') {
                str = "(lambda (";
                // parameters
                if(node.parameters.length > 0) {
                    for(let i = 0; i < node.parameters.length-1; i++) {
                        str += this.ObjectToString.call(this, node.parameters[i]);
                        str += " ";
                    }
                    str += this.ObjectToString.call(this, node.parameters[node.parameters.length-1]);
                }
                str += ') ';
                // body
                for(let i = 0; i < node.body.length; i++) {
                    str += this.ObjectToString.call(this, (node.body)[i]);
                }
                str += ')';
            }
            
            return str;
        }
    },

    // *堆空间*垃圾回收
    // 说明：采取标记-清除算法。以GC时刻进程全部闭包的全部绑定、以及操作数栈中的所有引用为起点，进行堆对象引用可达性分析。
    // 注意：不会GC池空间（池空间是静态区，且池空间内部的对象引用是封闭于池空间内部的）。
    //   对于SLIST引用，会沿着子节点对其他对象的引用，标记仍然“存活”的对象。而对于符号、字符串、立即数等原子对象引用，则只标记目标对象的“存活”状态。
    //   随后，清理掉没有被标记为“存活”的对象。
    //   [进阶特性]为防止堆空间碎片化，可将所有存活对象迁移到低地址侧连续存放（但不要挤占池空间地址），同时重置堆地址计数器，以便再分配新的堆空间时，可以保持连续。
    //   由于REFMAP将物理地址与实际使用的对象引用（逻辑地址）隔离，因此碎片整理过程不会修改引用，对用户代码而言是透明的。
    GC: function() {
        console.info(`[GC] 垃圾回收开始（${this.HEAP.length}）`);
        // 获取闭包空间的全部绑定、以及操作数栈内的引用（称为**活动引用**），作为可达性分析的起点（即gcroot）
        let gcroots = new Object();
        for(let c of this.CLOSURES) {
            let env = c.env;
            for(let v in env) {
                let value = env[v];
                gcroots[value] = true;
            }
        }
        for(let r of this.OPSTACK) {
            gcroots[r] = true;
        }

        // 遍历所有活动引用，进行可达性分析
        // 说明：堆对象之间的引用，目前只有列表元素之间的引用，即临时表的嵌套。鉴于表嵌套是一种树状的关系，因此不可能出现循环引用的情况。
        let aliveObjects = new Object();
        function GCMark(rootref) {
            let reftype = Common.TypeOfToken(rootref);
            if(reftype === Common.OBJECT_TYPE.REF_SLIST) {
                let index = (this.REFMAP)[rootref];
                aliveObjects[index] = true;
                let children = this.GetObject(rootref).value.children;
                for(let r of children) {
                    GCMark.call(this, r.toString().replace(/\!$/gi, ""));
                }
            }
            else {
                let index = (this.REFMAP)[rootref];
                aliveObjects[index] = true;
            }
        }
        for(let r in gcroots) {
            GCMark.call(this, r.toString().replace(/\!$/gi, ""));
        }

        // 遍历全部堆对象，删除没有被标记为“存活”的对象
        for(let index = 0; index < this.HEAP.length; index++) {
            if(!(index in aliveObjects)) {
                // console.info(`[GC] 堆空间@${index} 已回收`);
                delete (this.HEAP)[index];
            }
        }
    },
};

module.exports.RuntimeObject = RuntimeObject;
module.exports.Process = Process;
