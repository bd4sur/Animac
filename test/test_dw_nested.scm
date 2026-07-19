(define out '())
(define mylog (lambda (x) (set! out (cons x out))))

(dynamic-wind
  (lambda () (mylog 'outer-before))
  (lambda ()
    (dynamic-wind
      (lambda () (mylog 'inner-before))
      (lambda () (mylog 'thunk))
      (lambda () (mylog 'inner-after)))
    (mylog 'between)
    (dynamic-wind
      (lambda () (mylog 'inner2-before))
      (lambda () (mylog 'thunk2))
      (lambda () (mylog 'inner2-after))))
  (lambda () (mylog 'outer-after)))

(display "nested: out = ")
(display out)
(newline)

(define expected '(outer-after inner2-after thunk2 inner2-before between inner-after thunk inner-before outer-before))
(if (equal? out expected)
    (display "✅ PASS nested\n")
    (display "❌ FAIL nested\n"))
