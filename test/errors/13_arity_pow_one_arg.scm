;; 预期：编译失败。pow 是二元内建过程（doc/manual.md §6.2.4），少传参数同样是非法程序
(pow 2)
;; expect-stderr: 内建过程 pow 只接受 2 个参数，实际传入 1 个
