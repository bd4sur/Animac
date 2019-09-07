;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 简单的中缀表达式解析
;; 参见 The Little Schemer

(define numbered?
  (lambda (aexp)
    (cond ((atom? aexp) (number? aexp))
          ((atom? (car (cdr aexp))) (and (numbered? (car aexp)) (numbered? (car (cdr (cdr aexp))))))
          (else #f))))

(define value
  (lambda (aexp)
    (cond ((atom? aexp) aexp)
          ((eq? (car (cdr aexp)) '+)
           (+ (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '-)
           (- (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '*)
           (* (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '/)
           (/ (value (car aexp)) (value (car (cdr (cdr aexp))))))
          (else (display "Unexpected operator")))))

(display (value '((1 / 3) - (1 / 4))))
