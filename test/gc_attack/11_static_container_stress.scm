; 11_static_container_stress.scm —— 静态容器大规模压力（修复验证）
;
; 场景：静态字面量容器 '(nil) 经 push 原地扩容后持有 20 万个运行期子列表，
;   再以 4000 组垃圾搅动让水位/周期 GC 自动触发多轮，最后逐个校验全部子对象。
;
; 用途：验证「静态对象必须每轮复位 alive 位」的修复在自动 GC 路径、大规模数据下
;   依然成立（见 test/test_gc_static_alive.scm 的显式 GC 版本）。
; 预期：len=200001、e0/e100000/e200000 正确、corrupted=0。
(native System)
(define root '(nil))
(define i 0)
(while (< i 200000) { (push root (cons i '())) (set! i (+ i 1)) })
(display "built ") (display (length root)) (display " ") (display (System.memstat)) (newline)
(define k 0)
(while (< k 4000) {
  (define g '())
  (define m 0)
  (while (< m 50) { (set! g (cons m g)) (set! m (+ m 1)) })
  (set! g '())
  (set! k (+ k 1))
})
(display "after-churn ") (display (System.memstat)) (newline)
(display "len=") (display (length root))
(display " e0=") (display (car (get_item root 1)))
(display " e100000=") (display (car (get_item root 100000)))
(display " e200000=") (display (car (get_item root 200000))) (newline)
(define bad 0)
(define j 1)
(while (<= j 200000) {
  (if (not (== (car (get_item root j)) (- j 1))) (set! bad (+ bad 1)))
  (set! j (+ j 1))
})
(display "corrupted=") (display bad) (newline)
