;; 异步回调测试：睡眠排序 :-)
;; 2025-07-03
;; 这是一种幽默的排序算法，指的是对列表中每个元素（数值n）创建一个线程，
;; 每个线程延迟n毫秒后将其输出，这样自然就得到了排序好的列表
;; 由于JS时钟并不精确，因此输出结果有随机性，可以多运行几次

(native System)
(import List "list.scm")

(define array '(9 1 8 6 2 7 3 6 0 4 5))
(define sorted '())

(define make_promise
  (lambda (i)
    (System.set_timeout (+ 20 (* 50 (get_item array i))) ;; 因JS时钟分辨率有限，延时至少20ms
      (lambda ()
        (set! sorted (List.append (get_item array i) sorted))))))

(display "排序前：") (display array) (newline)

(define i 0)
(while (< i (length array)) {
  (make_promise i)
  (set! i (+ i 1))
})

(System.set_timeout 800 (lambda () (display "排序后：") (display sorted) (newline)))

;; 注意！由于目前while结构的实现，实质上只是简单的goto跳转，因此循环体所在的begin表达式，并不能视为与JS类似的块作用域
;;   下面的实现中，所有的延时执行闭包都捕获了最外层的i，而这些i实际上是同一个，并且只有当主进程执行完毕后，延时执行闭包才会执行，
;;   而此时i已经被while循环set!成11，所以所有的延时执行闭包都只能取到11，并没有起到捕获【当前循环体内绑定环境】的作用。
;; 后续，可能把while的循环体改成单独的作用域，以保持与JS类似的块作用域特性；或者教育用户手动封装promise，如上面代码所示。
;;
;; (define i 0)
;; (while (< i (length array)) {
;;   (System.set_timeout (get_item array i)
;;     (lambda ()
;;       (set! sorted (List.append (get_item array i) sorted))
;;       (display sorted) (newline)
;;       ))
;;   (set! i (+ i 1))
;; })
