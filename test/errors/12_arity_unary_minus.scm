;; 预期：编译失败。没有一元取负：取负数须写 (- 0 x)（doc/manual.md §6.2.4）
(display (- 1))
;; expect-stderr: 只接受 2 个参数，实际传入 1 个
