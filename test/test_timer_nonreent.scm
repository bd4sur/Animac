;; ============================================================================
;; test_timer_nonreent.scm —— 周期定时器回调不可重入的回归用例
;;
;; 背景：虚拟机允许定时器在进程运行期间触发（工单 #36 的“定时中断”语义）。
;;       若回调自身的执行时间超过定时间隔（跨越多个时间片），旧实现会在同一回调
;;       尚未返回时再次调用它，形成“回调套回调”的重入，深度可无限增长（实测
;;       可达 1024 层），并使回调内正在使用的全局状态被嵌套调用篡改。
;;       回调只应由事件循环串行调用：上一次调用返回之前，同一进程的定时器
;;       到期只顺延、不嵌套。主流程（非回调）仍可被定时器打断。
;;
;; 本用例：注册一个“慢”周期回调（循环 6 万次，约跨越多个时间片），统计回调
;;         的最大嵌套深度。修复前 max_depth 远大于 1；修复后必须恒为 1。
;;
;; 运行方式：./main test/test_timer_nonreent.scm
;; 通过标准：输出 "PASS: 3  FAIL: 0"，进程自行结束。
;; ============================================================================

(native System)

(define tn_pass 0)
(define tn_fail 0)
(define tn_depth 0)
(define tn_max_depth 0)
(define tn_count 0)
(define tn_timer 0)

(define tn_check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! tn_pass (+ tn_pass 1)) (display "  [PASS] ") }
      { (set! tn_fail (+ tn_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; 慢回调：进入时深度 +1，离开时 -1；运行 3 次后汇总并退出。
(define tn_cb (lambda () {
  (set! tn_depth (+ tn_depth 1))
  (if (> tn_depth tn_max_depth) { (set! tn_max_depth tn_depth) })

  (define i 0)
  (while (< i 60000) { (set! i (+ i 1)) })

  (set! tn_depth (- tn_depth 1))
  (set! tn_count (+ tn_count 1))

  (if (>= tn_count 3)
      {
        (System.clear_interval tn_timer)
        (display "====== 汇总 ======") (newline)
        (tn_check "1 回调至少执行 3 次" (>= tn_count 3) #t)
        (tn_check "2 回调未发生重入（最大嵌套深度为 1）" tn_max_depth 1)
        (tn_check "3 回调退出后深度归零" tn_depth 0)
        (display "PASS: ") (display tn_pass)
        (display "  FAIL: ") (display tn_fail) (newline)
        (System.exit)
      })
}))

(set! tn_timer (System.set_interval 1 tn_cb))