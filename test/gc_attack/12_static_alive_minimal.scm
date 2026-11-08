; 12_static_alive_minimal.scm —— 最小复现：静态容器 + alive 标记残留
;
; 机制：'(0) 是编译期字面量（静态对象）。push 原地扩容经 am_list_resize 的
;   `new_lst->base = lst->base` 原样复制对象头，static 标志被继承，于是静态容器
;   持有运行期子对象。旧实现 gc_sweep 对静态对象直接 continue、不复位 alive 位，
;   第 2 轮 gc_mark 因标记残留而短路，其子对象不再被标记 → 被 sweep 释放 → 悬空。
;
; 预期（已修复）：gc#1 与 gc#2 均打印 99。
;   修复前：gc#2 处报 [Runtime] 指令执行异常。
; 备注：正式回归用例是 test/test_gc_static_alive.scm（覆盖更多场景），本文件保留
;   为最小复现，便于日后排查同类问题。
(native System)

(define anchor '(0))               ; 静态字面量列表（非空，便于观察）
(push anchor (cons 99 '()))        ; 原地修改静态列表，引入运行期子对象
(push anchor (cons 100 '()))

(display "before gc: ") (display anchor) (newline)
(System.gc)                        ; 第 1 轮：一切正常
(display "after gc#1: ") (display (car (get_item anchor 1))) (newline)
(System.gc)                        ; 第 2 轮：anchor 的 alive 残留 → 子对象被误杀
(display "after gc#2: ") (display (car (get_item anchor 1))) (newline)
