; 01_baseline_churn.scm —— 对照组：纯垃圾搅动，无大存活集合
;
; 每组分配 50 个临时列表对象后立即丢弃。GC 每轮几乎无事可标、无事可压，
; 作为 02_thrash_high_watermark.scm 的对照（同一份搅动负载，仅少了存活集合）。
;
; 预期：正常结束，堆已用量稳定在 1MB 量级。
; 耗时：宿主约 0.2s（256MB 池）。
(native System)

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
      (set! l '())
      (set! i (+ i 1))
    })
    i))

(churn 20000)
(display "done memstat=") (display (System.memstat)) (newline)
