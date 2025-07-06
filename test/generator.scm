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

(define run
  (lambda () {

    (display "测试：使用call/cc模拟其他高级语言的生成器。")(newline)
    (display "此用例用来测试call/cc。")(newline)
    (display "期望结果：1 2 3 4 5 6 7 8 9 10")(newline)
    (display "实际结果：")
    (display (g))
    (display " ")
    (if (>= count 10)
        (newline)
        (display (generator 666)))
    (newline)

  })
)
