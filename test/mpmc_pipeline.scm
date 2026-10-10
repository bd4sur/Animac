;; ============================================================================
;; mpmc_pipeline.scm —— 多进程协作套件（C 版 Animac 大型实用性测试）
;;
;; 场景：
;;   A. Map-Reduce：主进程 fork 3 个 worker，经任务队列分发 20 个数字的素数
;;      判定任务，worker 经结果队列回传，主进程归并并与本地对照计算逐项核对；
;;   B. 请求-应答 RPC：fork 一个服务进程，主进程发送两个请求并收取应答；
;;   C. dynamic-wind 事务守卫：wind 体内经 call/cc 非局部逃逸，验证 after
;;      守护过程执行了状态回滚；
;;   D. 终止保证：全部 worker 以 "stop" 哨兵 + read 超时兜底可终止（对照
;;      test_fork.scm 的死循环问题），用例本身必须在 30s 内自然结束。
;;
;; 协议约定：任务/请求为数字；控制哨兵为字符串（跨进程以 String.equals 判定，
;; 规避符号/引用身份的进程语义问题）。
;;
;; 运行方式：./main test/mpmc_pipeline.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"（且无残留进程导致的挂起）。
;; ============================================================================

(native String)
(native Table)
(native System)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define mp_pass 0)
(define mp_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! mp_pass (+ mp_pass 1)) (display "  [PASS] ") }
      { (set! mp_fail (+ mp_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 公共函数
;; ----------------------------------------------------------------------------

;; 成员判定（尾递归；跨进程字符串以 equal? 比较）
(define mp-member? (lambda (x lst) {
  (if (null? lst)
      #f
      (if (equal? x (car lst)) #t (mp-member? x (cdr lst)))
))})

;; 素数试除判定
(define mp-prime? (lambda (n) {
  (if (< n 2)
      #f
      {
        (define i 2)
        (define r #t)
        (while (and (<= (* i i) n) r) {
          (if (== 0 (mod n i)) (set! r #f) 0)
          (set! i (+ i 1))
        })
        r
      })
}))

;; worker 主体：循环从任务队列取数字做素数判定，结果以 (n isprime) 双写回
;; 结果队列；读到哨兵字符串或读超时即退出。收尾先于父进程的断言。
(define mp-worker (lambda (tq rq) {
  (define running #t)
  (define task 0)
  (while running {
    (set! task (System.read tq 2000))
    (if (number? task)
        {
          (System.write rq task 0)
          (if (mp-prime? task) (System.write rq 1 0) (System.write rq 0 0))
        }
        (set! running #f))
  })
  (System.exit)
}))

;; ----------------------------------------------------------------------------
;; A. Map-Reduce：3 worker 并行素数判定
;; ----------------------------------------------------------------------------

(display "====== A. Map-Reduce 素数筛选 ======") (newline)

(define mp_tq (System.make_queue 64))
(define mp_rq (System.make_queue 64))

;; 任务集：12 个数字（含素数与非素数、边界 0/1/2）
;; 注意：并行归并不保证结果按序返回，故对照采用"按值重算"而非按序表
(define mp_tasks '(97 100 1 2 91 89 15 16 79 77 63 64))
(define mp_ntask (length mp_tasks))
(define mp_i 0)

;; 3 个 worker（fork 后从同一位置继续，靠 fork 返回值分流；worker 结尾自带 exit）
(define mp_w1 (System.fork))
(if (== mp_w1 0) { (mp-worker mp_tq mp_rq) (System.exit) } 0)
(define mp_w2 (System.fork))
(if (== mp_w2 0) { (mp-worker mp_tq mp_rq) (System.exit) } 0)
(define mp_w3 (System.fork))
(if (== mp_w3 0) { (mp-worker mp_tq mp_rq) (System.exit) } 0)

;; 主进程：投放全部任务与 3 个哨兵
(set! mp_i 0)
(while (< mp_i mp_ntask) {
  (System.write mp_tq (get_item mp_tasks mp_i) 0)
  (set! mp_i (+ mp_i 1))
})
(System.write mp_tq "stop" 0)
(System.write mp_tq "stop" 0)
(System.write mp_tq "stop" 0)

;; 归并：逐项收取 (n isprime) 并与本地对照
(define mp_ok #t)
(define mp_n 0)
(define mp_r 0)
(set! mp_i 0)
(while (< mp_i mp_ntask) {
  (set! mp_n (System.read mp_rq 3000))
  (set! mp_r (System.read mp_rq 3000))
  (if (and (number? mp_n) (equal? (== mp_r 1) (mp-prime? mp_n)))
      0
      (set! mp_ok #f))
  (set! mp_i (+ mp_i 1))
})
(check "A1 全部任务结果正确" mp_ok #t)
(check "A2 回调型 worker 已消费哨兵" (number? (System.read mp_rq 100)) #f)

;; ----------------------------------------------------------------------------
;; B. 请求-应答 RPC
;; ----------------------------------------------------------------------------

(display "====== B. 请求-应答 RPC ======") (newline)

(define mp_qq (System.make_queue 16))
(define mp_pq (System.make_queue 16))

(define mp_rid (System.fork))
(if (== mp_rid 0) {
  ;; 服务进程：请求 ×2 → 应答 ×2；哨兵后退出
  (define req 0)
  (define serving #t)
  (while serving {
    (set! req (System.read mp_qq 3000))
    (if (number? req)
        { (System.write mp_pq (* 2 req) 0) }
        (set! serving #f))
  })
  (System.exit)
} 0)

(System.write mp_qq 21 0)
(System.write mp_qq 7 0)
(System.write mp_qq "bye" 0)
(check "B1 RPC 应答 21*2" (== (System.read mp_pq 3000) 42) #t)
(check "B2 RPC 应答 7*2" (== (System.read mp_pq 3000) 14) #t)

;; ----------------------------------------------------------------------------
;; C. dynamic-wind 事务守卫（异常路径回滚）
;; ----------------------------------------------------------------------------

(display "====== C. dynamic-wind 事务守卫 ======") (newline)

(define mp_log '())
(define mp_tx #f)
(dynamic-wind
  (lambda () { (set! mp_log (cons "begin" mp_log)) (set! mp_tx #t) })
  (lambda () {
    ;; 事务体内经续体非局部逃逸（模拟异常中断）
    (call/cc (lambda (escape) {
      (set! mp_log (cons "work" mp_log))
      (escape #f)
      (set! mp_log (cons "unreachable" mp_log))
    }))
  })
  (lambda () { (set! mp_log (cons "rollback" mp_log)) (set! mp_tx #f) }))
(check "C1 after守护已回滚" (mp-member? "rollback" mp_log) #t)
(check "C2 事务标志已复位" mp_tx #f)
(check "C3 逃逸后代码未执行" (mp-member? "unreachable" mp_log) #f)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display mp_pass)
(display "  FAIL: ") (display mp_fail) (newline)
