(define A
  (lambda (k x1 x2 x3 x4 x5)
      (define B
        (lambda ()
            (set! k (- k 1))
            (A k B x1 x2 x3 x4)))
      (if (<= k 0)
          (+ (x4) (x5))
          (B))))
(display "Man or Boy Test = ")
(display (A 14 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)
