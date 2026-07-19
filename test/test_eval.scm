(native System)

(define x 100)
(define y 0)

(display "====== System.eval 测试 ======") (newline)

(display "预期输出：100\n实际输出：")
(System.eval "(display x)")
(newline)

(display "预期输出：100\n实际输出：")
(System.eval "(set! y x)")
(display y)
(newline)

(display "预期输出：1000\n实际输出：")
(System.eval "(display ((lambda (y) (* x y)) 10))")
(newline)

(display "预期输出：Animac © 2026 BD4SUR\n实际输出：")
(System.eval "(display (cond ((> x 2) \"Animac © 2026 BD4SUR\") (else \"Test System.eval\")))")
(newline)

(display "预期输出：人类的本质是复读机\n实际输出：")
(System.eval "(display (call/cc (lambda (k) (k \"人类的本质是复读机\") \"人类的本质是咕咕嘎嘎\")))")
(newline)

(display "预期输出：人类的本质是路由器\n实际输出：")
(System.eval "(display (call/cc (lambda (k) (k \"人类的本质是路由器\") \"人类的本质是人类的本质\")))")
(newline)

(display "((lambda (x) (cons x (cons (cons quote (cons x '())) '()))) (quote (lambda (x) (cons x (cons (cons quote (cons x '())) '())))))\n实际输出：")
(System.eval "(display ((lambda (x) (cons x (cons (cons quote (cons x '())) '()))) (quote (lambda (x) (cons x (cons (cons quote (cons x '())) '()))))))")
(newline)

(display "测试多次执行eval的可靠性\n")
(define count 500)
(define lst '())
(while (> count 0) {
    (System.eval "(native System) (push lst count) (display \"测试多次执行eval的可靠性 \") (display (System.timestamp)) (display lst) (newline) (set! count (- count 1))")
})

(display "预期输出：报错（变量z未定义）\n实际输出：")
(System.eval "(display z)")
(newline)
