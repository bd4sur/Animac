;; 快速排序，用于验证一等函数、列表操作、if、and/or等特殊结构
;; 此排序算法无法处理重复元素

(define filter
  (lambda (f lst)
    (if (null? lst)
        '()
        (if (f (car lst))
            (cons (car lst) (filter f (cdr lst)))
            (filter f (cdr lst))))))

(define concat
  (lambda (a b)
    (if (null? a)
        b
        (cons (car a) (concat (cdr a) b)))))

(define quicksort
  (lambda (array)
    (if (or (null? array) (null? (cdr array)))
        array
        (concat (quicksort (filter (lambda (x)
                                     (if (< x (car array)) #t #f))
                                   array))
                           (cons (car array)
                                 (quicksort (filter (lambda (x)
                                                      (if (> x (car array)) #t #f))
                                                    array)))))))

(display "【SSC编译】快速排序：")
(display (quicksort '(5 9 1 7 5 3 0 4 6 8 2)))
(newline)
