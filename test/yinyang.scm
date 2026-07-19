(native System)

;; 运行5ms后退出，防止无限循环
(System.set_timeout 5 (lambda () (display "\n超时正常退出\n") (System.exit)))

(define Yinyang
(lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
 ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k))))
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
)
)

(define run
  (lambda () {
    (display "测试 Yin-yang Puzzle：")
    (display "期望结果：@*@**@***@****...") (newline)
    (Yinyang)
  })
)

(run)
