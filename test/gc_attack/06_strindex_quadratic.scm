; 06_strindex_quadratic.scm —— P3 的计时版：量化二次增长
;
; 【2026-10 工单 #39 已修复】本文件保留作 A/B 对比；修复后应近似线性完成。
;
; 与 05 同一机制，但每 10 万个字符串打印一次累计耗时与 memstat，便于观察
; 「垃圾数量 ↑ → GC 更频繁 → 单轮 GC 更贵 → 每万个字符串耗时 ↑」的正反馈。
;
; 实测（256MB 池）：i=100000 → 约 1.0s、200000 → 3.3s、300000 → 8.3s、
;   400000 → 15.5s，累计耗时拟合 t ∝ n²；约 42 万个后堆越过 75% 进入恒 GC 状态。
; 耗时：TARGET=600000 时多数环境跑不完，属预期。
(native System)
(native String)
(define i 0)
(define t0 (System.timestamp))
(while (< i 600000) {
  (String.concat "k" (String.atom_to_string i))
  (set! i (+ i 1))
  (if (== (mod i 100000) 0.0) {
    (display "i=") (display i)
    (display " elapsed=") (display (- (System.timestamp) t0)) (display "ms")
    (display " ") (display (System.memstat)) (newline)
  })
})
