; 05_strindex_poison.scm —— P3 驻留字符串毒化（strindex poisoning）
;
; 【2026-10 工单 #39 已修复】驻留表已改为弱驻留：GC 后按轮次戳扫尾，只保留仍被
;   引用的字符串表项。本文件保留为压力/对比用例：修复后堆用量与驻留表项数应有界。
;
; 机制：长度 ≤ 32 的运行期字符串一律登记到进程 strindex，而 strindex 中的全部
;   handle 在每轮 GC 的根收集阶段都被当作永久根。即使没有任何变量引用这些字符串，
;   GC 也永远无法回收它们。堆占用单调上涨：越过 75% 后，每 256 条指令触发一轮
;   全量 GC + 压缩，每轮标记/清除/压缩全部驻留字符串，却一个字节也收不回来。
;
; 预期：堆用量单调上涨、累计耗时呈二次增长（每 10 万个字符串的耗时递增），
;   越过 75% 后进度近乎停滞，最终堆耗尽并令进程被分配失败终止。
; 耗时：默认 TARGET=3000000 实际上无法跑完（会长时间停顿），观察趋势请用
;   06_strindex_quadratic.scm；或把下方 TARGET 调小、用 Ctrl-C 提前结束。
(native System)
(native String)

(define TARGET 3000000)   ; 试图产生的不同短字符串个数（越小越早结束）
(define STEP 300000)      ; 进度打印间隔

(define i 0)
(while (< i TARGET) {
  (String.concat "k" (String.atom_to_string i))   ; 产生全新短字符串（修复前 → 驻留 → 永久根）
  (set! i (+ i 1))
  (if (== (mod i STEP) 0.0) {
    (display "i=") (display i)
    (display " ") (display (System.memstat)) (newline)
  })
})
(display "survived") (newline)
