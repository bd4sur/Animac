; 09_continuation_forest.scm —— P4 续体森林：让每轮 GC 拷贝整座栈山
;
; 机制：堆中每个续体对象在每轮 GC 的根收集阶段都会被完整展开——其保存的
;   opstack/fstack 经 am_continuation_get_opstack/fstack 在 VM 区重新分配并拷贝，
;   所有栈帧闭包与绑定逐个加入根集合。在 400 层非尾递归深处捕获 200 个续体并
;   永久保存在列表里，之后每轮 GC 都要为它们复制约 200×400 帧的双栈。
;
; 预期：相比 08 对照组约 14 倍耗时（实测 0.13s → 1.87s），vm_used 明显上涨，
;   且续体钉死整份栈快照（堆常驻约 35MB）。
; 耗时：宿主约 2s。
(native System)

(define conts (cons 0 '()))   ; 非静态 anchor

; 在深栈中捕获续体：depth 层非尾递归，每层帧都进续体快照
(define capture-deep
  (lambda (depth)
    (define rec
      (lambda (n)
        (if (== n 0)
            (call/cc (lambda (k) (push conts k) 0))
            (+ 1 (rec (- n 1))))))
    (rec depth)))

(define i 0)
(while (< i 200) {
  (capture-deep 400)
  (set! i (+ i 1))
})
(display "continuations captured: ") (display (length conts)) (newline)
(display (System.memstat)) (newline)

; 搅动垃圾触发 GC：每轮 GC 都要为 200 个续体各拷贝 400 帧 × 双栈
(define k 0)
(while (< k 3000) {
  (define l '())
  (define j 0)
  (while (< j 50) { (set! l (cons j l)) (set! j (+ j 1)) })
  (set! l '())
  (set! k (+ k 1))
  (if (== (mod k 500) 0.0) {
    (display "churn ") (display k)
    (display " ") (display (System.memstat)) (newline)
  })
})
(display "done") (newline)
