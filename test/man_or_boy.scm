(import Utils "utils.scm")

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
    (Utils.show "Man or Boy Test")(newline)
    (Utils.show "期望结果：-67")(newline)
    (Utils.show "实际结果：")
    (Utils.show (A 10 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0))
    (newline)
    (newline)
  })
)