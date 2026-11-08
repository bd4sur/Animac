; 10_fork_amplification.scm —— P5 fork 放大：指数堆增长 × 全进程 GC
;
; 机制：所有虚拟机进程共享同一块物理堆区；System.fork 深拷贝整个逻辑堆。
;   持有较大堆的进程连续 fork，对象数每轮翻倍；而 am_gc_collect 每次都要对
;   **所有**进程逐一标记-清除、再做全局压缩——任一进程的分配都会触发全体进程的 GC。
;
; 预期：约 3 次 fork 后共享堆区被打到 90% 以上，输出若干
;   `[allocator] heap freelist 分配失败`，各进程相继以 [Runtime] 指令执行异常终止，
;   期间 GC 空转（实测 1 次运行约 115s）。
; 注意：会耗尽内存池并让所有进程死亡，属预期；退出码可能非 0。
(native System)

(define anchor (cons 0 '()))
(define i 0)
(while (< i 150000) {
  (push anchor (cons i '()))
  (set! i (+ i 1))
})
(display "anchor built: ") (display (System.memstat)) (newline)

(define n 0)
(while (< n 5) {
  (define pid (System.fork))
  (display "fork ") (display n) (display " -> pid=") (display pid)
  (display " ") (display (System.memstat)) (newline)
  (set! n (+ n 1))
})

; 每个进程都搅动垃圾，迫使 GC 在全部进程堆上反复执行
(define k 0)
(while (< k 300) {
  (define l '())
  (define j 0)
  (while (< j 50) { (set! l (cons j l)) (set! j (+ j 1)) })
  (set! l '())
  (set! k (+ k 1))
})
(display "process done: ") (display (System.memstat)) (newline)
