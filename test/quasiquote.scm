
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

;; 直接输出
;; 期望输出：a=${(a 200 100)}
(printf qq)(newline)

;; 准引用列表里面的unquote也应该是词法作用域的。
;; 期望输出：a=${(a 200 100)}
((lambda (a) (printf qq) (newline)) 200)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 以下是故障单#16的测试用例

(define foo (lambda (a lst) (cons `(,a) lst)))
(define lst '())

(set! lst (foo 100 lst))
;; 期望输出((100))
(display lst)(newline)

(set! lst (foo 200 lst))
;; 期望输出((200) (100))
(display lst)(newline)
