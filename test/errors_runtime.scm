;; ============================================================================
;; errors_runtime.scm —— 运行期致命错误路径矩阵（fork 隔离）
;;
;; 原理：运行期错误会使 VM 进程终止（[Runtime] 指令执行异常），无法在单进程内
;; 捕获，因此每个错误场景 fork 一个子进程执行：子进程先 write "死前标记"，
;; 执行预期致命的错误调用，再 write "幸存标记"（若缺陷导致未死则会到达）。
;; 父进程断言：收到死前标记、幸存标记超时未到 = 子进程确已死于该错误。
;;
;; 注意：运行时子进程的 "[Runtime] 指令执行异常: PID=…" 输出是本用例的预期行为，
;; 与末尾汇总行 "PASS: n FAIL: 0" 并存；PASS 计数仅由父进程产生。
;;
;; 覆盖清单（17 场景）：car/cdr/get_item/set_item!/push/pop 对非法类型的调用、
;; get_item 越界、除零（整数与浮点）、mod 非数字、String/Table/Math 本地库参数
;; 类型错、调用未定义变量、cons 尾参非列表、非尾递归超出帧栈深度（工单 #4）。
;;
;; 运行方式：./main test/errors_runtime.scm
;; 通过标准：输出末行 "PASS: 17  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)
(native Math)
(native System)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define er_pass 0)
(define er_fail 0)

(define er-check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! er_pass (+ er_pass 1)) (display "  [PASS] ") }
      { (set! er_fail (+ er_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 场景运行器：fork 子进程执行 thunk（预期致命错误），父进程经队列观察其死亡
;; ----------------------------------------------------------------------------

(define er-run-fatal (lambda (name thunk) {
  (define q (System.make_queue 8))
  (define pid (System.fork))
  (if (== pid 0)
      {
        ;; 子进程：死前标记 → 致命错误 → 幸存标记（缺陷时才可达）→ 兜底退出
        (System.write q 1 0)
        (thunk)
        (System.write q 2 0)
        (System.exit)
      }
      {
        ;; 父进程（主进程）：死前标记应到达，幸存标记应超时
        (define m1 (System.read q 3000))
        (define m2 (System.read q 150))
        (er-check name (and (== m1 1) (undefined? m2)) #t)
      })
}))

;; 非尾递归（供"帧栈耗尽"场景调用；深度上限见 doc/manual.md §3.6 与工单 #4）
(define er-deep (lambda (n) (if (== n 0) 0 (+ 1 (er-deep (- n 1))))))

;; ----------------------------------------------------------------------------
;; A. 列表操作的非法调用
;; ----------------------------------------------------------------------------

(display "====== A. 列表操作非法调用 ======") (newline)

(er-run-fatal "A1 car 作用于非列表"          (lambda () (car 42)))
(er-run-fatal "A2 cdr 作用于字符串"          (lambda () (cdr "s")))
;; 注意：get_item 越界是设计行为（返回 #undefined，见 doc/manual.md §6.4），非致命错误
(er-check "A3 get_item 索引越界返回#undefined" (undefined? (get_item '(1 2) 99)) #t)
(er-check "A3b get_item 负索引返回#undefined" (undefined? (get_item '(1 2) -1)) #t)
(er-run-fatal "A3c get_item 作用于数字"       (lambda () (get_item 42 0)))
(er-run-fatal "A4 get_item 作用于字符串"     (lambda () (get_item "abc" 0)))
(er-run-fatal "A5 set_item! 作用于字符串"    (lambda () (set_item! "s" 0 1)))
(er-run-fatal "A6 push 作用于数字"           (lambda () (push 42 1)))
(er-run-fatal "A7 pop 作用于字符串"          (lambda () (pop "s")))
(er-run-fatal "A8 cons 尾参非列表"           (lambda () (cons 1 #null)))

;; ----------------------------------------------------------------------------
;; B. 算术错误
;; ----------------------------------------------------------------------------

(display "====== B. 算术错误 ======") (newline)

(er-run-fatal "B1 整数除零"                  (lambda () (/ 1 0)))
(er-run-fatal "B2 浮点除零"                  (lambda () (/ 1.0 0.0)))
(er-run-fatal "B3 mod 作用非数字"            (lambda () (mod 1 "x")))

;; ----------------------------------------------------------------------------
;; C. 本地库参数类型错
;; ----------------------------------------------------------------------------

(display "====== C. 本地库参数类型错 ======") (newline)

(er-run-fatal "C1 String.length 作用非串"    (lambda () (String.length 42)))
(er-run-fatal "C2 Table.length 作用非表"     (lambda () (Table.length "s")))
(er-run-fatal "C3 Math.sqrt 作用非数字"      (lambda () (Math.sqrt "x")))

;; ----------------------------------------------------------------------------
;; D. 变量与调用协议
;; ----------------------------------------------------------------------------

(display "====== D. 变量与调用协议 ======") (newline)

(er-run-fatal "D1 调用未定义变量"            (lambda () (er-undefined-variable-xyz)))

;; ----------------------------------------------------------------------------
;; E. 资源极限（doc/manual.md §3.6：非尾递归深度上限 ≈1024 帧）
;; ----------------------------------------------------------------------------

(display "====== E. 资源极限 ======") (newline)

(er-run-fatal "E1 非尾递归2000层超出帧栈"    (lambda () (er-deep 2000)))

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display er_pass)
(display "  FAIL: ") (display er_fail) (newline)
