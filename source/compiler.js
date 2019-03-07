// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// compiler.js
// 编译器
// 输入：AST（代码抽象语法树）
// 输出：MODULE（经编译的模块文件）

const Common = require('./common.js'); // 引入公用模块

// 编译器
const Compiler = function(qualifiedName, AST) {
    let MODULE = new Common.Module(qualifiedName);

    let NODES = AST.slists;

    // 虚拟机指令序列
    let ASM = new Array();

    // 生成不重复的字符串
    let stringIncCounter = 0;
    function UniqueString() {
        let uniqueString = `TEMP${stringIncCounter.toString()}`;
        stringIncCounter++;
        return uniqueString;
    }

    // 处理简单Application，即第一项不为SLIST的Application
    function compileLambda(nodeRef) {
        let node = AST.GetObject(nodeRef);
        // 插入注释
        ASM.push(`;; [SSC] Function @ $${node.index}`);
        // 插入标签，格式为@$x
        ASM.push(`@$${node.index}`);
        // 按参数列表逆序，插入store指令
        let parameters = node.parameters;
        for(let i = parameters.length - 1; i >= 0; i--) {
            ASM.push(`store ${parameters[i]}`);
        }

        if(Common.TypeOfToken(node.body) === Common.OBJECT_TYPE.REF_SLIST) {
            bodyNode = AST.GetObject(node.body);
            if(bodyNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`push @${node.body}`);
            }
            else if(bodyNode.isQuoted === true) {
                ASM.push(`push ${node.body}`);
            }
            else {
                compileSList(node.body);
            }
        }
        else if(Common.TypeOfToken(node.body) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${node.body}`);
        }
        else {
            ASM.push(`push ${node.body}`);
        }
        ASM.push(`return`);
    }

    // 处理call/cc
    function compileCallCC(nodeRef) {
        let node = AST.GetObject(nodeRef);
        // 参数：可能是lambda，也可能是变量
        let thunk = node.children[1];
        // cont临时变量，同时也是cont返回标签
        let contName = Common.makeRef(Common.OBJECT_TYPE.VARIABLE, `CC-${thunk}-${UniqueString()}`);
        ASM.push(`;; [SSC] Current Continuation captured, stored in ${contName}`);
        ASM.push(`capturecc ${contName}`);
        ASM.push(`load ${contName}`);
        if(Common.TypeOfToken(thunk) === Common.OBJECT_TYPE.REF_SLIST) {
            let thunkNode = AST.GetObject(thunk);
            if(thunkNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`call @${thunk}`);
            }
            else {
                throw `[SSC] Error: A thunk required`;
            }
        }
        else if(Common.TypeOfToken(thunk) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`call ${thunk}`);
        }
        else {
            throw `[SSC] Error: A thunk required`;
        }
        ASM.push(`@${contName}`);
        return;
    }

    // 处理define
    function compileDefine(nodeRef) {
        let node = AST.GetObject(nodeRef);
        ASM.push(`;; [SSC] DEFINE`);
        let rightValue = node.children[2];
        // load/push
        if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_SLIST) {
            let rightValueNode = AST.GetObject(rightValue);
            if(rightValueNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`push @${rightValue}`);
            }
            else {
                ASM.push(`push ${rightValue}`);
            }
        }
        else if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${rightValue}`);
        }
        else {
            ASM.push(`push ${rightValue}`);
        }
        // store
        let leftVariable = node.children[1];
        if(Common.TypeOfToken(leftVariable) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`store ${leftVariable}`);
        }
        else {
            throw `[SSC] Error: The first parameter of 'define' should be REF_VARIABLE`
        }
        return;
    }

    // 处理set!
    function compileSet(nodeRef) {
        let node = AST.GetObject(nodeRef);
        ASM.push(`;; [SSC] SET!`);
        let rightValue = node.children[2];
        // load/push
        if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_SLIST) {
            let rightValueNode = AST.GetObject(rightValue);
            if(rightValueNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`push @${rightValue}`);
            }
            else if(rightValueNode.isQuoted === true) {
                ASM.push(`push ${rightValue}`);
            }
            else {
                compileSList(rightValue);
            }
        }
        else if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${rightValue}`);
        }
        else {
            ASM.push(`push ${rightValue}`);
        }
        // store
        let leftVariable = node.children[1];
        if(Common.TypeOfToken(leftVariable) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`set! ${leftVariable}`);
        }
        else {
            throw `[SSC] Error: The first parameter of 'set!' should be REF_VARIABLE`
        }
        return;
    }

    // 处理if
    // (if p t f)
    // TODO 此处可以加比较高级的编译优化
    function compileIf(nodeRef) {
        let node = AST.GetObject(nodeRef);
        ASM.push(`;; [SSC] IF`);
        // 处理p
        let predicate = node.children[1];
        if(Common.TypeOfToken(predicate) === Common.OBJECT_TYPE.REF_SLIST) {
            let predicateNode = AST.GetObject(predicate);
            if(predicateNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`load ${predicate}`);
            }
            else if(predicateNode.isQuoted === true) {
                ASM.push(`push ${predicate}`);
            }
            else {
                compileSList(predicate);
            }
        }
        else if(Common.TypeOfToken(predicate) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${predicate}`);
        }
        else { // TODO 此处可以作优化
            ASM.push(`push ${predicate}`);
        }
        // 认为取f分支的概率较大，因此使用iftrue指令
        let trueTag = `@${UniqueString()}`; // true分支标签
        let endTag = `@${UniqueString()}`; // if语句结束标签
        ASM.push(`iftrue ${trueTag}`);
        // 处理false分支
        let falseBranch = node.children[3];
        if(Common.TypeOfToken(falseBranch) === Common.OBJECT_TYPE.REF_SLIST) {
            let falseBranchNode = AST.GetObject(falseBranch);
            if(falseBranchNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`load ${falseBranch}`);
            }
            else if(falseBranchNode.isQuoted === true) {
                ASM.push(`push ${falseBranch}`);
            }
            else {
                compileSList(falseBranch);
            }
        }
        else if(Common.TypeOfToken(falseBranch) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${falseBranch}`);
        }
        else {
            ASM.push(`push ${falseBranch}`);
        }
        // 跳转到结束标签
        ASM.push(`goto ${endTag}`);
        // 添加true分支标签
        ASM.push(trueTag);
        // 处理true分支
        let trueBranch = node.children[2];
        if(Common.TypeOfToken(trueBranch) === Common.OBJECT_TYPE.REF_SLIST) {
            let trueBranchNode = AST.GetObject(trueBranch);
            if(trueBranchNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`load ${trueBranch}`);
            }
            else if(trueBranchNode.isQuoted === true) {
                ASM.push(`push ${trueBranch}`);
            }
            else {
                compileSList(trueBranch);
            }
        }
        else if(Common.TypeOfToken(trueBranch) === Common.OBJECT_TYPE.REF_VARIABLE) {
            ASM.push(`load ${trueBranch}`);
        }
        else {
            ASM.push(`push ${trueBranch}`);
        }
        // 结束标签
        ASM.push(endTag);
        return;
    }


    // 处理简单Application，即第一项不为Application的Application
    function compileSList(nodeRef) {
        let node = AST.GetObject(nodeRef);
        let children = node.children;
        // 空表，直接返回
        if(children.length === 0) { return; }

        // 检查第一项的类型，区别对待SLIST/LAMBDA和原子
        let first = children[0];

        // 首先处理特殊格式
        if(first === 'call/cc') { return compileCallCC(nodeRef); }
        else if(first === 'define') { return compileDefine(nodeRef); }
        else if(first === 'set!') { return compileSet(nodeRef); }
        else if(first === 'if') { return compileIf(nodeRef);}

        // TODO Lambda的优化
        // 根据第一项是否是Application，采取ANF变换和直接生成汇编两种策略
        // 对于(A=SList ...)这种形式，应当进行一次η变换，变成((lambda (a ...) (a ...)) A ...)的形式
        //   也就是说，临时变量不能被绑定在当前闭包中

        let typeOfFirst = Common.TypeOfToken(first);

        // 首项是待求值的Application，需要进行η变换
        if(typeOfFirst === Common.OBJECT_TYPE.REF_SLIST && AST.GetObject(first).type === Common.NODE_TYPE.SLIST) {

            let startTag = `@APPLY-BEGIN-${UniqueString()}`;
            ASM.push(`goto ${startTag}`);

            // 构造临时函数
            let tempLambdaName = `TEMP-LAMBDA-${UniqueString()}`;
            let tempVarArray = new Array();
            for(let i = 0; i < children.length; i++) {
                tempVarArray[i] = Common.makeRef(Common.OBJECT_TYPE.VARIABLE, UniqueString());
            }
            ASM.push(`;; [SSC] Temporary Function @${tempLambdaName}`);
            ASM.push(`@${tempLambdaName}`);
            for(let i = children.length - 1; i >= 0; i--) {
                ASM.push(`store ${tempVarArray[i]}`);
            }
            for(let i = 1; i < children.length; i++) {
                ASM.push(`load ${tempVarArray[i]}`);
            }
            ASM.push(`tailcall ${tempVarArray[0]}`);
            ASM.push(`return`);

            // 主体开始
            ASM.push(`;; [SSC] Call Temporary Function @${tempLambdaName}`);
            ASM.push(startTag);

            for(let i = 0; i < children.length; i++) {
                ASM.push(`;; [SSC] Push item ${i}`);
                let child = children[i];
                if(Common.TypeOfToken(child) === Common.OBJECT_TYPE.REF_SLIST) {
                    let childNode = AST.GetObject(child);
                    if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                        ASM.push(`load @${child}`);
                    }
                    else if(childNode.isQuoted === true) {
                        ASM.push(`push ${child}`);
                    }
                    else {
                        compileSList(child);
                    }
                }
                // 变量参数用load
                else if(Common.TypeOfToken(child) === Common.OBJECT_TYPE.REF_VARIABLE) {
                    ASM.push(`load ${child}`);
                }
                // 其他类型的引用用push
                else {
                    ASM.push(`push ${child}`);
                }
            }
            ASM.push(`call @${tempLambdaName}`);
        }
        // 首项是原子对象，包括字面Lambda
        else {
            for(let i = 1; i < children.length; i++) { // 处理参数列表
                let child = children[i];
                if(Common.TypeOfToken(child) === Common.OBJECT_TYPE.REF_SLIST) {
                    let childNode = AST.GetObject(child);
                    if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                        ASM.push(`load @${child}`);
                    }
                    else if(childNode.isQuoted === true) {
                        ASM.push(`push ${child}`);
                    }
                    else {
                        compileSList(child);
                    }
                }
                // 变量参数用load
                else if(Common.TypeOfToken(child) === Common.OBJECT_TYPE.REF_VARIABLE) {
                    ASM.push(`load ${child}`);
                }
                // 其他类型的引用用push
                else {
                    ASM.push(`push ${child}`);
                }
            }
            // 调用，需要区分Lambda和非Lambda
            if(typeOfFirst === Common.OBJECT_TYPE.KEYWORD) {
                if(first !== 'begin') { // begin不加入指令序列
                    ASM.push(`${first}`);
                }
            }
            else if(node.isTail) { // 尾调用（尾递归）
                if(typeOfFirst === Common.OBJECT_TYPE.REF_SLIST) {
                    ASM.push(`tailcall @${first}`);
                }
                else {
                    ASM.push(`tailcall ${first}`);
                }
            }
            else {
                if(typeOfFirst === Common.OBJECT_TYPE.REF_SLIST) {
                    ASM.push(`call @${first}`);
                }
                else {
                    ASM.push(`call ${first}`);
                }
            }
        }
    }

    // 程序入口（顶级函数）
    ASM.push(`call @$1`);
    ASM.push(`halt`);
    // 把所有的Lambda单独作为过程
    for(let node of NODES) {
        if(node.type === Common.NODE_TYPE.LAMBDA) {
            compileLambda(Common.makeRef(Common.OBJECT_TYPE.SLIST, node.index));
        }
    }

    MODULE.setASM(ASM);
    MODULE.setAST(AST);

    return MODULE;
};

module.exports.Compiler = Compiler;
