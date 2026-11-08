; test_strindex_weak.scm —— 短字符串“弱驻留”回归用例
;
; 回归的问题：运行期构造的长度 ≤32 的字符串会被登记进进程 strindex，而旧实现把
; strindex 中的全部 handle 当作永久 GC 根。于是任何运行期短串（包括 String.concat
; 的每一层中间结果）都会永久占住堆区，内存只增不减，程序运行越久越接近 OOM。
;
; 修复方案（方案 A）：驻留表不再是 GC 根，而是“活串去重缓存”。每轮 GC 给存活对象
; 打轮次戳，sweep 之后只保留指向本轮存活字符串的表项；存活率过低时重建压缩表。
; 语义不变量：两个同内容的短字符串只要同时存活，创建时仍去重为同一 handle，
; 因此 eq? 的短串保证与散列表字符串键继续成立。
;
; 本用例覆盖：
;   场景1 eq? 短串保证（GC 前后、字面量与运行期字符串、长串不驻留）；
;   场景2 存活短串跨 GC 保活，并能与新构造的同内容字符串去重；
;   场景3 Table 字符串键跨 GC 仍可命中（键本身就是活引用）；
;   场景4 大量短串垃圾在 GC 后从驻留表消失，堆区/VM 区用量有界（核心回归点）。

(native System)
(native String)
(native Table)

(define sw_pass 0)
(define sw_fail 0)

(define sw_check
  (lambda (name expected actual)
    (if (equal? expected actual)
        (set! sw_pass (+ sw_pass 1))
        {
          (display "FAIL ") (display name)
          (display ": expected=") (display expected)
          (display " actual=") (display actual)
          (newline)
          (set! sw_fail (+ sw_fail 1))
        })))

;; ---------------------------------------------------------------------------
;; 场景1：eq? 的短串保证
;; ---------------------------------------------------------------------------
(define sw_a (String.concat "ab" "c"))
(define sw_b (String.concat "a" "bc"))
(sw_check "sw1_eq_before_gc" #t (eq? sw_a sw_b))
(sw_check "sw1_literal_vs_runtime" #t (eq? "abc" (String.concat "ab" "c")))

(define sw_l1 (String.concat "aaaaaaaaaaaaaaaaaaaaaaaa" "aaaaaaaaaaaaaaaa"))
(define sw_l2 (String.concat "aaaaaaaaaaaaaaaaaaaaaaaa" "aaaaaaaaaaaaaaaa"))
(sw_check "sw1_long_not_interned" #f (eq? sw_l1 sw_l2))
(sw_check "sw1_long_equal_content" #t (equal? sw_l1 sw_l2))

;; ---------------------------------------------------------------------------
;; 场景2：存活短串跨 GC 保活，并与新构造的同内容字符串去重
;; ---------------------------------------------------------------------------
(define sw_keep '())
(push sw_keep (String.concat "keep" (String.atom_to_string 7)))
(System.gc)
(sw_check "sw2_kept_content" #t (equal? (get_item sw_keep 0) "keep7"))
(sw_check "sw2_kept_identity" #t (eq? (get_item sw_keep 0) (String.concat "keep" (String.atom_to_string 7))))
(sw_check "sw2_eq_after_gc" #t (eq? sw_a sw_b))
(sw_check "sw2_literal_vs_runtime_after_gc" #t (eq? "abc" (String.concat "ab" "c")))

;; ---------------------------------------------------------------------------
;; 场景3：Table 字符串键跨 GC 仍可命中
;; ---------------------------------------------------------------------------
(define sw_t (Table.make))
(Table.set sw_t "greet" 42)
(Table.set sw_t (String.concat "ab" "c") 99)
(System.gc)
(sw_check "sw3_table_literal_key" 42 (Table.get sw_t "greet"))
(sw_check "sw3_table_runtime_key" 99 (Table.get sw_t (String.concat "a" "bc")))

;; ---------------------------------------------------------------------------
;; 场景4：短串垃圾不累积（核心回归点）
;;   先建立基线，再制造 20 万个内容唯一的短串，全部立即成为垃圾；
;;   显式 GC 后，驻留表表项数应回到基线附近，堆区/VM 区不应随垃圾量增长。
;;   旧实现下：表项数会增加约 20 万，堆区至少增长约 10MB 且永不回落。
;; ---------------------------------------------------------------------------
(System.gc)
(define sw_ms0 (System.memstat))
(define sw_intern0 (get_item sw_ms0 4))
(define sw_heap0 (get_item sw_ms0 3))
(define sw_vm0 (get_item sw_ms0 1))

(define sw_i 0)
(while (< sw_i 200000) {
  (String.concat "k" (String.atom_to_string sw_i))
  (set! sw_i (+ sw_i 1))
})

(System.gc)
(define sw_ms1 (System.memstat))
(define sw_intern1 (get_item sw_ms1 4))
(define sw_heap1 (get_item sw_ms1 3))
(define sw_vm1 (get_item sw_ms1 1))

(display "sw interned: base=") (display sw_intern0)
(display " after=") (display sw_intern1)
(display " heap: ") (display sw_heap0) (display " -> ") (display sw_heap1)
(display " vm: ") (display sw_vm0) (display " -> ") (display sw_vm1) (newline)

(sw_check "sw4_interned_pruned" #t (< sw_intern1 (+ sw_intern0 32)))
(sw_check "sw4_heap_bounded" #t (< sw_heap1 (+ sw_heap0 4194304)))
(sw_check "sw4_vm_bounded" #t (< sw_vm1 (+ sw_vm0 4194304)))

;; GC 之后仍然保留 eq? 语义
(sw_check "sw4_eq_after_churn" #t (eq? sw_a sw_b))
(sw_check "sw4_kept_identity_after_churn" #t (eq? (get_item sw_keep 0) "keep7"))

(display "PASS: ") (display sw_pass) (display "  FAIL: ") (display sw_fail) (newline)
