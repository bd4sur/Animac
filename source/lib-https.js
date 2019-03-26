// Aurora Virtual Machine for Scheme
// mikukonai@github
//
// [NativeLib] https通信
//

const https = require('https');

let url = new URL(process.argv[2]);

// 外层延时仅用于测试
setTimeout(()=> {
    process.stdout.write(`开始请求：${url}`);
    https.request({
        hostname: url.hostname,
        path: url.pathname,
        port: 443,
        method: 'GET',
    }, (res)=> {
        process.stdout.write(res.toString());
        res.on('data', (data) => {
            let content = data.toString();
            process.stdout.write(content);
        });
        req.on('error', (e) => {
            process.stderr.write(e.toString());
        });
    });
}, 1000);
