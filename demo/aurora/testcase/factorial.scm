(define fac
    (lambda (n)
        (if (= n 0)
            1
            (* n (fac (- n 1))))))
(display "【SSC编译】普通阶乘 10!=")
(display (fac 10))
(newline)
