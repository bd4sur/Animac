;; 预期：编译失败。cons 是二元内建过程（doc/manual.md §6.4）
(display (cons 1))
;; expect-stderr: 内建过程 cons 只接受 2 个参数，实际传入 1 个
