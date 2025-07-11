;; 递归实现快速傅里叶变换
;; 2023-08

(native Math)
(import List "list.scm")

;; 把序列按照奇偶分成两部分
(define sep
  (lambda (x)
    (define even
      (lambda (input even_items odd_items)
        (if (null? input)
            `(,even_items ,odd_items)
            (odd (cdr input) (List.append (car input) even_items) odd_items))))
    (define odd
      (lambda (input even_items odd_items)
        (if (null? input)
            `(,even_items ,odd_items)
            (even (cdr input) even_items (List.append (car input) odd_items)))))
    (even x '() '())))

(define complex_mul
  (lambda (x y)
    (define a (car x)) (define b (car (cdr x)))
    (define c (car y)) (define d (car (cdr y)))
    `(,(- (* a c) (* b d)) ,(+ (* b c) (* a d)))))

(define complex_add (lambda (x y) `(,(+ (car x) (car y)) ,(+ (car (cdr x)) (car (cdr y))))))

(define complex_sub (lambda (x y) `(,(- (car x) (car y)) ,(- (car (cdr x)) (car (cdr y))))))

(define list_pointwise
  (lambda (op x y)
    (if (or (null? x) (null? y))
        '()
        (cons (op (car x) (car y))
              (list_pointwise op (cdr x) (cdr y))))))

(define W_nk
  (lambda (N k)
    `(,(Math.cos (/ (* -2 (* (Math.PI) k)) N))
      ,(Math.sin (/ (* -2 (* (Math.PI) k)) N)))))

(define twiddle_factors
  (lambda (N iter)
    (if (= iter (/ N 2)) ;; 只取前一半
        '()
        (cons (W_nk N iter)
              (twiddle_factors N (+ iter 1))))))

(define fft
  (lambda (input N)
    (if (= N 1)
        input
        {
          (define s (sep input))
          (define even_dft (fft (car s)       (/ N 2)))
          (define odd_dft  (fft (car (cdr s)) (/ N 2)))
          (define tf (twiddle_factors N 0))
          (List.concat (list_pointwise complex_add even_dft (list_pointwise complex_mul odd_dft tf))
                       (list_pointwise complex_sub even_dft (list_pointwise complex_mul odd_dft tf)))
        })))

(define ifft
  (lambda (input N)
    ;; 复数列表逐个取共轭
    (define cv_conj
      (lambda (cv)
        (List.map cv (lambda (c) `(,(car c) ,(- 0 (car (cdr c))))))))
    (List.map (cv_conj (fft (cv_conj input) N))
              (lambda (x) `(,(/ (car x) N) ,(/ (car (cdr x)) N))))))



(define run
  (lambda () {
    (display "快速傅里叶变换：用于测试数学本地库和列表操作")(newline)
    (display "FFT期望结果：((8 1) (0 1) (0 1) (0 1) (0 1) (0 1) (0 1) (0 1))")(newline)
    (define N 8)
    (define x '((1 1) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0)))
    (define xx (fft x N))
    (define x2 (ifft xx N))
    (display "FFT实际结果：")
    (display xx)
    (newline)
    (display "IFFT期望结果：((1 1) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0))")(newline)
    (display "IFFT实际结果：")
    (display x2)
    (newline)
    (newline)
  })
)
