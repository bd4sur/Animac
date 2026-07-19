;; 辅助测试宏：assert
(define-syntax assert
  (syntax-rules ()
    ((_ expr)
     (if (not expr)
         {
           (display "❌ FAIL")
           (display 'expr)
           (newline)
           (error "Test Failed")
         } {
           (display "✅ PASS")
           (newline)
         }))))

;; ================= 1. my-if =================
(define-syntax my-if
  (syntax-rules ()
    ((_ c t f) (if c t f))))

(display "1. my-if test:") (newline)
(display (my-if #t 1 2)) (newline)
(display (my-if #f 1 2)) (newline)
(assert (eqv? (my-if #t 1 2) 1))
(assert (eqv? (my-if #f 1 2) 2))

;; ================= 2. my-begin =================
(define-syntax my-begin
  (syntax-rules ()
    ((_ e ...) { e ...})))

(display "2. my-begin test:") (newline)
(my-begin
  (display 1)
  (display 2)
  (display 3)
  (newline))

;; ================= 3. my-or =================
(define tmp 100)

(define-syntax my-or
  (syntax-rules ()
    ((_ a b)
     ((lambda (tmp) (if tmp tmp b)) a))))

(display "3. my-or test:") (newline)
(display (my-or #f 42)) (newline)
(display tmp) (newline)
(assert (eqv? (my-or #f 42) 42))
(assert (eqv? tmp 100)) ; 验证卫生宏：内部 tmp 未捕获全局 tmp

;; ================= 4. let-syntax =================
(define global 100)

(display "4. let-syntax test:") (newline)
(let-syntax ((local (syntax-rules () ((_) 42))))
  (display (local)) (newline)
  (display global) (newline)
  (assert (eqv? (local) 42)))

(let-syntax ((twice (syntax-rules () ((_ body) {body body}))))
  (twice (display 1)))
(newline)

(display global) (newline)
(assert (eqv? global 100))

;; ================= 5. my-when =================
(define-syntax my-when
  (syntax-rules (else)
    ((_ test e1 e2 ...) (if test {e1 e2 ...} #f))
    ((_ else e1 e2 ...) {e1 e2 ...})))

(display "5. my-when test:") (newline)
(my-when #t (display 1) (display 2))
(newline)
(my-when else (display 3))
(newline)
(assert (eqv? (my-when #t 10 20) 20))
(assert (eqv? (my-when #f 10 20) #f))
(assert (eqv? (my-when else 10 20) 20)) ; 验证字面量 else

;; ================= 6. inc! and double-inc! =================
(define-syntax inc!
  (syntax-rules ()
    ((_ x) (set! x (+ x 1)))))

(define-syntax double-inc!
  (syntax-rules ()
    ((_ x) { (inc! x) (inc! x) })))

(define n 0)
(double-inc! n)
(display "6. inc! test: ") (display n) (newline)
(assert (eqv? n 2))

;; ================= 7. unused =================
(define-syntax unused
  (syntax-rules ()
    ((_ x) x)))
(display "7. unused test: ") (display 42) (newline)

;; ================= 8. swap! =================
(define-syntax swap!
  (syntax-rules ()
    ((swap! a b)
     ((lambda (tmp)
        (set! a b)
        (set! b tmp))
      a))))

(define a 1)
(define b 2)
(display "8. swap! test: ") (newline)
(display "交换前  a=") (display a) (display "  b=") (display b) (newline)
(swap! a b)
(display "交换后  a=") (display a) (display "  b=") (display b) (newline)
(assert (eqv? a 2))
(assert (eqv? b 1))

;; ================= 9. with-x =================
(define-syntax with-x
  (syntax-rules ()
    ((_ x body) ((lambda (x) body) 42))))

(define x 999)
(display "9. with-x test: ") (display (with-x x x)) (newline)
(assert (eqv? (with-x x x) 42))
(assert (eqv? x 999)) ; 验证全局 x 未被污染

;; ================= 10. my_for =================
(define-syntax my_for
  (syntax-rules (to do)
    ((my_for var from start to end do body ...)
     ((lambda (var limit)
        (define loop (lambda ()
                       (if (<= var limit)
                           (begin body ...
                                  (set! var (+ var 1))
                                  (loop))
                           'done)))
        (loop))
      start end))))

(define sum 0)
(define i 999)

(display "10. my_for test:") (newline)
(my_for i from 1 to 5 do
  (display i) (newline)
  (set! sum (+ sum i)))

(display "my_for  sum=") (display sum) (display "  i=") (display i) (newline)
(assert (eqv? sum 15))
(assert (eqv? i 999)) ; 全局 i 被遮蔽，保持 999 不变


;; ================= 11. 测试 syntax-rules 模板中 lambda 参数和函数体的 ellipsis 展开 =================
(define-syntax mylet
  (syntax-rules ()
    ((mylet ((name val) ...) body1 body2 ...)
     ((lambda (name ...) body1 body2 ...) val ...))))

(define-syntax mylambda
  (syntax-rules ()
    ((mylambda (name ...) body ...)
     (lambda (name ...) body ...))))

(define ok #t)

(mylet ((a 10) (b 20) (c 30))
  (set! ok (== (+ a (+ b c)) 60))
  (set! ok (== (* a (* b c)) 6000))  )


(mylet ((x 42))
  (set! ok (== x 42))  )

(mylet ((a 1) (b 2))
  (mylet ((c 3) (d 4))
    (set! ok (== (+ a (+ b (+ c d))) 10))))

(define f (mylambda (x y z) (+ x (+ y z))))
(set! ok (== (f 1 2 3) 6))

(if ok {
  (display "✅ PASS macro_lambda") (newline)
} {
  (display "❌ FAIL macro_lambda") (newline)
})

;; ================= 12. quasiquote 中裸 ... 也应被识别为 ellipsis，且 #null 可正常匹配 =================
(define-syntax flat
  (syntax-rules ()
    ((flat ((a b) ...))
     `((,a ...) (,b ...)))
  ))

(define-syntax flat-comma
  (syntax-rules ()
    ((flat-comma ((a b) ...))
     `((,a ,...) (,b ,...)))
  ))

(display "12. quasiquote ellipsis test:") (newline)

(assert (equal? (flat ((1 10) (2 20) (3 30))) '((1 2 3) (10 20 30))))
(assert (equal? (flat ((1 #null) (2 20))) '((1 2) (#null 20))))
(assert (equal? (flat-comma ((1 10) (2 20) (3 30))) '((1 2 3) (10 20 30))))
(assert (equal? (flat-comma ((1 #null) (2 20))) '((1 2) (#null 20))))

(display "✅ PASS quasiquote_ellipsis") (newline)
