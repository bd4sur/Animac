
///////////////////////////////////////////////
// UT.ts
// 单元测试

// Test
const TESTCASE = `
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define A
  (lambda (k x1 x2 x3 x4 x5) (begin
      (define B
        (lambda () (begin
            (set! k (- k 1))
            (A k B x1 x2 x3 x4))))
      (if (<= k 0)
          (+ (x4) (x5))
          (B)))))
(display "【AuroraScheme编译】Man or Boy Test = ")
(display (A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
`;

let ast = Parse(TESTCASE);

console.log(JSON.stringify(ast));
