;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 准引用列表（quasiquote）

(define printf
  (lambda (template)
    (cond ((null? template) #f)
          ((not (list? template)) (display template))
          (else {
              (display (car template))
              (printf (cdr template))
          }))))

(define a 100)

(define qq `("a=${" ,(car `((a ,(* a 2) ,a) 1 a ,a ,(* a a))) "}"))

(printf qq)(newline)

;; 准引用列表里面的unquote也应该是词法作用域的。
((lambda (a)
    (printf (cdr qq))
    (newline)
 ) 200)
