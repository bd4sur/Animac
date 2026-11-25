;; 预期：编译失败。set_item! 是三元内建过程（doc/manual.md §6.4）
(define lst '(1 2))
(set_item! lst 0)
;; expect-stderr: 内建过程 set_item! 只接受 3 个参数，实际传入 2 个
