;; 矩阵乘法
;; 2025-06

(native Math)
(import List "std.list.scm")

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
          (List.ref matrix (+ index 1))
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

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define run
  (lambda () {

    (define A '((2 3) 11 12 13 21 22 23))
    (define B '((3 4) 11 12 13 14 21 22 23 24 31 32 33 34))

    (display "矩阵乘法测试：用于测试while循环结构") (newline)
    (display "期望输出：((2 4) 776 812 848 884 1406 1472 1538 1604)") (newline)
    (display "实际输出：")
    (display (matmul A B))
    (newline)
    (newline)

  })
)
