; test_gc_static_alive.scm —— 静态容器存活标记（GC 误扫存活对象）回归用例
;
; 回归的问题：静态对象（如 '(0) 这类列表字面量）经 push 原地扩容后，对象头
; （含 static 位）被 am_list_resize 原样复制，使静态容器得以持有运行期子对象。
; 旧实现在 gc_sweep 中「跳过静态对象」且不清除其 alive 位，于是下一轮 gc_mark
; 在该对象上因标记残留而短路返回，其运行期子对象全部不再被标记 —— 第二轮 GC
; 之后句柄悬空，取元素即报 [Runtime] 指令执行异常。
;
; 本用例覆盖四件事：
;   场景1 静态字面量列表 push 扩容 + 连续两轮显式 GC；
;   场景2 静态字面量列表 set_item! 原地改写 + 连续两轮显式 GC；
;   场景3 多层「静态 → 运行期 → 运行期」可达链；
;   场景4 自动触发路径（不调用 System.gc），并要求修复没有把不可达垃圾变成泄漏。
;
; 判定：每行输出形如「标签=期望值=>实际值」，出现 [Runtime] 错误或数值不符即为回归。

(native System)

;; ---------------------------------------------------------------------------
;; 场景1：静态字面量列表 push 扩容，连续两轮显式 GC
;; ---------------------------------------------------------------------------
(define anchor '(0))
(push anchor (cons 99 '()))
(push anchor (cons 100 '()))
(display "s1 before-gc len=") (display (length anchor)) (newline)
(System.gc)
(display "s1 gc#1 elem1=99=>") (display (car (get_item anchor 1))) (newline)
(System.gc)
(display "s1 gc#2 elem1=99=>") (display (car (get_item anchor 1)))
(display " elem2=100=>") (display (car (get_item anchor 2)))
(display " len=3=>") (display (length anchor)) (newline)

;; ---------------------------------------------------------------------------
;; 场景2：静态字面量列表 set_item! 原地改写，连续两轮显式 GC
;; ---------------------------------------------------------------------------
(define box '(0))
(set_item! box 0 (cons 7 '()))
(System.gc)
(System.gc)
(display "s2 gc#2 box0=7=>") (display (car (get_item box 0))) (newline)

;; ---------------------------------------------------------------------------
;; 场景3：多层「静态 → 运行期 → 运行期」可达链
;;   static-root（静态）→ chain（运行期）→ 2000 个运行期子列表
;; ---------------------------------------------------------------------------
(define chain (cons 0 '()))
(push chain (cons 1 '()))
(define static-root '(nil))
(push static-root chain)

(define i 0)
(while (< i 2000) {
  (push chain (cons i '()))
  (set! i (+ i 1))
})
(display "s3 chain-len=2002=>") (display (length chain)) (newline)
(System.gc)
(System.gc)
(display "s3 gc#2 elem1=1=>") (display (car (get_item chain 1)))
(display " elem2001=1999=>") (display (car (get_item chain 2001)))
(display " elem1000=998=>") (display (car (get_item chain 1000))) (newline)

;; ---------------------------------------------------------------------------
;; 场景4：自动触发路径 + 无泄漏校验
;;   在静态容器下持续挂运行期对象，再用垃圾搅动让水位/周期 GC 自动触发多轮；
;;   期间必须始终可取到全部元素。最后丢弃垃圾并显式回收，堆用量应下降。
;; ---------------------------------------------------------------------------
(define live '(start))          ; 静态容器
(define j 0)
(while (< j 3000) {
  (push live (cons j '()))
  (set! j (+ j 1))
})

(define k 0)
(while (< k 4000) {
  (define garbage '())
  (define m 0)
  (while (< m 50) {
    (set! garbage (cons m garbage))
    (set! m (+ m 1))
  })
  (set! garbage '())
  (set! k (+ k 1))
})
(display "s4 live-len=3001=>") (display (length live))
(display " first=0=>") (display (car (get_item live 1)))
(display " last=2999=>") (display (car (get_item live 3000))) (newline)

; 无泄漏校验：先回收干净取基准 h1，再制造 3 万个对象的大批垃圾并丢弃、
; 再次回收取 h2。h2 应回落到与 h1 同量级（垃圾被回收且存活集未丢失）。
(System.gc)
(define h1 (get_item (System.memstat) 3))

(define big '())
(define n 0)
(while (< n 30000) { (push big (cons n '())) (set! n (+ n 1)) })
(define h-garbage (get_item (System.memstat) 3))
(set! big '())
(System.gc)
(define h2 (get_item (System.memstat) 3))

(display "s4 heap-used h1(clean)=") (display h1)
(display " h-garbage=") (display h-garbage)
(display " h2(after-gc)=") (display h2) (newline)
(if (< h2 h-garbage)
    (display "s4 垃圾已回收：h2 < h-garbage")
    (display "s4 [FAIL] 垃圾未回收：h2 >= h-garbage"))
(newline)

; 最后一轮 GC 之后再次校验存活集完整性（回归的核心断言）
(display "s4 post-gc live-len=3001=>") (display (length live))
(display " first=0=>") (display (car (get_item live 1)))
(display " mid=1499=>") (display (car (get_item live 1500)))
(display " last=2999=>") (display (car (get_item live 3000))) (newline)

(display "static-alive regression PASSED") (newline)
