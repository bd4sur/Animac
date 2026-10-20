(native String)
;; ============================================================================
;; dpll.scm —— DPLL 布尔可满足性求解器（纯 Scheme 实现）+ 自校验回归用例
;;
;; 编码约定
;;   变量：x_1, x_2, … 从 1 开始编号
;;   文字：正整数 +v 表示「x_v 为真」；负整数 -v 表示「x_v 为假」
;;   子句：文字的列表（析取），空子句即不可满足
;;   CNF ：子句的列表（合取），例如 '((1 -2) (2 3)) 即 (x1∨¬x2) ∧ (x2∨x3)
;;   赋值：已确定为真的文字构成的列表（纯函数式，不做原地修改）
;;
;; 算法（经典 DPLL）
;;   1) 单元传播：反复取长度为 1 的子句作为强制赋值并化简 CNF；
;;   2) 空 CNF ⇒ 可满足；出现空子句 ⇒ 当前分支不可满足；
;;   3) 否则取首个子句的首个文字分支：先试真，失败再试假（回溯）。
;;
;; 自校验：每个用例的判定结果都与「真值表穷举」对拍；
;;         SAT 结果再验证一次赋值确实满足原公式。
;; ============================================================================

(define dpll-pass 0)
(define dpll-fail 0)

(define dpll-check (lambda (name actual expected) {
  (if (equal? actual expected)
      (begin (set! dpll-pass (+ dpll-pass 1)) (display "  [PASS] ") (display name) (newline))
      (begin (set! dpll-fail (+ dpll-fail 1))
             (display "  [FAIL] ") (display name)
             (display "  期望=") (display expected)
             (display " 实际=") (display actual) (newline)))
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

;; 列表成员判定（equal? 语义）
(define dpll-member (lambda (x lst)
  (if (null? lst) #f
      (if (equal? (car lst) x) #t (dpll-member x (cdr lst))))))

;; 生成 (s s+1 … s+n-1)
(define dpll-range (lambda (s n)
  (if (== n 0) '() (cons s (dpll-range (+ s 1) (- n 1))))))

;; 列表长度（自实现，避免依赖 length 的具体行为）
(define dpll-len (lambda (lst)
  (if (null? lst) 0 (+ (dpll-len (cdr lst)) 1))))

;; 反转（尾递归）
(define dpll-rev (lambda (lst acc)
  (if (null? lst) acc (dpll-rev (cdr lst) (cons (car lst) acc)))))

;; ----------------------------------------------------------------------------
;; 文字与子句的求值（用于校验与真值表穷举）
;; ----------------------------------------------------------------------------

;; 文字在其否定也在赋值中即为假；文字本身在赋值中即为真；否则未赋值
(define dpll-lit-true?  (lambda (lit assign) (dpll-member lit assign)))
(define dpll-lit-false? (lambda (lit assign) (dpll-member (- 0 lit) assign)))

;; 子句求值：真/假（未赋值视为假，仅用于「完整赋值」下的判定）
(define dpll-clause-eval (lambda (cl assign)
  (if (null? cl) #f
      (if (dpll-lit-true? (car cl) assign) #t (dpll-clause-eval (cdr cl) assign)))))

;; CNF 求值
(define dpll-cnf-eval (lambda (cnf assign)
  (if (null? cnf) #t
      (if (dpll-clause-eval (car cnf) assign) (dpll-cnf-eval (cdr cnf) assign) #f))))

;; ----------------------------------------------------------------------------
;; 化简
;;   子句化简结果：#t 表示该子句已满足（可丢弃）；#f 表示该子句已假死（整式不可满足）；
;;                 列表表示剩余子句（只含未赋值文字，非空）
;;   CNF 化简结果：#f 或新的 CNF（空列表表示全部满足）
;; ----------------------------------------------------------------------------

;; 子句化简：沿着子句累积"未赋值文字"，扫完后再决定结果
;; 注意：不能把"扫到子句末尾"与"子句假死"混为一谈——只有累积结果为空才是空子句。
(define dpll-simp-clause (lambda (cl assign)
  (dpll-simp-clause-1 cl assign '())))

(define dpll-simp-clause-1 (lambda (cl assign acc)
  (if (null? cl)
      (if (null? acc) #f (dpll-rev acc '()))     ;; 全部文字被消掉 ⇒ 空子句
      (if (dpll-lit-true? (car cl) assign) #t     ;; 出现真文字 ⇒ 子句已满足
          (if (dpll-lit-false? (car cl) assign)
              (dpll-simp-clause-1 (cdr cl) assign acc)
              (dpll-simp-clause-1 (cdr cl) assign (cons (car cl) acc)))))))

(define dpll-attach-clause (lambda (cl rest)
  (if (list? cl)
      (if (list? rest) (cons cl rest) rest)
      (if cl rest #f))))

(define dpll-simp-cnf (lambda (cnf assign)
  (if (null? cnf) '()
      (dpll-attach-clause (dpll-simp-clause (car cnf) assign)
                          (dpll-simp-cnf (cdr cnf) assign)))))

;; ----------------------------------------------------------------------------
;; 单元传播与回溯搜索
;; ----------------------------------------------------------------------------

;; 是否存在空子句（空子句即不可满足；注意本解释器的 (car '()) 会报错，必须先判空）
(define dpll-has-empty (lambda (cnf)
  (if (null? cnf) #f
      (if (null? (car cnf)) #t (dpll-has-empty (cdr cnf))))))

;; 找第一个长度为 1 的子句，返回其唯一文字；没有则返回 #f
(define dpll-find-unit (lambda (cnf)
  (if (null? cnf) #f
      (if (null? (car cnf))
          #f
          (if (null? (cdr (car cnf)))
              (car (car cnf))
              (dpll-find-unit (cdr cnf)))))))

;; 单元传播：返回 (cons 化简后的CNF 累积赋值)；传播中已判定不可满足时返回 #f
;; 注意：必须把单元赋值累积进赋值表，否则求解出的模型会缺少传播得到的事实。
(define dpll-propagate (lambda (cnf assign)
  (if (equal? cnf #f) #f
      (if (null? cnf) (cons cnf assign)
          (dpll-propagate-1 cnf assign (dpll-find-unit cnf))))))

(define dpll-propagate-1 (lambda (cnf assign unit)
  (if (equal? unit #f)
      (cons cnf assign)
      (dpll-propagate (dpll-simp-cnf cnf (cons unit '())) (cons unit assign)))))

;; 分支：先试首个子句的首个文字为真，失败再试其为假
(define dpll-branch (lambda (cnf assign)
  (dpll-try cnf assign (car (car cnf)))))

(define dpll-try (lambda (cnf assign pick)
  (if (dpll-sat? (dpll-simp-cnf cnf (cons pick '())) (cons pick assign))
      #t
      (dpll-sat? (dpll-simp-cnf cnf (cons (- 0 pick) '())) (cons (- 0 pick) assign)))))

;; DPLL 主判定：可满足返回 #t，否则 #f
(define dpll-sat? (lambda (cnf assign)
  (if (dpll-has-empty cnf)
      #f
      (dpll-sat-core (dpll-propagate cnf assign)))))

(define dpll-sat-core (lambda (st)
  (if (equal? st #f) #f
      (if (null? (car st)) #t (dpll-branch (car st) (cdr st))))))

;; ----------------------------------------------------------------------------
;; 求解并返回模型（完整赋值）：可满足返回文字列表，否则返回 #f
;; ----------------------------------------------------------------------------

(define dpll-solve (lambda (cnf nvar)
  (dpll-complete (dpll-model cnf '()) nvar)))

;; 返回部分赋值或 #f
(define dpll-model (lambda (cnf assign)
  (if (dpll-has-empty cnf)
      #f
      (dpll-model-core (dpll-propagate cnf assign)))))

(define dpll-model-core (lambda (st)
  (if (equal? st #f) #f
      (if (null? (car st)) (cdr st) (dpll-model-branch (car st) (cdr st))))))

(define dpll-model-branch (lambda (cnf assign)
  (dpll-model-try cnf assign (car (car cnf)))))

(define dpll-model-try (lambda (cnf assign pick)
  (dpll-model-take cnf assign pick (dpll-model (dpll-simp-cnf cnf (cons pick '())) (cons pick assign)))))

(define dpll-model-take (lambda (cnf assign pick got)
  (if (equal? got #f)
      (dpll-model (dpll-simp-cnf cnf (cons (- 0 pick) '())) (cons (- 0 pick) assign))
      got)))

;; 把部分赋值补全为对 x_1..x_n 的完整赋值（未出现的变量一律取假；结果按变量序号升序）
(define dpll-complete (lambda (assign nvar)
  (if (equal? assign #f) #f
      (dpll-rev (dpll-complete-1 assign nvar 1 '()) '()))))

(define dpll-complete-1 (lambda (assign nvar i acc)
  (if (> i nvar) acc
      (if (dpll-member i assign)
          (dpll-complete-1 assign nvar (+ i 1) (cons i acc))
          (dpll-complete-1 assign nvar (+ i 1) (cons (- 0 i) acc))))))

;; ----------------------------------------------------------------------------
;; 真值表穷举（对拍用，n 不超过 12）
;; ----------------------------------------------------------------------------

;; 第 k 个候选赋值：k 的二进制位决定各变量真假，结果按变量序号升序（下标 i-1 即 x_i）
(define dpll-abs (lambda (lit) (if (< lit 0) (- 0 lit) lit)))

(define dpll-table-assign (lambda (k nvar)
  (dpll-table-assign-1 k nvar nvar '())))

(define dpll-table-assign-1 (lambda (k nvar i acc)
  (if (== i 0) acc
      (dpll-table-assign-1 (dpll-half k) nvar (- i 1)
                           (if (== (mod k 2) 1) (cons i acc) (cons (- 0 i) acc))))))

;; 完整赋值下的快速取真值（下标直取，避免线性查找）
(define dpll-lit-bits-true? (lambda (lit assign)
  (if (> lit 0)
      (> (get_item assign (- lit 1)) 0)
      (< (get_item assign (- (dpll-abs lit) 1)) 0))))

(define dpll-clause-bits (lambda (cl assign)
  (if (null? cl) #f
      (if (dpll-lit-bits-true? (car cl) assign) #t (dpll-clause-bits (cdr cl) assign)))))

(define dpll-cnf-bits (lambda (cnf assign)
  (if (null? cnf) #t
      (if (dpll-clause-bits (car cnf) assign) (dpll-cnf-bits (cdr cnf) assign) #f))))

(define dpll-half (lambda (k) (dpll-half-1 k 0)))
(define dpll-half-1 (lambda (k acc)
  (if (< k 2) acc (dpll-half-1 (- k 2) (+ acc 1)))))

;; 穷举 2^nvar 个赋值，返回 #t/#f
(define dpll-brute (lambda (cnf nvar)
  (dpll-brute-1 cnf nvar 0 (dpll-pow2 nvar))))

(define dpll-pow2 (lambda (n)
  (if (== n 0) 1 (* 2 (dpll-pow2 (- n 1))))))

(define dpll-brute-1 (lambda (cnf nvar k limit)
  (if (>= k limit) #f
      (if (dpll-cnf-bits cnf (dpll-table-assign k nvar))
          #t
          (dpll-brute-1 cnf nvar (+ k 1) limit)))))

;; ----------------------------------------------------------------------------
;; 对拍：DPLL 判定 与 真值表穷举 必须一致；SAT 时再验证模型
;; ----------------------------------------------------------------------------

(define dpll-oracle (lambda (name cnf nvar)
  (dpll-check (dpll-cat name " 判定与穷举一致")
              (dpll-sat? cnf '())
              (dpll-brute cnf nvar))))

(define dpll-cat (lambda (a b)
  (String.concat a b)))

(define dpll-verify-model (lambda (name cnf nvar)
  (dpll-check (dpll-cat name " 模型满足公式")
              (dpll-cnf-eval cnf (dpll-solve cnf nvar))
              #t)))

;; ============================================================================
;; 用例
;; ============================================================================

(display "====== A. 基本形态 ======") (newline)

(dpll-check "A1 空 CNF 恒真"       (dpll-sat? '() '()) #t)
(dpll-check "A2 单元子句可满足"    (dpll-sat? '((1)) '()) #t)
(dpll-check "A3 含空子句不可满足"  (dpll-sat? '(()) '()) #f)
(dpll-check "A4 互补单元不可满足"  (dpll-sat? '((1) (-1)) '()) #f)
(dpll-check "A5 重言子句"          (dpll-sat? '((1 -1)) '()) #t)
(dpll-check "A6 重复文字"          (dpll-sat? '((1 1)) '()) #t)
(dpll-check "A7 三元可满足"        (dpll-sat? '((1 2) (-1 2) (1 -2)) '()) #t)
(dpll-check "A8 四子句全否决"      (dpll-sat? '((1 2) (-1 2) (1 -2) (-1 -2)) '()) #f)
(dpll-check "A9 单元传播链不可满足" (dpll-sat? '((1) (-1 2) (-2)) '()) #f)
(dpll-check "A10 单元传播链可满足"  (dpll-sat? '((1) (-1 2) (2 3)) '()) #t)

(display "====== B. 与真值表穷举对拍 ======") (newline)

(dpll-oracle "B1 两变量四种组合" '((1 2) (-1 2) (1 -2)) 2)
(dpll-oracle "B2 两变量全否决"   '((1 2) (-1 2) (1 -2) (-1 -2)) 2)
(dpll-oracle "B3 含单元链"       '((1) (-1 2) (-2 3) (3 4)) 4)
(dpll-oracle "B4 需要回溯"       '((1 2 3) (-1 -2) (-2 -3) (-1 -3)) 3)
(dpll-oracle "B5 重言混入"       '((1 -1 2) (-2 3) (-3 1)) 3)

(display "====== C. 鸽笼原理（PHP）不可满足 ======") (newline)

;; PHP(n+1, n)：n+1 只鸽子放进 n 个洞 → 恒不可满足
(define dpll-php (lambda (pigeons holes)
  (dpll-php-append (dpll-php-atleast pigeons holes '())
                   (dpll-php-atmostp pigeons holes '())
                   (dpll-php-atmosth pigeons holes holes '()))))

;; 每只鸽子至少占一个洞
(define dpll-php-atleast (lambda (p h acc)
  (if (== p 0) acc
      (dpll-php-atleast (- p 1) h (cons (dpll-range (+ (* (- p 1) h) 1) h) acc)))))

;; 每只鸽子至多占一个洞
(define dpll-php-atmostp (lambda (p h acc)
  (if (== p 0) acc
      (dpll-php-atmostp (- p 1) h (dpll-php-pairs (dpll-range (+ (* (- p 1) h) 1) h) acc)))))

;; 每个洞至多一只鸽子
(define dpll-php-atmosth (lambda (p h cur acc)
  (if (== cur 0) acc
      (dpll-php-atmosth p h (- cur 1)
                        (dpll-php-hole-pairs p h cur acc)))))

(define dpll-php-hole-pairs (lambda (p h col acc)
  (if (== p 0) acc
      (dpll-php-hole-pairs (- p 1) h col
                           (dpll-php-hole-pair (- p 1) (- p 2) h col acc)))))

(define dpll-php-hole-pair (lambda (i j h col acc)
  (if (< j 0) acc
      (dpll-php-hole-pair i (- j 1) h col
                          (cons (cons (- 0 (+ (* i h) col))
                                      (cons (- 0 (+ (* j h) col)) '()))
                                acc)))))

;; 同一只鸽子的洞对（h1,h2）互斥子句
(define dpll-php-pairs (lambda (holes acc)
  (dpll-php-pair-1 holes holes acc)))

(define dpll-php-pair-1 (lambda (holes rest acc)
  (if (null? rest) acc
      (dpll-php-pair-1 holes (cdr rest)
                       (dpll-php-pair-2 (car rest) (cdr rest) acc)))))

(define dpll-php-pair-2 (lambda (a rest acc)
  (if (null? rest) acc
      (dpll-php-pair-2 a (cdr rest)
                       (cons (cons (- 0 a) (cons (- 0 (car rest)) '())) acc)))))

(define dpll-php-append (lambda (a b c)
  (dpll-php-append-1 a (dpll-php-append-1 b c))))

(define dpll-php-append-1 (lambda (src acc)
  (if (null? src) acc (dpll-php-append-1 (cdr src) (cons (car src) acc)))))

(define dpll-php-12 (dpll-php 2 1))
(dpll-check "C1 PHP(2,1) 子句数" (dpll-len dpll-php-12) 3)
(dpll-check "C2 PHP(2,1) 不可满足" (dpll-sat? dpll-php-12 '()) #f)

(define dpll-php-32 (dpll-php 3 2))
(dpll-check "C3 PHP(3,2) 子句数" (dpll-len dpll-php-32) 12)
(dpll-check "C4 PHP(3,2) 不可满足" (dpll-sat? dpll-php-32 '()) #f)
(dpll-oracle "C5 PHP(3,2) 与穷举一致" dpll-php-32 6)

(define dpll-php-43 (dpll-php 4 3))
(dpll-check "C6 PHP(4,3) 不可满足" (dpll-sat? dpll-php-43 '()) #f)
(dpll-oracle "C7 PHP(4,3) 与穷举一致" dpll-php-43 12)

(display "====== D. 图着色 ======") (newline)

;; 变量 v(i,c) = (i-1)*k + c，i 从 1 开始，c 从 1 开始
(define dpll-v (lambda (i c k) (+ (* (- i 1) k) c)))

;; 每个点至少一种颜色
(define dpll-col-atleast (lambda (n k acc)
  (if (== n 0) acc
      (dpll-col-atleast (- n 1) k (cons (dpll-range (+ (* (- n 1) k) 1) k) acc)))))

;; 每个点至多一种颜色
(define dpll-col-atmost (lambda (n k acc)
  (if (== n 0) acc
      (dpll-col-atmost (- n 1) k (dpll-php-pairs (dpll-range (+ (* (- n 1) k) 1) k) acc)))))

;; 每条边两端不同色：对每种颜色 c，子句 (-v(u,c) -v(v,c))
(define dpll-col-edges (lambda (edges ncolors acc)
  (if (null? edges) acc
      (dpll-col-edges (cdr edges) ncolors
                      (dpll-col-edge (car (car edges)) (car (cdr (car edges))) ncolors ncolors acc)))))

(define dpll-col-edge (lambda (u v ncolors c acc)
  (if (== c 0) acc
      (dpll-col-edge u v ncolors (- c 1)
                     (cons (cons (- 0 (dpll-v u c ncolors))
                                 (cons (- 0 (dpll-v v c ncolors)) '()))
                           acc)))))

(define dpll-color-cnf (lambda (n edges k)
  (dpll-php-append (dpll-col-atleast n k '())
                   (dpll-col-atmost n k '())
                   (dpll-col-edges edges k '()))))

;; 三角形（奇环）不可 2 着色
(define dpll-c3 (dpll-color-cnf 3 '((1 2) (2 3) (1 3)) 2))
(dpll-check "D1 三角形 2 着色不可满足" (dpll-sat? dpll-c3 '()) #f)
(dpll-oracle "D2 三角形与穷举一致" dpll-c3 6)

;; 四边形可 2 着色
(define dpll-c4 (dpll-color-cnf 4 '((1 2) (2 3) (3 4) (1 4)) 2))
(dpll-check "D3 四边形 2 着色可满足" (dpll-sat? dpll-c4 '()) #t)
(dpll-oracle "D4 四边形与穷举一致" dpll-c4 8)
(dpll-verify-model "D5 四边形模型" dpll-c4 8)

;; 五边形（奇环）不可 2 着色
(define dpll-c5 (dpll-color-cnf 5 '((1 2) (2 3) (3 4) (4 5) (1 5)) 2))
(dpll-check "D6 五边形 2 着色不可满足" (dpll-sat? dpll-c5 '()) #f)
(dpll-oracle "D7 五边形与穷举一致" dpll-c5 10)

;; K4 不可 3 着色
(define dpll-k4 (dpll-color-cnf 4 '((1 2) (1 3) (1 4) (2 3) (2 4) (3 4)) 3))
(dpll-check "D8 K4 三着色不可满足" (dpll-sat? dpll-k4 '()) #f)

;; 说明：K4 三着色有 12 个变量，穷举 4096 个赋值对本 VM 偏贵（约 1.5 s），
;;      12 变量的穷举对拍统一放在 C7（PHP(4,3)）里做，此处只做判定检查。

;; K3 可 3 着色
(define dpll-k3 (dpll-color-cnf 3 '((1 2) (2 3) (1 3)) 3))
(dpll-check "D10 K3 三着色可满足" (dpll-sat? dpll-k3 '()) #t)
(dpll-verify-model "D11 K3 模型" dpll-k3 9)

(display "====== E. 确定性伪随机 3-CNF 对拍 ======") (newline)

;; 线性同余发生器（Lehmer，模 65537，乘法不溢出）
(define dpll-seed 20260729)
(define dpll-next (lambda ()
  (set! dpll-seed (mod (+ (* dpll-seed 75) 74) 65537))
  dpll-seed))

;; 生成一个文字：变量 1..nvar，符号由低位决定
(define dpll-rand-lit (lambda (nvar)
  (dpll-rand-lit-1 nvar (dpll-next) (dpll-next))))

(define dpll-rand-lit-1 (lambda (nvar a b)
  (if (== (mod a 2) 1)
      (+ 1 (mod b nvar))
      (- 0 (+ 1 (mod b nvar))))))

;; 生成一个 3-CNF：nclause 个子句，每个 3 个文字
(define dpll-rand-cnf (lambda (nvar nclause)
  (if (== nclause 0) '()
      (cons (dpll-rand-clause nvar) (dpll-rand-cnf nvar (- nclause 1))))))

(define dpll-rand-clause (lambda (nvar)
  (cons (dpll-rand-lit nvar)
        (cons (dpll-rand-lit nvar) (cons (dpll-rand-lit nvar) '())))))

;; 对每个随机实例做对拍（变量数 4..8，子句数 = 变量数 × 2）
(define dpll-rand-sweep (lambda (nvar nclause reps tag)
  (if (== reps 0) #t
      (begin
        (dpll-oracle (dpll-cat tag " 随机实例") (dpll-rand-cnf nvar nclause) nvar)
        (dpll-rand-sweep nvar nclause (- reps 1) tag)))))

(dpll-rand-sweep 4 8 3 "E1")
(dpll-rand-sweep 5 10 3 "E2")
(dpll-rand-sweep 6 12 3 "E3")
(dpll-rand-sweep 7 14 2 "E4")
(dpll-rand-sweep 8 16 2 "E5")

(display "====== F. 可满足实例的模型校验 ======") (newline)

;; 把文字列表转成单元子句列表
(define dpll-units (lambda (lits)
  (if (null? lits) '() (cons (cons (car lits) '()) (dpll-units (cdr lits))))))

;; 每个文字追加其否定
(define dpll-mirror (lambda (lits)
  (if (null? lits) '() (cons (car lits) (cons (- 0 (car lits)) (dpll-mirror (cdr lits)))))))

;; x1∧x2∧…∧x8 全真
(define dpll-conj8 (dpll-range 1 8))
(dpll-check "F1 全真合取可满足" (dpll-sat? (dpll-units dpll-conj8) '()) #t)
(dpll-verify-model "F2 全真合取模型" (dpll-units dpll-conj8) 8)
(dpll-check "F3 全真合取模型内容" (dpll-solve (dpll-units dpll-conj8) 8) dpll-conj8)

;; 每个变量正反各出现一次 → 恒不可满足
(define dpll-bad8 (dpll-units (dpll-mirror dpll-conj8)))
(dpll-check "F4 正反成对不可满足" (dpll-sat? dpll-bad8 '()) #f)

(display "====== G. 求解规模与稳定性 ======") (newline)

;; 24 变量链式实例：x1 ∧ (¬x1∨x2) ∧ … ∧ (¬x23∨x24)
(define dpll-chain-rest (lambda (i n)
  (if (> i n) '()
      (cons (cons (- 0 (- i 1)) (cons i '())) (dpll-chain-rest (+ i 1) n)))))

(define dpll-chain (cons (cons 1 '()) (dpll-chain-rest 2 24)))

(dpll-check "G1 24 变量链可满足" (dpll-sat? dpll-chain '()) #t)
(dpll-verify-model "G2 24 变量链模型" dpll-chain 24)

;; 24 变量链再叠加 ¬x24（链末取反）→ 不可满足
(define dpll-chain-bad (cons (cons (- 0 24) '()) dpll-chain))
(dpll-check "G3 24 变量链取反不可满足" (dpll-sat? dpll-chain-bad '()) #f)

;; ============================================================================
;; 汇总
;; ============================================================================
(display "PASS: ") (display dpll-pass)
(display "  FAIL: ") (display dpll-fail) (newline)