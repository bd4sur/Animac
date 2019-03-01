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
            dealSList(bodyNode);
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
                dealSList(bodyNode);
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
        else if(first === 'if') {
            // TODO 待补充
            return;
        }

        let typeOfFirst = Common.TypeOfToken(first);
        if(typeOfFirst === Common.OBJECT_TYPE.REF_SLIST) {
            // 转变成ANF
            let tempVarArray = new Array();
            for(let i = 0; i < children.length; i++) {
                let childNode = AST[Common.getRefIndex(children[i])];
                if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                    ASM.push(`load @${children[i]}`);
                }
                else {
                    dealSList(childNode);
                }
                let tempVar = Math.random().toString(36).substr(2); // 暂且使用随机数字/GUID作为临时变量名 TODO 这个地方需要更细致地考虑
                tempVarArray[i] = `&${tempVar}`;
                ASM.push(`store ${tempVarArray[i]}`);
            }
            for(let i = 1; i < children.length; i++) {
                ASM.push(`load ${tempVarArray[i]}`);
            }
            ASM.push(`call ${tempVarArray[0]}`);
        }
        else {
            // 处理列表除第一项外的其他项
            for(let i = 1; i < children.length; i++) {
                if(Common.TypeOfToken(children[i]) === Common.OBJECT_TYPE.REF_SLIST) {
                    let childNode = AST[Common.getRefIndex(children[i])];
                    if(childNode.type === Common.NODE_TYPE.LAMBDA) {
                        ASM.push(`load @${children[i]}`);
                    }
                    else {
                        dealSList(childNode);
                    }
                }
                else if(Common.TypeOfToken(children[i]) === Common.OBJECT_TYPE.REF_VARIABLE) {
                    ASM.push(`load ${children[i]}`);
                }
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
    // 把所有的Lambda单独作为过程
    for(let node of AST) {
        if(node.type === Common.NODE_TYPE.LAMBDA) {
            dealLambda(node);
        }
    }
    ASM.push(`halt`);

    console.log(ASM.join('\n'));
/*
    (function traverseAST(nodeRef) {
        let node = AST[Common.getRefIndex(nodeRef)];
        
        if(node.type === Common.NODE_TYPE.SLIST) {
            let children = node.children;
            console.log(`遍历SLIST：${nodeRef}=${JSON.stringify(children)}`);
            for(let i = 0; i < children.length; i++) {
                if(Common.TypeOfToken(children[i]) === Common.OBJECT_TYPE.REF_SLIST) {
                    traverseAST(children[i]);
                }
                else {
                    console.log(`遍历叶节点：${children[i]}`);
                }
            }
        }
        else if(node.type === Common.NODE_TYPE.LAMBDA) {
            let body = node.body;
            console.log(`遍历Lambda：f${JSON.stringify(node.parameters)}=${body}`);
            if(Common.TypeOfToken(body) === Common.OBJECT_TYPE.REF_SLIST) {
                traverseAST(body);
            }
            else {
                console.log(`遍历非列表函数体：${body}`);
            }
        }
    })("$0");
*/
    return MODULE;
};

module.exports.Compiler = Compiler;
