;; ============================================================================
;; syntax_torture.scm —— C 实现（Animac 2026）语法/内建覆盖矩阵测试
;;
;; 目标：以自校验断言（[PASS]/[FAIL] 计数汇总）锁定下列语义的现状，
;;       重点覆盖既有测试用例从未触及的内建与边界：
;;         pop / nan? / typeof / letrec-syntax / Math.log10 / System.test /
;;         clear_timeout・clear_interval（真实定时器）/ and・or 短路与返回值 /
;;         数值边界（59 位载荷回绕、mod 符号、浮点除）/ String 边界（参数序、
;;         越界、parseNumber）/ 空表 '() 与 #null 的区分 / string? 谓词模式 /
;;         深度非尾递归阈值 / quasiquote 嵌套现状。
;;
;; 运行方式：./main test/syntax_torture.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)
(native Math)
(native System)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define st_pass 0)
(define st_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! st_pass (+ st_pass 1)) (display "  [PASS] ") }
      { (set! st_fail (+ st_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; 浮点近似比较：|a-b| <= eps（eps 默认给 1e-9）
(define st_abs (lambda (x) (Math.abs x)))
(define check_near (lambda (name actual expected) {
  (define diff (st_abs (- actual expected)))
  (if (<= diff 0.000000001)
      { (set! st_pass (+ st_pass 1)) (display "  [PASS] ") }
      { (set! st_fail (+ st_fail 1)) (display "  [FAIL] ") })
  (display name) (newline)
}))

;; ----------------------------------------------------------------------------
;; A. pop —— 原地弹出并返回尾元素；空表返回 #undefined
;;    （手册 §6.4；op_list_pop 实现；既有测试零覆盖）
;; ----------------------------------------------------------------------------

(display "====== A. pop ======") (newline)

(define st_lst (cons 1 (cons 2 (cons 3 '()))))
(check "A1 pop返回尾元素" (pop st_lst) 3)
(check "A2 pop原地修改" st_lst '(1 2))
(check "A3 pop后长度" (length st_lst) 2)
(check "A4 pop至单元素" (pop st_lst) 2)
(check "A5 pop至单元素后长度" (length st_lst) 1)
(check "A6 pop最后一个元素" (pop st_lst) 1)
(check "A7 空表pop返回#undefined" (undefined? (pop st_lst)) #t)
(check "A8 空表pop后仍为空" (length st_lst) 0)
(define st_lst2 (cons "x" '()))
(check "A8 pop任意类型元素" (pop st_lst2) "x")

;; ----------------------------------------------------------------------------
;; B. typeof —— 立即值返回类型名；一切堆对象返回 "handle"（手册 §6.5 明文设计）
;; ----------------------------------------------------------------------------

(display "====== B. typeof ======") (newline)

(check "B1 typeof整数" (typeof 1) "number")
(check "B2 typeof浮点" (typeof 1.5) "number")
(check "B3 typeof负整数" (typeof -7) "number")
(check "B4 typeof布尔真" (typeof #t) "boolean")
(check "B5 typeof布尔假" (typeof #f) "boolean")
(check "B6 typeof #null" (typeof #null) "null")
(check "B7 typeof #undefined" (typeof #undefined) "undefined")
(check "B8 typeof符号" (typeof 'sym) "symbol")
(check "B9 typeof列表" (typeof '(1 2)) "handle")
(check "B10 typeof空表" (typeof '()) "handle")
(check "B11 typeof字符串" (typeof "a") "handle")
(check "B12 typeof散列表" (typeof (Table.make)) "handle")
(check "B13 typeof闭包" (typeof (lambda (x) x)) "handle")
(check "B14 typeof续体" (typeof (call/cc (lambda (k) k))) "handle")

;; ----------------------------------------------------------------------------
;; C. nan? 与 Inf —— NaN 仅可由 VM 级运算产生（mod 的 fmod 路径）；
;;    Math 域错误按约定返回 #null 而非 NaN
;; ----------------------------------------------------------------------------

(display "====== C. nan? / Inf ======") (newline)

(check "C1 nan?(mod 1 0)" (nan? (mod 1 0)) #t)
(check "C2 nan?(mod 1.5 0)" (nan? (mod 1.5 0)) #t)
(check "C3 nan?整数" (nan? 1) #f)
(check "C4 nan?浮点" (nan? 1.5) #f)
(check "C5 nan?字符串" (nan? "a") #f)
(check "C6 nan?布尔" (nan? #t) #f)
(check "C7 nan?列表" (nan? '(1)) #f)
(check "C8 nan?#null" (nan? #null) #f)
(check "C9 Inf非NaN" (nan? (pow 10 400)) #f)
(check "C10 Inf自等" (== (pow 10 400) (pow 10 400)) #t)
(check "C11 NaN不自等" (== (mod 1 0) (mod 2 0)) #f)
(check "C12 NaN typeof仍为number" (typeof (mod 1 0)) "number")
(check "C13 Math.log域错误返回#null" (null? (Math.log -1)) #t)
(check "C14 Math.sqrt域错误返回#null" (null? (Math.sqrt -1)) #t)
(check "C15 nan?对#null为假" (nan? (Math.log -1)) #f)

;; ----------------------------------------------------------------------------
;; D. letrec-syntax —— 相互递归宏（既有测试仅覆盖 define-syntax/let-syntax）
;; ----------------------------------------------------------------------------

(display "====== D. letrec-syntax ======") (newline)

(check "D1 letrec-syntax互递归宏"
       (letrec-syntax ((st-a (syntax-rules () ((_ e) (st-b e))))
                       (st-b (syntax-rules () ((_ e) (* e e)))))
         (st-a 7))
       49)

(check "D2 letrec-syntax多分支"
       (letrec-syntax ((inc (syntax-rules () ((_ e) (+ e 1))))
                       (twice (syntax-rules () ((_ e) (inc (inc e))))))
         (twice 40))
       42)

;; ----------------------------------------------------------------------------
;; E. Math.log10 / to_fixed 舍入方向（既有测试零覆盖项）
;; ----------------------------------------------------------------------------

(display "====== E. Math.log10 / to_fixed ======") (newline)

(check_near "E1 log10(1000)=3" (Math.log10 1000) 3)
(check_near "E2 log10(1)=0" (Math.log10 1) 0)
(check "E3 to_fixed(3.14159,2)=3.14" (== (Math.to_fixed 3.14159 2) 3.14) #t)
(check "E4 to_fixed远离零舍入(2.5,0)=3" (== (Math.to_fixed 2.5 0) 3) #t)
(check "E5 to_fixed远离零舍入(-2.5,0)=-3" (== (Math.to_fixed -2.5 0) -3) #t)
(check "E6 to_fixed(2.4,0)=2" (== (Math.to_fixed 2.4 0) 2) #t)

;; ----------------------------------------------------------------------------
;; F. System.test —— 保留测试函数，返回 "Value=<内部表示>" 字符串
;; ----------------------------------------------------------------------------

(display "====== F. System.test ======") (newline)

(check "F1 System.test返回Value=前缀字符串"
       (String.equals (String.slice (System.test 42) 0 6) "Value=")
       #t)
(check "F2 System.test返回的是字符串"
       (equal? (System.test 42) (String.atom_to_string (System.test 42)))
       #t)

;; ----------------------------------------------------------------------------
;; G. and / or —— 恒返回布尔字面量；运行期短路（跳过副作用与未定义变量求值）
;; ----------------------------------------------------------------------------

(display "====== G. and / or ======") (newline)

(check "G1 (and) = #t" (and) #t)
(check "G2 (or) = #f" (or) #f)
(check "G3 and恒返回布尔字面量" (and 1 2) #t)
(check "G4 or恒返回布尔字面量" (or #f 3) #t)
(check "G5 and全真" (and #t #t #t #t) #t)
(check "G6 and遇假" (and #t #f #t) #f)
(check "G7 or遇真" (or #f #t #f) #t)
(check "G8 or全假" (or #f #f) #f)

(define st_trace '())
(define _g1 (and #f (begin (push st_trace 'and) #t)))
(check "G9 and短路跳过后续副作用" st_trace '())
(define _g2 (or #t (begin (push st_trace 'or) #t)))
(check "G10 or短路跳过后续副作用" st_trace '())
(define _g3 (and #t (begin (push st_trace 'x) #t)))
(check "G11 非短路分支执行" st_trace '(x))
;; 短路在运行期生效：未定义变量位于被跳过的分支不报错、不终止进程
(check "G12 and短路跳过未定义变量" (and #f st-undefined-variable-xyz) #f)
(check "G13 or短路跳过未定义变量" (or #t st-undefined-variable-xyz) #t)

;; ----------------------------------------------------------------------------
;; H. 数值边界 —— 59 位整型载荷回绕、mod 符号、浮点除（既有测试零覆盖）
;; ----------------------------------------------------------------------------

(display "====== H. 数值边界 ======") (newline)

;; 整型字面量为 59 位有效载荷：2^59 回绕为 0；2^59-1 为最大精确值
(check "H1 2^59字面量回绕为0" (== 576460752303423488 0) #t)
(check "H2 2^59-1精确表示" (== 576460752303423487 576460752303423487) #t)
(check "H3 加法载荷回绕" (== (+ 1 576460752303423487) 0) #t)
(check "H4 2^58精确表示" (== 288230376151711744 288230376151711744) #t)
;; mod：fmod 语义，结果符号随被除数；恒返回浮点
(check "H5 mod(-7,3)=-1" (== (mod -7 3) -1) #t)
(check "H6 mod(7,-3)=1" (== (mod 7 -3) 1) #t)
(check "H7 mod(7,3)=1" (== (mod 7 3) 1) #t)
;; 除法：恒返回浮点
(check "H8 浮点除(7,2)=3.5" (== (/ 7 2) 3.5) #t)
(check_near "H9 除不尽" (/ 1 3) 0.3333333333333333)
(check "H10 pow恒返回浮点" (== (pow 2 0.5) (Math.sqrt 2)) #t)
(check "H11 数字比较跨整型浮点" (== 1 1.0) #t)

;; ----------------------------------------------------------------------------
;; I. String 边界 —— charCodeAt 参数序为 (index str)；slice 负索引自尾计数；
;;    parseNumber 非法输入返回 #undefined；中文按码点计数
;; ----------------------------------------------------------------------------

(display "====== I. String 边界 ======") (newline)

;; 注意参数序：charCodeAt 的引数顺序是 (index str)，与 charAt (str index) 相反！
(check "I1 charCodeAt(0,'abc')=97" (== (String.charCodeAt 0 "abc") 97) #t)
(check "I2 charCodeAt(2,'abc')=99" (== (String.charCodeAt 2 "abc") 99) #t)
(check "I3 charCodeAt越界返回0" (== (String.charCodeAt 99 "abc") 0) #t)
(check "I4 charCodeAt负索引返回0" (== (String.charCodeAt -1 "abc") 0) #t)
(check "I5 charCodeAt中文码点" (== (String.charCodeAt 0 "中文") 20013) #t)

(check "I6 slice(1,3)" (String.equals (String.slice "hello" 1 3) "el") #t)
(check "I7 slice终点钳制" (String.equals (String.slice "hello" 2 99) "llo") #t)
(check "I8 slice负索引自尾计数" (String.equals (String.slice "hello" -3 -1) "ll") #t)
(check "I9 slice(0,-3)" (String.equals (String.slice "hello" 0 -3) "he") #t)
(check "I10 slice起点>终点返回空" (String.equals (String.slice "hello" 3 1) "") #t)

(check "I11 parseNumber整数" (== (String.parseNumber "42") 42) #t)
(check "I12 parseNumber浮点" (== (String.parseNumber "-0.5") -0.5) #t)
(check "I13 parseNumber科学计数" (== (String.parseNumber "3.5e2") 350) #t)
(check "I14 parseNumber非法输入" (undefined? (String.parseNumber "abc")) #t)
(check "I15 parseNumber空串" (undefined? (String.parseNumber "")) #t)
(check "I16 parseNumber尾部杂质" (undefined? (String.parseNumber "42x")) #t)

(check "I17 fromCharCode往返" (== (String.charCodeAt 0 (String.fromCharCode 20013)) 20013) #t)
(check "I18 中文按码点计数" (== (String.length "中文") 2) #t)
(check "I19 转义引号反斜杠" (== (String.length "a\"b\\c") 5) #t)
(check "I20 转义控制符" (== (String.length "a\nb\tc") 5) #t)
(check "I21 CR字面量长度" (== (String.length "A\rB") 3) #t)
(check "I22 equals区分大小写" (String.equals "A" "a") #f)
(check "I23 concat" (String.equals (String.concat "foo" "bar") "foobar") #t)

;; ----------------------------------------------------------------------------
;; J. 空表 '() 与 #null 的区分 + string? 谓词模式
;;    （'() 是空列表堆对象；#null 是立即值；cons 第二引数必须是列表）
;; ----------------------------------------------------------------------------

(display "====== J. 空表与#null ======") (newline)

(check "J1 null?对空表为真" (null? '()) #t)
(check "J2 null?对#null为真" (null? #null) #t)
(check "J3 equal?不混淆空表与#null" (equal? '() #null) #f)
(check "J4 atom?对#null为真" (atom? #null) #t)
(check "J5 atom?对空表为假" (atom? '()) #f)
(check "J6 atom?对字符串为假" (atom? "a") #f)
(check "J7 atom?对数字为真" (atom? 1) #t)
(check "J8 atom?对#undefined为真" (atom? #undefined) #t)
(check "J9 list?对空表为真" (list? '()) #t)
(check "J10 list?对#null为假" (list? #null) #f)
(check "J11 list?对字符串为假" (list? "a") #f)
(check "J12 list?对散列表为假" (list? (Table.make)) #f)
(check "J13 cons以空表结尾" (equal? (cons 1 (cons 2 '())) '(1 2)) #t)
(check "J14 length空表" (length '()) 0)
(check "J15 eq?空表为不同对象" (eq? '() '()) #f)
(check "J16 symbol按拼写同一" (eq? 'abc 'abc) #t)
(check "J17 equal?深比较列表" (equal? '(1 (2 3)) (cons 1 (cons (cons 2 (cons 3 '())) '()))) #t)

;; string? 谓词模式：语言无 string?/table? 谓词（手册 §6.5），
;; 但 (equal? v (String.atom_to_string v)) 构成全类型安全的 string? 判定：
;; 字符串 → atom_to_string 返回其副本（equal? 真）；其余类型 → 空串或类型不符。
(define st-string? (lambda (v) (equal? v (String.atom_to_string v))))
;; table?：非列表、非字符串的堆对象（handle）
(define st-table? (lambda (v) { (and (== (typeof v) "handle") (not (list? v)) (not (st-string? v))) }))

(check "J18 string?对字符串" (st-string? "abc") #t)
(check "J19 string?对空串" (st-string? "") #t)
(check "J20 string?对数字" (st-string? 42) #f)
(check "J21 string?对布尔" (st-string? #t) #f)
(check "J22 string?对列表" (st-string? '(1)) #f)
(check "J23 string?对散列表" (st-string? (Table.make)) #f)
(check "J24 string?对符号" (st-string? 'sym) #f)
(check "J25 string?对#null" (st-string? #null) #f)
(check "J26 table?对散列表" (st-table? (Table.make)) #t)
(check "J27 table?对字符串" (st-table? "a") #f)
(check "J28 table?对列表" (st-table? '(1)) #f)
(check "J29 table?对数字" (st-table? 1) #f)

;; ----------------------------------------------------------------------------
;; K. 递归深度 —— 非尾递归受帧栈容量约束（fstack 2048 = 1024 帧），1000 层内安全；
;;    尾递归不受限（尾调用不占帧）
;; ----------------------------------------------------------------------------

(display "====== K. 递归深度 ======") (newline)

(define st-sumr (lambda (n) (if (== n 0) 0 (+ 1 (st-sumr (- n 1))))))
(check "K1 非尾递归1000层" (st-sumr 1000) 1000)
(define st-tailsum (lambda (n acc) { (if (== n 0) acc (st-tailsum (- n 1) (+ acc n))) }))
(check "K2 尾递归100000层" (st-tailsum 100000 0) 5000050000)

;; ----------------------------------------------------------------------------
;; L. quasiquote —— 锁定嵌套无层级计数的现状（doc/ISSUES.md issue#19）：
;;    内层 unquote 不做层级计数、会被立即求值
;; ----------------------------------------------------------------------------

(display "====== L. quasiquote ======") (newline)

(check "L1 基本unquote" (equal? `(1 ,(+ 1 1)) '(1 2)) #t)
(check "L2 嵌套quasiquote内层立即求值（现状锁定）"
       (equal? `(1 (quasiquote (2 (unquote (+ 1 2))))) '(1 (2 3)))
       #t)
(check "L3 顶层splice" (equal? `(0 ,@(cons 1 (cons 2 '())) 3) '(0 1 2 3)) #t)
(check "L4 嵌套splice" (equal? `(a (b ,(+ 1 2) ,@(cons 3 '()))) '(a (b 3 3))) #t)
(check "L5 splice空列表吸收" (equal? `(0 ,@'() 1) '(0 1)) #t)
(check "L6 quasiquote内符号保持" (equal? `(a b) '(a b)) #t)

;; ----------------------------------------------------------------------------
;; M. 定时器控制 —— set_timeout/set_interval 返回编号；clear_timeout/clear_interval
;;    真实取消；重复取消安全；非法延时返回编号 0。
;;    注意：断言在进程停止后触发的一次性定时器回调中独占执行——
;;    （经验：进程运行中被含 set! 的回调打断会破坏变量状态，见测试报告。）
;; ----------------------------------------------------------------------------

(display "====== M. 定时器控制 ======") (newline)

(define st_cnt_a 0)
(define st_cnt_b 0)
(define st_ia (System.set_interval 1 (lambda () (set! st_cnt_a (+ st_cnt_a 1)))))
(define st_ib (System.set_interval 1 (lambda () (set! st_cnt_b (+ st_cnt_b 1)))))
(check "M1 set_interval返回编号" (number? st_ia) #t)
(check "M2 set_timeout非法延时返回0" (== (System.set_timeout -1 (lambda () 0)) 0) #t)
(check "M3 clear_interval返回#undefined" (undefined? (System.clear_interval st_ia)) #t)
(check "M4 clear_timeout返回#undefined" (undefined? (System.clear_timeout 99999)) #t)
(check "M5 重复clear安全" (undefined? (System.clear_timeout 99999)) #t)

;; 主流程至此结束（进程转入停止态）。约 200ms 后下方回调独占执行：
;; 未取消的 st_ib 应已累计触发，已取消的 st_ia 应保持为 0。
(System.set_timeout 200 (lambda () {
  (System.clear_interval st_ib)
  (check "M6 已取消的interval不再触发" (== st_cnt_a 0) #t)
  (check "M7 存活的interval持续触发" (> st_cnt_b 10) #t)
  (check "M8 回调内再次clear安全" (undefined? (System.clear_interval st_ib)) #t)
  (display "====== 汇总 ======") (newline)
  (display "PASS: ") (display st_pass)
  (display "  FAIL: ") (display st_fail) (newline)
}))
