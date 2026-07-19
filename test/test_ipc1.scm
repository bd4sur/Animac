(native System)

(define main
  (lambda ()
    ; 基本创建 / 写 / 读
    (define q (System.make_queue 3))
    (display "queue id=") (display q) (newline)

    (define w1 (System.write q 42 0))
    (display "write immediate=") (display w1) (newline)

    (define r1 (System.read q 0))
    (display "read immediate=") (display r1) (newline)

    ; 空队列超时读取应返回 #undefined
    (define r2 (System.read q 50))
    (display "read timeout empty=") (display r2) (newline)

    ; 满队列超时写入应返回 #f
    (System.write q 1 0)
    (System.write q 2 0)
    (System.write q 3 0)
    (define w4 (System.write q 4 50))
    (display "write timeout full=") (display w4) (newline)

    ; 清空旧队列
    (System.read q 0)
    (System.read q 0)
    (System.read q 0)

    ; 跨进程 FIFO 通信：使用两个单向队列
    ; 期望：child 从 q_to_child 读到 100，parent 从 q_to_parent 读到 200
    (define q_to_child (System.make_queue 1))
    (define q_to_parent (System.make_queue 1))

    (define pid (System.fork))
    (if (== 0 pid)
        (begin
          (define rv (System.read q_to_child 2000))
          (display "child read=") (display rv) (newline)
          (System.write q_to_parent 200 2000))
        (begin
          (System.write q_to_child 100 2000)
          (define rp (System.read q_to_parent 2000))
          (display "parent read=") (display rp) (newline)))

    (display "queue IPC tests done") (newline)))

(main)
