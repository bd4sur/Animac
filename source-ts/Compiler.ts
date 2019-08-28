
// Compiler.ts
// 编译器：AST→Module

// 模块
//   模块如同Java的字节码文件，包含代码、静态资源和元数据等
class Module {
    // TODO 模块结构设计，需要注意 ①元数据 ②可序列化性 ③与Runtime和Process结构对接
    static AVM_Version: string = "V0";
    public AST: AST;
    public ILCode: Array<string>;

    constructor() {
        this.ILCode = new Array();
    }
}

//////////////////////////////////////////////////
//
//  编译器：将AST编译成运行时环境可执行的模块
//
//////////////////////////////////////////////////

function Compile(ast: AST): Module {
    let module = new Module();

    let ILCode: Array<string> = new Array();

    ///////////////////////////////
    //  工具函数
    ///////////////////////////////

    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `${ast.moduleQualifiedName}.ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        return uniqueString;
    }
    // 增加一条新指令
    function AddInstruction(instStr: string): void {
        if(instStr.trim()[0] === ";") {
            ILCode.push(instStr);
        }
        else {
            ILCode.push("   " + instStr.trim()); // 与注释对齐
        }
    }

    ////////////////////////////////////////////////
    //  从所有的Lambda节点开始，递归地编译每个节点
    ////////////////////////////////////////////////

    // 编译Lambda节点

    function CompileLambda(nodeHandle: Handle): void {
        let node: LambdaObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ FUNCTION “${nodeHandle}” BEGIN`);

        // 函数开始标签：格式约定为@+LambdaHandle
        AddInstruction(`@${nodeHandle}`);

        // 按参数列表逆序，插入store指令
        // 【已解决】TODO 参数列表里通过define获得的参数，不需要在这里出现
        let parameters = node.getParameters();
        for(let i = parameters.length - 1; i >= 0; i--) {
            AddInstruction(`store  ${parameters[i]}`);
        }

        // 逐个编译函数体，等价于begin块
        let bodies = node.getBodies();
        for(let i = 0; i < bodies.length; i++) {
            let body = bodies[i];
            let bodyType = TypeOfToken(body);

            if(bodyType === "HANDLE") {
                let bodyObj = ast.GetNode(body);
                let bodyObjType = bodyObj.type;
                if(bodyObjType === "LAMBDA") {
                    AddInstruction(`loadclosure @${body}`);
                }
                else if(bodyObjType === "QUOTE" || bodyObjType === "QUASIQUOTE" || bodyObjType === "UNQUOTE") {
                    AddInstruction(`push ${body}`);
                }
                else if(bodyObjType === "STRING") {
                    AddInstruction(`push ${body}`);
                }
                else if(bodyObjType === "APPLICATION") {
                    CompileApplication(body);
                }
                else {
                    throw `[Error] 意外的函数体节点类型。`;
                }
            }
            else if(bodyType === "VARIABLE") {
                AddInstruction(`load ${body}`);
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(bodyType) >= 0) {
                AddInstruction(`push ${body}`);
            }
            else {
                throw `[Error] 意外的函数体类型。`;
            }
        }

        // 返回指令
        AddInstruction(`return`);

        AddInstruction(`;; 🛑 FUNCTION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译CallCC

    function CompileCallCC(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ Call/cc “${nodeHandle}” BEGIN`);

        // 参数：lambda（必须是thunk）或者引用thunk的变量
        let thunk = node.children[1];

        // cont临时变量，同时也构成cont返回标签
        let contName = `CC_${thunk}_${UniqueString()}`;
        AddInstruction(`;; ✅ Current Continuation captured, stored in “${contName}”`);

        // 捕获CC，并使用此CC调用thunk
        AddInstruction(`capturecc ${contName}`);
        AddInstruction(`load ${contName}`);

        if(TypeOfToken(thunk) === "HANDLE") {
            let thunkNode = ast.GetNode(thunk);
            // TODO Thunk类型检查
            if(thunkNode.type === "LAMBDA") {
                AddInstruction(`call @${thunk}`);
            }
            else {
                throw `[Error] call/cc的参数必须是Thunk。`;
            }
        }
        else if(TypeOfToken(thunk) === "VARIABLE") {
            // TODO Thunk类型检查
            AddInstruction(`call ${thunk}`);
        }
        else {
            throw `[Error] call/cc的参数必须是Thunk。`;
        }

        // cont返回标签
        AddInstruction(`@${contName}`);

        AddInstruction(`;; 🛑 Call/cc “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译define
    function CompileDefine(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ DEFINE “${nodeHandle}” BEGIN`);

        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if(rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if(rightValueNode.type === "LAMBDA") {
                AddInstruction(`push @${rightValue}`); // 注意：define并不对Lambda节点求值（即，生成闭包实例）
            }
            else { // 包括Application和String对象
                AddInstruction(`push ${rightValue}`); // 注意：define并不对Application（包括各种quote）求值
            }
        }
        else if(rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(rightValueType) >= 0) {
            AddInstruction(`push ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }

        // store
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if(leftVariableType === "VARIABLE") {
            AddInstruction(`store ${leftVariable}`);
        }
        else {
            throw `[Error] define左值必须是变量名称。`
        }

        AddInstruction(`;; 🛑 DEFINE “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译set!
    function CompileSet(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ SET! “${nodeHandle}” BEGIN`);

        // load/push
        let rightValue = node.children[2];
        let rightValueType = TypeOfToken(rightValue);
        if(rightValueType === "HANDLE") {
            let rightValueNode = ast.GetNode(rightValue);
            if(rightValueNode.type === "LAMBDA") {
                AddInstruction(`push @${rightValue}`); // 注意：set!也不对Lambda节点求值（即，生成闭包实例）
            }
            else if(rightValueNode.type === "QUOTE" || rightValueNode.type === "QUASIQUOTE" || rightValueNode.type === "UNQUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "APPLICATION") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if(rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(rightValueType) >= 0) {
            AddInstruction(`push ${rightValue}`);
        }
        else {
            throw `[Error] 意外的define右值。`;
        }

        // set
        let leftVariable = node.children[1];
        let leftVariableType = TypeOfToken(leftVariable);
        if(leftVariableType === "VARIABLE") {
            AddInstruction(`set ${leftVariable}`);
        }
        else {
            throw `[Error] set!左值必须是变量名称。`
        }

        AddInstruction(`;; 🛑 SET! “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译if
    function CompileIf(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ IF “${nodeHandle}” BEGIN`);

        // 处理分支条件
        let predicate = node.children[1];
        let predicateType = TypeOfToken(predicate);
        if(predicateType === "HANDLE") {
            let predicateNode = ast.GetNode(predicate);
            if(predicateNode.type === "APPLICATION") {
                CompileApplication(predicate);
            }
            // 其余情况，统统作push处理
            else {
                AddInstruction(`push ${predicate}`);
            }
        }
        else if(predicateType === "VARIABLE") {
            AddInstruction(`load ${predicate}`);
        }
        // TODO 此处可以作优化
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(predicateType) >= 0) {
            AddInstruction(`push ${predicate}`);
        }
        else {
            throw `[Error] 意外的if分支条件。`;
        }

        // 认为取f分支的概率较大，因此使用iftrue指令

        let uqStr = UniqueString();
        let trueTag = `@IF_TRUE_${uqStr}`; // true分支标签
        let endTag = `@IF_END_${uqStr}`; // if语句结束标签
        AddInstruction(`iftrue ${trueTag}`);

        // 处理false分支
        let falseBranch = node.children[3];
        let falseBranchType = TypeOfToken(falseBranch);
        if(falseBranchType === "HANDLE") {
            let falseBranchNode = ast.GetNode(falseBranch);
            if(falseBranchNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${falseBranch}`); // 返回闭包
            }
            else if(falseBranchNode.type === "QUOTE" || falseBranchNode.type === "QUASIQUOTE" || falseBranchNode.type === "UNQUOTE") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if(falseBranchNode.type === "STRING") {
                AddInstruction(`push ${falseBranch}`);
            }
            else if(falseBranchNode.type === "APPLICATION") {
                CompileApplication(falseBranch);
            }
            else {
                throw `[Error] 意外的if-false分支。`;
            }
        }
        else if(falseBranchType === "VARIABLE") {
            AddInstruction(`load ${falseBranch}`);
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(falseBranchType) >= 0) {
            AddInstruction(`push ${falseBranch}`);
        }
        else {
            throw `[Error] 意外的if-false分支。`;
        }

        // 跳转到结束标签
        AddInstruction(`goto ${endTag}`);

        // 添加true分支标签
        AddInstruction(trueTag);

        // 处理true分支

        let trueBranch = node.children[2];
        let trueBranchType = TypeOfToken(trueBranch);
        if(trueBranchType === "HANDLE") {
            let trueBranchNode = ast.GetNode(trueBranch);
            if(trueBranchNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${trueBranch}`); // 返回闭包
            }
            else if(trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if(trueBranchNode.type === "STRING") {
                AddInstruction(`push ${trueBranch}`);
            }
            else if(trueBranchNode.type === "APPLICATION") {
                CompileApplication(trueBranch);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }
        }
        else if(trueBranchType === "VARIABLE") {
            AddInstruction(`load ${trueBranch}`);
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(trueBranchType) >= 0) {
            AddInstruction(`push ${trueBranch}`);
        }
        else {
            throw `[Error] 意外的if-true分支。`;
        }

        // 结束标签
        AddInstruction(endTag);

        AddInstruction(`;; 🛑 IF “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译and
    function CompileAnd(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ AND “${nodeHandle}” BEGIN`);

        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@AND_END_${uqStr}`;
        let falseTag = `@AND_FALSE_${uqStr}`;

        // 遍历每一项
        for(let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);

            if(clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "APPLICATION") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的and clause。`;
                }
            }
            else if(clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            // TODO 此处可以作优化（短路）
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(clauseType) >= 0) {
                AddInstruction(`push ${clause}`);
            }
            else {
                throw `[Error] 意外的and clause。`;
            }

            // 每个分支后面都要作判断
            AddInstruction(`iffalse ${falseTag}`);
        }

        // 没有任何一项为假，则返回#t，结束
        AddInstruction(`push #t`);
        AddInstruction(`goto ${endTag}`);

        // 有任何一项为#f都会跳到这里，返回#f，结束
        AddInstruction(falseTag);
        AddInstruction(`push #f`);

        // 结束标签
        AddInstruction(endTag);

        AddInstruction(`;; 🛑 AND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译or
    function CompileOr(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ OR “${nodeHandle}” BEGIN`);

        // 结束位置标签
        let uqStr = UniqueString();
        let endTag = `@OR_END_${uqStr}`;
        let trueTag = `@OR_FALSE_${uqStr}`;

        // 遍历每一项
        for(let i = 1; i < node.children.length; i++) {
            let clause = node.children[i];
            let clauseType = TypeOfToken(clause);

            if(clauseType === "HANDLE") {
                let trueBranchNode = ast.GetNode(clause);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${clause}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "APPLICATION") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的 or clause。`;
                }
            }
            else if(clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
            }
            // TODO 此处可以作优化（短路）
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(clauseType) >= 0) {
                AddInstruction(`push ${clause}`);
            }
            else {
                throw `[Error] 意外的 or clause。`;
            }

            // 每个分支后面都要作判断
            AddInstruction(`iftrue ${trueTag}`);
        }

        // 没有任何一项为真（非假），则返回#f，结束
        AddInstruction(`push #f`);
        AddInstruction(`goto ${endTag}`);

        // 有任何一项为#t（非#f）都会跳到这里，返回#t，结束
        AddInstruction(trueTag);
        AddInstruction(`push #t`);

        // 结束标签
        AddInstruction(endTag);

        AddInstruction(`;; 🛑 OR “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译复杂的Application节点（即首项为待求值的Application的Application，此时需要作η变换）
    // (A 1 2 ..) → ((lambda (F x y ..) (F x y ..)) A 1 2 ..)
    function CompileComplexApplication(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ C'APPLICATION “${nodeHandle}” BEGIN`);

        let children = node.children;

        let uqStr = UniqueString();

        // 调用(TempFunc A 1 2 ..)开始点
        let startTag = `@APPLY_BEGIN_${uqStr}`;
        AddInstruction(`goto ${startTag}`);

        // 构造临时函数

        // 临时函数的开始点标签和返回点标签
        let tempLambdaName = `TEMP_LAMBDA_${uqStr}`;
        let tempLambdaRetName = `TEMP_LAMBDA_RETURN_TARGET_${uqStr}`;

        // 临时函数的形式参数列表
        let tempLambdaParams = new Array();
        for(let i = 0; i < children.length; i++) {
            tempLambdaParams[i] = `TEMP_LAMBDA_PARAM${i}_${uqStr}`;
        }

        // 临时函数开始
        AddInstruction(`;; >>>>>> Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(`@${tempLambdaName}`);

        // 执行η变换
        for(let i = children.length - 1; i >= 0; i--) {
            AddInstruction(`store ${tempLambdaParams[i]}`);
        }
        for(let i = 1; i < children.length; i++) {
            AddInstruction(`load ${tempLambdaParams[i]}`);
        }
        AddInstruction(`tailcall ${tempLambdaParams[0]}`);

        // 以下二选一
        // AddInstruction(`goto @${tempLambdaRetName}`); // 不用return，直接返回调用临时函数的位置
        AddInstruction(`return`);

        // 主体开始
        AddInstruction(`;; >>>>>> Call Temporary Function “@${tempLambdaName}” <<<<<<`);
        AddInstruction(startTag);

        // 编译(TempFunc A 1 2 ..)形式
        for(let i = 0; i < children.length; i++) {
            let child = children[i];
            let childType = TypeOfToken(child);

            if(childType === "HANDLE") {
                let trueBranchNode = ast.GetNode(child);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "APPLICATION") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if(childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(childType) >= 0) {
                AddInstruction(`push ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }
        }

        // 调用临时函数
        // 以下二选一
        // AddInstruction(`goto @${tempLambdaName}`); // 不用call
        AddInstruction(`call @${tempLambdaName}`);

        // 临时函数调用返回点
        AddInstruction(`@${tempLambdaRetName}`);

        AddInstruction(`;; 🛑 C'APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译一般的Application节点
    function CompileApplication(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ APPLICATION “${nodeHandle}” BEGIN`);

        let children = node.children;

        // 判断Application类型，根据不同的类型，执行不同的编译流程
        // 空表
        if(children.length <= 0)     { return; }

        let first = children[0];
        let firstType = TypeOfToken(first);

        // 以下是几种特殊形式

        if(first === 'import')       { return; }
        else if(first === 'native')  { return; }
        else if(first === 'call/cc') { return CompileCallCC(nodeHandle); }
        else if(first === 'define')  { return CompileDefine(nodeHandle); }
        else if(first === 'set!')    { return CompileSet(nodeHandle); }
        else if(first === 'if')      { return CompileIf(nodeHandle);}
        else if(first === 'and')     { return CompileAnd(nodeHandle);}
        else if(first === 'or')      { return CompileOr(nodeHandle);}
        else if(first === 'fork')    { AddInstruction(`fork ${children[1]}`); return; }

        // 首项是待求值的Application，需要进行η变换
        if(firstType === "HANDLE" && ast.GetNode(first).type === "APPLICATION") {
            CompileComplexApplication(nodeHandle);
            return;
        }
        // 首项是合法的原子对象，包括变量、Native、Primitive、Lambda
        else if(["HANDLE", "VARIABLE", "KEYWORD"].indexOf(firstType) >= 0) {
            // 首先处理参数
            for(let i = 1; i < children.length; i++) { // 处理参数列表
                let child = children[i];
                let childType = TypeOfToken(child);
                if(childType === "HANDLE") {
                    let trueBranchNode = ast.GetNode(child);
                    if(trueBranchNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${child}`); // 返回闭包
                    }
                    else if(trueBranchNode.type === "QUOTE" || trueBranchNode.type === "QUASIQUOTE" || trueBranchNode.type === "UNQUOTE") {
                        AddInstruction(`push ${child}`);
                    }
                    else if(trueBranchNode.type === "STRING") {
                        AddInstruction(`push ${child}`);
                    }
                    else if(trueBranchNode.type === "APPLICATION") {
                        CompileApplication(child);
                    }
                    else {
                        throw `[Error] 意外的 child。`;
                    }
                }
                else if(childType === "VARIABLE") {
                    AddInstruction(`load ${child}`);
                }
                else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(childType) >= 0) {
                    AddInstruction(`push ${child}`);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }

            // 处理调用。需要做这样几件事情：
            // 1、确保首项是合法的可调用项，变量、Native、Primitive、Lambda
            // 2、处理import的外部变量名称（Native不必处理，保留原形）
            //    TODO 外部变量的处理方式根据整个系统对多模块的支持方式不同而不同。这里采取的策略是：暂不处理，交给运行时的模块加载器去动态地处理。
            // 3、处理尾递归

            // Primitive
            if(firstType === "KEYWORD") {
                if(first !== 'begin') { // begin不加入指令序列
                    if(first in PrimitiveInstruction) {
                        AddInstruction(`${PrimitiveInstruction[first]}`);
                    }
                    else {
                        AddInstruction(`${first}`);
                    }
                }
            }
            // 尾调用
            else if(ast.tailcall.indexOf(nodeHandle) >= 0) {
                if(firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`tailcall @${first}`);
                }
                else if(firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`tailcall ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
            else {
                if(firstType === "HANDLE" && ast.GetNode(first).type === "LAMBDA") {
                    AddInstruction(`call @${first}`);
                }
                else if(firstType === "VARIABLE") { // 包括Native和外部函数
                    AddInstruction(`call ${first}`);
                }
                else {
                    throw `[Error] 不可调用的首项。`;
                }
            }
        }
        else {
            throw `[Error] 不可调用的首项。`;
        }

        AddInstruction(`;; 🛑 APPLICATION “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 开始编译整个AST
    function CompileAll() {
        // 注释
        AddInstruction(`;;`);
        AddInstruction(`;; Aurora Intermediate Language (AIL) Code`);
        AddInstruction(`;;   Module: ${ast.moduleQualifiedName}`);
        AddInstruction(`;;   Generated by ASCompiler V0`); // TODO 编译器版本号
        AddInstruction(`;;`);

        // 程序入口（顶级Lambda）
        let topLambdaHandle = ast.lambdaHandles[0];
        AddInstruction(`;; 🐟🐟🐟🐟🐟 Program Entry 🐟🐟🐟🐟🐟`);
        AddInstruction(`call @${topLambdaHandle}`);
        AddInstruction(`halt`);
        AddInstruction(`;; 🐟🐟🐟🐟🐟  Program End  🐟🐟🐟🐟🐟`);
        AddInstruction(`;;`);

        // 从所有的Lambda节点开始顺序编译
        // 这类似于C语言，所有的函数都是顶级的
        for(let i = 0; i < ast.lambdaHandles.length; i++) {
            CompileLambda(ast.lambdaHandles[i]);
        }
    }

    // 开始编译，并组装成模块
    CompileAll();
    // TODO 组装模块，必要的元数据也要有

    module.AST = ast;
    module.ILCode = ILCode;

    return module;
}
