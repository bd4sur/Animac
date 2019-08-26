
///////////////////////////////////////////////
// UT.ts
// 单元测试

// import * as fs from "fs";
const fs = require("fs");

// Parser测试

function UT_Parser() {
    const TESTCASE = `
    ((lambda ()
    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    
    ;; AppLib测试
    (native HTTPS)
    (native String)
    (native Math)
    (native File)
    (import "../../../source/applib/list.scm" List)
    (define multiply
      (lambda (x y) (Math.mul x y)))
    (display (List.reduce '(1 2 3 4 5 6 7 8 9 10) multiply 1))
    
    (define filter
      (lambda (f lst)
        (if (null? lst)
            '()
            (if (f (car lst))
                (cons (car lst) (filter f (cdr lst)))
                (filter f (cdr lst))))))
    
    (define concat
      (lambda (a b)
        (if (null? a)
            b
            (cons (car a) (concat (cdr a) b)))))
    
    (define quicksort
      (lambda (array)
        (if (or (null? array) (null? (cdr array)))
            array
            (concat (quicksort (filter (lambda (x)
                                         (if (< x (car array)) #t #f))
                                       array))
                               (cons (car array)
                                     (quicksort (filter (lambda (x)
                                                          (if (> x (car array)) #t #f))
                                                        array)))))))
    
    (display "【SSC编译】快速排序：")
    (display (quicksort '(5 9 1 7 (5 3 0) 4 6 8 2)))
    (newline)
    
    
    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ))
    `;

    let ast = Parse(TESTCASE, "me.aurora.TestModule");
    fs.writeFileSync("./AST.json", JSON.stringify(ast, null, 2), "utf-8");
}

/*
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(define Count 100)
(define Add
  (lambda (x y)
    (set! Count (+ 1 Count))
    (if (= y 0)
        x
        (+ 1 (Add x (- y 1))))))

(display (Add 10 5))
(newline)
(display Count)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
*/
function UT_Instruction() {
const instructions = [
    `   call    @&LAMBDA_0`,
    `   halt`,

    `;; 函数&LAMBDA_n(Add)开始`,
    `   @&LAMBDA_n`,
    `;; Parameters:(x y)`,
    `   store   me.aurora.test.&LAMBDA_n.y`,
    `   store   me.aurora.test.&LAMBDA_n.x`,
    `;; (set! Count (+ 1 Count))`,
    `   push    1`,
    `   load    me.aurora.test.&LAMBDA_0.Count`,
    `   add`,
    `   set     me.aurora.test.&LAMBDA_0.Count`,
    `;; (if COND_0 TRUE_ROUTE_0 FALSE_ROUTE_0)`,
    `   @COND_0`,
    `   load    me.aurora.test.&LAMBDA_n.y`,
    `   push    0`,
    `   eqn`,
    `   iffalse @FALSE_ROUTE_0`,
    `   @TRUE_ROUTE_0`,
    `   load    me.aurora.test.&LAMBDA_n.x`,
    `   goto    @END_IF_0`,
    `   @FALSE_ROUTE_0`,
    `   push    1`,
    `   load    me.aurora.test.&LAMBDA_n.x`,
    `   load    me.aurora.test.&LAMBDA_n.y`,
    `   push    1`,
    `   sub`,
    `   call    me.aurora.test.&LAMBDA_0.Add`,
    `   add`,
    `   @END_IF_0`,
    `   return`,
    `;; 函数&LAMBDA_n(顶级作用域)开始`,
    `   @&LAMBDA_0`,
    `;; (define Count 100)`,
    `   push    100`,
    `   store   me.aurora.test.&LAMBDA_0.Count`,
    `;; (define Add &LAMBDA_n)`,
    `   push    @&LAMBDA_n`,
    `   store   me.aurora.test.&LAMBDA_0.Add`,
    `;; (Add 10 5)`,
    `   push    10`,
    `   push    5`,
    `   call    me.aurora.test.&LAMBDA_0.Add`,
    `   display`,
    `   newline`,
    `   load    me.aurora.test.&LAMBDA_0.Count`,
    `   display`,
    `   return`,
];

    // IL指令集和VM测试
    // 期望结果：15 106
    let process = new Process(instructions);
    while(process.state !== ProcessState.STOPPED) {
        // console.log(process.CurrentInstruction().instruction);
        Execute(process);
    }
}

UT_Parser();
// UT_Instruction();

