;; stack_balance.scm —— 栈平衡（单值栈纪律）专项测试
;;
;; 依据 doc/todo/stack_bal.md（“方案A：编译期单值纪律”，2026-07 实施）与
;; doc/ISSUES.md #34 编写。单值栈纪律：任何表达式求值结束后恰好在操作数栈上
;; 留下 1 个值；任何语句序列执行完后栈深恢复。语句形式（define/set!/display/
;; newline/push/set_item!/while/单臂 if 假分支/cond 落空/空 begin）的值统一为
;; #undefined。
;;
;; 每个用例输出 ✅ PASS / ❌ FAIL，末尾汇总 PASS/FAIL 计数。

(native System)
(native Table)

(define pass_count 0)
(define fail_count 0)

;; 断言：actual 与 expected 结构/数值相等（equal?）
(define check
  (lambda (name actual expected)
    (if (equal? actual expected)
        { (display "✅ PASS ") (display name) (newline)
          (set! pass_count (+ pass_count 1)) }
        { (display "❌ FAIL ") (display name)
          (display "  expected=") (display expected)
          (display "  actual=") (display actual) (newline)
          (set! fail_count (+ fail_count 1)) })))

;; 断言：actual 为 #undefined
(define check_undef
  (lambda (name actual)
    (check name (undefined? actual) #t)))

;; 供测试使用的多表达式函数体（旧实现会把 1、2 残留在调用方栈上）
(define multi_ret (lambda () 1 2 3))
(define multi_sq  (lambda (x) 1 2 (* x x)))
(define multi_lst (lambda () 1 2 '(7 8 9)))

(define run
  (lambda () {

    (display "====== A. 语句形式的值统一为 #undefined（stack_bal.md §9 实测案例）======") (newline)
    (check_undef "A1  单臂if假分支 (if #f 1)" (if #f 1))
    (check_undef "A2  cond全部落空 (cond (#f 1))" (cond (#f 1)))
    (check_undef "A3  while零迭代 (while #f 1)" (while #f 1))
    (check_undef "A4  空begin (begin)" (begin))
    (check_undef "A5  define的值" (define sb_x 1))
    (check      "A6  define的绑定生效" sb_x 1)
    (check_undef "A7  set!的值" (set! sb_x 2))
    (check      "A8  set!的绑定生效" sb_x 2)
    (check_undef "A9  display的值" (display ""))
    (check_undef "A10 newline的值" (newline))
    (define sb_lst '(1 2 3))
    (check_undef "A11 push的值" (push sb_lst 4))
    (check_undef "A12 set_item!的值" (set_item! sb_lst 0 9))
    (check      "A13 push/set_item!副作用生效" sb_lst '(9 2 3 4))
    (check_undef "A14 废弃read的值" (read))
    (check_undef "A15 废弃write的值" (write 1 2))

    (display "====== B. 语句边界pop：中间结果不残留 ======") (newline)
    (check "B1  begin中间表达式被pop" (+ (begin 1 2) (begin 3 4)) 6)
    (check "B2  begin嵌套空begin" (begin (begin) 42) 42)
    (check "B3  多表达式函数体恰好返回1个值" (+ 10 (multi_ret)) 13)
    (check "B4  多表达式函数体作cons参数" (cons (multi_ret) '(4)) '(3 4))
    ;; ISSUES#34：quasiquote 中解除引用多表达式函数体的调用，不得取到残留值
    (define qq_f (lambda (a) `(,a ,(multi_ret))))
    (check "B5  ISSUES#34 quasiquote不受残留污染" (qq_f 100) '(100 3))
    (check "B6  unquote-splicing多表达式函数体" `(a ,@(multi_lst) b) '(a 7 8 9 b))
    (check_undef "B7  lambda体以define结尾" ((lambda () (define z 9))))
    (check_undef "B8  lambda体以display结尾" ((lambda () (display ""))))
    (check "B9  begin内混用语句形式" (begin (define t 1) (display "") (+ t 41)) 42)

    (display "====== C. 分支/循环各路径栈效应一致 ======") (newline)
    (check      "C1  单臂if真分支" (if #t 7) 7)
    (define if_tail (lambda (x) (if x 1)))
    (check_undef "C2  尾位置单臂if假分支" (if_tail #f))
    (check      "C3  尾位置单臂if真分支" (if_tail 2) 1)
    (define cond_tail (lambda (x) (cond (x 1))))
    (check_undef "C4  尾位置cond落空" (cond_tail #f))
    (check      "C5  尾位置cond命中" (cond_tail 2) 1)
    (check      "C6  仅else的cond" (cond (else 5)) 5)
    (check      "C7  多子句cond落空后命中else" (cond (#f 1) (#f 2) (else 3)) 3)
    (define j 0)
    (while (< j 50) j (set! j (+ j 1)))   ; 循环体含产值表达式j（旧实现逐迭代累积）
    (check "C8  while体产值表达式不污染计数" j 50)
    (check_undef "C9  while循环的值" (while (< j 100) (set! j (+ j 1))))
    (check      "C10 while正常迭代结束" j 100)
    (define i 0)
    (define s 0)
    (while (< i 5) {
      (set! i (+ i 1))
      (define k 0)
      (while #t {
        (set! k (+ k 1))
        (if (== k 3) break)
        (if (== k 2) continue)
        (set! s (+ s k))
      })
    })
    (check "C11 嵌套while与break/continue" s 5)

    (display "====== D. 调用协议精确化（净 -argc+1） ======") (newline)
    (check "D1  两次多表达式调用求和" (+ (multi_sq 2) (multi_sq 3)) 13)
    (check "D2  运算符位置为if（η变换）" ((if #t car cdr) '(1 2)) 1)
    (check "D3  运算符位置为begin（η变换）" ((begin car) '(9 8)) 9)
    (check "D4  立即调用的多表达式lambda" ((lambda (x) 1 2 x) 5) 5)
    (check "D5  深层嵌套调用" (+ (+ (+ (+ (+ 1 1) 1) 1) 1) 1) 6)
    (define sum_nat (lambda (n) (if (== n 0) 0 (+ n (sum_nat (- n 1))))))
    (check "D6  非尾递归求和(500)" (sum_nat 500) 125250)

    (display "====== E. 尾递归在opstack上恒界（回归保障） ======") (newline)
    (define loop_multi (lambda (n) 1 2 (if (== n 0) 0 (loop_multi (- n 1)))))
    (check "E1  多语句函数体尾递归(100000层)" (loop_multi 100000) 0)
    (define sum_iter (lambda (n acc) (if (== n 0) acc (sum_iter (- n 1) (+ n acc)))))
    (check "E2  尾递归累加(100000)" (sum_iter 100000 0) 5000050000)

    (display "====== F. call/cc 与 dynamic-wind 交互 ======") (newline)
    (check "F1  call/cc基本 escape" (+ 1 (call/cc (lambda (k) (k 41)))) 42)
    (check "F2  多表达式thunk中escape" (call/cc (lambda (k) 1 2 (k 7) 8)) 7)
    (check "F3  不调用续体时取thunk末值" (call/cc (lambda (k) 1 2 9)) 9)
    (define dw_log '())
    (define dw_result
      (dynamic-wind
        (lambda () (push dw_log 'b) 1)
        (lambda () (push dw_log 't) 2 3 42)
        (lambda () (push dw_log 'a) 4)))
    (check "F4  dynamic-wind返回thunk末值" dw_result 42)
    (check "F5  dynamic-wind执行顺序" dw_log '(b t a))

    (display "====== G. 语句型native函数返回 #undefined（stack_bal.md §12） ======") (newline)
    (check_undef "G1  System.clear_timeout" (System.clear_timeout 0))
    (check_undef "G2  System.clear_interval" (System.clear_interval 0))
    (check_undef "G3  System.eval" (System.eval "1"))
    (check      "G4  System.kill无效PID（表达式型不变）" (System.kill 99999) #f)
    (define sb_tbl (Table.make))
    (check_undef "G5  Table.set" (Table.set sb_tbl "k" 1))
    (check_undef "G6  Table.delete" (Table.delete sb_tbl "k"))
    (check      "G7  Table.get缺失键" (Table.get sb_tbl "k") #undefined)

    (display "====== H. 既有形式不变量 ======") (newline)
    (check "H1  (and) 恒#t" (and) #t)
    (check "H2  (or) 恒#f" (or) #f)
    (check "H3  (and 1 2) 恒#t" (and 1 2) #t)
    (check "H4  (or #f 3) 恒#t" (or #f 3) #t)
    (check "H5  quasiquote拼接空列表被吸收" `(a ,@'() b) '(a b))
    (check "H6  quasiquote多重拼接" `(,@'(1 2) ,@'(3 4)) '(1 2 3 4))

    (display "====== 栈平衡测试汇总 ======") (newline)
    (display "PASS: ") (display pass_count)
    (display "  FAIL: ") (display fail_count) (newline)
  }))
