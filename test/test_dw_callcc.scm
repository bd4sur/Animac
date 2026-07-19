(define k #f)
(define out '())
(define invoked #f)
(dynamic-wind
  (lambda () (set! out (cons 'before out)))
  (lambda ()
    (call/cc (lambda (c) (set! k c)))
    (set! out (cons 'thunk out)))
  (lambda () (set! out (cons 'after out))))

(if (not invoked)
    (begin
      (set! invoked #t)
      (k #f)))

(display "call/cc: out = ")
(display out)
(newline)


(if (equal? out '(after thunk before after thunk before))
    (display "✅ PASS call/cc\n")
    (display "❌ FAIL call/cc\n"))
