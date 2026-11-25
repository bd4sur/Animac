;; 预期：编译失败。dynamic-wind 必须恰好三个参数（doc/manual.md §6.7）
(dynamic-wind (lambda () 1) (lambda () 2))
;; expect-stderr: 内建过程 dynamic-wind 只接受 3 个参数，实际传入 2 个
