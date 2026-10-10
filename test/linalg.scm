;; ============================================================================
;; linalg.scm —— 纯 Scheme 数值线性代数库（C 版 Animac 大型实用性测试）
;;
;; 表示约定：矩阵为"行列表"——外层列表每项是一行（列表）；行是堆对象，
;; 可经 set_item! 原地修改；列向量用长度为 n 的列表表示。
;;
;; 提供：构造（零阵/单位阵/拷贝）、访问（ref/set!）、转置、加法、数乘、
;;       矩阵乘、矩阵×向量、行列式（部分主元高斯消元）、逆（高斯-约当）、
;;       幂法求主特征值。
;;
;; 风格约定：while 不创建词法区域——它实质是简单的循环跳转，循环体内不是
;; 块作用域（doc/manual.md §4.2、test/sleepsort.scm 的示例说明）。因此循环体
;; 内的 define 直接定义在所属 lambda 的作用域中，多个循环体内的同名 define
;; 即为同一作用域的重复定义，会导致解析失败。故所有循环变量一律在 lambda
;; 体顶层 define 一次、循环内仅用 set! 重置。
;;
;; 验证不变量（自校验，[PASS]/[FAIL] 计数汇总）：
;;   - 已知行列式/乘法/转置数值例；
;;   - A·A⁻¹ ≈ I（逐元素最大偏差 < 1e-9）；解代回残差 < 1e-9；
;;   - 幂法收敛到已知主特征值；
;;   - Hilbert 4×4 病态矩阵逆的残差仍在 1e-9 内（double 精度实证）；
;;   - 80×80 随机矩阵乘法性能计时（信息性输出）。
;;
;; 运行方式：./main test/linalg.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native Math)
(native String)
(native System)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define la_pass 0)
(define la_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! la_pass (+ la_pass 1)) (display "  [PASS] ") }
      { (set! la_fail (+ la_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; 近似断言：actual 与 expected 的绝对差 < 1e-9
(define la-eps (pow 10 -9))
(define check-near (lambda (name actual expected) {
  (define diff (Math.abs (- actual expected)))
  (if (< diff la-eps)
      { (set! la_pass (+ la_pass 1)) (display "  [PASS] ") }
      { (set! la_fail (+ la_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (< diff la-eps)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

;; 尾递归列表反转
(define la-reverse (lambda (lst acc) (if (null? lst) acc (la-reverse (cdr lst) (cons (car lst) acc)))))

;; n×n 单位阵
(define la-identity (lambda (n) {
  (define out '())
  (define i 0)
  (define j 0)
  (define row '())
  (while (< i n) {
    (set! row '())
    (set! j 0)
    (while (< j n) {
      (if (== i j) (set! row (cons 1 row)) (set! row (cons 0 row)))
      (set! j (+ j 1))
    })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

;; r×c 零阵
(define la-zero (lambda (r c) {
  (define out '())
  (define i 0)
  (define j 0)
  (define row '())
  (while (< i r) {
    (set! row '())
    (set! j 0)
    (while (< j c) { (set! row (cons 0 row)) (set! j (+ j 1)) })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

;; 深拷贝（新行对象，与原矩阵不共享任何行）
(define la-copy (lambda (m) {
  (define out '())
  (define i 0)
  (define n (length m))
  (define j 0)
  (define nc 0)
  (define src #null)
  (define row '())
  (while (< i n) {
    (set! src (get_item m i))
    (set! row '())
    (set! j 0)
    (set! nc (length src))
    (while (< j nc) { (set! row (cons (get_item src j) row)) (set! j (+ j 1)) })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

(define la-rows (lambda (m) (length m)))
(define la-cols (lambda (m) (length (get_item m 0))))
(define la-ref (lambda (m i j) (get_item (get_item m i) j)))
;; 原地写：矩阵的行是堆对象，set_item! 直接改行内元素
(define la-set! (lambda (m i j v) (set_item! (get_item m i) j v)))

;; 两矩阵逐元素最大绝对偏差（矩阵近似断言的核心）
(define la-max-diff (lambda (a b) {
  (define md 0)
  (define d 0)
  (define i 0)
  (define j 0)
  (define n (la-rows a))
  (define nc (la-cols a))
  (while (< i n) {
    (set! j 0)
    (while (< j nc) {
      (set! d (Math.abs (- (la-ref a i j) (la-ref b i j))))
      (if (> d md) (set! md d) 0)
      (set! j (+ j 1))
    })
    (set! i (+ i 1))
  })
  md
}))

;; ----------------------------------------------------------------------------
;; 运算
;; ----------------------------------------------------------------------------

(define la-add (lambda (a b) {
  (define out '())
  (define i 0)
  (define j 0)
  (define n (la-rows a))
  (define nc (la-cols a))
  (define row '())
  (while (< i n) {
    (set! row '())
    (set! j 0)
    (while (< j nc) {
      (set! row (cons (+ (la-ref a i j) (la-ref b i j)) row))
      (set! j (+ j 1))
    })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

(define la-scale (lambda (k m) {
  (define out '())
  (define i 0)
  (define j 0)
  (define n (la-rows m))
  (define nc (la-cols m))
  (define row '())
  (while (< i n) {
    (set! row '())
    (set! j 0)
    (while (< j nc) {
      (set! row (cons (* k (la-ref m i j)) row))
      (set! j (+ j 1))
    })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

(define la-transpose (lambda (m) {
  (define r (la-rows m))
  (define c (la-cols m))
  (define out '())
  (define i 0)
  (define j 0)
  (define row '())
  (while (< j c) {
    (set! row '())
    (set! i 0)
    (while (< i r) {
      (set! row (cons (la-ref m i j) row))
      (set! i (+ i 1))
    })
    (set! out (cons (la-reverse row '()) out))
    (set! j (+ j 1))
  })
  (la-reverse out '())
}))

;; 矩阵乘：先转置 b，使内积退化为两行的点积
(define la-mul (lambda (a b) {
  (define bt (la-transpose b))
  (define n (la-rows a))
  (define p (la-rows bt))
  (define kmax (la-cols a))
  (define out '())
  (define i 0)
  (define j 0)
  (define k 0)
  (define s 0)
  (define ai #null)
  (define bj #null)
  (define row '())
  (while (< i n) {
    (set! ai (get_item a i))
    (set! row '())
    (set! j 0)
    (while (< j p) {
      (set! bj (get_item bt j))
      (set! s 0)
      (set! k 0)
      (while (< k kmax) {
        (set! s (+ s (* (get_item ai k) (get_item bj k))))
        (set! k (+ k 1))
      })
      (set! row (cons s row))
      (set! j (+ j 1))
    })
    (set! out (cons (la-reverse row '()) out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

;; 矩阵 × 列向量
(define la-mulvec (lambda (m v) {
  (define out '())
  (define i 0)
  (define j 0)
  (define s 0)
  (define n (la-rows m))
  (define k (length v))
  (define row #null)
  (while (< i n) {
    (set! row (get_item m i))
    (set! s 0)
    (set! j 0)
    (while (< j k) {
      (set! s (+ s (* (get_item row j) (get_item v j))))
      (set! j (+ j 1))
    })
    (set! out (cons s out))
    (set! i (+ i 1))
  })
  (la-reverse out '())
}))

;; 向量数乘（幂法归一化用；la-scale 仅接受矩阵）
(define la-scalev (lambda (k v) {
  (define out '())
  (define i 0)
  (define n (length v))
  (define row '())
  (while (< i n) {
    (set! row (cons (* k (get_item v i)) row))
    (set! i (+ i 1))
  })
  (la-reverse row '())
}))

;; ----------------------------------------------------------------------------
;; 行列式（部分主元高斯消元，原地消元于副本；奇异返回 0）
;; ----------------------------------------------------------------------------

(define la-det (lambda (m) {
  (define n (la-rows m))
  (define a (la-copy m))
  (define det 1)
  (define i 0)
  (define k 0)
  (define r 0)
  (define c 0)
  (define piv 0)
  (define pivv 1)
  (define factor 0)
  (define tmp #null)
  (define singular #f)
  (while (and (< i n) (not singular)) {
    (set! piv i)
    (set! k (+ i 1))
    (while (< k n) {
      (if (> (Math.abs (la-ref a k i)) (Math.abs (la-ref a piv i))) (set! piv k) 0)
      (set! k (+ k 1))
    })
    (if (< (Math.abs (la-ref a piv i)) (pow 10 -15))
        (set! singular #t)
        {
          (if (not (== piv i)) {
            (set! tmp (get_item a piv))
            (set_item! a piv (get_item a i))
            (set_item! a i tmp)
            (set! det (- 0 det))
          } 0)
          (set! pivv (la-ref a i i))
          (set! det (* det pivv))
          (set! r (+ i 1))
          (while (< r n) {
            (set! factor (/ (la-ref a r i) pivv))
            (set! c i)
            (while (< c n) {
              (la-set! a r c (- (la-ref a r c) (* factor (la-ref a i c))))
              (set! c (+ c 1))
            })
            (set! r (+ r 1))
          })
        })
    (set! i (+ i 1))
  })
  (if singular 0 det)
}))

;; ----------------------------------------------------------------------------
;; 逆（高斯-约当消元于 [A|I]；奇异返回 #null）
;; ----------------------------------------------------------------------------

(define la-inverse (lambda (m) {
  (define n (la-rows m))
  (define a (la-copy m))
  (define inv (la-identity n))
  (define i 0)
  (define k 0)
  (define r 0)
  (define c 0)
  (define piv 0)
  (define pivv 1)
  (define factor 0)
  (define tmp #null)
  (define tmpi #null)
  (define singular #f)
  (while (and (< i n) (not singular)) {
    (set! piv i)
    (set! k (+ i 1))
    (while (< k n) {
      (if (> (Math.abs (la-ref a k i)) (Math.abs (la-ref a piv i))) (set! piv k) 0)
      (set! k (+ k 1))
    })
    (if (< (Math.abs (la-ref a piv i)) (pow 10 -15))
        (set! singular #t)
        {
          (if (not (== piv i)) {
            (set! tmp (get_item a piv))
            (set_item! a piv (get_item a i))
            (set_item! a i tmp)
            (set! tmpi (get_item inv piv))
            (set_item! inv piv (get_item inv i))
            (set_item! inv i tmpi)
          } 0)
          (set! pivv (la-ref a i i))
          (set! c 0)
          (while (< c n) {
            (la-set! a i c (/ (la-ref a i c) pivv))
            (la-set! inv i c (/ (la-ref inv i c) pivv))
            (set! c (+ c 1))
          })
          (set! r 0)
          (while (< r n) {
            (if (not (== r i)) {
              (set! factor (la-ref a r i))
              (set! c 0)
              (while (< c n) {
                (la-set! a r c (- (la-ref a r c) (* factor (la-ref a i c))))
                (la-set! inv r c (- (la-ref inv r c) (* factor (la-ref inv i c))))
                (set! c (+ c 1))
              })
            } 0)
            (set! r (+ r 1))
          })
        })
    (set! i (+ i 1))
  })
  (if singular #null inv)
}))

;; ----------------------------------------------------------------------------
;; 幂法求主特征值（要求存在唯一模最大的实特征值；返回无穷范数归一化下的谱半径估计）
;; ----------------------------------------------------------------------------

(define la-power-iteration (lambda (m iters) {
  (define n (la-rows m))
  (define v '())
  (define w '())
  (define lam 0)
  (define mx 0)
  (define i 0)
  (define it 0)
  (while (< i n) { (set! v (cons 1 v)) (set! i (+ i 1)) })
  (set! v (la-reverse v '()))
  (while (< it iters) {
    (set! w (la-mulvec m v))
    (set! mx 0)
    (set! i 0)
    (while (< i n) {
      (if (> (Math.abs (get_item w i)) mx) (set! mx (Math.abs (get_item w i))) 0)
      (set! i (+ i 1))
    })
    (set! lam mx)
    (set! v (la-scalev (/ 1 mx) w))
    (set! it (+ it 1))
  })
  lam
}))

;; ----------------------------------------------------------------------------
;; A. 基础访问与构造
;; ----------------------------------------------------------------------------

(display "====== A. 基础访问 ======") (newline)

(define la_a '((1 2) (3 4)))
(check "A1 行数" (la-rows la_a) 2)
(check "A2 列数" (la-cols la_a) 2)
(check "A3 ref" (la-ref la_a 1 0) 3)
(la-set! la_a 0 0 10)
(check "A4 set!原地生效" (la-ref la_a 0 0) 10)
(check "A5 identity对角线" (la-ref (la-identity 3) 1 1) 1)
(check "A6 identity非对角线" (la-ref (la-identity 3) 0 1) 0)
(check "A7 zero尺寸" (la-rows (la-zero 2 5)) 2)
(la-set! la_a 0 0 1)
(check "A9 原矩阵改回" (la-ref la_a 0 0) 1)

;; ----------------------------------------------------------------------------
;; B. 转置 / 加法 / 数乘
;; ----------------------------------------------------------------------------

(display "====== B. 转置与线性运算 ======") (newline)

(check "B1 转置数值例" (la-max-diff (la-transpose '((1 2 3) (4 5 6))) '((1 4) (2 5) (3 6))) 0)
(check "B2 转置两次复原" (la-max-diff (la-transpose (la-transpose la_a)) la_a) 0)
(check "B3 加法数值例" (la-max-diff (la-add '((1 2) (3 4)) '((10 20) (30 40))) '((11 22) (33 44))) 0)
(check "B4 数乘数值例" (la-max-diff (la-scale 2 '((1 -2) (3 4))) '((2 -4) (6 8))) 0)
(check "B5 单位阵乘法不变" (la-max-diff (la-mul la_a (la-identity 2)) la_a) 0)

;; ----------------------------------------------------------------------------
;; C. 矩阵乘法
;; ----------------------------------------------------------------------------

(display "====== C. 矩阵乘法 ======") (newline)

(check "C1 2×2乘法数值例" (la-max-diff (la-mul '((1 2) (3 4)) '((5 6) (7 8))) '((19 22) (43 50))) 0)
(check "C2 非方阵乘法 2×3·3×2" (la-max-diff (la-mul '((1 2 3) (4 5 6)) '((7 8) (9 10) (11 12))) '((58 64) (139 154))) 0)
(check "C3 结合律 (AB)C=A(BC)"
       (la-max-diff
         (la-mul (la-mul '((1 2) (3 4)) '((5 6) (7 8))) '((9 10) (11 12)))
         (la-mul '((1 2) (3 4)) (la-mul '((5 6) (7 8)) '((9 10) (11 12)))))
       0)
(check "C4 转置性质 (A·B)^T=B^T·A^T"
       (la-max-diff
         (la-transpose (la-mul '((1 2) (3 4)) '((5 6) (7 8))))
         (la-mul (la-transpose '((5 6) (7 8))) (la-transpose '((1 2) (3 4)))))
       0)
(define la_v5 (la-mulvec '((1 2) (3 4)) '(5 6)))
(check "C5 mulvec[0]" (get_item la_v5 0) 17)
(check "C5b mulvec[1]" (get_item la_v5 1) 39)

;; ----------------------------------------------------------------------------
;; D. 行列式
;; ----------------------------------------------------------------------------

(display "====== D. 行列式 ======") (newline)

(check-near "D1 det[[1,2],[3,4]]=-2" (la-det '((1 2) (3 4))) -2)
(check-near "D2 det换行变号" (la-det '((3 4) (1 2))) 2)
(check-near "D3 det上三角=对角积" (la-det '((2 5 7) (0 3 1) (0 0 2))) 12)
(check-near "D4 det奇异矩阵=0" (la-det '((1 2) (2 4))) 0)
(check-near "D5 det 4×4" (la-det '((2 1 0 0) (1 3 1 0) (0 1 4 1) (0 0 1 5))) 85)

;; ----------------------------------------------------------------------------
;; E. 逆与线性方程组求解
;; ----------------------------------------------------------------------------

(display "====== E. 逆与求解 ======") (newline)

(define la_m '((4 7) (2 6)))
(define la_inv (la-inverse la_m))
(check-near "E1 A·A⁻¹≈I" (la-max-diff (la-mul la_m la_inv) (la-identity 2)) 0)
(check-near "E2 A⁻¹·A≈I" (la-max-diff (la-mul la_inv la_m) (la-identity 2)) 0)
(check "E3 奇异矩阵逆为#null" (null? (la-inverse '((1 2) (2 4)))) #t)

;; 解 Ax=b：x = A⁻¹·b；断言代回残差 < 1e-9
(define la_b '(18 22))
(define la_x (la-mulvec la_inv la_b))
(define la_r (la-mulvec la_m la_x))
(check-near "E4 解代回残差 x1" (get_item la_r 0) 18)
(check-near "E5 解代回残差 x2" (get_item la_r 1) 22)

;; Hilbert 4×4 病态矩阵：H[i][j]=1/(i+j+1)，条件数 ~1.5e4，考验 double 精度
(define la_hm '())
(define la_hi 0)
(define la_hj 0)
(define la_hrow '())
(while (< la_hi 4) {
  (set! la_hrow '())
  (set! la_hj 0)
  (while (< la_hj 4) {
    (set! la_hrow (cons (/ 1 (+ (+ la_hi la_hj) 1)) la_hrow))
    (set! la_hj (+ la_hj 1))
  })
  (set! la_hm (cons (la-reverse la_hrow '()) la_hm))
  (set! la_hi (+ la_hi 1))
})
(set! la_hm (la-reverse la_hm '()))
(define la_hinv (la-inverse la_hm))
(check-near "E6 Hilbert4 A·A⁻¹≈I" (la-max-diff (la-mul la_hm la_hinv) (la-identity 4)) 0)

;; ----------------------------------------------------------------------------
;; F. 幂法求主特征值
;; ----------------------------------------------------------------------------

(display "====== F. 幂法 ======") (newline)

(check-near "F1 幂法 diag(2,1)→2" (la-power-iteration '((2 0) (0 1)) 64) 2)
(check-near "F2 幂法 diag(3,2,1)→3" (la-power-iteration '((3 0 0) (0 2 0) (0 0 1)) 128) 3)
(check-near "F3 幂法 diag(1,5,2)→5" (la-power-iteration '((1 0 0) (0 5 0) (0 0 2)) 128) 5)

;; ----------------------------------------------------------------------------
;; G. 规模与性能（信息性输出）
;; ----------------------------------------------------------------------------

(display "====== G. 规模与性能 ======") (newline)

;; 程序化构造 80×80 矩阵：a[i][j] = 1 + ((i*7 + j*3) mod 5) * 0.25
(define la_n 80)
(define la_big '())
(define la_bi 0)
(define la_bj 0)
(define la_brow '())
(while (< la_bi la_n) {
  (set! la_brow '())
  (set! la_bj 0)
  (while (< la_bj la_n) {
    (set! la_brow (cons (+ 1 (* 0.25 (mod (+ (* la_bi 7) (* la_bj 3)) 5))) la_brow))
    (set! la_bj (+ la_bj 1))
  })
  (set! la_big (cons (la-reverse la_brow '()) la_big))
  (set! la_bi (+ la_bi 1))
})
(set! la_big (la-reverse la_big '()))
(check "G1 大矩阵尺寸" (la-rows la_big) 80)
(define la_t0 (System.timestamp))
(define la_prod (la-mul la_big la_big))
(define la_dt (- (System.timestamp) la_t0))
(check "G2 乘积尺寸" (la-rows la_prod) 80)
(check "G3 乘法有限时间" (>= la_dt 0) #t)
(display "  80×80 矩阵乘法耗时: ") (display la_dt) (display " ms") (newline)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display la_pass)
(display "  FAIL: ") (display la_fail) (newline)
