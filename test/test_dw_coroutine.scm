;; test_dw_coroutine.scm
;; 基于 dynamic-wind + call/cc 实现一个“可多次任意出入”的协程 demo。
;;
;; 原理：
;;   1. 用 (call/cc) 捕获“调用者（main）”的续体 k-main，使协程 yield 时能返回主流程。
;;   2. 协程体运行在 dynamic-wind 的 thunk 中；yield 时调用 k-main 离开协程，
;;      dynamic-wind 的 after 会被执行（模拟“退出清理”）。
;;   3. 调用 (resume v) 时再次捕获新的 k-main，并调用保存的协程续体 k-co，
;;      dynamic-wind 的 before 会被执行（模拟“进入准备”），然后从 yield 点继续。
;;   4. 协程最终正常结束时，after 也会执行。
;;
;; 预期行为：
;;   - 每次 yield/resume 都会触发 before/after 日志。
;;   - 协程体按 body-start -> yield(1) -> body-mid -> yield(2) -> body-end 执行。
;;   - 最终 result 为 'final。
;;

(native System)

(define out '())
(define log (lambda (x) (set! out (cons x out))))

(define k-main #f)   ;; 调用者（main）的续体
(define k-co #f)     ;; 协程体内的续体
(define done #f)     ;; 协程是否已正常结束

;; yield：保存当前协程位置，返回主流程
(define yield (lambda (v)
  (call/cc (lambda (k)
             (set! k-co k)
             (k-main v)))))

;; resume：保存新的主流程位置，恢复协程
(define resume (lambda (v)
  (call/cc (lambda (k)
             (set! k-main k)
             (if done
                 (k-main 'done)
                 (k-co v))))))

;; 启动协程
(define result
  (call/cc (lambda (k)
             (set! k-main k)
             (dynamic-wind
               (lambda () (log 'enter))
               (lambda ()
                 (log 'body-start)
                 (yield 1)
                 (log 'body-mid)
                 (yield 2)
                 (log 'body-end)
                 (set! done #t)
                 ;; 正常结束时也显式返回 latest k-main，否则 dynamic-wind 会回到外层 call/cc
                 ;; 的返回点（即 (log 'after-coro)），导致控制流混乱。
                 (k-main 'final))
               (lambda () (log 'exit))))))

(log 'after-coro)
(set! result (resume 'r1))
(log 'after-resume1)
(set! result (resume 'r2))
(log 'after-resume2)

(display "coroutine: out = ")
(display out)
(newline)
(display "coroutine: final result = ")
(display result)
(newline)

;; 验证输出顺序（从最近到最远）：
;; after-resume2, exit, body-end, enter,
;; after-resume1, exit, body-mid, enter,
;; after-coro,    exit, body-start, enter
(if (equal? out '(after-resume2 exit body-end   enter
                  after-resume1 exit body-mid   enter
                  after-coro    exit body-start enter))
    (display "✅ PASS coroutine\n")
    (display "❌ FAIL coroutine\n"))
