(native System)

; 辅助断言：数值相等则输出 PASS，否则输出 FAIL
(define check
  (lambda (name expected actual)
    (display name)
    (display ": ")
    (if (== expected actual)
        (display "PASS")
        (begin
          (display "FAIL expected ")
          (display expected)
          (display " got ")
          (display actual)))
    (newline)))

; ============ 1. 卫生宏：宏内部生成的绑定不应捕获外部同名变量 ============
(define tmp 1000)
(define-syntax my-or
  (syntax-rules ()
    ((_ a b)
     ((lambda (tmp) (if tmp tmp b)) a))))
(check "T1 hygiene-macro" 42 (my-or #f 42))
(check "T1 outer-tmp-unchanged" 1000 tmp)

; ============ 2. syntax-rules 字面量与 ellipsis ============
(define-syntax my-when
  (syntax-rules (else)
    ((_ test e1 e2 ...) (if test (begin e1 e2 ...) #f))
    ((_ else e1 e2 ...) (begin e1 e2 ...))))
(check "T2 literal-else" 7 (my-when else 7))
(my-when #t (display "T2 ellipsis body OK") (newline))

; ============ 3. call/cc 基础 ============
(define cc-val
  (call/cc (lambda (k) (k 123) 456)))
(check "T3 call/cc" 123 cc-val)

; ============ 4. System.eval 访问宿主顶级变量 ============
(define host-x 10)
(System.eval "(display \"T4 eval host-x: \") (display host-x) (newline)")

; ============ 5. System.eval 输入字符串中的双引号、换行、反斜杠转义 ============
(System.eval "(display \"T5 eval quote: \\\"ok\\\"\") (newline)")
(System.eval "(display \"T5 eval newline:\\nline2\\n\") (newline)")
(System.eval "(display \"T5 eval backslash: \\\\ \") (newline)")

; ============ 6. System.eval 内部使用 call/cc ============
(System.eval "(define r (call/cc (lambda (k) (k 777) 888))) (check \"T6 eval-call/cc\" 777 r)")

; ============ 7. 宿主宏展开为 System.eval 调用 ============
(define-syntax eval-code
  (syntax-rules ()
    ((_ str) (System.eval str))))
(System.eval "(display \"T7 macro-to-eval\") (newline)")

; ============ 8. 宿主宏展开为 call/cc 调用 ============
(define-syntax escape-with
  (syntax-rules ()
    ((_ v) (call/cc (lambda (k) (k v))))))
(check "T8 macro-to-call/cc" 555 (escape-with 555))

; ============ 9. 宏 + call/cc + System.eval 三者组合 ============
(define-syntax remote-cc
  (syntax-rules ()
    ((_ v)
     (call/cc (lambda (k)
                (System.eval "(display \"T9 macro+call/cc+eval: Eval OK\") (newline)")
                (k v))))))
(check "T9 macro+call/cc+eval" 42 (remote-cc 42))

; ============ 10. let-syntax 局部宏 + 宿主顶级变量 + eval 捕获 ============
(define base 100)
(let-syntax ((local-inc (syntax-rules () ((_ x) (+ x 1)))))
  (System.eval "(display \"T10 let-syntax+eval: \") (display (+ base 1)) (newline)")
  (check "T10 local-inc" 101 (local-inc base)))
