; test_gc_watermark.scm — 堆水位触发 GC 的负载测试用例
; 场景1（垃圾搅动）：持续制造“分配后立刻成为垃圾”的列表，验证水位 GC 能及时回收，
;         堆已用量被压制在临界水位以下，小内存池上不发生分配失败。
; 场景2（存活扩张）：持续扩张一个存活的大列表，验证 L0 边界让渡（heap 向 VM 区借界）
;         与水位 GC 的组合下分配持续成功。
; 预期：程序正常跑完并打印 survived，无 [allocator] 分配失败、无 [Runtime] 错误。

(native System)

;; 场景1：垃圾搅动
(define churn
  (lambda (rounds)
    (define i 0)
    (while (< i rounds) {
      (define l '())
      (define j 0)
      (while (< j 50) {
        (set! l (cons j l))
        (set! j (+ j 1))
      })
      (set! l '())   ; 放弃引用，整批成为垃圾
      (set! i (+ i 1))
      (if (== (mod i 5000) 0.0) {
        (display "churn round ") (display i)
        (display " memstat=") (display (System.memstat)) (newline)
      })
    })
    i))

(churn 30000)

;; 场景2：存活扩张（配合垃圾：push 扩容产生的旧数组）
(define big '())
(define i 0)
(while (< i 100000) {
  (push big i)
  (set! i (+ i 1))
  (if (== (mod i 20000) 0.0) {
    (display "grow ") (display i)
    (display " memstat=") (display (System.memstat)) (newline)
  })
})
(display "big length=") (display (length big)) (newline)

(display "survived, final memstat=") (display (System.memstat)) (newline)
