(native System)

(define child-pid (System.fork))
(if (== child-pid 0)
    (begin
      (display "Child started\n")
      ; 子进程挂起一个相对长的时间
      (System.set_timeout 5000 (lambda () (display "Child timer (should not print)\n")))
      ; 通过无限循环保持子进程存活（但没有实际工作）
      (define loop (lambda () (loop)))
      (loop))
    (begin
      (display "Parent will kill child\n")
      ; 给子进程一点时间进入循环
      (System.set_timeout 200 (lambda ()
                                (display "Killing child\n")
                                (System.kill child-pid)
                                (display "Child killed\n")))))
