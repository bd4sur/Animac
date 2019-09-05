;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 端口、信号量和死锁演示

;; 临界区：需要独占端口资源的过程，这里是一段空转延时。
(define Critical
    (lambda (countdown)
        (if (= countdown 0)
            #f
            (Critical (- countdown 1)))))

;; 请求资源，并在回调中使用申请到的资源。当然回调中也可以申请新的资源。
(define Request
    (lambda (lock pid callback)
        (if (= (read lock) 0) {
            (display "进程 ")(display pid)(display " 获得并占用资源 ")(display lock)(display " ...")(newline)
            (write lock 1)
            (callback)
            (write lock 0)
            (display "进程 ")(display pid)(display " 已释放资源 ")(display lock)(display " !")(newline)
        } {
            (Request lock pid callback)
        })
    )
)

;; 初始化两个信号量，对应两个资源
(write :lock1 0)
(write :lock2 0)

;; 进程1：先后请求资源1和资源2
(fork {
    (display "进程 1 开始尝试请求资源 :lock1 ...")(newline)
    (Request :lock1 1 (lambda ()
        (Critical 100000) ;; 需要不短于一个时间片，保证另一进程申请到另一资源之前不释放，以满足死锁条件。下同。
        (display "进程 1 开始尝试请求资源 :lock2 ...")(newline)
        (Request :lock2 1 (lambda () #f))
    ))
})

;; 进程2：先后请求资源2和资源1
(fork {
    (display "进程 2 开始尝试请求资源 :lock2 ...")(newline)
    (Request :lock2 2 (lambda ()
        (Critical 100000)
        (display "进程 2 开始尝试请求资源 :lock1 ...")(newline)
        (Request :lock1 2 (lambda () #f))
    ))
})
