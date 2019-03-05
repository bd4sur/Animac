const fs = require('fs');
const Compiler = require('../source/compiler.js');
const Parser = require('../source/parser.js');

const testcase = [
// 0
`(define fac
    (lambda (n)
        (if (= n 0)
            1
            (* n (fac (- n 1))))))
(display "【编译】普通阶乘<br>")
(display "10!=")
(display (fac 10))
(display "<br>")`,
// 1
`
(define A
  (lambda (k x1 x2 x3 x4 x5) (begin
      (define B
        (lambda () (begin
            (set! k (- k 1))
            (A k B x1 x2 x3 x4))))
      (if (<= k 0)
          (+ (x4) (x5))
          (B)))))
(display "【编译】Man or Boy Test<br>Result=")
(display (A 5 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(display "<br>")
`,
// 2
`
(define trav
  (lambda (lat)
    (if (null? lat)
        #f
        (begin
          (display (car lat))
          (trav (cdr lat))))))
(display "【编译】列表遍历测试<br>期望输出“AuroraVirtualMachine”=")
(trav (car (cdr '("Hello" ("Aurora" "Virtual" "Machine")))))
(display "<br>")
`,
// 3
`
(((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
 ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k))))
`,
// 4
`
(define fac-count 0)
(define clo-count 0)
(define fac
  (lambda (n cont) (begin
    (set! fac-count (+ fac-count 1))
    (if (= n 0)
        (cont 1)
        (fac (- n 1)
             (lambda (res) (begin
               (set! clo-count (+ clo-count 1))
               (cont (* res n)))))))))
(display "【编译】CPS阶乘/set!测试<br>5!=")
(display (fac 5 (lambda (x) x)))
(display "<br>闭包调用次数=")
(display clo-count)
(display "<br>阶乘递归调用次数=")
(display fac-count)
(display "<br>")
`,
// 5
`
(define concat
  (lambda (lat atom)
    (concat (cons atom lat) atom)))
(display "【编译】测试无限cons列表的内存管理<br>")
(concat '("Aurora" "Virtual" "Machine")
        "Hello")
`,
]

const sourcePath = "./demo"; // 代码基准目录
const modulePath = "/aurora/testcase/"; // 模块目录
const moduleFileName = "yin-yang-puzzle.scm"; // 模块文件名（与模块名相同）

let moduleFilePath = [sourcePath, modulePath, moduleFileName].join('');
let moduleName = moduleFileName.replace(/\.[^\.]*$/gi, "");
let moduleQualifiedName = modulePath.substring(1).replace(/\//gi, ".") + moduleName;

let outFilePath = ["./asm/", moduleQualifiedName, ".json"].join('');

fs.readFile(moduleFilePath, {encoding:"utf-8"}, (error, data)=> {
    if(error) {
        throw error;
    }
    let source = data.toString();

    // 包裹第一层Lambda
    source = ["((lambda () (begin", source, ")))"].join('\n');

    // 语法分析，生成静态资源表和AST
    let AST = Parser.Parser(source);
    let MODULE = Compiler.Compiler(moduleQualifiedName, AST);

    function outputTarget() {
        fs.writeFile(outFilePath, JSON.stringify(MODULE, "", 2), {flag:'w'}, (error)=> {
            if(error) { throw error; }
            console.log(`[SSC] Module '${moduleFilePath}': `);
            console.log(`[SSC]   Target code @ '${outFilePath}'.`);
            console.log(`[SSC]   Successfully Compiled.`);
        });
    }

    fs.exists("./asm/", (isExist)=> {
        if(isExist) {
            outputTarget();
        }
        else {
            fs.mkdir("./asm/", (error)=> {
                if(error) { throw error; }
                outputTarget();
             });
        }
    });
    
});


