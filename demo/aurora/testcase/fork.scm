;; 测试fork

(define test
  (lambda (n)
    (if (= n 3)
        (begin
        (display "从外部模块fork子进程")
        (fork "./main.scm")
        (display "直接根据代码fork子进程")
        (fork (begin (native HTTPS)
                     (native String)
                     (display "子进程开始啦")
                     (define foo
                        (lambda (n)
                          (if (= n 0)
                              1
                              (* n (foo (- n 1))))))
                     (define response #f)
                     (set! response (HTTPS.request "https://mikukonai.com/feed.xml"))
                     (display response)
                     (display "子进程内部的阻塞过程执行完毕，继续执行后面的过程")
                     (display (String.length "一二三四五六七八九十"))
                     ((lambda (res)
                        (begin (display "子进程里计算阶乘的结果：")
                               (display res)))
                      (foo 10))))
        (test (+ n 1)))
        (if (= n 6)
            (display "父进程执行完毕")
            (test (+ n 1))))))
(test 1)
