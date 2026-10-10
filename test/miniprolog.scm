;; ============================================================================
;; miniprolog.scm —— 纯 Scheme 迷你 Prolog 求值器（C 版 Animac 大型实用性测试）
;;
;; 实现：
;;   - 项表示：常量为 symbol/number/字符串；变量为 (v "名字") 形式的二元素列表；
;;   - 知识库：Table——谓词名(symbol) → 事实列表；谓词名 → 规则列表
;;     （规则 = (头 目标1 目标2 ...)）；
;;   - 合一：walk（变量链解引用）+ unify（含复合项逐元素），subst 为关联列表；
;;   - 求值：目标序列的 CPS 遍历（success continuation 收集全部解），
;;     规则变量按展开深度重命名（防捕获），深度上限防无限递归。
;;
;; 验证不变量（自校验，[PASS]/[FAIL] 计数汇总）：
;;   - 家族知识库上的事实查询、含变量查询的解集、规则推导、递归规则
;;     （ancestor 传递闭包）、无解查询、跨目标变量约束；
;;   - 解的个数与绑定值逐一断言。
;;
;; 运行方式：./main test/miniprolog.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define pl_pass 0)
(define pl_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! pl_pass (+ pl_pass 1)) (display "  [PASS] ") }
      { (set! pl_fail (+ pl_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

(define pl-reverse (lambda (lst acc) (if (null? lst) acc (pl-reverse (cdr lst) (cons (car lst) acc)))))

;; 变量判定与访问：(v "名字")
(define pl-var? (lambda (t) {
  (and (list? t) (== (length t) 2) (eq? (get_item t 0) (quote v)) (String.atom_to_string (get_item t 1)))
}))
(define pl-var-name (lambda (t) (get_item t 1)))
(define pl-make-var (lambda (name) (cons (quote v) (cons name '()))))

;; ----------------------------------------------------------------------------
;; subst：关联列表 (名 . 值)；walk 沿变量链解引用
;; ----------------------------------------------------------------------------

(define pl-lookup (lambda (name subst) {
  (define r #null)
  (define i 0)
  (define n (length subst))
  (while (< i n) {
    (define pair (get_item subst i))
    (if (String.equals (get_item pair 0) name) (set! r (get_item pair 1)) 0)
    (set! i (+ i 1))
  })
  r
}))

(define pl-extend (lambda (name val subst) (cons (cons name (cons val '())) subst)))

(define pl-walk (lambda (t subst) {
  (if (pl-var? t)
      {
        (define b (pl-lookup (pl-var-name t) subst))
        (if (equal? b #null) t (pl-walk b subst))
      }
      t)
}))

;; ----------------------------------------------------------------------------
;; 合一
;; ----------------------------------------------------------------------------

(define pl-bind (lambda (var val subst) {
  ;; 若 val 也是同名变量则不绑定（由 walk 保证不会出现）
  (pl-extend (pl-var-name var) val subst)
}))

(define pl-unify (lambda (a b subst) {
  (define wa (pl-walk a subst))
  (define wb (pl-walk b subst))
  (cond ((and (pl-var? wa) (pl-var? wb) (String.equals (pl-var-name wa) (pl-var-name wb))) subst)
        ((pl-var? wa) (pl-bind wa wb subst))
        ((pl-var? wb) (pl-bind wb wa subst))
        ((and (list? wa) (list? wb))
         {
           (if (not (== (length wa) (length wb)))
               #f
               {
                 ;; 首元素（谓词名）为 symbol，其余逐元素合一
                 (if (not (eq? (get_item wa 0) (get_item wb 0)))
                     #f
                     (pl-unify-list wa wb 1 subst))
               })
         })
        (else (if (equal? wa wb) subst #f)))
}))

;; 复合项逐元素合一（从下标 from 开始）
(define pl-unify-list (lambda (a b from subst) {
  (if (>= from (length a))
      subst
      {
        (define s2 (pl-unify (get_item a from) (get_item b from) subst))
        (if (equal? s2 #f) #f (pl-append (quote ()) (pl-unify-list a b (+ from 1) s2)))
      })
}))

;; ----------------------------------------------------------------------------
;; 知识库
;; ----------------------------------------------------------------------------

(define pl-facts (Table.make))
(define pl-rules (Table.make))

(define pl-add-fact (lambda (fact) {
  (define pred (get_item fact 0))
  (if (Table.contains pl-facts pred)
      (Table.set pl-facts pred (cons fact (Table.get pl-facts pred)))
      (Table.set pl-facts pred (cons fact '())))
}))

(define pl-add-rule (lambda (rule) {
  (define pred (get_item (get_item rule 0) 0))
  (if (Table.contains pl-rules pred)
      (Table.set pl-rules pred (cons rule (Table.get pl-rules pred)))
      (Table.set pl-rules pred (cons rule '())))
}))

;; 列表拼接 a++b
(define pl-append (lambda (a b) {
  (define ra (pl-reverse a '()))
  (define out b)
  (define i 0)
  (define n (length ra))
  (while (< i n) {
    (set! out (cons (get_item ra i) out))
    (set! i (+ i 1))
  })
  out
}))

;; 规则变量按展开深度重命名（防捕获）：(v "X") → (v "X@d")
(define pl-rename (lambda (term depth) {
  (if (pl-var? term)
      (pl-make-var (String.concat (pl-var-name term) (String.concat "@" (String.atom_to_string depth))))
      {
        (if (list? term)
            {
              (define out '())
              (define i 0)
              (define n (length term))
              (while (< i n) {
                (set! out (cons (pl-rename (get_item term i) depth) out))
                (set! i (+ i 1))
              })
              (pl-reverse out '())
            }
            term)
      })
}))

;; ----------------------------------------------------------------------------
;; 求值：CPS 遍历目标序列
;;   pl-prove(goals, subst, depth, k)：全部满足时以最终 subst 调 k
;; ----------------------------------------------------------------------------

(define pl-depth-limit 40)

;; 遍历某谓词下的事实与规则
(define pl-prove (lambda (goals subst depth k) {
  (if (> depth pl-depth-limit)
      0
      {
        (if (null? goals)
            (k subst)
            {
              ;; 目标已在规则展开/查询时完成重命名，此处不再改名
              (define goal (get_item goals 0))
              (define rest (cdr goals))
              (define pred (get_item goal 0))
              (display "[cp-pred]") (display pred) (newline) (display "[cp-pred-t]") (display (pl-var? pred)) (newline)
              (define facts #null)
              (if (Table.contains pl-facts pred)
                  (set! facts (Table.get pl-facts pred))
                  (set! facts '()))
              (pl-try-facts facts 0 goal subst rest depth k)
            })
      })
}))

;; 逐条试事实，用尽后转规则
(define pl-try-facts (lambda (facts i goal subst rest depth k) {
  (if (< i (length facts))
      {
        (define s2 (pl-unify goal (get_item facts i) subst))
        (if (equal? s2 #f)
            (pl-append (quote ()) (pl-try-facts facts (+ i 1) goal subst rest depth k))
            {
              ;; 每个匹配产生一条解路径；k 被调用后继续尝试后续事实（回溯）
              (pl-prove rest s2 depth k)
              (pl-append (quote ()) (pl-try-facts facts (+ i 1) goal subst rest depth k))
            })
      }
      (pl-try-rules (pl-rules-for (get_item goal 0)) 0 goal subst rest depth k)
) }))

;; 取某谓词的规则列表（无则空）
(define pl-rules-for (lambda (pred) {
  (if (Table.contains pl-rules pred)
      (Table.get pl-rules pred)
      '())
}))

;; 逐条试规则：头与目标合一，体目标接在 rest 前继续求值
(define pl-try-rules (lambda (rules i goal subst rest depth k) {
  (if (< i (length rules))
      {
        (define rule (get_item rules i))
        (define renamed (pl-rename rule depth))
        (define head (get_item renamed 0))
        (define s2 (pl-unify goal head subst))
        (if (equal? s2 #f)
            (pl-append (quote ()) (pl-try-rules rules (+ i 1) goal subst rest depth k))
            {
              (define newgoals '())
              (define bi 1)
              (define bn (length renamed))
              (while (< bi bn) {
                (set! newgoals (cons (get_item renamed bi) newgoals))
                (set! bi (+ bi 1))
              })
              (set! newgoals (pl-reverse newgoals '()))
              (define allgoals (pl-append newgoals rest))
              (pl-prove allgoals s2 (+ depth 1) k)
              (pl-append (quote ()) (pl-try-rules rules (+ i 1) goal subst rest depth k))
            })
      }
      0)
}))

;; ----------------------------------------------------------------------------
;; 知识库：家族关系
;; ----------------------------------------------------------------------------

(pl-add-fact '(parent "tom" "bob"))
(pl-add-fact '(parent "tom" "liz"))
(pl-add-fact '(parent "bob" "ann"))
(pl-add-fact '(parent "bob" "joe"))
(pl-add-fact '(parent "ann" "kate"))

(pl-add-rule '((grandparent (v "X") (v "Z")) (parent (v "X") (v "Y")) (parent (v "Y") (v "Z"))))
(display "[cp-r1]\n")
(pl-add-rule '((ancestor (v "X") (v "Y")) (parent (v "X") (v "Y"))))
(display "[cp-r2]\n")
(pl-add-rule '((ancestor (v "X") (v "Y")) (parent (v "X") (v "Z")) (ancestor (v "Z") (v "Y"))))

;; ----------------------------------------------------------------------------
;; 求解接口：pl-solve 返回解列表（每个解为最终 subst）
;; ----------------------------------------------------------------------------

(define pl-solutions-tmp (quote ()))

(define pl-solve (lambda (goal) {
  (set! pl-solutions-tmp '())
  (pl-prove (cons goal '()) '() 0 (lambda (s) { (set! pl-solutions-tmp (cons s pl-solutions-tmp)) }))
  pl-solutions-tmp
}))

;; 从解中提取某变量的绑定值（walk 于最终 subst）
(define pl-answer (lambda (varname solution) (pl-walk (pl-make-var varname) solution)))

;; ----------------------------------------------------------------------------
;; A. 事实查询
;; ----------------------------------------------------------------------------

(display "====== A. 事实查询 ======") (newline)

(define pl_r1 (pl-solve '(parent "tom" (v "X"))))
(check "A1 parent(tom,X) 解数" (length pl_r1) 2)
(display "[cp-sub0]") (display (get_item pl_r1 0)) (newline) (display "[cp-a2-0]") (display (pl-answer "X" (get_item pl_r1 0))) (newline) (display "[cp-a2-1]") (display (pl-answer "X" (get_item pl_r1 1))) (newline) (check "A2 解含 bob" (or (String.equals (pl-answer "X" (get_item pl_r1 0)) "bob")
                          (String.equals (pl-answer "X" (get_item pl_r1 1)) "bob")) #t)
(check "A3 解含 liz" (or (String.equals (pl-answer "X" (get_item pl_r1 0)) "liz")
                          (String.equals (pl-answer "X" (get_item pl_r1 1)) "liz")) #t)
(define pl_r2 (pl-solve '(parent (v "X") "bob")))
(check "A4 parent(X,bob) 解数" (length pl_r2) 1)
(check "A5 解为 tom" (String.equals (pl-answer "X" (get_item pl_r2 0)) "tom") #t)
(define pl_r3 (pl-solve '(parent "kate" (v "X"))))
(check "A6 无解查询" (null? pl_r3) #t)

;; ----------------------------------------------------------------------------
;; B. 规则推导
;; ----------------------------------------------------------------------------

(display "====== B. 规则推导 ======") (newline)

(display "[cp-rules-n]") (display (length (pl-rules-for (quote grandparent)))) (newline)
(define pl_r4 (pl-solve '(grandparent "tom" (v "X"))))
(check "B1 grandparent(tom,X) 解数" (length pl_r4) 2)
(check "B2 含 ann" (or (String.equals (pl-answer "X" (get_item pl_r4 0)) "ann")
                        (String.equals (pl-answer "X" (get_item pl_r4 1)) "ann")) #t)
(check "B3 含 joe" (or (String.equals (pl-answer "X" (get_item pl_r4 0)) "joe")
                        (String.equals (pl-answer "X" (get_item pl_r4 1)) "joe")) #t)

;; ----------------------------------------------------------------------------
;; C. 递归规则（传递闭包）
;; ----------------------------------------------------------------------------

(display "====== C. 递归规则 ======") (newline)

(define pl_rt (pl-solve '(parent "tom" (v "Y"))))
(display "[cp-parent-tom-Y]") (display (length pl_rt)) (newline)
(define pl_r5 (pl-solve '(ancestor "tom" "kate")))
(check "C1 ancestor(tom,kate) 有解" (not (null? pl_r5)) #t)
(check "C2 解数" (length pl_r5) 1)
(define pl_r6 (pl-solve '(ancestor "kate" "tom")))
(check "C3 反向无解" (null? pl_r6) #t)
(define pl_r7 (pl-solve '(ancestor "tom" (v "X"))))
(check "C4 tom 全后代数（bob,liz,ann,joe,kate）" (length pl_r7) 5)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display pl_pass)
(display "  FAIL: ") (display pl_fail) (newline)
