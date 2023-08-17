;; The Little Schemer 第四章

(define add1 (lambda (n) (+ n 1)))
(define sub1 (lambda (n) (- n 1)))
(define is_zero (lambda (x) (= 0 x)))

(define add (lambda (a b) (if (is_zero b) a (add (add1 a) (sub1 b)))))
(define add_r (lambda (a b) (if (is_zero b) a (add1 (add a (sub1 b))))))

;元组累积
(define addtup (lambda (lst) (cond ((null? lst) 0) (else (add (car lst) (addtup (cdr lst)))))))

;乘法
(define multiply (lambda (a b) (cond ((is_zero b) 0) (else (add a (multiply a (sub1 b)))))))

;向量加法
(define vector_pointwise_add
  (lambda (list1 list2)
    (cond ((or (null? list1) (null? list2)) '())
          (else (cons (add (car list1) (car list2)) (vector_pointwise_add (cdr list1) (cdr list2)))))))

(define lt
  (lambda (a b)
    (cond ((is_zero b) #f)
          ((is_zero a) #t)
          (else (lt (sub1 a) (sub1 b))))))

(define le
  (lambda (a b)
    (cond ((is_zero a) #t)
          ((is_zero b) #f)
          (else (le (sub1 a) (sub1 b))))))

(define gt
  (lambda (a b)
    (cond ((is_zero a) #f)
          ((is_zero b) #t)
          (else (gt (sub1 a) (sub1 b))))))

(define ge
  (lambda (a b)
    (cond ((is_zero b) #t)
          ((is_zero a) #f)
          (else (ge (sub1 a) (sub1 b))))))

;; TODO 这个是应该是关键字
(define eqn
  (lambda (a b)
    (cond ((lt a b) #f)
          ((gt a b) #f)
          (else #t))))

;; TODO 关键字
(define mypow
  (lambda (a b)
    (cond ((is_zero b) 1)
          (else (multiply a (mypow a (sub1 b)))))))

(define div
  (lambda (a b)
    (cond ((< a b) 0)
          (else (add1 (div (- a b) b))))))

(define len
  (lambda (lat)
    (cond ((null? lat) 0)
          (else (add1 (len (cdr lat)))))))

(define run
  (lambda () {
    (display "简单递归函数测试：来自 The Little Schemer 第四章")(newline)

    (display "期望结果：30 30 550 600 (6 6 6 6 6) 27 5 3 0\n实际结果：")
    (display (add 10 20)) (display " ")
    (display (add_r 10 20)) (display " ")
    (display (addtup '(10 20 30 40 50 60 70 80 90 100))) (display " ")
    (display (multiply 20 30)) (display " ")
    (display (vector_pointwise_add '(1 2 3 4 5) '(5 4 3 2 1))) (display " ")
    (display (mypow 3 3)) (display " ")
    (display (div 21 4)) (display " ")
    (display (len '(1 a 3))) (display " ")
    (display (len '()))

    (newline)
    (newline)
  })
)
