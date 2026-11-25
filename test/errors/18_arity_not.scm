;; 预期：编译失败。not 是一元内建过程（doc/manual.md §6.3）
(display (not 1 2))
;; expect-stderr: 内建过程 not 只接受 1 个参数，实际传入 2 个
