;;;;;;;;;;;;;;;;;;;;;;;;;
;; Animac测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 打印某年某月的日历

(define get-value-iter
  (lambda (list i counter)
    (if (= counter i)
        (car list)
        (get-value-iter (cdr list) i (+ counter 1)))))

(define get-value
  (lambda (list i)
    (get-value-iter list i 0)))

(define is-leap-year?
  (lambda (year)
    (cond ((and (= (% year 4) 0)
                (not (= (% year 100) 0)))
           #t)
          ((= (% year 400) 0)
           #t)
          (else
           #f))))

(define days-of-month
  (lambda (year month)
    (cond ((< month 1) 0)
          ((> month 12) 0)
          (else (cond ((is-leap-year? year)
                       (get-value '(0 31 29 31 30 31 30 31 31 30 31 30 31) month))
                      (else
                       (get-value '(0 31 28 31 30 31 30 31 31 30 31 30 31) month)))))))

(define days-of-year
  (lambda (year)
    (if (is-leap-year? year)
        366 
        365)))

;某月某日是某年的第几天
(define day-count
  (lambda (year month day)
    (cond ((= month 0) day)
          (else (+ (days-of-month year (- month 1)) (day-count year (- month 1) day))))))

;计算两个日期之间的日数差
(define day-diff
  (lambda (y1 m1 d1 y2 m2 d2)
    (cond ((= y1 y2) (- (day-count y2 m2 d2) (day-count y1 m1 d1)))
          (else (+ (days-of-year (- y2 1)) (day-diff y1 m1 d1 (- y2 1) m2 d2))))))

;计算某日的星期数
(define get-week
  (lambda (year month day)
    (% (day-diff 2017 1 1 year month day) 7)))

;格式输出
(define print-iter
  (lambda (year month iter blank-flag)
    (cond ((>= iter (+ (get-week year month 1) (days-of-month year month)))
           (newline)) ;月末结束
          ((< iter (get-week year month 1)) {
             (display "   ")
             (print-iter year month (+ iter 1) blank-flag)}) ;月初空格
          (else
             (cond ((and (< (- iter (get-week year month 1)) 9) (= blank-flag 0)) {
                      (display " ")
                      (print-iter year month iter 1)})
                   (else
                      (cond ((= (% iter 7) 6) {
                               (display (+ 1 (- iter (get-week year month 1)))) (newline) (print-iter year month (+ iter 1) 0)}) ;行末换行
                            (else {(display (+ 1 (- iter (get-week year month 1)))) (display " ") (print-iter year month (+ iter 1) 0)}))))))))

(define print-calendar
  (lambda (year month)
    (print-iter year month 0 0)))

(define Calendar
  (lambda (year month)
    (display "Animac测试用例：日历")(newline)
    (display "2012.6      C语言编写")(newline)
    (display "2017.8.26   改写为Scheme")(newline)
    (display year)(display "年")(display month)(display "月")(newline)
    (display "====================")(newline)
    (display "Su Mo Tu We Th Fr Sa")(newline)
    (display "====================")(newline)
    (print-calendar year month)
    (display "====================")(newline)
  ))

(define run
  (lambda () {
    (Calendar 2019 9)
    (newline)
    (newline)
  })
)
