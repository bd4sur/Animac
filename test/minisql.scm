;; ============================================================================
;; minisql.scm —— 内存表查询引擎（C 版 Animac 大型实用性测试）
;;
;; 表示约定：
;;   - 数据库 = Table（表名 → 表）；表 = Table（"schema" → 列名列表，"rows" → 行列表）；
;;   - 行 = Table（列名 → 值）；Table 深比较不受支持，断言一律逐键取值核对。
;;
;; 引擎操作：insert（建表/插行）、select（投影）、where（过滤，谓词经 (row-get 行 列) 访问）、
;;           order-by（按列排序，选择排序）、limit、count/sum/avg 聚合。
;; DSL：以 define-syntax 定义 (query 表 (where 谓词) (select 列...)) 的语法糖，
;;      展示 syntax-rules 卫生宏在实用代码中的运用。
;;
;; 验证不变量（自校验，[PASS]/[FAIL] 计数汇总）：
;;   建表/插行/投影/过滤/排序/截取/聚合/宏 DSL 查询的数值与结构断言。
;;
;; 运行方式：./main test/minisql.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)
(native Math)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define sq_pass 0)
(define sq_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! sq_pass (+ sq_pass 1)) (display "  [PASS] ") }
      { (set! sq_fail (+ sq_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

(define sq-reverse (lambda (lst acc) (if (null? lst) acc (sq-reverse (cdr lst) (cons (car lst) acc)))))

;; 行构造辅助：(let-row id name dept salary) → 行 Table
(define let-row (lambda (id name dept salary) {
  (define row (Table.make))
  (Table.set row "id" id)
  (Table.set row "name" name)
  (Table.set row "dept" dept)
  (Table.set row "salary" salary)
  row
}))

;; ----------------------------------------------------------------------------
;; 引擎核心
;; ----------------------------------------------------------------------------

(define sq-db (Table.make))

;; 建表：sq-create "name" (列名列表)
(define sq-create (lambda (name cols) {
  (define t (Table.make))
  (Table.set t "schema" cols)
  (Table.set t "rows" '())
  (Table.set sq-db name t)
}))

;; 插行
(define sq-insert (lambda (name row) {
  (define t (Table.get sq-db name))
  (Table.set t "rows" (cons row (Table.get t "rows")))
}))

(define sq-get-table (lambda (name) (Table.get sq-db name)))
(define sq-rows (lambda (t) (Table.get t "rows")))
(define sq-row-get (lambda (row col) (Table.get row col)))

;; 过滤
(define sq-filter (lambda (rows pred) {
  (define out '())
  (define i 0)
  (define n (length rows))
  (define row #null)
  (while (< i n) {
    (set! row (get_item rows i))
    (if (pred row) (set! out (cons row out)) 0)
    (set! i (+ i 1))
  })
  (sq-reverse out '())
}))

;; 投影：新行只含指定列
(define sq-select (lambda (rows cols) {
  (define out '())
  (define i 0)
  (define n (length rows))
  (while (< i n) {
    (define src (get_item rows i))
    (define newrow (Table.make))
    (define j 0)
    (define nc (length cols))
    (while (< j nc) {
      (define col (get_item cols j))
      (Table.set newrow col (Table.get src col))
      (set! j (+ j 1))
    })
    (set! out (cons newrow out))
    (set! i (+ i 1))
  })
  (sq-reverse out '())
}))

;; 排序：按列值升序的选择排序（返回新行列表）
(define sq-order (lambda (rows col) {
  (define src '())
  (define i 0)
  (define n (length rows))
  (while (< i n) {
    (set! src (cons (get_item rows i) src))
    (set! i (+ i 1))
  })
  (set! src (sq-reverse src '()))
  (define out '())
  (while (> (length src) 0) {
    ;; 找最小
    (define mi 0)
    (define mv (sq-row-get (get_item src 0) col))
    (define j 1)
    (while (< j (length src)) {
      (if (< (sq-row-get (get_item src j) col) mv) { (set! mi j) (set! mv (sq-row-get (get_item src j) col)) } 0)
      (set! j (+ j 1))
    })
    (set! out (cons (get_item src mi) out))
    ;; 删除第 mi 个
    (define rest '())
    (define k 0)
    (define kn (length src))
    (while (< k kn) {
      (if (not (== k mi)) (set! rest (cons (get_item src k) rest)) 0)
      (set! k (+ k 1))
    })
    (set! src (sq-reverse rest '()))
  })
  (sq-reverse out '())
}))

;; 截取前 n 行
(define sq-limit (lambda (rows n) {
  (define out '())
  (define i 0)
  (define m (length rows))
  (while (< i m) {
    (if (< i n) (set! out (cons (get_item rows i) out)) 0)
    (set! i (+ i 1))
  })
  (sq-reverse out '())
}))

;; 近似断言
(define sq-eps (pow 10 -9))
(define check-near (lambda (name actual expected) {
  (define diff (Math.abs (- actual expected)))
  (if (< diff sq-eps)
      { (set! sq_pass (+ sq_pass 1)) (display "  [PASS] ") }
      { (set! sq_fail (+ sq_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (< diff sq-eps)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; 聚合
(define sq-count (lambda (rows) (length rows)))
(define sq-sum (lambda (rows col) {
  (define s 0)
  (define i 0)
  (define n (length rows))
  (while (< i n) {
    (set! s (+ s (sq-row-get (get_item rows i) col)))
    (set! i (+ i 1))
  })
  s
}))
(define sq-avg (lambda (rows col) (/ (sq-sum rows col) (sq-count rows))))

;; ----------------------------------------------------------------------------
;; 卫生宏 DSL：把 (query 表达式 (where 谓词)) 展开为 sq-filter 调用
;; ----------------------------------------------------------------------------

(define-syntax query-where
  (syntax-rules (where)
    ((_ src (where pred)) (sq-filter src pred))))

;; ----------------------------------------------------------------------------
;; A. 建表与插行
;; ----------------------------------------------------------------------------

(display "====== A. 建表与插行 ======") (newline)

(sq-create "employees" '(id name dept salary))
(sq-insert "employees" (let-row 1 "Alice" "eng" 9000))
(sq-insert "employees" (let-row 2 "Bob" "eng" 7500))
(sq-insert "employees" (let-row 3 "Cindy" "sales" 6200))
(sq-insert "employees" (let-row 4 "Dave" "sales" 5800))
(sq-insert "employees" (let-row 5 "Eve" "hr" 7000))
(sq-insert "employees" (let-row 6 "Frank" "eng" 8800))

(define sq_emp (sq-get-table "employees"))
(check "A1 行数" (sq-count (sq-rows sq_emp)) 6)
(check "A2 列数" (length (Table.get sq_emp "schema")) 4)

;; ----------------------------------------------------------------------------
;; B. 过滤与投影
;; ----------------------------------------------------------------------------

(display "====== B. 过滤与投影 ======") (newline)

(display "[cp-b1]") (newline)
(define sq_eng (sq-filter (sq-rows sq_emp) (lambda (r) (String.equals (sq-row-get r "dept") "eng"))))
(check "B1 部门过滤行数" (sq-count sq_eng) 3)
(display "[cp-b2]\n") (display "[cp-b2a]") (newline)
(define sq_high (sq-filter (sq-rows sq_emp) (lambda (r) { (define s (sq-row-get r "salary")) (display "[sal]") (display s) (newline) (> s 7000)) }))
(display "[cp-b2b]\n")
(check "B2 高薪过滤行数" (sq-count sq_high) 3)
(define sq_proj (sq-select (sq-rows sq_emp) '("name")))
(check "B3 投影行数" (sq-count sq_proj) 6)
(display "[cp-p2]") (display (sq-row-get (get_item sq_proj 2) "name")) (newline) (display "[cp-p2-name]") (display (sq-row-get (get_item sq_proj 2) "name")) (newline) (check "B4 投影取值（头插序第3行为Dave）" (sq-row-get (get_item sq_proj 2) "name") "Dave")

;; ----------------------------------------------------------------------------
;; C. 排序与截取
;; ----------------------------------------------------------------------------

(display "====== C. 排序与截取 ======") (newline)

(define sq_sorted (sq-order (sq-rows sq_emp) "salary"))
(check "C1 排序首行" (sq-row-get (get_item sq_sorted 0) "name") "Dave")
(check "C2 排序末行" (sq-row-get (get_item sq_sorted 5) "name") "Alice")
(define sq_top2 (sq-limit sq_sorted 2))
(check "C3 limit行数" (sq-count sq_top2) 2)
(check "C4 limit第2行" (sq-row-get (get_item sq_top2 1) "name") "Cindy")

;; ----------------------------------------------------------------------------
;; D. 聚合
;; ----------------------------------------------------------------------------

(display "====== D. 聚合 ======") (newline)

(check "D1 count" (sq-count (sq-rows sq_emp)) 6)
(check "D2 sum" (sq-sum (sq-rows sq_emp) "salary") 44300)
(check-near "D3 avg" (sq-avg (sq-rows sq_emp) "salary") 7383.333333333333)
(define sq_engsum (sq-sum (sq-filter (sq-rows sq_emp) (lambda (r) (String.equals (sq-row-get r "dept") "eng"))) "salary"))
(check "D4 eng 薪资总和" sq_engsum 25300)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display sq_pass)
(display "  FAIL: ") (display sq_fail) (newline)
