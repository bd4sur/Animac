;; 基于离散傅里叶变换的大整数乘法算法
;; 2023-08-15

(native String)
(native Math)
(import List "list.scm")
(import FFT "fft.scm")

(define charcode_of_zero (String.charCodeAt 0 "0"))

;; 乘法结果位数（FFT所需序列长度）
(define fft_len
  (lambda (str1 str2)
    (define str1len (String.length str1))
    (define str2len (String.length str2))
    (define maxlen (* 2 (if (> str1len str2len) str1len str2len)))
    (define loglen (Math.round (Math.log2 maxlen)))
    (if (= (% loglen 2) 0) (pow 2 (+ 2 loglen)) (pow 2 (+ 1 loglen)))))

;; 十进制数字字符串转为复数（虚部为0）列表
(define numstr_to_complex_vector
  (lambda (numstr fftlen)
    (define numlen (String.length numstr))
    (define complex_vector '())
    (define iter
      (lambda (pos)
        (if (= pos fftlen)
            complex_vector {
            (if (and (>= pos numlen) (< pos fftlen))
                (set! complex_vector (List.append '(0 0) complex_vector))
                { (define charcode (String.charCodeAt (- (- numlen pos) 1) numstr))
                  (define digit (- charcode charcode_of_zero))
                  (set! complex_vector (List.append `(,digit 0) complex_vector)) })
            (iter (+ 1 pos)) })))
    (iter 0)))

;; 复数列表转回十进制数字字符串
(define complex_vector_to_numstr
  (lambda (cv fftlen)
    (define numstr "")
    (define carry 0)
    (define iter
      (lambda (i)
        (if (>= i fftlen)
            numstr
            { (define complex_value (List.ref cv i))
              (define c (+ carry (Math.round (car complex_value))))
              (if (and (>= c 0)(<= c 9))
                  { (set! numstr (String.concat (String.fromCharCode (+ c charcode_of_zero)) numstr))
                    (set! carry 0) }
                  { (set! numstr (String.concat (String.fromCharCode (+ (% c 10) charcode_of_zero)) numstr))
                    (set! carry (Math.round (/ (- c (% c 10)) 10))) })
              (iter(+ i 1)) })))
    (iter 0)))

;; 去掉数字字符串的前导零
(define trim_leading_zeros
  (lambda (nstr)
    (define s "")
    (define slen (String.length nstr))
    (define iter
      (lambda (i is_leading)
        (define current_digit (- (String.charCodeAt i nstr) charcode_of_zero))
        (if (= i slen)
            s
            (if (and is_leading (= current_digit 0))
                (iter (+ i 1) #t)
                { (set! s (String.concat s (String.fromCharCode (+ current_digit charcode_of_zero))))
                  (iter (+ i 1) #f) }))))
    (iter 0 #t)))

;; 两个十进制大整数字符串相乘，输出也是字符串
(define big_int_multiply
  (lambda (astr bstr)
    (define fftlen (fft_len astr bstr))
    (define a_cv (numstr_to_complex_vector astr fftlen))
    (define b_cv (numstr_to_complex_vector bstr fftlen))
    (define aa_cv (FFT.fft a_cv fftlen))
    (define bb_cv (FFT.fft b_cv fftlen))
    (define cc_cv (FFT.list_pointwise FFT.complex_mul aa_cv bb_cv))
    (define c_cv (FFT.ifft cc_cv fftlen))
    (trim_leading_zeros (complex_vector_to_numstr c_cv fftlen))))

(define run
  (lambda () {
    (display "基于FFT的大整数乘法\n")
    (display "预期结果（直接数字相乘） = ")
    (display (* 114514 1919810))
    (newline)
    (display "实际结果（大数乘法算法） = ")
    (display (big_int_multiply "114514" "1919810"))
    (newline)
    (newline)
  })
)
