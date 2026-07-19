(native System)

;; 两个进程分别持有对方需要的资源，形成循环等待，从而死锁。
;; 用两个容量为 1 的队列 `lockA`、`lockB` 模拟两把互斥锁：
;; - 初始各写入一个 token，表示锁可用。
;; - `System.read` 成功表示加锁。
;; - `System.write` 可用于释放（本例中不手动释放，靠超时检测死锁）。
;; 
;; 进程布局：
;; - parent：先获取 `lockA`，通过屏障等待 child 获取 `lockB`，然后尝试获取 `lockB`。
;; - child：先获取 `lockB`，通过屏障等待 parent 获取 `lockA`，然后尝试获取 `lockA`。
;; 
;; 两者都拿到对方需要的锁，再请求对方持有的锁，形成循环等待，即典型死锁。
;; 第二次 `read` 使用 200ms 超时，超时失败返回 `#undefined`，从而打破死锁并打印检测信息；若不加超时，两个进程将永久阻塞。

(define main
  (lambda ()
    (define lockA (System.make_queue 1))
    (define lockB (System.make_queue 1))
    (define parent_ready (System.make_queue 1))
    (define child_ready (System.make_queue 1))

    ; 初始化两把锁
    (System.write lockA 1 0)
    (System.write lockB 1 0)

    (define pid (System.fork))
    (if (== 0 pid)
        (begin
          (display "child: acquiring B") (newline)
          (System.read lockB 0)
          (display "child: B acquired") (newline)

          ; 屏障：通知 parent 已拿到 B，并等待 parent 拿到 A
          (System.write child_ready 1 0)
          (System.read parent_ready 100)

          (display "child: trying to acquire A (expect deadlock)") (newline)
          (define gotA (System.read lockA 200))
          (if (== #undefined gotA)
              (begin
                (display "child: DEADLOCK detected, could not acquire A") (newline))
              (begin
                (display "child: acquired A (unexpected)") (newline))))
        (begin
          (display "parent: acquiring A") (newline)
          (System.read lockA 0)
          (display "parent: A acquired") (newline)

          ; 屏障：通知 child 已拿到 A，并等待 child 拿到 B
          (System.write parent_ready 1 0)
          (System.read child_ready 100)

          (display "parent: trying to acquire B (expect deadlock)") (newline)
          (define gotB (System.read lockB 200))
          (if (== #undefined gotB)
              (begin
                (display "parent: DEADLOCK detected, could not acquire B") (newline))
              (begin
                (display "parent: acquired B (unexpected)") (newline)))))

    (display "process finished") (newline)))

(main)
