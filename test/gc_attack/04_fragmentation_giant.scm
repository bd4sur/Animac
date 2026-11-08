; 04_fragmentation_giant.scm —— P2 棋盘碎片 + 周期性巨型分配
;
; 机制：阶段1 交错分配大量小字符串、只保留一半，堆中形成「活-死-活-死」棋盘，
;   空闲链表被切成碎块且无法合并；阶段2 周期性请求约 2.4MB 的巨型连续块，于是
;   (a) first-fit 每次都要扫穿整条碎块空闲链表再失败；
;   (b) 失败后 L0 做最多 4 次「向 VM 区让渡边界 + 重试」，每次重建空闲结构；
;   (c) largest_request 被巨块推高后，碎片水位条件（用量≥30% 且最大空闲块 <
;       max(容量/32, largest_request)）恒成立 → 水位恒为级别 2，每 256 条指令
;       强制压缩一轮。
;
; 预期：每轮巨块分配 1000~2500ms（对照 03 为约 100ms），且堆用量每轮被压回原水平。
; 耗时：宿主约 15s；把 checkerboard 规模或轮次调大（如 40 万 / 12 轮）会进入近乎不
;   推进的状态（实测 600s 未能完成）。
(native System)
(native String)

(define keep (cons 0 '()))   ; 非静态 anchor
(define i 0)
(while (< i 100000) {
  (define s (String.concat "0123456789abcdefghij0123456789abcdefghij-" (String.atom_to_string i)))
  (if (== (mod i 2.0) 0.0) (push keep s))
  (set! i (+ i 1))
})
(display "checkerboard built: ") (display (System.memstat)) (newline)

(define giant
  (lambda (n)
    (define g (cons 0 '()))
    (define k 0)
    (while (< k n) { (push g k) (set! k (+ k 1)) })
    g))

(define round 0)
(while (< round 8) {
  (define t0 (System.timestamp))
  (define g (giant 300000))   ; 巨型连续分配（~2.4MB 单块）
  (set! g '())                ; 丢弃 → 下轮再来
  (set! round (+ round 1))
  (display "round ") (display round)
  (display " cost=") (display (- (System.timestamp) t0)) (display "ms")
  (display " ") (display (System.memstat)) (newline)
})
(display "done") (newline)
