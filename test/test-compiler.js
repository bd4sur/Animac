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

const testcaseIndex = 5;
let RESOURCE = Parser.Parser(`((lambda () (begin${testcase[testcaseIndex]})))`)[1];

console.log('===== AST =====');
console.log(JSON.stringify(RESOURCE));

console.log('===== 指令序列 =====');
Compiler.Compiler(RESOURCE);
