
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

(define partition
  (lambda (op pivot array)
    (filter (lambda (x) (if (op x pivot) #t #f)) array)))

(define quicksort
  (lambda (array)
    (define pivot #f)
    (if (or (null? array) (null? (cdr array)))
        array
        {
          (set! pivot (car array))
          (concat (quicksort (partition < pivot array))
                  (concat (partition = pivot array)
                          (quicksort (partition > pivot array))))
        }
    )
))

(define run
  (lambda () {
    (display "快速排序：测试验证列表操作、if、and/or等特殊结构")(newline)
    (display "期望结果：(-3 -3 -2 -1 0 1 2 3 4 5 5 6 6 6 7 8 9)")(newline)
    (display "实际结果：")
    (display (quicksort '(6 -3 5 9 -2 6 1 7 -3 5 3 0 4 -1 6 8 2)))
    (newline)
    (newline)
  })
)
