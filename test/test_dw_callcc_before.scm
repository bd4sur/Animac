(native System)

(define out '())
(define mylog (lambda (x) (set! out (cons x out))))
(define k #f)
(define captured #f)
(define invoked #f)

(dynamic-wind
  (lambda ()
    (mylog 'before)
    (if (not captured)
        (call/cc (lambda (c)
                   (set! k c)
                   (set! captured #t)))))
  (lambda ()
    (mylog 'thunk)
    (if captured
        (if (not invoked)
            (begin
              (set! invoked #t)
              (k #f)))))
  (lambda () (mylog 'after)))

(display "before call/cc: out = ")
(display out)
(newline)

(if (equal? out '(after thunk after thunk before))
    (display "✅ PASS before call/cc\n")
    (display "❌ FAIL before call/cc\n"))
