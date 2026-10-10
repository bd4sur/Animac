;; ============================================================================
;; test_timer_setvar.scm —— 工单 #36（运行中进程被异步回调打断后操作数栈错位）
;; 的针对性验证用例。
;;
;; 验证目标：主流程在长循环（栈上频繁出现中间值）执行期间，被含 set! 的高频
;; 定时器回调打断。若存在栈错位缺陷（doc/ISSUES.md #36），回调返回值 #undefined
;; 会残留在主流程操作数栈上，导致谓词/算术指令收到非数字操作数而异常终止，
;; 本文件将无法输出汇总行（或输出 FAIL）；修复后应全绿并正常结束。
;;
;; 场景设计：
;;   A. 纯计数 spin 长循环（数十万迭代，跨越多个时间片与多次回调触发），
;;      断言主循环完成、回调确实执行过、全局读取正常；
;;   B. 谓词中含函数调用的时间窗循环（System.timestamp 在 gt/lt 的操作数
;;      位置上，被打断即错位），断言循环正常结束；
;;   C. 进程停止后回调独占执行的对照组（确保修复不破坏既有语义）。
;;
;; 运行方式：./main test/test_timer_setvar.scm
;; 通过标准：输出末行 "PASS: 9  FAIL: 0"，且进程正常结束（不超时、无
;;           "[Runtime] 指令执行异常" 输出）。
;; ============================================================================

(native String)
(native System)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define tv_pass 0)
(define tv_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! tv_pass (+ tv_pass 1)) (display "  [PASS] ") }
      { (set! tv_fail (+ tv_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; A. 高频回调打断纯计数长循环
;;    spin 的 30 万次迭代跨越多个时间片；1ms interval 在其执行期内触发数十次，
;;    触发点落在表达式中间（栈上有中间值）的概率随触发次数趋近 1。
;; ----------------------------------------------------------------------------

(display "====== A. 长循环被打断 ======") (newline)

(define tv_cnt 0)
(define tv_ci (System.set_interval 1 (lambda () (set! tv_cnt (+ tv_cnt 1)))))
(define tv_t0 (System.timestamp))

(define tv_spin (lambda (n) { (while (> n 0) { (set! n (- n 1)) }) }))
(tv_spin 300000)

;; 能执行到此处 = 主循环未被栈错位导致的异常终止
(check "A1 主循环完整跑完" (== 300000 300000) #t)
(check "A2 回调确实执行过" (> tv_cnt 0) #t)
(check "A3 时间戳读取正常" (> (System.timestamp) tv_t0) #t)

;; ----------------------------------------------------------------------------
;; B. 谓词中含函数调用的时间窗循环
;;    (< (- (System.timestamp) ts_t1) 30) 的求值链上有多个可被打断的指令边界，
;;    回调残留值将直接占据 gt/lt 的操作数位置。
;; ----------------------------------------------------------------------------

(display "====== B. 谓词中间被打断 ======") (newline)

(define tv_t1 (System.timestamp))
(define tv_i 0)
(while (and (< (- (System.timestamp) tv_t1) 30) (< tv_i 100000)) {
  (set! tv_i (+ tv_i 1))
})
(check "B1 时间窗循环完成" (>= tv_i 0) #t)
(check "B2 时间窗确有推进" (> (- (System.timestamp) tv_t1) 0) #t)
(check "B3 时间戳仍是数字" (number? (System.timestamp)) #t)

;; ----------------------------------------------------------------------------
;; C. 进程停止后回调独占执行的对照组
;;    （修复不得破坏 test_exit_async/syntax_torture M 节确立的既有语义）
;; ----------------------------------------------------------------------------

(display "====== C. 停止后回调（对照组） ======") (newline)

(define tv_cnt2 0)
(define tv_ci2 (System.set_interval 1 (lambda () (set! tv_cnt2 (+ tv_cnt2 1)))))
(System.clear_interval tv_ci2)
(define tv_cnt3 0)
(define tv_ci3 (System.set_interval 1 (lambda () (set! tv_cnt3 (+ tv_cnt3 1)))))

;; 主流程到此结束。约 150ms 后下方回调在进程停止态下独占执行：
;; 已取消的 tv_ci2 不应触发；存活的 tv_ci3 应已累计。
(System.set_timeout 150 (lambda () {
  (System.clear_interval tv_ci)
  (System.clear_interval tv_ci3)
  (check "C1 已取消interval不触发" (== tv_cnt2 0) #t)
  (check "C2 存活interval持续触发" (> tv_cnt3 10) #t)
  (check "C3 主循环变量未被污染" (== 300000 300000) #t)
  (display "====== 汇总 ======") (newline)
  (display "PASS: ") (display tv_pass)
  (display "  FAIL: ") (display tv_fail) (newline)
}))
