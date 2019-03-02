// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// compiler.js
// 编译器
// 输入：AST（代码抽象语法树） × RESOURCE（静态资源）
// 输出：MODULE（经编译的模块文件）

const Common = require('./common.js'); // 引入公用模块

// 编译器
const Compiler = function(RESOURCE) {
    let MODULE = new Common.Module();

    let AST = RESOURCE.slists;

    let ASM = new Array();

    // 生成随机字符串
    function getRandomString() {
        return Math.random().toString(36).substr(2); // TODO 这个地方需要更细致地考虑
    }

    // 处理简单Application，即第一项不为SLIST的Application
    function dealLambda(node) {
        // 插入注释
        ASM.push(`;; [ASC] Function @ $${node.index}`);
        // 插入标签，格式为@$x
        ASM.push(`@$${node.index}`);
        // 按参数列表逆序，插入store指令
        let parameters = node.parameters;
        for(let i = parameters.length - 1; i >= 0; i--) {
            ASM.push(`store ${parameters[i]}`);
        }

        if(Common.TypeOfToken(node.body) === Common.OBJECT_TYPE.REF_SLIST) {
            bodyNode = AST[Common.getRefIndex(node.body)];
            if(bodyNode.type === Common.NODE_TYPE.LAMBDA) {
                ASM.push(`push @${node.body}`);
            }
            else if(bodyNode.isQuoted === true) {
                ASM.push(`push ${node.body}`);
            }
            else {
                dealSList(bodyNode);
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

    // 处理简单Application，即第一项不为Application的Application
    function dealSList(node) {
        let children = node.children;
        // 空表，直接返回
        if(children.length === 0) {
            return;
        }
        // 检查第一项的类型，区别对待SLIST/LAMBDA和原子
        // TODO Lambda的优化以后再说
        let first = children[0];

        // 首先处理特殊格式
        // (call/cc (lambda (kont) ...))
        if(first === 'call/cc') {
            // get到lambda里面的唯一参数
            let lambdaNode = AST[Common.getRefIndex(children[1])];
            let contName = lambdaNode.parameters[0];
            ASM.push(`;; [ASC] Capture Cont @ ${contName}`);
            ASM.push(`capturecc ${contName}`);
            // 加入lambda的body
            let body = lambdaNode.body;
            if(Common.TypeOfToken(body) === Common.OBJECT_TYPE.REF_SLIST) {
                bodyNode = AST[Common.getRefIndex(body)];
                if(bodyNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`push @${body}`);
                }
                else if(bodyNode.isQuoted === true) {
                    ASM.push(`push ${body}`);
                }
                else {
                    dealSList(bodyNode);
                }
            }
            else if(Common.TypeOfToken(body) === Common.OBJECT_TYPE.REF_VARIABLE) {
                ASM.push(`load ${body}`);
            }
            else {
                ASM.push(`push ${body}`);
            }
            // continuation返回标签
            ASM.push(`;; [ASC] Cont @ ${contName} Re-entry`);
            ASM.push(`@${contName}`);
            return;
        }

        // (define variable x)
        else if(first === 'define') {
            ASM.push(`;; [ASC] DEFINE`);
            let rightValue = children[2];
            // load/push
            if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_SLIST) {
                rightValueNode = AST[Common.getRefIndex(rightValue)];
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
            let leftVariable = children[1];
            ASM.push(`store ${leftVariable}`);
            return;
        }

        // (set! variable expr)
        else if(first === 'set!') {
            ASM.push(`;; [ASC] SET!`);
            let rightValue = children[2];
            // load/push
            if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_SLIST) {
                rightValueNode = AST[Common.getRefIndex(rightValue)];
                if(rightValueNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`push @${rightValue}`);
                }
                else if(rightValueNode.isQuoted === true) {
                    ASM.push(`push ${rightValue}`);
                }
                else {
                    dealSList(rightValueNode);
                }
            }
            else if(Common.TypeOfToken(rightValue) === Common.OBJECT_TYPE.REF_VARIABLE) {
                ASM.push(`load ${rightValue}`);
            }
            else {
                ASM.push(`push ${rightValue}`);
            }
            // store
            let leftVariable = children[1];
            ASM.push(`set! ${leftVariable}`);
            return;
        }

        // (if p t f)
        // TODO 此处可以加比较高级的编译优化
        else if(first === 'if') {
            // 处理p
            let predicate = children[1];
            if(Common.TypeOfToken(predicate) === Common.OBJECT_TYPE.REF_SLIST) {
                predicateNode = AST[Common.getRefIndex(predicate)];
                if(predicateNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`load ${predicate}`);
                }
                else if(predicateNode.isQuoted === true) {
                    ASM.push(`push ${predicate}`);
                }
                else {
                    dealSList(predicateNode);
                }
            }
            else if(Common.TypeOfToken(predicate) === Common.OBJECT_TYPE.REF_VARIABLE) {
                ASM.push(`load ${predicate}`);
            }
            else {
                ASM.push(`push ${predicate}`);
            }
            // 认为取f分支的概率较大，因此使用iftrue指令
            let trueTag = `@${getRandomString()}`; // true分支标签
            let endTag = `@${getRandomString()}`; // if语句结束标签
            ASM.push(`;; [ASC] IF`);
            ASM.push(`iftrue ${trueTag}`);
            // 处理false分支
            let falseBranch = children[3];
            if(Common.TypeOfToken(falseBranch) === Common.OBJECT_TYPE.REF_SLIST) {
                falseBranchNode = AST[Common.getRefIndex(falseBranch)];
                if(falseBranchNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`load ${falseBranch}`);
                }
                else if(falseBranchNode.isQuoted === true) {
                    ASM.push(`push ${falseBranch}`);
                }
                else {
                    dealSList(falseBranchNode);
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
            let trueBranch = children[2];
            if(Common.TypeOfToken(trueBranch) === Common.OBJECT_TYPE.REF_SLIST) {
                trueBranchNode = AST[Common.getRefIndex(trueBranch)];
                if(trueBranchNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`load ${trueBranch}`);
                }
                else if(trueBranchNode.isQuoted === true) {
                    ASM.push(`push ${trueBranch}`);
                }
                else {
                    dealSList(trueBranchNode);
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

        // 根据第一项是否是列表（暂且含lambda），采取ANF变换和直接生成汇编两种策略
        let typeOfFirst = Common.TypeOfToken(first);
        if(typeOfFirst === Common.OBJECT_TYPE.REF_SLIST) {
            // 转变成ANF
            let tempVarArray = new Array();
            for(let i = 0; i < children.length; i++) {
                let childNode = AST[Common.getRefIndex(children[i])];
                if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`load @${children[i]}`);
                }
                else if(childNode.isQuoted === true) {
                    ASM.push(`push ${children[i]}`);
                }
                else {
                    dealSList(childNode);
                }
                let tempVar = getRandomString();
                tempVarArray[i] = `&${tempVar}`;
                ASM.push(`store ${tempVarArray[i]}`);
            }
            for(let i = 1; i < children.length; i++) {
                ASM.push(`load ${tempVarArray[i]}`);
            }
            ASM.push(`call ${tempVarArray[0]}`);
        }
        else {
            // 处理参数项
            for(let i = 1; i < children.length; i++) {
                // 列表参数，递归地处理之
                if(Common.TypeOfToken(children[i]) === Common.OBJECT_TYPE.REF_SLIST) {
                    let childNode = AST[Common.getRefIndex(children[i])];
                    if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                        ASM.push(`load @${children[i]}`);
                    }
                    else if(childNode.isQuoted === true) {
                        ASM.push(`push ${children[i]}`);
                    }
                    else {
                        dealSList(childNode);
                    }
                }
                // 变量参数用load
                else if(Common.TypeOfToken(children[i]) === Common.OBJECT_TYPE.REF_VARIABLE) {
                    ASM.push(`load ${children[i]}`);
                }
                // 其他类型的引用用push
                else {
                    ASM.push(`push ${children[i]}`);
                }
            }
            // 调用第一项，TODO：尾递归
            if(typeOfFirst === Common.OBJECT_TYPE.KEYWORD) {
                ASM.push(`${first}`);
            }
            else {
                ASM.push(`call ${first}`);
            }
        }
    }

    ASM.push(`call @$1`);
    ASM.push(`halt`);
    // 把所有的Lambda单独作为过程
    for(let node of AST) {
        if(node.type === Common.NODE_TYPE.LAMBDA) {
            dealLambda(node);
        }
    }

    console.log(ASM.join('\n'));

    return MODULE;
};

module.exports.Compiler = Compiler;
