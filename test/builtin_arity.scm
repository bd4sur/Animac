; builtin_arity.scm —— 内建过程“编译期元数检查”回归用例（工单 #35）
;
; 回归的问题：内建过程（+ - * / mod pow、比较符、谓词、列表操作、IO、call/cc、
; dynamic-wind 等）一律是固定元数（doc/manual.md §6）。旧实现在参数个数不符时
; 依然只为整个调用发射一条 VM 指令——该指令按下标弹出固定个数的操作数，多余参数
; 原样残留在操作数栈上，造成静默的栈污染与错误结果：
;     (display (+ 1 2 3))  ⇒ 显示 5（栈上残留 [1, 5]）
; 修复：编译器在 compile_application 中依 AM_BUILTIN_ARITY_MAP 做元数检查，
; 参数个数不符直接报编译错误（“[Compiler] 编译错误: 内建过程 … 只接受 N 个参数”）。
;
; 本用例覆盖：
;   场景1 合法元数的内建调用照常工作（防止修复过度：把正确程序也拒了）；
;   场景2 同名形参遮蔽内建名时不误判（换名后的 varid 不带内置名，不得报错）；
;   场景3 内建过程作为值经变量间接调用（编译期无法得知元数，保持原行为）；
;   场景4 System.eval 的动态编译路径同样执行元数检查：子进程 eval 非法程序后死亡，
;         父进程观察到“死前标记”而读不到“幸存标记”。编译期矩阵本身由
;         test/errors/11..20 覆盖（testall_errors.sh）。

(native System)

(define ba_pass 0)
(define ba_fail 0)

(define ba_check
  (lambda (name expected actual)
    (if (equal? expected actual)
        (set! ba_pass (+ ba_pass 1))
        {
          (display "FAIL ") (display name)
          (display ": expected=") (display expected)
          (display " actual=") (display actual)
          (newline)
          (set! ba_fail (+ ba_fail 1))
        })))

(define ba_check_undef
  (lambda (name actual)
    (if (undefined? actual)
        (set! ba_pass (+ ba_pass 1))
        {
          (display "FAIL ") (display name)
          (display ": expected=#undefined actual=") (display actual)
          (newline)
          (set! ba_fail (+ ba_fail 1))
        })))

;; ---------------------------------------------------------------------------
;; 场景1：合法元数照常工作
;; ---------------------------------------------------------------------------
(display "====== A. 合法元数（二元算术/比较、一元谓词、列表、IO）======") (newline)

(ba_check "A1  (+) 二元"  3   (+ 1 2))
(ba_check "A2  (-) 二元"  -1  (- 1 2))
(ba_check "A3  (-) 取负惯用法 (- 0 x)" -5 (- 0 5))
(ba_check "A4  (*) 二元"  12  (* 3 4))
(ba_check "A5  (/) 二元"  3.5 (/ 7 2))
(ba_check "A6  (mod) 二元" 1.0 (mod 5 2))
(ba_check "A7  (pow) 二元" 1024.0 (pow 2 10))

(ba_check "A8  (>)"  #t (> 2 1))
(ba_check "A9  (<)"  #t (< 1 2))
(ba_check "A10 (>=)" #t (>= 2 2))
(ba_check "A11 (<=)" #t (<= 2 2))
(ba_check "A12 (==)" #t (== 1 1.0))
(ba_check "A13 链式比较用 and+嵌套" #t (and (< 1 2) (< 2 3)))

(ba_check "A14 (not)"        #t (not #f))
(ba_check "A15 (eq?)"        #t (eq? 'a 'a))
(ba_check "A16 (eqv?)"       #t (eqv? 1 1.0))
(ba_check "A17 (equal?)"     #t (equal? '(1 (2)) '(1 (2))))
(ba_check "A18 (null?)"      #t (null? '()))
(ba_check "A19 (undefined?)" #t (undefined? (get_item '(1) 9)))
(ba_check "A20 (atom?)"      #t (atom? 1))
(ba_check "A21 (list?)"      #t (list? '(1)))
(ba_check "A22 (number?)"    #t (number? 1))
(ba_check "A23 (nan?)"       #t (nan? (mod 1 0)))
(ba_check "A24 (typeof)"     "number" (typeof 1))

(define ba_lst '(1 2 3))
(ba_check "A25 (car)"      1 (car ba_lst))
(ba_check "A26 (cdr)"      '(2 3) (cdr ba_lst))
(ba_check "A27 (cons)"     '(0 1 2 3) (cons 0 ba_lst))
(ba_check "A28 (get_item)" 3 (get_item ba_lst 2))
(ba_check "A29 (length)"   3 (length ba_lst))
(ba_check_undef "A30 (set_item!) 的值" (set_item! ba_lst 0 9))
(ba_check_undef "A31 (push) 的值" (push ba_lst 4))
(ba_check "A32 set_item!/push 副作用" '(9 2 3 4) ba_lst)
(ba_check "A33 (pop)"      4 (pop ba_lst))
(ba_check "A34 pop 副作用" '(9 2 3) ba_lst)

(ba_check_undef "A35 (display) 的值" (display ""))
(ba_check_undef "A36 (newline) 的值" (newline))
(ba_check_undef "A37 废弃 (read) 的值" (read))
(ba_check_undef "A38 废弃 (write) 的值" (write 1 2))

(ba_check "A39 (call/cc) 单参数" 42 (+ 1 (call/cc (lambda (k) (k 41)))))

(define ba_dw_log '())
(dynamic-wind
  (lambda () (push ba_dw_log "bef"))
  (lambda () (push ba_dw_log "body"))
  (lambda () (push ba_dw_log "aft")))
(ba_check "A40 (dynamic-wind) 三参数" '("bef" "body" "aft") ba_dw_log)

;; ---------------------------------------------------------------------------
;; 场景2：同名形参遮蔽内建名，不得误判（换名后的 varid 不带内置名）
;; ---------------------------------------------------------------------------
(display "====== B. 遮蔽内建名的形参不被误判 ======") (newline)

; (+) 被遮蔽为三参数闭包：若元数检查按“拼写”误判，这里会编译失败
(define ba_shadow_plus (lambda (+) (+ 10 20 30)))
(ba_check "B1 遮蔽 + 后调用三参数" 6000 (ba_shadow_plus (lambda (a b c) (* a (* b c)))))

(define ba_shadow_not (lambda (not) (not 7)))
(ba_check "B2 遮蔽 not 后调用一参数" 14 (ba_shadow_not (lambda (x) (* x 2))))

(define ba_shadow_len (lambda (length) (length '(1 2) '(3 4))))
(ba_check "B3 遮蔽 length 后调用二参数" 2 (ba_shadow_len (lambda (a b) (length b))))

; 内建名在遮蔽作用域外仍按内建元数检查（同一程序内两种解释并存）
(ba_check "B4 遮蔽作用域外仍是内建 +" 3 (+ 1 2))

;; ---------------------------------------------------------------------------
;; 场景3：内建过程作为值经变量间接调用（编译期无法得知元数）
;; ---------------------------------------------------------------------------
(display "====== C. 内建过程作为值的间接调用（已知限制）======") (newline)

; 手册未把内建过程定义为可传递的一等过程，但实现允许：push 的是 varid，
; 运行期 call 会再查出 opcode。此类调用点编译期看不到元数，仍不做检查。
; 本组只锁定“合法元数的间接调用不被破坏”。
(define ba_plus +)
(ba_check "C1 间接调用 +（二元）" 3 (ba_plus 1 2))
(define ba_lt <)
(ba_check "C2 间接调用 <（二元）" #t (ba_lt 1 2))

;; ---------------------------------------------------------------------------
;; 场景4：System.eval 的动态编译路径同样做元数检查
;; ---------------------------------------------------------------------------
(display "====== D. System.eval 编译期元数检查（fork 双标记协议）======") (newline)

; 若 eval 出来的非法程序被接受，子进程会写出“幸存标记”2，父进程读到 2 即失败。
(define ba_eval_rejected
  (lambda (name code)
    (define ba_q (System.make_queue 8))
    (define ba_pid (System.fork))
    (if (== 0 ba_pid)
        {
          (System.write ba_q 1 0)
          (System.eval code)
          (System.write ba_q 2 0)
          (System.exit)
        }
        {
          (define ba_m1 (System.read ba_q 5000))
          (define ba_m2 (System.read ba_q 300))
          (ba_check name #t (and (== ba_m1 1) (undefined? ba_m2)))
        })))

(ba_eval_rejected "D1 eval 拒绝 (+ 1 2 3)" "(+ 1 2 3)")
(ba_eval_rejected "D2 eval 拒绝 (- 1)（无一元取负）" "(- 1)")
(ba_eval_rejected "D3 eval 拒绝 (< 1 2 3)" "(< 1 2 3)")
(ba_eval_rejected "D4 eval 拒绝 (cons 1)" "(cons 1)")
(ba_eval_rejected "D5 eval 拒绝 (display 1 2)" "(display 1 2)")
(ba_eval_rejected "D6 eval 拒绝 (call/cc f g)" "(call/cc (lambda (k) k) (lambda (x) x))")

; 合法程序经 eval 后进程存活，且后续求值正常（eval 若被误拒，进程会在此前终止）
(System.eval "(+ 1 2)")
(ba_check "D7 eval 接受合法元数后进程存活" 3 (+ 1 2))

(display "PASS: ") (display ba_pass) (display "  FAIL: ") (display ba_fail) (newline)
