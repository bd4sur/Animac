;; 预期：编译失败。call/cc 只接受一个 thunk 参数（doc/manual.md §6.7）
(call/cc (lambda (k) k) 1)
;; expect-stderr: 内建过程 call/cc 只接受 1 个参数，实际传入 2 个
