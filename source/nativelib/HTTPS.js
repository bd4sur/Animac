// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// nativelib/HTTPS.js
// HTTPS本地库
// Node 10+

const https = require('https');

const Common = require('../common.js');

const request = function(avmArgs, avmProcess, avmRuntime) {
    if(avmProcess.STATE === Common.PROCESS_STATE.SLEEPING) {
        avmProcess.STATE = Common.PROCESS_STATE.SLEEPING;
    }
    else {
        console.log(`开始阻塞`);
        avmProcess.STATE = Common.PROCESS_STATE.SLEEPING;

        let url = new URL(avmProcess.GetObject(avmArgs[0]).value);
        function callback() {
            avmProcess.STATE = Common.PROCESS_STATE.RUNNING;
            avmProcess.PC++;
        }

        setTimeout(()=> {
            let responseData = '';
            console.log(`开始请求：${url}`);
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
                    // console.log(responseData.toString());
                    let resRef = avmProcess.NewObject('STRING', responseData);
                    avmProcess.OPSTACK.push(resRef);
                    console.log(`响应状态：${res.statusCode}`);
                    callback();
                });
            });
            req.on('error', (e) => {
                let resRef = avmProcess.NewObject('STRING', e.toString());
                avmProcess.OPSTACK.push(resRef);
                console.log(`响应状态：${res.statusCode}`);
                callback();
            });
            req.end();
        }, 0);
    }
}

module.exports.request = request;
