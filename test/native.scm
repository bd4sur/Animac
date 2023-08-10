(import Utils "utils.scm")
(define run
  (lambda () {
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "Fork和Native库测试：")(newline)

(fork {
    (Utils.show "子进程1：HTTPS请求")(newline)
    (native HTTPS)
    (define res #f)
    (set! res (HTTPS.Request "https://www.baidu.com/123"))
    (Utils.show res)
    (Utils.show "子进程1结束")(newline)
})

(fork {
    (Utils.show "子进程2：读取文件")(newline)
    (native File)
    (define res #f)
    (set! res (File.Read "LICENSE"))
    (Utils.show res)
    (newline)
    (define foo
    (lambda (n)
        (if (= n 0)
            1
            (* n (foo (- n 1))))))
    ((lambda (kkk)
       (Utils.show "子进程里计算阶乘的结果：")
       (Utils.show kkk)
       (newline))
     (foo 10))
    (Utils.show "子进程2结束")(newline)
})

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
}))