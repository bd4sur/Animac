;; 预期：编译失败。display 是一元内建过程（doc/manual.md §6.6）
(display 1 2)
;; expect-stderr: 内建过程 display 只接受 1 个参数，实际传入 2 个
