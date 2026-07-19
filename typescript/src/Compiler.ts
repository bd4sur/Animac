
// Compiler.ts
// 编译器：AST→ILCode

//////////////////////////////////////////////////
//
//  编译器：将AST编译成中间语言代码
//
//////////////////////////////////////////////////

function Compile(ast: AST): Array<string> {

    // 编译得到的中间语言指令序列
    let ILCode: Array<string> = new Array();

    // while块的标签跟踪栈：用于处理break/continue
    let whileTagStack: Array<[string,string]> = new Array();

    ///////////////////////////////
    //  工具函数
    ///////////////////////////////

    // 生成不重复的字符串
    let uniqueStringCounter = 0;
    function UniqueString() {
        let uniqueString = `${ast.moduleID}.ID${uniqueStringCounter.toString()}`;
        uniqueStringCounter++;
        if (ANIMAC_CONFIG.is_debug !== true) {
            return HashString([uniqueString]);
        }
        else {
            return uniqueString;
        }
    }
    // 增加一条新指令
    function AddInstruction(instStr: string): void {
        if(instStr.trim()[0] === ";") {
            // ILCode.push(instStr);
        }
        else {
            ILCode.push(instStr.trim());
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
            AddInstruction(`store ${parameters[i]}`);
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
                else if(bodyObjType === "QUOTE") {
                    AddInstruction(`push ${body}`);
                }
                else if(bodyObjType === "QUASIQUOTE") {
                    CompileQuasiquote(body);
                }
                else if(bodyObjType === "STRING") {
                    AddInstruction(`push ${body}`);
                }
                else if(bodyObjType === "APPLICATION" || bodyObjType === "UNQUOTE") {
                    CompileApplication(body);
                }
                else {
                    throw `[Error] 意外的函数体节点类型。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(bodyType) >= 0 || ast.IsNativeCall(body)) {
                if (body === "break" || body === "continue") {
                    throw `[Error] lambda块内不允许出现break和continue。`;
                }
                else {
                    AddInstruction(`push ${body}`);
                }
            }
            else if(bodyType === "VARIABLE") {
                AddInstruction(`load ${body}`);
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
            else if(rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if(rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            if (rightValue === "break" || rightValue === "continue") {
                throw `[Error] define右值不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${rightValue}`);
            }
        }
        else if(rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
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
                AddInstruction(`loadclosure @${rightValue}`); // 注意：set!对Lambda节点求值（即，生成闭包实例）
            }
            else if(rightValueNode.type === "QUOTE") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "QUASIQUOTE") {
                CompileQuasiquote(rightValue);
            }
            else if(rightValueNode.type === "STRING") {
                AddInstruction(`push ${rightValue}`);
            }
            else if(rightValueNode.type === "APPLICATION" || rightValueNode.type === "UNQUOTE") {
                CompileApplication(rightValue);
            }
            else {
                throw `[Error] 意外的set!右值。`;
            }
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(rightValueType) >= 0 || ast.IsNativeCall(rightValue)) {
            if (rightValue === "break" || rightValue === "continue") {
                throw `[Error] set!右值不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${rightValue}`);
            }
        }
        else if(rightValueType === "VARIABLE") {
            AddInstruction(`load ${rightValue}`);
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

    // TODO 编译begin
    /*
    function CompileBegin(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ BEGIN “${nodeHandle}” BEGIN`);

        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();

        // 遍历每个分支
        for(let i = 1; i < node.children.length; i++) {
            let child = node.children[i];
            let childType = TypeOfToken(child);
            if(childType === "HANDLE") {
                let trueBranchNode = ast.GetNode(child);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                AddInstruction(`push ${child}`);
            }
            else if(childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
            else {
                throw `[Error] 意外的 child。`;
            }

            // 只保留最后一个child的压栈结果，其他的全部pop掉
            if(i !== node.children.length - 1) {
                AddInstruction(`pop`);
            }
        } // 分支遍历结束

        AddInstruction(`;; 🛑 BEGIN “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }
    */

    // 编译cond
    function CompileCond(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ COND “${nodeHandle}” BEGIN`);

        // 用于标识此cond的唯一字符串
        let uqStr = UniqueString();

        // 遍历每个分支
        for(let i = 1; i < node.children.length; i++) {
            let clauseNode = ast.GetNode(node.children[i]);

            // 插入开始标签（实际上第一个分支不需要）
            AddInstruction(`@COND_BRANCH_${uqStr}_${i}`);

            // 处理分支条件（除了else分支）
            let predicate = clauseNode.children[0];
            if(predicate !== "else") {
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
                // TODO 此处可以作优化
                else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
                    if (predicate === "break" || predicate === "continue") {
                        throw `[Error] cond条件表达式不允许出现break和continue。`;
                    }
                    else {
                        AddInstruction(`push ${predicate}`);
                    }
                }
                else if(predicateType === "VARIABLE") {
                    AddInstruction(`load ${predicate}`);
                }
                else {
                    throw `[Error] 意外的cond分支条件。`;
                }
                // 如果不是最后一个分支，则跳转到下一条件；如果是最后一个分支，则跳转到结束标签
                if(i === node.children.length - 1) {
                    AddInstruction(`iffalse @COND_END_${uqStr}`);
                }
                else {
                    AddInstruction(`iffalse @COND_BRANCH_${uqStr}_${(i+1)}`);
                }
            }

            // 处理分支主体
            let branch = clauseNode.children[1];
            let branchType = TypeOfToken(branch);
            if(branchType === "HANDLE") {
                let branchNode = ast.GetNode(branch);
                if(branchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${branch}`); // 返回闭包
                }
                else if(branchNode.type === "QUOTE") {
                    AddInstruction(`push ${branch}`);
                }
                else if(branchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(branch);
                }
                else if(branchNode.type === "STRING") {
                    AddInstruction(`push ${branch}`);
                }
                else if(branchNode.type === "APPLICATION" || branchNode.type === "UNQUOTE") {
                    CompileApplication(branch);
                }
                else {
                    throw `[Error] 意外的if-true分支。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(branchType) >= 0 || ast.IsNativeCall(branch)) {
                if (branch === "break" || branch === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (branch === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${branch}`);
                }
            }
            else if(branchType === "VARIABLE") {
                AddInstruction(`load ${branch}`);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }

            // 插入收尾语句（区分else分支和非else分支）
            if(predicate === "else" || i === node.children.length - 1) {
                AddInstruction(`@COND_END_${uqStr}`);
                break; // 忽略else后面的所有分支
            }
            else {
                AddInstruction(`goto @COND_END_${uqStr}`);
            }

        } // 分支遍历结束

        AddInstruction(`;; 🛑 COND “${nodeHandle}” END   `);
        AddInstruction(`;;`);
    }

    // 编译if
    function CompileIf(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ IF “${nodeHandle}” BEGIN`);

        // 标签
        let uqStr = UniqueString();
        let trueTag = `@IF_TRUE_${uqStr}`; // true分支标签
        let endTag = `@IF_END_${uqStr}`; // if语句结束标签

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
        // TODO 此处可以作优化
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(predicateType) >= 0 || ast.IsNativeCall(predicate)) {
            if (predicate === "break" || predicate === "continue") {
                throw `[Error] if条件表达式不允许出现break和continue。`;
            }
            else {
                AddInstruction(`push ${predicate}`);
            }
        }
        else if(predicateType === "VARIABLE") {
            AddInstruction(`load ${predicate}`);
        }
        else {
            throw `[Error] 意外的if分支条件。`;
        }

        // 两个分支（children[2]和children[3]）既可以同时存在，也可以只存在t分支，但是t分支是必须存在的。
        if (node.children[2] !== undefined) {

            // 如果t分支和f分支同时存在，则认为取f分支的概率较大，使用iftrue指令，将f分支的IL指令放在t分支前面
            if (node.children[3] !== undefined) {

                AddInstruction(`iftrue ${trueTag}`);

                // 处理false分支
                let falseBranch = node.children[3];
                let falseBranchType = TypeOfToken(falseBranch);
                if(falseBranchType === "HANDLE") {
                    let falseBranchNode = ast.GetNode(falseBranch);
                    if(falseBranchNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${falseBranch}`); // 返回闭包
                    }
                    else if(falseBranchNode.type === "QUOTE") {
                        AddInstruction(`push ${falseBranch}`);
                    }
                    else if(falseBranchNode.type === "QUASIQUOTE") {
                        CompileQuasiquote(falseBranch);
                    }
                    else if(falseBranchNode.type === "STRING") {
                        AddInstruction(`push ${falseBranch}`);
                    }
                    else if(falseBranchNode.type === "APPLICATION" || falseBranchNode.type === "UNQUOTE") {
                        CompileApplication(falseBranch);
                    }
                    else {
                        throw `[Error] 意外的if-false分支。`;
                    }
                }
                else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(falseBranchType) >= 0 || ast.IsNativeCall(falseBranch)) {
                    if (falseBranch === "break" || falseBranch === "continue") {
                        let whileTags = Top(whileTagStack);
                        if (whileTags !== undefined) {
                            if (falseBranch === "break") {
                                AddInstruction(`goto ${whileTags[1]}`); // endTag
                            }
                            else {
                                AddInstruction(`goto ${whileTags[0]}`); // condTag
                            }
                        }
                        else {
                            throw `[Error] break或continue没有对应的while表达式。`;
                        }
                    }
                    else {
                        AddInstruction(`push ${falseBranch}`);
                    }
                }
                else if(falseBranchType === "VARIABLE") {
                    AddInstruction(`load ${falseBranch}`);
                }
                else {
                    throw `[Error] 意外的if-false分支。`;
                }

                // 跳转到结束标签
                AddInstruction(`goto ${endTag}`);

                // 添加true分支标签
                AddInstruction(trueTag);
            }

            // 或者，如果只存在t分支，f分支不存在，则在t分支前添加一个条件跳转指令
            //   NOTE 只有t分支的形式(if p t)等效于(and p t)
            else {
                AddInstruction(`iffalse ${endTag}`);
            }

            // 以下编译t分支（true分支必须存在）

            let trueBranch = node.children[2];
            let trueBranchType = TypeOfToken(trueBranch);
            if(trueBranchType === "HANDLE") {
                let trueBranchNode = ast.GetNode(trueBranch);
                if(trueBranchNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${trueBranch}`); // 返回闭包
                }
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${trueBranch}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(trueBranch);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${trueBranch}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(trueBranch);
                }
                else {
                    throw `[Error] 意外的if-true分支。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(trueBranchType) >= 0 || ast.IsNativeCall(trueBranch)) {
                if (trueBranch === "break" || trueBranch === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (trueBranch === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${trueBranch}`);
                }
            }
            else if(trueBranchType === "VARIABLE") {
                AddInstruction(`load ${trueBranch}`);
            }
            else {
                throw `[Error] 意外的if-true分支。`;
            }

            // 结束标签
            AddInstruction(endTag);

            AddInstruction(`;; 🛑 IF “${nodeHandle}” END   `);
            AddInstruction(`;;`);
        }
        else {
            throw `[Error] if表达式中不存在true分支。`;
        }
    }

    // 编译while
    function CompileWhile(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        // 注释
        AddInstruction(`;; ✅ WHILE “${nodeHandle}” BEGIN`);

        // 标签
        let uqStr = UniqueString();
        let condTag = `@WHILE_COND_${uqStr}`; // 循环条件标签
        let endTag = `@WHILE_END_${uqStr}`; // 循环结束标签

        // 进入while块，将标签压入while块标签跟踪栈，用于处理块内本级的break/continue
        whileTagStack.push([condTag, endTag]);

        // 添加循环条件标签
        AddInstruction(condTag);

        // 循环条件
        let cond = node.children[1];
        let condType = TypeOfToken(cond);
        if(condType === "HANDLE") {
            let condNode = ast.GetNode(cond);
            if(condNode.type === "APPLICATION") {
                CompileApplication(cond);
            }
            // 其余情况，统统作push处理
            else {
                AddInstruction(`push ${cond}`);
            }
        }
        // TODO 此处可以作优化
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(condType) >= 0 || ast.IsNativeCall(cond)) {
            AddInstruction(`push ${cond}`);
        }
        else if(condType === "VARIABLE") {
            AddInstruction(`load ${cond}`);
        }
        else {
            throw `[Error] 意外的while循环条件。`;
        }

        // 如果循环条件为#f，则跳出循环，否则执行紧接着的循环体
        AddInstruction(`iffalse ${endTag}`);

        // 循环体
        let loopBody = node.children[2];
        let loopBodyType = TypeOfToken(loopBody);
        if(loopBodyType === "HANDLE") {
            let loopBodyNode = ast.GetNode(loopBody);
            if(loopBodyNode.type === "LAMBDA") {
                AddInstruction(`loadclosure @${loopBody}`); // 返回闭包
            }
            else if(loopBodyNode.type === "QUOTE") {
                AddInstruction(`push ${loopBody}`);
            }
            else if(loopBodyNode.type === "QUASIQUOTE") {
                CompileQuasiquote(loopBody);
            }
            else if(loopBodyNode.type === "STRING") {
                AddInstruction(`push ${loopBody}`);
            }
            else if(loopBodyNode.type === "APPLICATION" || loopBodyNode.type === "UNQUOTE") {
                CompileApplication(loopBody);
            }
            else {
                throw `[Error] 意外的if-false分支。`;
            }
        }
        else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(loopBodyType) >= 0 || ast.IsNativeCall(loopBody)) {
            if (loopBody === "break" || loopBody === "continue") {
                let whileTags = Top(whileTagStack);
                if (whileTags !== undefined) {
                    if (loopBody === "break") {
                        AddInstruction(`goto ${whileTags[1]}`); // endTag
                    }
                    else {
                        AddInstruction(`goto ${whileTags[0]}`); // condTag
                    }
                }
                else {
                    throw `[Error] break或continue没有对应的while表达式。`;
                }
            }
            else {
                AddInstruction(`push ${loopBody}`);
            }
        }
        else if(loopBodyType === "VARIABLE") {
            AddInstruction(`load ${loopBody}`);
        }
        else {
            throw `[Error] 意外的if-false分支。`;
        }

        // 跳转回循环条件标签
        AddInstruction(`goto ${condTag}`);

        // 结束标签
        AddInstruction(endTag);

        // 退出while块，标签从while块标签跟踪栈弹出
        whileTagStack.pop();

        AddInstruction(`;; 🛑 WHILE “${nodeHandle}” END   `);
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
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的and clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                if (clause === "break" || clause === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (clause === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${clause}`);
                }
            }
            else if(clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
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
                else if(trueBranchNode.type === "QUOTE") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(clause);
                }
                else if(trueBranchNode.type === "STRING") {
                    AddInstruction(`push ${clause}`);
                }
                else if(trueBranchNode.type === "APPLICATION" || trueBranchNode.type === "UNQUOTE") {
                    CompileApplication(clause);
                }
                else {
                    throw `[Error] 意外的 or clause。`;
                }
            }
            // TODO 此处可以作优化（短路）
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(clauseType) >= 0 || ast.IsNativeCall(clause)) {
                if (clause === "break" || clause === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (clause === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${clause}`);
                }
            }
            else if(clauseType === "VARIABLE") {
                AddInstruction(`load ${clause}`);
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

    // 编译准引用节点
    function CompileQuasiquote(nodeHandle: Handle): void {
        let node: ApplicationObject = ast.GetNode(nodeHandle);
        for(let i = 0; i < node.children.length; i++) {
            let child = node.children[i];
            if(TypeOfToken(child) === "HANDLE") {
                let childObj = ast.GetNode(child);
                if(childObj.type === "APPLICATION" || childObj.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else if(childObj.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(TypeOfToken(child)) >= 0 || ast.IsNativeCall(child)) {
                if (child === "break" || child === "continue") {
                    throw `[Error] quasiquote内部不允许出现break和continue。`;
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if(TypeOfToken(child) === "VARIABLE") {
                AddInstruction(`load ${child}`);
            }
        }
        AddInstruction(`push ${node.children.length}`);
        AddInstruction(`concat`);
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
                let childNode = ast.GetNode(child);
                if(childNode.type === "LAMBDA") {
                    AddInstruction(`loadclosure @${child}`); // 返回闭包
                }
                else if(childNode.type === "QUOTE") {
                    AddInstruction(`push ${child}`);
                }
                else if(childNode.type === "QUASIQUOTE") {
                    CompileQuasiquote(child);
                }
                else if(childNode.type === "STRING") {
                    AddInstruction(`push ${child}`);
                }
                else if(childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                    CompileApplication(child);
                }
                else {
                    throw `[Error] 意外的 child。`;
                }
            }
            else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                if (child === "break" || child === "continue") {
                    let whileTags = Top(whileTagStack);
                    if (whileTags !== undefined) {
                        if (child === "break") {
                            AddInstruction(`goto ${whileTags[1]}`); // endTag
                        }
                        else {
                            AddInstruction(`goto ${whileTags[0]}`); // condTag
                        }
                    }
                    else {
                        throw `[Error] break或continue没有对应的while表达式。`;
                    }
                }
                else {
                    AddInstruction(`push ${child}`);
                }
            }
            else if(childType === "VARIABLE") {
                AddInstruction(`load ${child}`);
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
        // TODO else if(first === 'begin')   { return CompileBegin(nodeHandle); }
        else if(first === 'call/cc') { return CompileCallCC(nodeHandle); }
        else if(first === 'define')  { return CompileDefine(nodeHandle); }
        else if(first === 'set!')    { return CompileSet(nodeHandle); }
        else if(first === 'cond')    { return CompileCond(nodeHandle);}
        else if(first === 'if')      { return CompileIf(nodeHandle);}
        else if(first === 'while')   { return CompileWhile(nodeHandle);}
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
                    let childNode = ast.GetNode(child);
                    if(childNode.type === "LAMBDA") {
                        AddInstruction(`loadclosure @${child}`); // 返回闭包
                    }
                    else if(childNode.type === "QUOTE") {
                        AddInstruction(`push ${child}`);
                    }
                    else if(childNode.type === "QUASIQUOTE") {
                        CompileQuasiquote(child);
                    }
                    else if(childNode.type === "STRING") {
                        AddInstruction(`push ${child}`);
                    }
                    else if(childNode.type === "APPLICATION" || childNode.type === "UNQUOTE") {
                        CompileApplication(child);
                    }
                    else {
                        throw `[Error] 意外的 child。`;
                    }
                }
                else if(["NUMBER", "BOOLEAN", "SYMBOL", "STRING", "KEYWORD", "PORT"].indexOf(childType) >= 0 || ast.IsNativeCall(child)) {
                    if (child === "break" || child === "continue") {
                        let whileTags = Top(whileTagStack);
                        if (whileTags !== undefined) {
                            if (child === "break") {
                                AddInstruction(`goto ${whileTags[1]}`); // endTag
                            }
                            else {
                                AddInstruction(`goto ${whileTags[0]}`); // condTag
                            }
                        }
                        else {
                            throw `[Error] break或continue没有对应的while表达式。`;
                        }
                    }
                    else {
                        AddInstruction(`push ${child}`);
                    }
                }
                else if(childType === "VARIABLE") {
                    AddInstruction(`load ${child}`);
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
                if (first === "break" || first === "continue") {
                    throw `[Error] break和continue不可出现在列表的第一项。`;
                }
                else if(first !== 'begin') { // begin不加入指令序列
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
        AddInstruction(`;;   Module: ${ast.moduleID}`);
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

    return ILCode;
}
