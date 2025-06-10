const fs = require("fs");
const { exec } = require("child_process");

exec("npx tsc -p ./tsconfig.cli.json", (error, stdout, stderr) => {
    if (error) {
        console.error(`错误: ${error}`);
        return;
    }
    console.log(`cli编译完成: \n${stdout}`); // 成功输出
    if (stderr) console.error(`输出: ${stderr}`);
});

exec("npx tsc -p ./tsconfig.web.json", (error, stdout, stderr) => {
    if (error) {
        console.error(`错误: ${error}`);
        return;
    }
    console.log(`web编译完成: \n${stdout}`); // 成功输出
    if (stderr) console.error(`错误: ${stderr}`);
});

// fs.writeFileSync("src/vfs.js", "aaa", { "encoding": "utf-8" });
