
const DebugServerConfig = {
    'portNumber': 8088,
    'MIME':{
        "css":   "text/css",
        "jpg":   "image/jpeg",
        "jpeg":  "image/jpeg",
        "png":   "image/png",
        "gif":   "image/gif",
        "bmp":   "image/bmp",
        "webp":  "image/webp",
        "js":    "text/javascript",
        "ico":   "image/vnd.microsoft.icon",
        "mp3":   "audio/mpeg",
        "woff":  "application/font-woff",
        "woff2": "font/woff2",
        "ttf":   "application/x-font-truetype",
        "otf":   "application/x-font-opentype",
        "mp4":   "video/mp4",
        "webm":  "video/webm",
        "svg":   "image/svg+xml"
    },
};

// 启动调试服务器
function StartDebugServer() {

    let RUNTIME = new Runtime(process.cwd());

    function loadCode(codefiles: string, baseModuleID: string) {
        let mod = LoadModuleFromCode(`((lambda () ${codefiles[0]}))`, baseModuleID);
        let proc = new Process(mod);
        proc.PID = 0;
        RUNTIME.asyncCallback = ()=>{};
        RUNTIME.processPool[0] = proc;
        RUNTIME.AddProcess(proc);
    }

    // 工具函数：用于判断某字符串是否以另一个字符串结尾
    function IsEndWith(test: string, endPattern: string): boolean {
        let reg = new RegExp(endPattern + '$', 'i');
        return reg.test(test);
    }
    http.createServer((request, response)=>{
        // 请求数据
        let incomeData = '';
        // 响应结构
        let res = {
            process: null,
            outputBuffer: null
        };
        // 解析请求，包括文件名
        let reqPath = url.parse(request.url).pathname.substr(1);
        let filePath = path.join(process.cwd(), "debug" , url.parse(request.url).pathname);

        request.on('data', (chunk)=>{
            incomeData += chunk;
        });

        request.on('end', ()=>{
            let now = new Date();
            console.log(`${now.toLocaleDateString()} ${now.toLocaleTimeString()} 收到请求：${request.url}`);

            // 默认主页
            if(reqPath === '') {
                readFileSystem(filePath + "index.html");
            }
            else if(reqPath === "load") {
                let codefiles = JSON.parse(incomeData);
                loadCode(codefiles, "ADB");
            }
            else if(reqPath === "execute") {
                RUNTIME.StartClock(()=>{
                    res.process = RUNTIME.processPool[0];
                    res.outputBuffer = RUNTIME.outputBuffer;
                    response.writeHead(200, {'Content-Type': 'application/json'});
                    response.write(JSON.stringify(res));
                    response.end();
                });
            }
            else if(reqPath === "step") {
                RUNTIME.Tick(0);
                res.process = RUNTIME.processPool[0];
                res.outputBuffer = RUNTIME.outputBuffer;
                response.writeHead(200, {'Content-Type': 'application/json'});
                response.write(JSON.stringify(res));
                response.end();
            }
            else if(reqPath === "reset") {
                RUNTIME.outputBuffer = "";
                RUNTIME.errorBuffer = "";
                RUNTIME.processPool = new Array();
                RUNTIME.processQueue = new Array();

                res.process = RUNTIME.processPool[0];
                res.outputBuffer = RUNTIME.outputBuffer;
                response.writeHead(200, {'Content-Type': 'application/json'});
                response.write(JSON.stringify(res));
                response.end();
            }
            else {
                readFileSystem(decodeURI(filePath));
            }

            // 从文件系统读取相应的数据，向客户端返回
            function readFileSystem(reqPath) {
                fs.readFile(reqPath, function (err, data) {
                    // 处理404，返回预先设置好的404页
                    if(err) {
                        console.log("404 ERROR");
                        fs.readFile('404.html', function (err, data) {
                            // 如果连404页都找不到
                            if(err) {
                                response.writeHead(404, {'Content-Type': 'text/html'});
                                response.write('<head><meta charset="utf-8"/></head><h1>真·404</h1>');
                            }
                            else{
                                response.writeHead(404, {'Content-Type': 'text/html'});
                                response.write(data.toString());
                            }
                            response.end(); // 响应
                        });
                        return;
                    }
                    else{
                        // 默认MIME标记
                        let defaultFlag = true;
                        // 根据后缀，检查所有的已有的MIME类型（如果可以硬编码是不是好一点？可能要用到所谓的元编程了）
                        for(let suffix in DebugServerConfig.MIME) {
                            if(IsEndWith(reqPath, '.' + suffix)) {
                                defaultFlag = false;
                                let mimeType = DebugServerConfig.MIME[suffix];
                                response.writeHead(200, {'Content-Type': mimeType});
                                if((mimeType.split('/'))[0] === 'text') {
                                    response.write(data.toString());
                                }
                                else {
                                    response.write(data);
                                }
                            }
                        }
                        // 默认MIME类型：text
                        if(defaultFlag === true) {
                            response.writeHead(200, {'Content-Type': 'text/html'});
                            response.write(data.toString());
                        }
                    }
                    response.end(); // 响应
                });
            }
        });

    }).listen(DebugServerConfig.portNumber);

    console.log(`Animac调试服务器已启动，正在监听端口：${DebugServerConfig.portNumber}`);
}
