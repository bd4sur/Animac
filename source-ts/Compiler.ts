
// Compiler.ts
// 编译器：AST→Module

// 模块
//   模块如同Java的字节码文件，包含代码、静态资源和元数据等
class Module {
    // TODO 模块结构设计，需要注意 ①元数据 ②可序列化性 ③与Runtime和Process结构对接
}

//////////////////////////////////////////////////
//
//  编译器：将模块分析后的单棵AST编译成运行时环境可执行的模块
//
//////////////////////////////////////////////////

function Compile(ast: AST): Module {
    let module = new Module();

    let ILCodes: Array<string> = new Array();

    ///////////////////////////////
    //  工具函数
    ///////////////////////////////

    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        return uniqueString;
    }
    // 增加一条新指令
    function AddInstruction(instStr: string): void {
        ILCodes.push(instStr);
    }

    ////////////////////////////////////////////////
    //  从所有的Lambda节点开始，递归地编译每个节点
    ////////////////////////////////////////////////

    // 编译Lambda节点

    function CompileLambda(nodeHandle: Handle): void {
        let node: LambdaObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== FUNCTION “${nodeHandle}” BEGIN ======`);

        // 函数开始标签：格式约定为@+LambdaHandle
        AddInstruction(`@${nodeHandle}`);

        // 按参数列表逆序，插入store指令
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
                else if(bodyObjType === "QUOTE" || bodyObjType === "QUASIQUOTE" || bodyObjType === "UNQUOTE" ){
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
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD"].indexOf(bodyType)) {
                AddInstruction(`push ${body}`);
            }
            else {
                throw `[Error] 意外的函数体类型。`;
            }
        }

        // 返回指令
        AddInstruction(`return`);

        AddInstruction(`;; ^^^^^^ LAMBDA “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译CallCC

    function CompileCallCC(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== Call/cc “${nodeHandle}” BEGIN ======`);

        // 参数：lambda（必须是thunk）或者引用thunk的变量
        let thunk = node.children[1];

        // cont临时变量，同时也构成cont返回标签
        let contName = `CC_${thunk}_${UniqueString()}`;
        AddInstruction(`;; ====== Current Continuation captured, stored in “${contName}” ======`);

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

        AddInstruction(`;; ^^^^^^ Call/cc “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译define
    function CompileDefine(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== DEFINE “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ DEFINE “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译set!
    function CompileSet(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== SET! “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ SET! “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译if
    function CompileIf(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== IF “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ IF “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译and
    function CompileAnd(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== AND “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ AND “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译or
    function CompileOr(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== OR “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ OR “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译复杂的Application节点（即首项为待求值的Application的Application，此时需要作η变换）
    function CompileComplexApplication(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== C'APPLICATION “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ C'APPLICATION “${nodeHandle}” END   ^^^^^^`);
        AddInstruction(`;;`);
    }

    // 编译一般的Application节点
    function CompileApplication(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ====== APPLICATION “${nodeHandle}” BEGIN ======`);

        AddInstruction(`;; ^^^^^^ APPLICATION “${nodeHandle}” END   ^^^^^^`);
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
        AddInstruction(`;; ****** Program Entry ******`);
        AddInstruction(`call @${topLambdaHandle}`);
        AddInstruction(`halt`);
        AddInstruction(`;; ******  Program End  ******`);

        // 从所有的Lambda节点开始顺序编译
        // 这类似于C语言，所有的函数都是顶级的
        for(let i = 0; i < ast.lambdaHandles.length; i++) {
            CompileLambda(ast.lambdaHandles[i]);
        }
    }

    // 开始编译，并组装成模块
    CompileAll();
    // TODO 组装模块，必要的元数据也要有

    return module;
}
