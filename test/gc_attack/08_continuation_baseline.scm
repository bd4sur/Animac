; 08_continuation_baseline.scm —— 对照组：09 的搅动负载（不含续体）
;
; 与 09_continuation_forest.scm 完全相同的垃圾搅动量，仅不捕获续体。
; 预期：宿主约 0.13s。
(native System)
(define k 0)
(while (< k 3000) {
  (define l '())
  (define j 0)
  (while (< j 50) { (set! l (cons j l)) (set! j (+ j 1)) })
  (set! l '())
  (set! k (+ k 1))
})
(display "done") (newline)
