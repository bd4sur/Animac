;; fibonacci.scm
;; 计算斐波那契数列

(define fibonacci
  (lambda (n)
    (cond ((= n 0) 1)
          ((= n 1) 1)
          (else (+ (fibonacci (- n 1))
                   (fibonacci (- n 2)))))))
