;; 预期：编译失败。return 是保留但未实现的关键字（函数返回即最后一个表达式的值）
(define f (lambda (x) (return (* x 2))))
(display (f 21))
