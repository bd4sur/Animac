; 02_thrash_high_watermark.scm —— P1 高水位抖动（neapolitan thrash）
;
; 机制：先构建约 70 万个微小列表对象作为存活集合（约占初始堆区 128MB 的 72%），
;   此后持续制造少量垃圾。垃圾把水位推过 75% 后，L1 检查（每 256 条指令）即触发
;   一轮「全量标记-清除 + 全局压缩」：每轮标记全部存活对象、扫描全部 handle、
;   qsort 存活指针并 memmove 约 84MB 存活数据，而回收到的只是少量垃圾。
;   存活集合越接近水位线，GC 越频繁、每轮越贵、收益越低。
;
; 预期：memstat 的 heap_used 在 92~97MB（恰跨 75% 线）反复横跳。
; 耗时：宿主约 50s，是同文件搅动负载在 01 对照组下的约 60 倍。
; 备注：anchor 用运行期 cons 创建（非静态对象），避免与静态容器存活标记问题混淆。
(native System)

(define anchor (cons 0 '()))
(define i 0)
(while (< i 700000) {
  (push anchor (cons i '()))
  (set! i (+ i 1))
})
(display "anchor built: ") (display (System.memstat)) (newline)

(define churn
  (lambda (rounds)
    (define k 0)
    (while (< k rounds) {
      (define l '())
      (define j 0)
      (while (< j 50) {
        (set! l (cons j l))
        (set! j (+ j 1))
      })
      (set! l '())
      (set! k (+ k 1))
      (if (== (mod k 2000) 0.0) {
        (display "churn ") (display k)
        (display " ") (display (System.memstat)) (newline)
      })
    })
    k))

(churn 20000)
(display "done: ") (display (System.memstat)) (newline)
