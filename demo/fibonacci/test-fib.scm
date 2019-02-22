(import-as "./fib.scm" fib)

(define count 0)
(while (<= count 10)
       (begin (display (fib.fibonacci count))
              (set! count (+ count 1))))
