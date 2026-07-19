
(define A
  (lambda (k x1 x2 x3 x4 x5)
      (define B
        (lambda ()
            (set! k (- k 1))
            (A k B x1 x2 x3 x4)))
      (if (<= k 0)
          (+ (x4) (x5))
          (B))))

(define thunk_1  (lambda () 1))
(define thunk_m1 (lambda () -1))
(define thunk_0  (lambda () 0))

(define run
  (lambda () {
    (display "Man or Boy Test")(newline)
    (display "A[10] = ") (display (A 10 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (display " / 期望-67") (newline)
    (display "A[11] = ") (display (A 11 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (display " / 期望-138") (newline)
    (display "A[12] = ") (display (A 12 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (display " / 期望-291") (newline)
    (newline)
  })
)
