(define fac-count 0)
(define clo-count 0)
(define fac
  (lambda (n cont) (begin
    (set! fac-count (+ fac-count 1))
    (if (= n 0)
        (cont 1)
        (fac (- n 1)
             (lambda (res) (begin
               (set! clo-count (+ clo-count 1))
               (cont (* res n)))))))))
(display "【编译】CPS阶乘/set!测试<br>5!=")
(display (fac 5 (lambda (x) x)))
(display "<br>闭包调用次数=")
(display clo-count)
(display "<br>阶乘递归调用次数=")
(display fac-count)
(display "<br>")
