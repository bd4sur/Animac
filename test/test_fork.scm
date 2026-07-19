(native System)

(define pid (System.fork))
(if (== 0 pid) {
    (display "子进程 (即将被exec夺舍)") (newline)
    (System.exec "(native System) (native Math) (import List \"list.scm\") (display \"这是子进程被夺舍后执行的另一段程序\") (newline) (display (Math.pow 2 10)) (newline) (define lst '(1 1 4 5 1 4)) (List.heap_sort lst >) (display lst) (newline)")
    (display "should not print") (newline)
} {
    (System.set_interval 500 (lambda () (newline) (display "这是亲进程仍在运行的异步回调 Heartbeat @ ") (display (System.timestamp))))
})

