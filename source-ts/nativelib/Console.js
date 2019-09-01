
// nativelib/Console.js
// 控制台本地库

// TODO 由于缺乏TypeOfToken等接口，暂时无法使用

function Print(PROCESS, RUNTIME) {
    let content = PROCESS.OPSTACK.pop();
    let contentType = TypeOfToken(content);
    if(contentType === "HANDLE") {
        let obj = PROCESS.heap.Get(content);
        if(obj.type === "STRING") {
            console.log(`${TrimQuotes(obj.content)}`);
        }
        else {
            let str = PROCESS.AST.NodeToString(content);
            console.log(`${str}`);
        }
    }
    else {
        console.info(`${String(content)}`);
    }
    PROCESS.Step();
}

module.exports.Print = Print;
