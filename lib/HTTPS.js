
// nativelib/HTTPS.js
// HTTPS本地库

const _ANIMAC_NATIVE_UTILS = require('./_utils.js');
const https = require('https');

function Request(PROCESS, RUNTIME) {
    if(PROCESS.STATE === "SLEEPING") {
        PROCESS.SetState("SLEEPING");
    }
    else {
        // console.log(`开始阻塞(file)`);
        PROCESS.SetState("SLEEPING");

        // 从栈中获取参数，注意顺序是反的
        let urlHandle = PROCESS.PopOperand();
        let url = new URL(_ANIMAC_NATIVE_UTILS.TrimQuotes(PROCESS.heap.Get(urlHandle).content));

        function callback() {
            console.log(`HTTPS执行完毕`);
            PROCESS.SetState("RUNNING");
            PROCESS.Step();
            // 唤醒
            RUNTIME.AddProcess(PROCESS);
            RUNTIME.StartClock();
        }

        // 响应数据
        let responseData = '';

        // HTTPS异步请求
        const req = https.request({
            hostname: url.hostname,
            path: url.pathname,
            port: 443,
            method: 'GET',
        }, (res)=> {
            res.on('data', (data) => {
                responseData += data;
            });
            res.on('end', () => {
                // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
                let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
                let strObject = {
                    type: "STRING",
                    content: responseData
                };
                PROCESS.heap.Set(strHandle, strObject);
                PROCESS.OPSTACK.push(strHandle);

                callback();
            });
        });
        req.on('error', (e) => {
            // TODO ANI所需的接口应当采用恰当的方式暴露给Native库
            let strHandle = PROCESS.heap.AllocateHandle("STRING", false);
            let strObject = {
                type: "STRING",
                content: e.toString()
            };
            PROCESS.heap.Set(strHandle, strObject);
            PROCESS.OPSTACK.push(strHandle);

            callback();
            return;
        });
        req.end();
    }
}

module.exports.Request = Request;
