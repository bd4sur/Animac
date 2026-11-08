; 07_deepnest_mark_crash.scm —— C1 深嵌套结构打崩 gc_mark（原生栈溢出）
;
; 机制：gc_mark 用 C 递归遍历列表子对象。用 while 循环迭代构造深层嵌套
;   （(set! x (cons x '()))，每层一个列表对象，不消耗 IL 栈、不触发 1024 帧
;   非尾递归上限），嵌套深度达到十万量级后，自动 GC 或 System.gc 触发时
;   gc_mark 的递归深度 = 嵌套深度，耗尽 8MB 原生栈 → SIGSEGV。
;
; 预期：不是可恢复的运行时错误，而是**整个解释器段错误退出**（实测崩溃点：
;   gdb 回溯全部帧为 gc_mark，rsp 触底）。同理可攻击 runtime_value_equal（equal?）。
; 耗时：数秒内崩溃。
; 注意：会产生 core dump，建议 `ulimit -c 0; ./main test/gc_attack/07_deepnest_mark_crash.scm`。
;   若宿主栈上限不同，可调整下方 DEPTH 阈值观察临界点。
(native System)

(define DEPTH 1000000)    ; 目标嵌套层数（8MB 栈实测在 10 万层量级崩溃）
(define STEP 100000)      ; 进度打印间隔

(define x '())
(define i 0)
(while (< i DEPTH) {
  (set! x (cons x '()))   ; 每轮套一层：x := (x)
  (set! i (+ i 1))
  (if (== (mod i STEP) 0.0) {
    (display "depth=") (display i)
    (display " ") (display (System.memstat)) (newline)
  })
})
(display "built, forcing gc...") (newline)
(System.gc)
(display "survived") (newline)
