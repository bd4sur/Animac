; 03_fragmentation_baseline.scm —— 对照组：干净堆上的巨型连续分配
;
; 反复分配并丢弃约 30 万元素的列表（列表倍增扩容会请求约 2.4MB 的单块），
; 作为 04_fragmentation_giant.scm 的对照（堆未碎片化）。
;
; 预期：每轮 80~110ms。
(native System)
(define giant
  (lambda (n)
    (define g (cons 0 '()))
    (define k 0)
    (while (< k n) { (push g k) (set! k (+ k 1)) })
    g))
(define round 0)
(while (< round 8) {
  (define t0 (System.timestamp))
  (define g (giant 300000))
  (set! g '())
  (set! round (+ round 1))
  (display "round ") (display round)
  (display " cost=") (display (- (System.timestamp) t0)) (display "ms")
  (display " ") (display (System.memstat)) (newline)
})
