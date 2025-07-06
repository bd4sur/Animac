const fs = require("fs");
const { execSync } = require("child_process");

function esc(src) {
    return src
        .replace(/\\/gi, "\\\\")
        .replace(/`/gi, "\\`")
        .replace(/\$/gi, "\\$")
        .replace(/_ANIMAC_NATIVE_UTILS\./gi, "")
        .replace(/const\s+_ANIMAC_NATIVE_UTILS\s+=\s+require\(\'\.\/_utils\.js\'\);/gi, "\n")
        .replace(/const\s+([a-zA-Z_$][\w$]*)\s*=\s*require.+;/gi, "\n")
        // .replace(/^module\.exports\.([a-zA-Z_$][\w$]*)\s*=\s*\1;$/mgi, "")
        ;
}

// 链接测试用例

let test_big_int = fs.readFileSync("./test/big_int.scm", { "encoding": "utf-8" });
let test_blink = fs.readFileSync("./test/blink.scm", { "encoding": "utf-8" });
let test_brainfuck = fs.readFileSync("./test/brainfuck.scm", { "encoding": "utf-8" });
let test_calculator = fs.readFileSync("./test/calculator.scm", { "encoding": "utf-8" });
let test_calendar = fs.readFileSync("./test/calendar.scm", { "encoding": "utf-8" });
let test_church_encoding = fs.readFileSync("./test/church_encoding.scm", { "encoding": "utf-8" });
let test_coroutine = fs.readFileSync("./test/coroutine.scm", { "encoding": "utf-8" });
let test_deadlock = fs.readFileSync("./test/deadlock.scm", { "encoding": "utf-8" });
let test_factorial = fs.readFileSync("./test/factorial.scm", { "encoding": "utf-8" });
let test_fft = fs.readFileSync("./test/fft.scm", { "encoding": "utf-8" });
let test_generator = fs.readFileSync("./test/generator.scm", { "encoding": "utf-8" });
let test_interpreter = fs.readFileSync("./test/interpreter.scm", { "encoding": "utf-8" });
let test_list = fs.readFileSync("./test/list.scm", { "encoding": "utf-8" });
let test_man_or_boy = fs.readFileSync("./test/man_or_boy.scm", { "encoding": "utf-8" });
let test_mlp = fs.readFileSync("./test/mlp.scm", { "encoding": "utf-8" });
let test_nano_llm_infer_native = fs.readFileSync("./test/nano_llm_infer_native.scm", { "encoding": "utf-8" });
let test_nano_llm_infer = fs.readFileSync("./test/nano_llm_infer.scm", { "encoding": "utf-8" });
let test_nano_llm_model = fs.readFileSync("./test/nano_llm_model.scm", { "encoding": "utf-8" });
let test_quasiquote = fs.readFileSync("./test/quasiquote.scm", { "encoding": "utf-8" });
let test_quicksort = fs.readFileSync("./test/quicksort.scm", { "encoding": "utf-8" });
let test_quine = fs.readFileSync("./test/quine.scm", { "encoding": "utf-8" });
let test_shudu = fs.readFileSync("./test/shudu.scm", { "encoding": "utf-8" });
let test_sleepsort = fs.readFileSync("./test/sleepsort.scm", { "encoding": "utf-8" });
let test_tls = fs.readFileSync("./test/tls.scm", { "encoding": "utf-8" });
let test_yinyang = fs.readFileSync("./test/yinyang.scm", { "encoding": "utf-8" });

let testcases = `
ANIMAC_VFS["/test/big_int.scm"] = \`${esc(test_big_int)}\n\`;
ANIMAC_VFS["/test/blink.scm"] = \`${esc(test_blink)}\n\`;
ANIMAC_VFS["/test/brainfuck.scm"] = \`${esc(test_brainfuck)}\n\`;
ANIMAC_VFS["/test/calculator.scm"] = \`${esc(test_calculator)}\n\`;
ANIMAC_VFS["/test/calendar.scm"] = \`${esc(test_calendar)}\n\`;
ANIMAC_VFS["/test/church_encoding.scm"] = \`${esc(test_church_encoding)}\n\`;
ANIMAC_VFS["/test/coroutine.scm"] = \`${esc(test_coroutine)}\n\`;
ANIMAC_VFS["/test/deadlock.scm"] = \`${esc(test_deadlock)}\n\`;
ANIMAC_VFS["/test/factorial.scm"] = \`${esc(test_factorial)}\n\`;
ANIMAC_VFS["/test/fft.scm"] = \`${esc(test_fft)}\n\`;
ANIMAC_VFS["/test/generator.scm"] = \`${esc(test_generator)}\n\`;
ANIMAC_VFS["/test/interpreter.scm"] = \`${esc(test_interpreter)}\n\`;
ANIMAC_VFS["/test/list.scm"] = \`${esc(test_list)}\n\`;
ANIMAC_VFS["/test/man_or_boy.scm"] = \`${esc(test_man_or_boy)}\n\`;
ANIMAC_VFS["/test/mlp.scm"] = \`${esc(test_mlp)}\n\`;
ANIMAC_VFS["/test/nano_llm_infer_native.scm"] = \`${esc(test_nano_llm_infer_native)}\n\`;
ANIMAC_VFS["/test/nano_llm_infer.scm"] = \`${esc(test_nano_llm_infer)}\n\`;
ANIMAC_VFS["/test/nano_llm_model.scm"] = \`${esc(test_nano_llm_model)}\n\`;
ANIMAC_VFS["/test/quasiquote.scm"] = \`${esc(test_quasiquote)}\n\`;
ANIMAC_VFS["/test/quicksort.scm"] = \`${esc(test_quicksort)}\n\`;
ANIMAC_VFS["/test/quine.scm"] = \`${esc(test_quine)}\n\`;
ANIMAC_VFS["/test/shudu.scm"] = \`${esc(test_shudu)}\n\`;
ANIMAC_VFS["/test/sleepsort.scm"] = \`${esc(test_sleepsort)}\n\`;
ANIMAC_VFS["/test/tls.scm"] = \`${esc(test_tls)}\n\`;
ANIMAC_VFS["/test/yinyang.scm"] = \`${esc(test_yinyang)}\n\`;
`;

fs.writeFileSync("./demo/vfs.js", testcases, { "encoding": "utf-8" });

// 链接宿主本地库

let lib_utils_src = fs.readFileSync("./lib/_utils.js", { "encoding": "utf-8" });
let lib_File_src = fs.readFileSync("./lib/File.js", { "encoding": "utf-8" });
let lib_HTTPS_src = fs.readFileSync("./lib/HTTPS.js", { "encoding": "utf-8" });
let lib_LLM_src = fs.readFileSync("./lib/LLM.js", { "encoding": "utf-8" });
let lib_Math_src = fs.readFileSync("./lib/Math.js", { "encoding": "utf-8" });
let lib_String_src = fs.readFileSync("./lib/String.js", { "encoding": "utf-8" });
let lib_System_src = fs.readFileSync("./lib/System.js", { "encoding": "utf-8" });

let native_libs_src = `
ANIMAC_VFS["/lib/File.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_File_src)}\`;
ANIMAC_VFS["/lib/HTTPS.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_HTTPS_src)}\`;
ANIMAC_VFS["/lib/LLM.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_LLM_src)}\`;
ANIMAC_VFS["/lib/Math.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_Math_src)}\`;
ANIMAC_VFS["/lib/String.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_String_src)}\`;
ANIMAC_VFS["/lib/System.js"] = \`${esc(lib_utils_src)}\n\n${esc(lib_System_src)}\`;
`;

fs.writeFileSync("./src/NativeLib.ts", native_libs_src, { "encoding": "utf-8" });

// 开始编译

try {
    execSync("npx tsc -p ./tsconfig.cli.json", { encoding: "utf-8" });
    execSync("npx tsc -p ./tsconfig.web.json", { encoding: "utf-8" });
    console.log("编译成功");
} catch (error) {
    console.error('编译失败：', error.message);
}

// 清理临时文件

fs.unlink('./src/NativeLib.ts', (err) => {
    if (err) {
        if (err.code === 'ENOENT') {
            console.log('文件不存在');
        } else {
            console.error('删除失败:', err);
        }
        return;
    }
    console.log('清理成功');
});
