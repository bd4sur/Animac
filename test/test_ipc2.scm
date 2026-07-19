(native System)

(define main
  (lambda ()
    ; 多消费者测试：容量为 2 的队列，两个子进程读取，父进程写入两个值
    (define q (System.make_queue 2))

    (define pid1 (System.fork))
    (if (== 0 pid1)
        (begin
          (define v1 (System.read q 1000))
          (display "consumer1 read=") (display v1) (newline))
        (begin
          (define pid2 (System.fork))
          (if (== 0 pid2)
              (begin
                (define v2 (System.read q 1000))
                (display "consumer2 read=") (display v2) (newline))
              (begin
                (System.write q 111 100)
                (System.write q 222 100)))))

    (display "mpmc test done") (newline)))

(main)
