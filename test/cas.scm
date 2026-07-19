;; Animac测试用例 - 简单的CAS算法
;; 2026-07 AI辅助编码
;; TODO 对于加0、减0、乘0、乘1这些特殊情况的化简

(native Math)

;; ==========================================
;; 辅助函数
;; ==========================================

(define cadr
  (lambda (lst)
    (car (cdr lst))))

(define caddr
  (lambda (lst)
    (car (cdr (cdr lst)))))

(define symbol?
  (lambda (v)
    (and (atom? v) (not (number? v)))))

;; Animac没有原生点对概念，挪用pair?来表达“非空表”的概念
(define pair?
  (lambda (lst)
    (and (list? lst) (> (length lst) 0))))

;; ==========================================
;; 一元多项式函数求导
;; ==========================================

;; 构造加/减法表达式，并进行基础的代数化简
(define make_sum
  (lambda (a1 a2)
    (cond ((and (number? a1) (number? a2)) (+ a1 a2))
          ((and (number? a1) (== a1 0)) a2)
          ((and (number? a2) (== a2 0)) a1)
          ((equal? a1 a2) `('* ,a1 2))
          (else `('+ ,a1 ,a2)))))

(define make_diff
  (lambda (a1 a2)
    (cond ((and (number? a1) (number? a2)) (- a1 a2))
          ((and (number? a1) (== a1 0)) `(- 0 ,a2))
          ((and (number? a2) (== a2 0)) a1)
          ((equal? a1 a2) 0)
          (else `(- ,a1 ,a2)))))

;; 构造乘法表达式，并进行基础的代数化简
(define make_product
  (lambda (m1 m2)
    (cond ((or (and (number? m1) (== m1 0))
               (and (number? m2) (== m2 0)))
           0)
          ((and (number? m1) (== m1 1)) m2)
          ((and (number? m2) (== m2 1)) m1)
          ((and (number? m1) (number? m2)) (* m1 m2))
          (else `('* ,m1 ,m2)))))

;; 核心递归求导函数
(define deriv
  (lambda (expr v)
    (cond 
      ;; 1. 常数的导数为 0
      ((number? expr) 0)
      ;; 2. 变量的导数：如果是求导变量则为 1，否则为 0
      ((symbol? expr) (if (eq? expr v) 1 0))
      ;; 3. 复合表达式的导数（假设均为二元操作符）
      ((pair? expr)
       (cond 
         ;; 加法法则: (f + g)' = f' + g'
         ((eq? (car expr) '+)
          (make_sum (deriv (cadr expr) v)
                    (deriv (caddr expr) v)))
         ;; 减法法则: (f - g)' = f' - g'
         ((eq? (car expr) '-)
          (make_diff (deriv (cadr expr) v)
                     (deriv (caddr expr) v)))
         ;; 乘法法则: (f * g)' = f * g' + f' * g
         ((eq? (car expr) '*)
          (make_sum
           (make_product (cadr expr) (deriv (caddr expr) v))
           (make_product (deriv (cadr expr) v) (caddr expr))))
         (else 'unknown_operator)))
      (else 'unknown_expr))))

;; 主入口函数 D：解析 lambda 结构并调用 deriv
(define D
  (lambda (expr)
    `('lambda ,(cadr expr) ,(deriv (caddr expr) (car (cadr expr))) )))


;; ==========================================
;; 多项式化简
;; ==========================================

;; 1. 多项式内部表示操作 (Alist: ((deg coeff) ...))

;; 构建单项式内部表示 '(deg coeff)
(define make_poly_term
  (lambda (deg coeff) `(,deg ,coeff)))

(define poly_term_deg car)
(define poly_term_coeff cadr)

;; 将一个项插入到按降序排列的多项式中，并自动合并同类项
(define insert_poly_term
  (lambda (term poly)
    (cond ((null? poly) `(,term))
          ((== (poly_term_deg term) (poly_term_deg (car poly)))
           ;; 次数相同，系数相加。使用 lambda 替代 let 绑定新系数
           ((lambda (new_coeff)
              (if (== new_coeff 0)
                  (cdr poly) ;; 系数抵消为0，直接删除该项
                  (cons (make_poly_term (poly_term_deg term) new_coeff) (cdr poly))))
            (+ (poly_term_coeff term) (poly_term_coeff (car poly)))))
          ((> (poly_term_deg term) (poly_term_deg (car poly)))
           (cons term poly))
          (else
           (cons (car poly) (insert_poly_term term (cdr poly)))))))

;; 多项式加法
(define poly_add
  (lambda (p1 p2)
    (cond ((null? p2) p1)
          (else (poly_add (insert_poly_term (car p2) p1) (cdr p2))))))

;; 多项式取负 (系数全部乘 -1)
(define poly_neg
  (lambda (p)
    (cond ((null? p) '())
          (else (cons (make_poly_term (poly_term_deg (car p)) (- 0 (poly_term_coeff (car p))))
                      (poly_neg (cdr p)))))))

;; 单项式乘多项式
(define mul_term_by_poly
  (lambda (term poly)
    (cond ((null? poly) '())
          (else
           (insert_poly_term
            (make_poly_term (+ (poly_term_deg term) (poly_term_deg (car poly)))
                       (* (poly_term_coeff term) (poly_term_coeff (car poly))))
            (mul_term_by_poly term (cdr poly)))))))

;; 多项式乘法
(define poly_mul
  (lambda (p1 p2)
    (cond ((null? p1) '())
          (else (poly_add (mul_term_by_poly (car p1) p2)
                          (poly_mul (cdr p1) p2))))))

;; 2. 表达式解析器 (AST -> 内部多项式)
(define expr_to_poly
  (lambda (expr)
    (cond
      ((number? expr) `(,(make_poly_term 0 expr)))
      ((eq? expr 'x) `(,(make_poly_term 1 1)))
      ((list? expr)
       (cond
         ((eq? (car expr) '+)
          (poly_add (expr_to_poly (cadr expr)) (expr_to_poly (caddr expr))))
         ((eq? (car expr) '-)
          ;; 区分一元减号 (- a) 和二元减号 (- a b)
          ((lambda (rest)
             (if (eq? rest '())
                 (poly_neg (expr_to_poly (cadr expr)))
                 (poly_add (expr_to_poly (cadr expr))
                           (poly_neg (expr_to_poly (caddr expr))))))
           (cdr (cdr expr))))
         ((eq? (car expr) '*)
          (poly_mul (expr_to_poly (cadr expr)) (expr_to_poly (caddr expr))))
         (else '())))
      (else '()))))

;; 3. 表达式重构器 (内部多项式 -> AST)

;; 生成 x^n 的 AST 结构，例如 n=2 生成 (* x x)
(define make_x_power
  (lambda (n)
    (cond ((== n 0) 1)
          ((== n 1) 'x)
          (else `('* 'x ,(make_x_power (- n 1))) ))))

;; 生成单项式 coeff * x^deg 的 AST
(define make_monomial
  (lambda (deg coeff)
    (cond ((== deg 0) coeff)
          ((== coeff 1) (make_x_power deg))
          ;; 统一使用乘法处理负系数，避免一元减号解析歧义
          ((== coeff -1) `('* -1 ,(make_x_power deg)))
          (else `('* ,coeff ,(make_x_power deg)) ))))

;; 将多个单项式用 + 连接起来
(define sum_monomials
  (lambda (mons)
    (cond ((null? mons) 0)
          ((null? (cdr mons)) (car mons)) ;; 只有一项时不需要 +
          (else `('+ ,(car mons) ,(sum_monomials (cdr mons))) ))))

;; 辅助遍历函数
(define poly_to_expr_helper
  (lambda (poly)
    (cond ((null? poly) '())
          (else (cons (make_monomial (poly_term_deg (car poly)) (poly_term_coeff (car poly)))
                      (poly_to_expr_helper (cdr poly)))))))

;; 主重构函数
(define poly_to_expr
  (lambda (poly)
    (sum_monomials (poly_to_expr_helper poly))))

;; 主入口函数
(define simplify
  (lambda (expr)
    `(lambda ,(cadr expr) ,(poly_to_expr (expr_to_poly (caddr expr))))))



;; ==========================================
;; 数值GCD
;; ==========================================

(define gcd
  (lambda (a b)
    (if (== b 0)
        (Math.abs a)
        (gcd b (mod a b)))))


;; ==========================================
;; 精确数算术
;; ==========================================

;; 精确整数：v为int或者symbol
(define make_eint (lambda (v) `('eint ,v)))
(define is_eint (lambda (e) (and (pair? e) (eq? (car e) 'eint))))
(define eint_v (lambda (e) (if (is_eint e) (get_item e 1) #undefined)))

;; 精确有理数：pq均为int
(define make_efrac (lambda (p q) `('efrac ,p ,q)))
(define is_efrac (lambda (e) (and (pair? e) (eq? (car e) 'efrac))))
(define efrac_p (lambda (e) (if (is_efrac e) (get_item e 1) #undefined)))
(define efrac_q (lambda (e) (if (is_efrac e) (get_item e 2) #undefined)))
(define simplify_efrac (lambda (e) (define d (gcd (efrac_p e) (efrac_q e))) (make_efrac (/ (efrac_p e) d) (/ (efrac_q e) d))))

;; 精确实数：v为int、float或者symbol
(define make_ereal (lambda (v) `('ereal ,v)))
(define is_ereal (lambda (e) (and (pair? e) (eq? (car e) 'ereal))))
(define ereal_v (lambda (e) (if (is_ereal e) (get_item e 1) #undefined)))

;; 特殊实数
(define epi   (make_ereal 'epi))
(define ee    (make_ereal 'ee))
(define enan  (make_ereal 'enan))
(define einfp (make_ereal 'einfp))
(define einfn (make_ereal 'einfn))

;; 精确复数：ab为int、float或者symbol
(define make_ecmpl (lambda (a b) `('ecmpl ,a ,b)))
(define is_ecmpl (lambda (e) (and (pair? e) (eq? (car e) 'ecmpl))))
(define ecmpl_a (lambda (e) (if (is_ecmpl e) (get_item e 1) #undefined)))
(define ecmpl_b (lambda (e) (if (is_ecmpl e) (get_item e 2) #undefined)))

;; 特殊复数
(define ei (make_ecmpl 0 1))


;; 精确数除法
(define ediv_basic
  (lambda (ep eq)
    (cond ((and (is_eint  ep) (is_eint  eq)) (make_efrac (eint_v ep)  (eint_v eq)))
          ((and (is_efrac ep) (is_eint  eq)) (make_efrac (efrac_p ep) (* (efrac_q ep) (eint_v eq))))
          ((and (is_eint  ep) (is_efrac eq)) (make_efrac (* (eint_v ep) (efrac_q eq)) (efrac_p eq)))
          ((and (is_efrac ep) (is_efrac eq)) (make_efrac (* (efrac_p ep) (efrac_q eq)) (* (efrac_q ep) (efrac_p eq))))
          ((or  (is_ereal ep) (is_ereal eq)) (make_real  (/ (ereal_v ep) (ereal_v eq)))) ;; stub
          (else #undefined))))

(define ediv
  (lambda (ep eq)
    (simplify_efrac (ediv_basic ep eq))))



;; ==========================================
;; 入口
;; ==========================================

(define run
  (lambda ()

    ;; d/dx[ x^3 - x^2 - (-2x) - 100 ] = 3x^2 - 2x + 2
    (display "d/dx[ x^3 - x^2 - (-2x) - 100 ] = ")
    (display (simplify (D '(lambda (x) (- (- (- (* x (* x x)) (* x x)) (* -2 x)) 100)  ))))
    (newline)

    ;; d/dx[ -x - x^2 ] = -2x - 1
    (display "d/dx[ -x - x^2 ] = ")
    (display (simplify (D '(lambda (x) (- (- 0 x) (* x x))  ))))
    (newline)

    (display "(1919/810) / (114/514) = ")
    (define ep (ediv (make_eint 1919) (make_eint 810)))
    (define eq (ediv (make_eint 114)  (make_eint 514)))
    (display (ediv ep eq))
    (newline)

))
