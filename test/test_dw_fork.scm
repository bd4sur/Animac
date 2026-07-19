(native System)

(define out '())
(define mylog (lambda (x) (set! out (cons x out))))
(define pid #f)

(dynamic-wind
  (lambda () (mylog 'before))
  (lambda ()
    (mylog 'thunk-start)
    (set! pid (System.fork))
    (if (== 0 pid)
        (System.exit)
        (mylog 'forked))
    (mylog 'thunk-end))
  (lambda () (mylog 'after)))

(display "fork: out = ")
(display out)
(newline)

(if (equal? out '(after thunk-end forked thunk-start before))
    (display "✅ PASS fork\n")
    (display "❌ FAIL fork\n"))
