;;; test_dw_complex_macro.scm
;;; 目标：验证宏展开后的 dynamic-wind + call/cc 仍能正确执行 wind 调整。
;;;
;;; 设计思路：
;;;   1. 用 syntax-rules 定义宏 with-cleanup，把 body 包装在 dynamic-wind 中。
;;;   2. 在宏展开的 thunk 内使用 call/cc 捕获一个“跳出再跳回”的续体。
;;;   3. 在动态作用域外调用该续体，应触发：after thunk -> before thunk -> 恢复执行 -> after thunk。
;;;   4. 通过全局列表记录 before/after 执行顺序，和预期比较。
;;;
;;; 注意：本测试有意把预期列表用 cons 在运行时构造，而不是用 quote 直接写死。
;;;       这是因为当前宏展开器在模板中使用了 'in / 'out 后，
;;;       若在同一顶层再出现包含相同符号的 quote 列表，会触发一个已知的
;;;       AST 节点共享 bug（报错 "invalid let-syntax bindings"）。

(define log '())

(define-syntax with-cleanup
  (syntax-rules ()
    ((_ body)
     (dynamic-wind
       (lambda () (set! log (cons 'in log)))
       (lambda () body)
       (lambda () (set! log (cons 'out log)))))))

(define esc #f)

(with-cleanup
  (begin
    (call/cc (lambda (k) (set! esc k)))
    'body-done))

;; esc 现在持有“跳出 with-cleanup 后再返回”的续体。
;; 调用它一次，应该看到一对额外的 out / in，最后再以 out 结束。
(if esc
    ((lambda (k)
       (set! esc #f)            ; 防止返回后再次误调用
       (k 'again))              ; 先触发 after，再触发 before，然后恢复执行
     esc)
    'no-esc)

;; 预期日志（按 cons 累积顺序显示）: (out in out in)
;; 用运行时 cons 构造，避开上述 quote 节点共享问题。
(define expected (cons 'out (cons 'in (cons 'out (cons 'in '())))))

(display "log: ") (display log) (newline)
(if (equal? log expected)
    (begin (display "✅ PASS complex-macro") (newline))
    (begin (display "❌ FAIL complex-macro: expected ") (display expected)
           (display " but got ") (display log) (newline)))
