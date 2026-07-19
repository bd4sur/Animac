(native System)

(define out '())
(define mylog (lambda (x) (set! out (cons x out))))
(define escaped #f)
(define k #f)

(call/cc
  (lambda (cont)
    (set! k cont)
    (dynamic-wind
      (lambda () (mylog 'before))
      (lambda ()
        (mylog 'thunk)
        (if (not escaped)
            (begin
              (set! escaped #t)
              (k 'escape-value))))
      (lambda () (mylog 'after)))))

(mylog 'outside)

(display "escape: out = ")
(display out)
(newline)

(if (equal? out '(outside after thunk before))
    (display "✅ PASS escape\n")
    (display "❌ FAIL escape\n"))
