;; 解数独：用于测试语言核心、call/cc和列表原位操作
;; 2025-06-30

(import List "list.scm")

(define board '(
  (1 2 3 0 0 0 0 0 0)
  (4 5 6 0 0 0 0 0 0)
  (7 8 9 0 0 0 0 0 0)
  (0 0 0 1 2 3 0 0 0)
  (0 0 0 4 5 6 0 0 0)
  (0 0 0 7 8 9 0 0 0)
  (0 0 0 0 0 0 1 2 3)
  (0 0 0 0 0 0 4 5 6)
  (0 0 0 0 0 0 7 8 9)
))

(define RANK 9)

(define get_cell (lambda (board i j) (get_item (get_item board i) j)))
(define set_cell (lambda (board i j n) (set_item! (get_item board i) j n)))

(define show
  (lambda (board)
    (define i 0)
    (while (< i RANK) {
        (display "\t")
        (display (get_item board i))
        (newline)
        (set! i (+ i 1))
    })))

(define check
  (lambda (board i j n)
    (call/cc
      (lambda (ret)
        ;; 检查行
        (define count 0)
        (while (< count RANK) {
            (if (== (get_cell board i count) n) (ret #f))
            (set! count (+ count 1))
        })
        ;; 检查列
        (set! count 0)
        (while (< count RANK) {
            (if (== (get_cell board count j) n) (ret #f))
            (set! count (+ count 1))
        })
        ;; 检查所在宫格
        (define row_from (if (< i 3) 0 (if (< i 6) 3 (if (< i 9) 6 (ret #f)))))
        (define col_from (if (< j 3) 0 (if (< j 6) 3 (if (< j 9) 6 (ret #f)))))
        (define count_i row_from)
        (define count_j col_from)
        (while (< count_i (+ row_from 3)) {
            (set! count_j col_from)
            (while (< count_j (+ col_from 3)) {
                (if (== (get_cell board count_i count_j) n) (ret #f))
                (set! count_j (+ count_j 1))
            })
            (set! count_i (+ count_i 1))
        })
        #t))))

(define solve_shudu
  (lambda (board)
    (call/cc
      (lambda (ret)
        (define i 0)
        (define j 0)
        (define n 0)
        (while (< i RANK) {
            (set! j 0)
            (while (< j RANK) {
                (if (== 0 (get_cell board i j)) {
                    (define nlist (List.shuffle RANK)) ;; [0,RANK)的乱序列表
                    (set! n 0)
                    (while (< n RANK) {
                        (define rn (+ 1 (get_item nlist n)))
                        (if (check board i j rn) {
                            (set_cell board i j rn)
                            (if (solve_shudu board) (ret #t))
                            (set_cell board i j 0)
                        })
                        (set! n (+ n 1))
                    })
                    (ret #f)
                })
                (set! j (+ j 1))
            })
            (set! i (+ i 1))
        })
        #t))))

(define run
  (lambda () {
    (display "解数独测试：") (newline)
    (display "  注意：因问题为随机生成，在有限内存下可能因VM区耗尽而失败，此为正常现象。") (newline)
    (display "是否有解？")
    (if (solve_shudu board) {
        (display "有解，解为：")
        (newline)
        (show board)
        (newline)
    } {
        (display "无解。")
        (newline)
    })
  })
)
