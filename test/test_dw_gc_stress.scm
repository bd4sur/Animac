(native System)

(define out '())
(define mylog (lambda (x) (set! out (cons x out))))
(define k #f)
(define invoked #f)

(dynamic-wind
  (lambda ()
    (mylog 'outer-before)
    (System.gc))
  (lambda ()
    (dynamic-wind
      (lambda ()
        (mylog 'inner-before)
        (System.gc))
      (lambda ()
        (call/cc (lambda (c) (set! k c)))
        (mylog 'thunk))
      (lambda ()
        (mylog 'inner-after)
        (System.gc))))
  (lambda ()
    (mylog 'outer-after)
    (System.gc)))

(if (not invoked)
    (begin
      (set! invoked #t)
      (k #f)))

(display "gc stress: out = ")
(display out)
(newline)

(if (equal? out '(outer-after inner-after thunk inner-before outer-before
                    outer-after inner-after thunk inner-before outer-before))
    (display "✅ PASS gc stress\n")
    (display "❌ FAIL gc stress\n"))
