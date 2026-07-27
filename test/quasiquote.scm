
;; 准引用列表（quasiquote）与 unquote-splicing（,@）

(native System)

;; 断言计数器：任何一项断言失败都会使 qq-fail-count 增加，
;; run 末尾据此输出 ✅ PASS qq 或 ❌ FAIL qq
(define qq-fail-count 0)

(define check
  (lambda (expected actual)
    (if (not (equal? expected actual))
        (set! qq-fail-count (+ qq-fail-count 1))
        #t)))

;; 供 unquote-splicing 用例使用的宏（宏定义须在模块顶层）
;; 宏展开生成含 ,@ 的 quasiquote（模式变量在 quasiquote 模板中替换）
(define-syntax spl
  (syntax-rules ()
    ((spl x) `(a ,@x b))))

;; 宏展开生成含 ,@ 的 quasiquote（模板自由变量引用宏定义处的全局绑定）
(define gxs '(5 6))
(define-syntax gspl
  (syntax-rules ()
    ((gspl) `(,@gxs end))))

(define printf
  (lambda (template)
    (cond ((null? template) #f)
          ((not (list? template)) (display template))
          (else {
              (display (car template))
              (printf (cdr template))
          }))))

(define run
  (lambda () {
    (display "准引用列表（quasiquote）测试：")(newline)

    (define a 100)
    (define qq `("a=${" ,(car `((a ,(* a 2) ,a) 1 a ,a ,(* a a))) "}"))

    (display "期望输出：(100)")(newline)
    (display "实际输出：")
    (display `(,'a))
    (newline)
    (check '(100) `(,'a))

    (display "期望输出：(a)")(newline)
    (display "实际输出：")
    (display `('a))
    (newline)
    (check '(a) `('a))

    (display "期望输出：(100)")(newline)
    (display "实际输出：")
    (display `(,a))
    (newline)
    (check '(100) `(,a))

    ;; 直接输出
    (display "期望输出：a=${(a 200 100)}")(newline)
    (display "实际输出：")
    (printf qq)
    (newline)
    (check '("a=${" (a 200 100) "}") qq)

    ;; 准引用列表里面的unquote也应该是词法作用域的。
    (display "期望输出：a=${(a 200 100)}")(newline)
    (display "实际输出：")
    ((lambda (a) (printf qq) (newline)) 200)

    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ;; 以下是故障单#16的测试用例

    (define foo (lambda (a lst) (cons `(,a) lst)))
    (define lst '())

    (set! lst (foo 100 lst))
    (display "期望输出：((100))")(newline)
    (display "实际输出：")
    (display lst)(newline)
    (check '((100)) lst)

    (set! lst (foo 200 lst))
    (display "期望输出：((200) (100))")(newline)
    (display "实际输出：")
    (display lst)(newline)
    (check '((200) (100)) lst)

    (newline)

    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ;; 以下是 unquote-splicing（,@）的测试用例

    (display "unquote-splicing（,@）测试：")(newline)

    (define xs '(1 2 3))
    (define ys '(4 5))

    ;; 1. 基本拼接：中间位置
    (display "期望输出：(a 1 2 3 b)")(newline)
    (display "实际输出：")(display `(a ,@xs b))(newline)
    (check '(a 1 2 3 b) `(a ,@xs b))

    ;; 2. 头部拼接
    (display "期望输出：(1 2 3 a)")(newline)
    (display "实际输出：")(display `(,@xs a))(newline)
    (check '(1 2 3 a) `(,@xs a))

    ;; 3. 尾部拼接
    (display "期望输出：(a 1 2 3)")(newline)
    (display "实际输出：")(display `(a ,@xs))(newline)
    (check '(a 1 2 3) `(a ,@xs))

    ;; 4. 空列表拼接（应被完全吸收）
    (display "期望输出：(a b)")(newline)
    (display "实际输出：")(display `(a ,@'() b))(newline)
    (check '(a b) `(a ,@'() b))

    ;; 空 quasiquote 列表的显示形态为 '()
    (display "期望输出：'()")(newline)
    (display "实际输出：")(display `(,@'()))(newline)
    (check '() `(,@'()))

    ;; 5. 多段拼接
    (display "期望输出：(1 2 3 4 5)")(newline)
    (display "实际输出：")(display `(,@xs ,@ys))(newline)
    (check '(1 2 3 4 5) `(,@xs ,@ys))

    ;; 6. 多段拼接与普通元素混合
    (display "期望输出：(1 2 3 0 4 5)")(newline)
    (display "实际输出：")(display `(,@xs 0 ,@ys))(newline)
    (check '(1 2 3 0 4 5) `(,@xs 0 ,@ys))

    ;; 7. (unquote-splicing X) 关键字形式，与 ,@X 等价
    (display "期望输出：(a 1 2 3 b)")(newline)
    (display "实际输出：")(display `(a (unquote-splicing xs) b))(newline)
    (check '(a 1 2 3 b) `(a (unquote-splicing xs) b))

    ;; 8. 拼接动态计算的表达式
    (display "期望输出：(0 1 2)")(newline)
    (display "实际输出：")(display `(0 ,@(cons 1 (cons 2 '()))))(newline)
    (check '(0 1 2) `(0 ,@(cons 1 (cons 2 '()))))

    ;; 9. 嵌套列表作为被拼接列表的元素，结构应保持
    (define xss '((1 2) (3)))
    (display "期望输出：(a (1 2) (3))")(newline)
    (display "实际输出：")(display `(a ,@xss))(newline)
    (check '(a (1 2) (3)) `(a ,@xss))

    ;; 10. 模板顶层 ,@（本解释器宽松语义：把 xs 的元素拼成新列表）
    (display "期望输出：(1 2 3)")(newline)
    (display "实际输出：")(display `(,@xs))(newline)
    (check '(1 2 3) `(,@xs))

    ;; 11. 词法作用域：qs 在 xs='(1 2 3) 的词法环境中定义，
    ;;     内层同名形参不应影响 qs 中 ,@xs 的取值
    (define qs `(,@xs z))
    (display "期望输出：(1 2 3 z)")(newline)
    (display "实际输出：")((lambda (xs) (display qs)) '(9 9))(newline)
    (check '(1 2 3 z) qs)

    ;; 12. 嵌套 quasiquote（本解释器既有语义：内层 ,@ 随内层求值展开）
    (display "期望输出：(a (b 1 2 3) 1 2 3)")(newline)
    (display "实际输出：")(display `(a `(b ,@xs) ,@xs))(newline)
    (check '(a (b 1 2 3) 1 2 3) `(a `(b ,@xs) ,@xs))

    ;; 13. 拼接函数调用返回的列表
    (define mk (lambda (n) (cond ((== n 0) '()) (else (cons n (mk (- n 1)))))))
    (display "期望输出：(3 2 1)")(newline)
    (display "实际输出：")(display `(,@(mk 3)))(newline)
    (check '(3 2 1) `(,@(mk 3)))

    ;; 14. 拼接结果与 unquote 混合
    (display "期望输出：(100 1 2 3 200)")(newline)
    (display "实际输出：")(display `(,(car '(100)) ,@xs ,(* 100 2)))(newline)
    (check '(100 1 2 3 200) `(,(car '(100)) ,@xs ,(* 100 2)))

    ;; 15. 大列表拼接（触发运行时列表多次扩容，检验元素值拷贝路径）
    (define big (mk 200))
    (display "期望输出：#t 205")(newline)
    (display "实际输出：")(display (equal? `(,@big) big))(display " ")(display (length `(,@xs ,@big ,@ys)))(newline)
    (check #t (equal? `(,@big) big))
    (check 205 (length `(,@xs ,@big ,@ys)))

    ;; 16. 宏展开生成含 ,@ 的 quasiquote（模式变量在 quasiquote 模板中替换）
    (display "期望输出：(a 7 8 b)")(newline)
    (display "实际输出：")(display (spl '(7 8)))(newline)
    (check '(a 7 8 b) (spl '(7 8)))

    ;; 17. 宏展开生成含 ,@ 的 quasiquote（模板自由变量引用宏定义处的全局绑定）
    (display "期望输出：(5 6 end)")(newline)
    (display "实际输出：")(display (gspl))(newline)
    (check '(5 6 end) (gspl))

    ;; 18. 重复执行产生独立实例（故障单#16同类回归：多次求值互不影响）
    (define foo2 (lambda (a lst) (cons `(,@'(0) ,a) lst)))
    (define lst2 '())
    (set! lst2 (foo2 100 lst2))
    (display "期望输出：((0 100))")(newline)
    (display "实际输出：")(display lst2)(newline)
    (check '((0 100)) lst2)
    (set! lst2 (foo2 200 lst2))
    (display "期望输出：((0 200) (0 100))")(newline)
    (display "实际输出：")(display lst2)(newline)
    (check '((0 200) (0 100)) lst2)

    ;; 19. System.eval 动态执行含 ,@ 的代码（eval 重新走 词法→语法→编译 全链路）。
    ;;     注：System.eval 返回 void 且仅捕获进程顶级变量绑定（模块顶层变量不可见），
    ;;     无法将结果送回 check，故比较在 eval 字符串内部完成并直接显示布尔结果。
    (display "期望输出：#t")(newline)
    (display "实际输出：")(System.eval "(display (equal? `(a ,@'(1 2) b) '(a 1 2 b)))")(newline)

    (newline)

    ;; 汇总：全部断言通过输出 ✅ PASS qq，否则输出 ❌ FAIL qq
    (if (== qq-fail-count 0)
        (display "✅ PASS qq\n")
        (display "❌ FAIL qq\n"))

  })
)
