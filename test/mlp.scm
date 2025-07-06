;; 多层感知机训练与推理
;; 2025-06-28

(native Math)
(import List "list.scm")

;; 矩阵的存储格式：M行N列的矩阵A，以线性列表的方式存储，格式为：
;;   注：m:=M-1 n:=N-1
;;   '((M N) A00 A01 ... A0j ...... A0n ... Ai0 Ai1 ... Aij ... Ain ...... Am0 Am1 ... Amj ... Amn)

(define get_cell
  (lambda (matrix row col)
    (define mat_row (car (car matrix)))
    (define mat_col (car (cdr (car matrix))))
    (if (and (>= row 0) (>= col 0) (< row mat_row) (< col mat_col))
        {
          (define index (+ (* row mat_col) col))
          (get_item matrix (+ index 1))
        }
        {
          #f
        })))

(define matmul
  (lambda (a b)
    (define a_row (car (car a)))
    (define a_col (car (cdr (car a))))
    (define b_row (car (car b)))
    (define b_col (car (cdr (car b))))

    (define res `((,a_row ,b_col)))

    (define i 0)
    (define j 0)
    (define k 0)

    (define dot_product 0)

    (if (= a_col b_row)
    {
      (while (< i a_row) {
        (set! j 0)
        (while (< j b_col) {
            (set! k 0)
            (set! dot_product 0)
            (while (< k a_col) {
              (set! dot_product (+ dot_product (* (get_cell a i k) (get_cell b k j))))
              (set! k (+ k 1))
            })
            (set! res (List.append dot_product res))
            (set! j (+ j 1))
        })
        (set! i (+ i 1))
      })
      res
    }
    {
      #f
    })))

;; 按行列显示矩阵
(define show
  (lambda (mat)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define i 0)
    (define j 0)
    (display "\n")
    (while (< i m_row) {
      (set! j 0)
      (display "\t")
      (while (< j m_col) {
        (display (get_cell mat i j))
        (display "\t")
        (set! j (+ j 1))
      })
      (display "\n")
      (set! i (+ i 1))
    })))

;; 矩阵加向量：向量广播到矩阵的每一列。不检查参数。
;; m.shape=(m,n)  v.shape=(1,n)
(define add_vector
  (lambda (mat vec)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define i 0)
    (define j 0)
    (define res `((,m_row ,m_col)))
    (while (< i m_row) {
      (set! j 0)
      (while (< j m_col) {
        (set! res (List.append (+ (get_cell mat i j) (get_cell vec 0 j)) res))
        (set! j (+ j 1))
      })
      (set! i (+ i 1))
    })
    res))

;; 寻找整个矩阵内的最大值
(define max_value
  (lambda (mat)
    (define iter
      (lambda (mm maxv)
        (if (null? mm)
            maxv
            (iter (cdr mm) (if (> (car mm) maxv) (car mm) maxv)))))
    (iter (cdr mat) -100000000000))) ;; NOTE 最小的number

;; 对向量(1,)作softmax
(define softmax
  (lambda (vec)
    (define col (car (cdr (car vec))))
    (define maxv (max_value vec))
    (define array (cdr vec))
    (define buf (List.map array (lambda (v) (Math.exp (- v maxv)))))
    (define sum (List.reduce buf (lambda (v acc) (+ v acc)) 0))
    (cons `(1 ,col) (List.map buf (lambda (v) (/ v sum))))))

;; 取矩阵的第row行
(define get_row
  (lambda (mat row)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define i 0)
    (define res `((1 ,m_col)))
    (while (< i m_col) {
      (set! res (List.append (get_cell mat row i) res))
      (set! i (+ i 1))
    })
    res))

;; 对矩阵的每一行作softmax
(define softmax_rowwise
  (lambda (mat)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define res `((,m_row ,m_col)))
    (define i 0)
    (while (< i m_row) {
      (define row (get_row mat i))
      (define sm (softmax row))
      (set! res (List.concat res (cdr sm)))
      (set! i (+ i 1))
    })
    res))

;; 逐点一元运算
(define unary_pointwise
  (lambda (mat unary_op)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (List.concat `((,m_row ,m_col)) (List.map (cdr mat) unary_op))))

;; ReLU激活函数
(define ReLU
  (lambda(x) (if (< x 0) 0 x)))

;; 把两个列表组合成一个二元组列表，直到其中一个列表为空
(define zip
  (lambda (list_a list_b)
    (if (or (null? list_a) (null? list_b))
        '()
        (cons `(,(car list_a) ,(car list_b)) (zip (cdr list_a) (cdr list_b))))))

;; 逐点二元运算
(define binary_pointwise
  (lambda (a b binary_op)
    (define a_row (car (car a)))
    (define a_col (car (cdr (car a))))
    ;; NOTE 形状必须一致，此处不检查
    (List.concat `((,a_row ,a_col))
                 (List.map (zip (cdr a) (cdr b))
                   (lambda (pair) (binary_op (car pair) (car (cdr pair))))))))

;; 按列累加：把同一列的都加起来，得到一个向量，即(m,n)->(1,n)
(define sum_in_col
  (lambda (mat)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define i 0)
    (define j 0)
    (define res `((1 ,m_col)))
    (define sum 0)
    (while (< i m_col) {
      (set! sum 0)
      (set! j 0)
      (while (< j m_row) {
        (set! sum (+ sum (get_cell mat j i)))
        (set! j (+ j 1))
      })
      (set! res (List.append sum res))
      (set! i (+ i 1))
    })
    res))

;; 矩阵转置
(define T
  (lambda (mat)
    (define m_row (car (car mat)))
    (define m_col (car (cdr (car mat))))
    (define i 0)
    (define j 0)
    (define res `((,m_col ,m_row)))
    (while (< i m_col) {
      (set! j 0)
      (while (< j m_row) {
        (set! res (List.append (get_cell mat j i) res))
        (set! j (+ j 1))
      })
      (set! i (+ i 1))
    })
    res))

;; 从两层嵌套列表构建矩阵
(define make_matrix
  (lambda (array2d)
    (define cells '())
    (define row 0)
    (define col 0)
    (define array_outer array2d)
    (define array_inner '())
    (while (not (null? array_outer)) {
      (set! array_inner (car array_outer))
      (set! col 0)
      (while (not (null? array_inner)) {
        (set! cells (List.append (car array_inner) cells))
        (set! col (+ col 1))
        (set! array_inner (cdr array_inner))
      })
      (set! row (+ row 1))
      (set! array_outer (cdr array_outer))
    })
    (List.concat `((,row ,col)) cells)))

;; 随机初始化矩阵
(define init_matrix
  (lambda (row col)
    (define mat `((,row ,col)))
    (define i (* row col))
    (while (> i 0) {
      (set! mat (List.append (- (Math.random) 0.5) mat))
      (set! i (- i 1))
    })
    mat))

;; 前向传播
(define forward
  (lambda (x W0 W1 W2 b0 b1 b2)
    (define a0 x)
    ;; Layer 0
    (define z1 (add_vector (matmul a0 W0) b0))
    (define a1 (unary_pointwise z1 ReLU))
    ;; Layer 1
    (define z2 (add_vector (matmul a1 W1) b1))
    (define a2 (unary_pointwise z2 ReLU))
    ;; Layer 2
    (define z3 (add_vector (matmul a2 W2) b2))
    (define a3 (softmax_rowwise z3))
    ;; return
    `(,a0 ,a1 ,a2 ,a3)))

;; 反向传播
(define backward
  (lambda (a0 a1 a2 a3 y W0 W1 W2)
    ;; 交叉熵
    (define dl_dz (binary_pointwise a3 y (lambda (x y) (- x y))))
    ;; Layer 2
    (define grad_W2 (matmul (T a2) dl_dz))
    (define grad_b2 (sum_in_col dl_dz))
    (define dl_da2 (matmul dl_dz (T W2)))
    (define buf2 (unary_pointwise a2 (lambda (x) (if (<= x 0) 0 1))))
    (set! dl_dz (binary_pointwise dl_da2 buf2 (lambda (x y) (* x y))))
    ;; Layer 1
    (define grad_W1 (matmul (T a1) dl_dz))
    (define grad_b1 (sum_in_col dl_dz))
    (define dl_da1 (matmul dl_dz (T W1)))
    (define buf1 (unary_pointwise a1 (lambda (x) (if (<= x 0) 0 1))))
    (set! dl_dz (binary_pointwise dl_da1 buf1 (lambda (x y) (* x y))))
    ;; Layer 0
    (define grad_W0 (matmul (T a0) dl_dz))
    (define grad_b0 (sum_in_col dl_dz))
    (define dl_da0 (matmul dl_dz (T W0)))
    (define buf0 (unary_pointwise a0 (lambda (x) (if (<= x 0) 0 1))))
    (set! dl_dz (binary_pointwise dl_da0 buf0 (lambda (x y) (* x y))))
    ;; return
    `((,grad_W0 ,grad_W1 ,grad_W2) (,grad_b0 ,grad_b1 ,grad_b2))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define get_batch
  (lambda (dataset indexes batch_size)
    (define i 0)
    (define indexes_rem indexes)
    (define res '())
    (while (< i batch_size) {
      (define k (car indexes_rem))
      (set! res (cons (get_item dataset k) res))
      (set! indexes_rem (cdr indexes_rem))
      (set! i (+ i 1))
    })
    res))

(define get_length
  (lambda (lst)
    (if (null? lst) 0 (+ 1 (get_length (cdr lst))))))

(define slice
  (lambda (lst from_index to_index)
    (define i from_index)
    (define res '())
    (while (< i to_index) {
      (set! res (List.append (List.ref lst i) res))
      (set! i (+ i 1))
    })
    res))

;; 从softmax输出向量(1,n)中取出最大值所在的下标
(define argmax
  (lambda (vec)
    (define v_col (car (cdr (car vec))))
    (define i 0)
    (define maxv -1000000000)
    (define maxi 0)
    (while (< i v_col) {
      (define v (get_cell vec 0 i))
      (if (> v maxv)
          {
            (set! maxi i)
            (set! maxv v)
          }
          0)
      (set! i (+ i 1))
    })
    maxi))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 交叉熵损失度量
(define cross_entropy_loss
  (lambda (y_gt y_hat)
    (define y_row (car (car y_gt)))
    (define y_col (car (cdr (car y_gt))))
    (define i 0)
    (define j 0)
    (define loss_sum 0)
    (while (< i y_row) {
      (set! j 0)
      (while (< j y_col) {
        (set! loss_sum (+ loss_sum (- 0 (* (Math.log (get_cell y_hat i j)) (get_cell y_gt i j)))))
        (set! j (+ j 1))
      })
      (set! i (+ i 1))
    })
    loss_sum))

(define validate
  (lambda (x_batch y_batch W0 W1 W2 b0 b1 b2)
    (define a (forward x_batch W0 W1 W2 b0 b1 b2))
    (define y_hat (get_item a 3))
    (define batch_size (car (car x_batch)))
    (define tp_count 0)
    (define cats '())
    (define i 0)
    (while (< i batch_size) {
      (define y_hat_i (get_row y_hat i))
      (define y_gt_i (get_row y_batch i))
      (define pred_cat (argmax y_hat_i))
      (define gt_cat (argmax y_gt_i))
      (set! tp_count (+ tp_count (if (= pred_cat gt_cat) 1 0)))
      (set! cats (List.append pred_cat cats))
      (set! i (+ i 1))
    })
    (display "  Loss @ ValidSet = ") (display (cross_entropy_loss y_batch y_hat)) (newline)
    (display "  Output tags = ") (display cats) (newline)
    (display "  Acc = ") (display (/ tp_count batch_size)) (newline)
  ))

(define train
  (lambda (x_train y_train trainset_size x_valid y_valid validset_size)
    (define W0 (init_matrix 4 6))  (define W1 (init_matrix 6 6))  (define W2 (init_matrix 6 3))
    (define b0 (init_matrix 1 6))  (define b1 (init_matrix 1 6))  (define b2 (init_matrix 1 3))

    (define BATCH_SIZE 6)
    (define LEARNING_RATE 0.008)
    (define iter 0)
    (define epoch 0)

    (while (< epoch 1000) {
      (display "Epoch ") (display epoch) (display " (") (display (/ trainset_size BATCH_SIZE)) (display " iterations) ")
      (set! iter 0)
      (define indexes (List.shuffle trainset_size))
      (while (< iter (/ trainset_size BATCH_SIZE)) {
        (display ".")

        (define batch_indexes (slice indexes (* BATCH_SIZE iter) (* BATCH_SIZE (+ 1 iter))))
        (define x_batch (make_matrix (get_batch x_train batch_indexes BATCH_SIZE)))
        (define y_batch (make_matrix (get_batch y_train batch_indexes BATCH_SIZE)))

        (define a (forward x_batch W0 W1 W2 b0 b1 b2))
        (define a0 (get_item a 0))  (define a1 (get_item a 1))  (define a2 (get_item a 2))  (define a3 (get_item a 3))

        (define grad (backward a0 a1 a2 a3 y_batch W0 W1 W2))
        (define grad_W0 (get_item (car grad) 0))
        (define grad_W1 (get_item (car grad) 1))
        (define grad_W2 (get_item (car grad) 2))
        (define grad_b0 (get_item (car (cdr grad)) 0))
        (define grad_b1 (get_item (car (cdr grad)) 1))
        (define grad_b2 (get_item (car (cdr grad)) 2))

        (define update_with_lr (lambda (x y) (- x (* LEARNING_RATE y))))

        (set! W0 (binary_pointwise W0 grad_W0 update_with_lr))
        (set! W1 (binary_pointwise W1 grad_W1 update_with_lr))
        (set! W2 (binary_pointwise W2 grad_W2 update_with_lr))

        (set! b0 (binary_pointwise b0 grad_b0 update_with_lr))
        (set! b1 (binary_pointwise b1 grad_b1 update_with_lr))
        (set! b2 (binary_pointwise b2 grad_b2 update_with_lr))

        (set! iter (+ iter 1))
      })
      (newline)
      (validate (make_matrix x_valid) (make_matrix y_valid) W0 W1 W2 b0 b1 b2)
      (set! epoch (+ epoch 1))
    })))



;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; 鸢尾花分类数据集：训练集120个样本，验证集30个样本。为简单起见，验证集当测试集用。

(define IRIS_TRAINSET_X '(
;; 类别1：setosa
(5.1 3.5 1.4 0.2) (4.9 3.0 1.4 0.2) (4.7 3.2 1.3 0.2) (4.6 3.1 1.5 0.2) (5.0 3.6 1.4 0.2) (5.4 3.9 1.7 0.4) (4.6 3.4 1.4 0.3) (5.0 3.4 1.5 0.2) (4.4 2.9 1.4 0.2) (4.9 3.1 1.5 0.1) (5.4 3.7 1.5 0.2) (4.8 3.4 1.6 0.2) (4.8 3.0 1.4 0.1) (4.3 3.0 1.1 0.1) (5.8 4.0 1.2 0.2) (5.7 4.4 1.5 0.4) (5.4 3.9 1.3 0.4) (5.1 3.5 1.4 0.3) (5.7 3.8 1.7 0.3) (5.1 3.8 1.5 0.3) (5.4 3.4 1.7 0.2) (5.1 3.7 1.5 0.4) (4.6 3.6 1.0 0.2) (5.1 3.3 1.7 0.5) (4.8 3.4 1.9 0.2) (5.0 3.0 1.6 0.2) (5.0 3.4 1.6 0.4) (5.2 3.5 1.5 0.2) (5.2 3.4 1.4 0.2) (4.7 3.2 1.6 0.2) (4.8 3.1 1.6 0.2) (5.4 3.4 1.5 0.4) (5.2 4.1 1.5 0.1) (5.5 4.2 1.4 0.2) (4.9 3.1 1.5 0.2) (5.0 3.2 1.2 0.2) (5.5 3.5 1.3 0.2) (4.9 3.6 1.4 0.1) (4.4 3.0 1.3 0.2) (5.1 3.4 1.5 0.2)
;; 类别2：versicolor
(7.0 3.2 4.7 1.4) (6.4 3.2 4.5 1.5) (6.9 3.1 4.9 1.5) (5.5 2.3 4.0 1.3) (6.5 2.8 4.6 1.5) (5.7 2.8 4.5 1.3) (6.3 3.3 4.7 1.6) (4.9 2.4 3.3 1.0) (6.6 2.9 4.6 1.3) (5.2 2.7 3.9 1.4) (5.0 2.0 3.5 1.0) (5.9 3.0 4.2 1.5) (6.0 2.2 4.0 1.0) (6.1 2.9 4.7 1.4) (5.6 2.9 3.6 1.3) (6.7 3.1 4.4 1.4) (5.6 3.0 4.5 1.5) (5.8 2.7 4.1 1.0) (6.2 2.2 4.5 1.5) (5.6 2.5 3.9 1.1) (5.9 3.2 4.8 1.8) (6.1 2.8 4.0 1.3) (6.3 2.5 4.9 1.5) (6.1 2.8 4.7 1.2) (6.4 2.9 4.3 1.3) (6.6 3.0 4.4 1.4) (6.8 2.8 4.8 1.4) (6.7 3.0 5.0 1.7) (6.0 2.9 4.5 1.5) (5.7 2.6 3.5 1.0) (5.5 2.4 3.8 1.1) (5.5 2.4 3.7 1.0) (5.8 2.7 3.9 1.2) (6.0 2.7 5.1 1.6) (5.4 3.0 4.5 1.5) (6.0 3.4 4.5 1.6) (6.7 3.1 4.7 1.5) (6.3 2.3 4.4 1.3) (5.6 3.0 4.1 1.3) (5.5 2.5 4.0 1.3)
;; 类别3：virginica
(6.3 3.3 6.0 2.5) (5.8 2.7 5.1 1.9) (7.1 3.0 5.9 2.1) (6.3 2.9 5.6 1.8) (6.5 3.0 5.8 2.2) (7.6 3.0 6.6 2.1) (4.9 2.5 4.5 1.7) (7.3 2.9 6.3 1.8) (6.7 2.5 5.8 1.8) (7.2 3.6 6.1 2.5) (6.5 3.2 5.1 2.0) (6.4 2.7 5.3 1.9) (6.8 3.0 5.5 2.1) (5.7 2.5 5.0 2.0) (5.8 2.8 5.1 2.4) (6.4 3.2 5.3 2.3) (6.5 3.0 5.5 1.8) (7.7 3.8 6.7 2.2) (7.7 2.6 6.9 2.3) (6.0 2.2 5.0 1.5) (6.9 3.2 5.7 2.3) (5.6 2.8 4.9 2.0) (7.7 2.8 6.7 2.0) (6.3 2.7 4.9 1.8) (6.7 3.3 5.7 2.1) (7.2 3.2 6.0 1.8) (6.2 2.8 4.8 1.8) (6.1 3.0 4.9 1.8) (6.4 2.8 5.6 2.1) (7.2 3.0 5.8 1.6) (7.4 2.8 6.1 1.9) (7.9 3.8 6.4 2.0) (6.4 2.8 5.6 2.2) (6.3 2.8 5.1 1.5) (6.1 2.6 5.6 1.4) (7.7 3.0 6.1 2.3) (6.3 3.4 5.6 2.4) (6.4 3.1 5.5 1.8) (6.0 3.0 4.8 1.8) (6.9 3.1 5.4 2.1)
))

(define IRIS_TRAINSET_Y '(
;; 类别1：setosa
(1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0)
;; 类别2：versicolor
(0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0)
;; 类别3：virginica
(0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1)
))

(define IRIS_VALIDSET_X '(
;; 类别1：setosa
(5.0 3.5 1.3 0.3) (4.5 2.3 1.3 0.3) (4.4 3.2 1.3 0.2) (5.0 3.5 1.6 0.6) (5.1 3.8 1.9 0.4) (4.8 3.0 1.4 0.3) (5.1 3.8 1.6 0.2) (4.6 3.2 1.4 0.2) (5.3 3.7 1.5 0.2) (5.0 3.3 1.4 0.2)
;; 类别2：versicolor
(5.5 2.6 4.4 1.2) (6.1 3.0 4.6 1.4) (5.8 2.6 4.0 1.2) (5.0 2.3 3.3 1.0) (5.6 2.7 4.2 1.3) (5.7 3.0 4.2 1.2) (5.7 2.9 4.2 1.3) (6.2 2.9 4.3 1.3) (5.1 2.5 3.0 1.1) (5.7 2.8 4.1 1.3)
;; 类别3：virginica
(6.7 3.1 5.6 2.4) (6.9 3.1 5.1 2.3) (5.8 2.7 5.1 1.9) (6.8 3.2 5.9 2.3) (6.7 3.3 5.7 2.5) (6.7 3.0 5.2 2.3) (6.3 2.5 5.0 1.9) (6.5 3.0 5.2 2.0) (6.2 3.4 5.4 2.3) (5.9 3.0 5.1 1.8)
))

(define IRIS_VALIDSET_Y '(
;; 类别1：setosa
(1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0) (1 0 0)
;; 类别2：versicolor
(0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0) (0 1 0)
;; 类别3：virginica
(0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1) (0 0 1)
))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define run
  (lambda () {
    (train IRIS_TRAINSET_X IRIS_TRAINSET_Y 120 IRIS_VALIDSET_X IRIS_VALIDSET_Y 30)
  })
)
