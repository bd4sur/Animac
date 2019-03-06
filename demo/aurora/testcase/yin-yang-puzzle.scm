;(((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
; ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k))))
; TODO 注意：first如果是application，必须转换成如下的eta变换后的形式
(
    (lambda (a b) (a b))
    ((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
    ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k)))
)