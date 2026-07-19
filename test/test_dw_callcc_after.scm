(native System)

(define out '())
(define mylog (lambda (x) (set! out (cons x out))))
(define k #f)
(define captured #f)
(define invoked #f)

(dynamic-wind
  (lambda () (mylog 'before2))
  (lambda () (mylog 'thunk2))
  (lambda ()
    (mylog 'after2)
    (if (not captured)
        (call/cc (lambda (c)
                   (set! k c)
                   (set! captured #t))))))

(mylog 'outside)
(if (not invoked)
    (begin
      (set! invoked #t)
      (k #f)))

(display "after call/cc: out = ")
(display out)
(newline)

(if (equal? out '(outside outside after2 thunk2 before2))
    (display "✅ PASS after call/cc\n")
    (display "❌ FAIL after call/cc\n"))
