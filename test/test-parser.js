const Parser = require('../source/parser.js');

const testcase = [
// 0
`(define sum
    (lambda (n s)
        (if (= n 0)
            (n '符号 "字符串" 3.1415926535897932384626)
            (quote (sum (- n 1) (+ n s))))))`,
// 1
`(define c 10)
(define f
  (lambda (c)
    (begin
      (set! c 123)
      c)))`,

]

console.log(JSON.stringify(Parser.Parser(`
((lambda () (begin
${testcase[1]}
)))
`)));


