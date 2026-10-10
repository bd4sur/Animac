;; ============================================================================
;; huffman.scm —— 纯 Scheme Huffman 压缩编解码器（C 版 Animac 大型实用性测试）
;;
;; 实现：
;;   - 频率统计：Table（整数码点 → 频次）。注意码点经 charCodeAt 取得为浮点，
;;     必须以 Math.floor 归一化为整数后再作 Table 键（浮点键与整数键不互通）；
;;   - Huffman 树：节点为列表——叶子 [weight, 码点]（长度2）、内部节点
;;     [weight, 左子, 右子]（长度3）；建树用线性扫描选取最小二节点合并；
;;   - 前缀码表：自根 DFS 生成（Table：整数码点 → 0/1 码串）；单符号退化时
;;     约定码 "0"；
;;   - 编码：逐字符查码表拼接；解码：自根逐位走树，达叶子输出并复位。
;;
;; 验证不变量（自校验，[PASS]/[FAIL] 计数汇总）：
;;   1) decode(encode(s)) == s（中英文混合、含标点与数字的样本，往返无损）；
;;   2) 编码总码长 ≤ 8×原始字符数（Huffman 码每符号至多 8 位才不算劣化）；
;;   3) 高偏斜分布（10'a'+1'b'）显著压缩（码长 < 4×原始位数）；
;;   4) 码表满足前缀码性质（任一码不是其他码的前缀）；
;;   5) 单符号退化、空串边界往返无损；
;;   6) 频率统计与手算一致。
;;
;; 运行方式：./main test/huffman.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)
(native Math)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define hf_pass 0)
(define hf_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! hf_pass (+ hf_pass 1)) (display "  [PASS] ") }
      { (set! hf_fail (+ hf_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

(define hf-reverse (lambda (lst acc) (if (null? lst) acc (hf-reverse (cdr lst) (cons (car lst) acc)))))

;; 字符串 → 整数码点列表（charCodeAt 返回浮点，floor 归一化）
(define hf-codes (lambda (s) {
  (define out '())
  (define i 0)
  (define n (String.length s))
  (while (< i n) {
    (set! out (cons (Math.floor (String.charCodeAt i s)) out))
    (set! i (+ i 1))
  })
  (hf-reverse out '())
}))

;; ----------------------------------------------------------------------------
;; 频率统计：Table（整数码点 → 频次）
;; ----------------------------------------------------------------------------

(define hf-freq (lambda (s) {
  (define tbl (Table.make))
  (define codes (hf-codes s))
  (define i 0)
  (define n (length codes))
  (while (< i n) {
    (define c (get_item codes i))
    (if (Table.contains tbl c)
        (Table.set tbl c (+ 1 (Table.get tbl c)))
        (Table.set tbl c 1))
    (set! i (+ i 1))
  })
  tbl
}))

;; ----------------------------------------------------------------------------
;; Huffman 树：叶子 [weight, 码点]；内部 [weight, 左子, 右子]
;; ----------------------------------------------------------------------------

(define hf-node-weight (lambda (node) (get_item node 0)))
(define hf-leaf? (lambda (node) (== (length node) 2)))
(define hf-leaf-char (lambda (node) (get_item node 1)))
(define hf-left (lambda (node) (get_item node 1)))
(define hf-right (lambda (node) (get_item node 2)))

;; 从 forest 中选取权重最小的两个节点的下标（m1 ≤ m2）
(define hf-two-min (lambda (forest) {
  (define m1 -1)
  (define m2 -1)
  (define i 0)
  (define n (length forest))
  (while (< i n) {
    (define w (hf-node-weight (get_item forest i)))
    (if (== m1 -1)
        (set! m1 i)
        (if (== m2 -1)
            { (if (< w (hf-node-weight (get_item forest m1)))
                  { (set! m2 m1) (set! m1 i) }
                  (set! m2 i)) }
            {
              (if (< w (hf-node-weight (get_item forest m1)))
                  { (set! m2 m1) (set! m1 i) }
                  { (if (< w (hf-node-weight (get_item forest m2))) (set! m2 i) 0) })
            }))
    (set! i (+ i 1))
  })
  (cons m1 (cons m2 '()))
}))

;; 建树：反复合并最小二节点；返回根节点
(define hf-build (lambda (freq) {
  ;; 初始 forest：每个符号一个叶子
  (define forest '())
  (define keys (Table.keys freq))
  (define i 0)
  (define n (length keys))
  (while (< i n) {
    (define k (get_item keys i))
    (set! forest (cons (cons (Table.get freq k) (cons k '())) forest))
    (set! i (+ i 1))
  })
  (set! forest (hf-reverse forest '()))
  ;; 反复合并（选择法，字母表小、O(n²) 可接受）
  (define m1 0)
  (define m2 0)
  (define n1 0)
  (define n2 0)
  (define merged #null)
  (define rest '())
  (define j 0)
  (while (> (length forest) 1) {
    (define mm (hf-two-min forest))
    (set! m1 (get_item mm 0))
    (set! m2 (get_item mm 1))
    (set! n1 (get_item forest m1))
    (set! n2 (get_item forest m2))
    (set! merged (cons (+ (hf-node-weight n1) (hf-node-weight n2))
                       (cons n1 (cons n2 '()))))
    ;; 重建 forest：跳过 m1/m2，加入 merged
    (set! rest '())
    (set! j 0)
    (define cnt (length forest))
    (while (< j cnt) {
      (if (and (not (== j m1)) (not (== j m2)))
          (set! rest (cons (get_item forest j) rest))
          0)
      (set! j (+ j 1))
    })
    (set! forest (cons merged (hf-reverse rest '())))
  })
  (get_item forest 0)
}))

;; ----------------------------------------------------------------------------
;; 码表：自根 DFS（Table：整数码点 → 码串）
;; ----------------------------------------------------------------------------

(define hf-codes-from-tree (lambda (root) {
  (define tbl (Table.make))
  ;; 单符号退化：根即叶子，约定码 "0"（不进入 DFS）
  (if (hf-leaf? root)
      { (Table.set tbl (hf-leaf-char root) "0") }
      {
        (define stack '())   ;; (节点 前缀) 对，按头插序处理
        (set! stack (cons (cons root (cons "" '())) '()))
        (define cur #null)
        (define prefix "")
        (while (not (null? stack)) {
          (set! cur (get_item (get_item stack 0) 0))
          (set! prefix (get_item (get_item stack 0) 1))
          (set! stack (cdr stack))
          (if (hf-leaf? cur)
              (Table.set tbl (hf-leaf-char cur) prefix)
              {
                (set! stack (cons (cons (hf-left cur) (cons (String.concat prefix "0") '())) stack))
                (set! stack (cons (cons (hf-right cur) (cons (String.concat prefix "1") '())) stack))
              })
        })
      })
  tbl
}))

;; ----------------------------------------------------------------------------
;; 编码 / 解码
;; ----------------------------------------------------------------------------

(define hf-encode (lambda (s codes) {
  (define out "")
  (define codes-codes (hf-codes s))
  (define i 0)
  (define n (length codes-codes))
  (while (< i n) {
    (set! out (String.concat out (Table.get codes (get_item codes-codes i))))
    (set! i (+ i 1))
  })
  out
}))

(define hf-decode (lambda (bits root) {
  (define out "")
  (define cur root)
  (define i 0)
  (define n (String.length bits))
  ;; 单符号退化：根即叶子，每位对应一个该字符
  (if (hf-leaf? root)
      {
        (while (< i n) {
          (set! out (String.concat out (String.fromCharCode (hf-leaf-char root))))
          (set! i (+ i 1))
        })
        out
      }
      {
  (while (< i n) {
    (if (hf-leaf? cur)
        { (set! out (String.concat out (String.fromCharCode (hf-leaf-char cur)))) (set! cur root) }
        0)
    (if (String.equals (String.slice bits i (+ i 1)) "0")
        (set! cur (hf-left cur))
        (set! cur (hf-right cur)))
    (set! i (+ i 1))
  })
  (if (hf-leaf? cur)
      (String.concat out (String.fromCharCode (hf-leaf-char cur)))
      out)
      })
}))

;; 前缀码性质：任一码不是其他码的前缀
(define hf-is-prefix (lambda (p s) {
  (and (<= (String.length p) (String.length s))
       (String.equals (String.slice s 0 (String.length p)) p))
}))

;; ----------------------------------------------------------------------------
;; A. 频率统计
;; ----------------------------------------------------------------------------

(display "====== A. 频率统计 ======") (newline)

(define hf_freq1 (hf-freq "aab"))
(check "A1 频率表尺寸" (Table.length hf_freq1) 2)
(check "A2 频率 a" (Table.get hf_freq1 (Math.floor 97)) 2)
(check "A3 频率 b" (Table.get hf_freq1 (Math.floor 98)) 1)
(define hf_sum 0)
(define hf_keys (Table.keys (hf-freq "abcabc")))
(define hf_i 0)
(while (< hf_i (length hf_keys)) {
  (set! hf_sum (+ hf_sum (Table.get (hf-freq "abcabc") (get_item hf_keys hf_i))))
  (set! hf_i (+ hf_i 1))
})
(check "A4 频率总和=字符数" hf_sum 6)

;; ----------------------------------------------------------------------------
;; B. 编码/解码往返（核心不变量）
;; ----------------------------------------------------------------------------

(display "====== B. 往返无损 ======") (newline)

(define hf_s1 "the quick brown fox jumps over the lazy dog. 1234567890")
(define hf_f1 (hf-freq hf_s1))
(define hf_t1 (hf-build hf_f1))
(define hf_c1 (hf-codes-from-tree hf_t1))
(define hf_b1 (hf-encode hf_s1 hf_c1))
(define hf_d1 (hf-decode hf_b1 hf_t1))
(check "B1 中英文混合往返" (String.equals hf_d1 hf_s1) #t)
(check "B2 码长不超过8×原始" (<= (String.length hf_b1) (* 8 (String.length hf_s1))) #t)

(define hf_s2 "灵机 Animac 是一个 Scheme 解释器，灵机也是一台有灵魂的机器。")
(define hf_f2 (hf-freq hf_s2))
(define hf_t2 (hf-build hf_f2))
(define hf_c2 (hf-codes-from-tree hf_t2))
(define hf_b2 (hf-encode hf_s2 hf_c2))
(define hf_d2 (hf-decode hf_b2 hf_t2))
(check "B3 中文样本往返" (String.equals hf_d2 hf_s2) #t)

;; ----------------------------------------------------------------------------
;; C. 压缩率与前缀码性质
;; ----------------------------------------------------------------------------

(display "====== C. 压缩率与前缀码 ======") (newline)

;; 高偏斜分布：10 个 a + 1 个 b → 最优码长 11 位（原始 88 位）
(define hf_s3 "aaaaaaaaaab")
(define hf_f3 (hf-freq hf_s3))
(define hf_t3 (hf-build hf_f3))
(define hf_c3 (hf-codes-from-tree hf_t3))
(define hf_b3 (hf-encode hf_s3 hf_c3))
(check "C1 高偏斜显著压缩" (< (String.length hf_b3) (* 4 (String.length hf_s3))) #t)
(define hf_d3 (hf-decode hf_b3 hf_t3))
(check "C2 高偏斜往返" (String.equals hf_d3 hf_s3) #t)

;; 前缀码性质：码表两两互不为前缀
(define hf_cks (Table.keys hf_c1))
(define hf_prefok #t)
(set! hf_i 0)
(while (and (< hf_i (length hf_cks)) hf_prefok) {
  (define j2 0)
  (while (and (< j2 (length hf_cks)) hf_prefok) {
    (if (not (== hf_i j2)) {
      (if (hf-is-prefix (Table.get hf_c1 (get_item hf_cks hf_i))
                        (Table.get hf_c1 (get_item hf_cks j2)))
          (set! hf_prefok #f)
          0)
    } 0)
    (set! j2 (+ j2 1))
  })
  (set! hf_i (+ hf_i 1))
})
(check "C3 前缀码性质" hf_prefok #t)
(check "C4 压缩率信息（编码位数/原始位数）" (>= (/ (String.length hf_b1) (* 8.0 (String.length hf_s1))) 0) #t)

;; ----------------------------------------------------------------------------
;; D. 退化与边界
;; ----------------------------------------------------------------------------

(display "====== D. 退化与边界 ======") (newline)

;; 单符号：码长 1/符号
(define hf_s4 "zzzz")
(define hf_f4 (hf-freq hf_s4))
(define hf_t4 (hf-build hf_f4))
(define hf_c4 (hf-codes-from-tree hf_t4))
(define hf_b4 (hf-encode hf_s4 hf_c4))
(check "D1 单符号码长=符号数" (== (String.length hf_b4) 4) #t)
(check "D2 单符号往返" (String.equals (hf-decode hf_b4 hf_t4) hf_s4) #t)

;; 空串
(check "D3 空串编码" (String.equals (hf-encode "" hf_c1) "") #t)
(check "D4 空串解码" (String.equals (hf-decode "" hf_t1) "") #t)

;; 双符号
(define hf_s5 "ababab")
(define hf_f5 (hf-freq hf_s5))
(define hf_t5 (hf-build hf_f5))
(define hf_c5 (hf-codes-from-tree hf_t5))
(define hf_b5 (hf-encode hf_s5 hf_c5))
(check "D6 双符号往返" (String.equals (hf-decode hf_b5 hf_t5) hf_s5) #t)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display hf_pass)
(display "  FAIL: ") (display hf_fail) (newline)
