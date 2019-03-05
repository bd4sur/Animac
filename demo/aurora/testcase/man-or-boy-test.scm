(define A
  (lambda (k x1 x2 x3 x4 x5) (begin
      (define B
        (lambda () (begin
            (set! k (- k 1))
            (A k B x1 x2 x3 x4))))
      (if (<= k 0)
          (+ (x4) (x5))
          (B)))))
(display "【编译】Man or Boy Test<br>Result=")
(display (A 5 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(display "<br>")
