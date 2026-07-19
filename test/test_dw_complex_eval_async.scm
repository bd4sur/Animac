;;; test_dw_complex_eval_async.scm
;;; 目标：在异步回调中通过 System.eval 动态执行包含 dynamic-wind + call/cc 的代码，
;;;       验证 dynamic-wind 的 before/after 在 eval 上下文和异步调度下仍然正确。
;;;
;;; 设计思路：
;;;   1. 用 System.set_interval 启动周期定时器。
;;;   2. 每次 tick 调用 System.eval，eval 的字符串内部：
;;;        - 使用 dynamic-wind 包裹一个 thunk；
;;;        - thunk 内用 call/cc 捕获续体 esc；
;;;        - 退出 eval 后外部再调用 esc 跳回 wind 内部，强制触发一次 after->before 调整。
;;;   3. tick 计数到 2 后清除 interval，随后一次性打印结果并判定 PASS/FAIL。

(native System)

(define out '())
(define log (lambda (x) (set! out (cons x out))))

(define count 0)
(define timer 0)

;; 每个 tick 在 out 中留下的数字序列为：1 2 3 4 5 2 4 5
;; 两个 tick 后，out 的内容（cons 累积顺序）如下：
(define expected '(5 4 2 5 4 3 2 1 5 4 2 5 4 3 2 1))

(define tick
  (lambda ()
    (set! count (+ count 1))
    (log 1)                     ; tick marker
    (System.eval
      "(begin (define esc #f) (define saved #f) (dynamic-wind (lambda () (log 2)) (lambda () (log 3) (call/cc (lambda (k) (set! esc k))) (log 4)) (lambda () (log 5))) (if esc (begin (set! saved esc) (set! esc #f) (saved 'again))))")
    (if (>= count 2)
        (System.clear_interval timer))))

(set! timer (System.set_interval 50 tick))

;; 等待 interval 完成，然后汇总验证
(System.set_timeout
  1000
  (lambda ()
    (display "out: ") (display out) (newline)
    (if (equal? out expected)
        (begin (display "✅ PASS eval-async") (newline))
        (begin (display "❌ FAIL eval-async: expected ") (display expected)
               (display " but got ") (display out) (newline)))))
