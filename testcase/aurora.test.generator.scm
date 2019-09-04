;; 生成器示例
;; 用于演示一等Continuation
;; 说明：本解释器暂时没有将顶级作用域特殊看待，导致捕获Continuation时会同时捕获到后续的generator调用，形成递归。因此引入了判断，使得演示程序能够在10轮递归之内结束。
;; 预期结果：输出1~10

(define count 0)
(define generator #f)
(define g
  (lambda ()
    ((lambda (init)
      (call/cc (lambda (Kont)
                 (set! generator Kont)))
      (set! init (+ init 1))
      (set! count init)
      init) 0)))
