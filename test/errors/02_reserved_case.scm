;; 预期：编译失败。case 是保留但未实现的关键字
(define x 1)
(case x ((1) "one"))
