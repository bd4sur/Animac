(define fac
    (lambda (n)
        (if (= n 0)
            1
            (* n (fac (- n 1))))))
(display "【编译】普通阶乘<br>")
(display "10!=")
(display (fac 10))
(display "<br>")
