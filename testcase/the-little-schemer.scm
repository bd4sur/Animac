;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; The Little Schemer

;; 判断list是不是lat（list of atoms）
(define lat?
  (lambda (list)
    (cond ((null? list) #t)
          ((atom? (car list)) (lat? (cdr list)))
          (else #f))))

(display (lat? '(1 2 3 a b))) (newline)     ; #t
(display (lat? '(1 2 3 a "b"))) (newline)   ; #f
(display (lat? '(1 (2) 3 (a b)))) (newline) ; #f

;; 判断某个原子是否为某个lat的成员
(define member?
  (lambda (x lat)
    (cond ((null? lat) #f) ;找遍列表也没找到
          ((eq? x (car lat)) #t)
          (else (member? x (cdr lat))))))

(display (member? 'a '(1 2 3 a b))) (newline)  ; #t
(display (member? 'c '(1 2 3 a b))) (newline)  ; #f

;; 返回删除了第一个a的lat
(define rember
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((eq? a (car lat)) (cdr lat))
          (else (cons (car lat) (rember a (cdr lat)))))))

(display (rember 'a '(1 2 3 a b a 4 5 6))) (newline)  ; (1 2 3 b a 4 5 6)
(display (rember 'a '(1 2 3 b 4 5 6))) (newline)      ; (1 2 3 b 4 5 6)

;; 删除表中所有匹配原子
(define delete
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((member? a lat) (delete a (rember a lat)))
          (else lat))))

(display (delete 'a '(1 2 3 a b a 4 5 6))) (newline)  ; (1 2 3 b 4 5 6)
(display (delete 'a '(1 2 3 b 4 5 6))) (newline)      ; (1 2 3 b 4 5 6)

;; 输出一个表的各子表的car组成的表
(define firsts
  (lambda (list)
    (cond ((null? list) '())
          ((list? (car list)) (cons (car (car list)) (firsts (cdr list)))) ;; 注：应为pair?
          (else (cons (car list) (firsts (cdr list)))))))

(display (firsts '((1 2) ((3) a) (b (a)) (4 5 6)))) (newline)  ; (1 (3) b 4)

;; 该函数查找old在list的第一次出现位置，并在其后插入new。函数返回新列表
(define insertR
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons (car list) (cons new (cdr list))))
          (else (cons (car list) (insertR new old (cdr list)))))))

(display (insertR 'hello 'a '(1 2 a 3 a))) (newline)  ; (1 2 a hello 3 a)

;;在左侧插入
(define insertL
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new list))
          (else (cons (car list) (insertL new old (cdr list)))))))

(display (insertL 'hello 'a '(1 2 a 3 a))) (newline)  ; (1 2 hello a 3 a)

;; 用new替换old在list的首个出现
(define subst
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new (cdr list)))
          (else (cons (car list) (subst new old (cdr list)))))))

(display (subst 'hello 'a '(1 2 a 3 a))) (newline)  ; (1 2 hello 3 a)

;; 用new替换o1或者o2在list的首个出现
(define subst2
  (lambda (new o1 o2 list)
    (cond ((null? list) list)
          ((or (eq? o1 (car list)) (eq? o2 (car list))) (cons new (cdr list)))
          (else (cons (car list) (subst2 new o1 o2 (cdr list)))))))

(display (subst2 'hello 'a 3 '(1 2 3 a))) (newline)  ; (1 2 hello a)


(define list '(1 2 3 4))

(define list-set
  (lambda (list pos new-value iter)
    (define list-set!-iter
      (lambda (list pos new-value iter)
        (cond ((= iter pos) (cons new-value (cdr list)))
              (else (cons (car list) (list-set!-iter (cdr list) pos new-value (+ iter 1)))))))
    (list-set!-iter list pos new-value 0)))
;; 这里并不会修改list，只会返回新list
(display (list-set list 0 10 0)) (newline)
(display (list-set list 1 20 0)) (newline)
(display (list-set list 2 30 0)) (newline)
(display (list-set list 3 40 0)) (newline)
;; 而这里是有副作用的
(set! list (list-set list 0 10 0))
(display list) (newline)
(set! list (list-set list 1 20 0))
(display list) (newline)
(set! list (list-set list 2 30 0))
(display list) (newline)
(set! list (list-set list 3 40 0))
(display list) (newline)

;;;;;;;;;;;;;;;;;;;;;;;;
;; 第四章
;;;;;;;;;;;;;;;;;;;;;;;;

;加一函数
(define add1
  (lambda (n)
    (+ n 1)))
;减一函数
(define sub1
  (lambda (n)
    (- n 1)))

(define zero?
  (lambda (x) (= 0 x)))

(define add
  (lambda (a b)
    (if (zero? b)
        a
        (add (add1 a) (sub1 b)))))

(define add-r
  (lambda (a b)
    (if (zero? b)
        a
        (add1 (add a (sub1 b))))))

(display (add 10 20)) (newline)
(display (add-r 10 20)) (newline)

;元组累积
(define addtup
  (lambda (list)
    (cond ((null? list) 0)
          (else (add (car list) (addtup (cdr list)))))))

(display (addtup '(10 20 30 40 50 60 70 80 90 100))) (newline)

;乘法
(define multiply
  (lambda (a b)
    (cond ((eq? b 0) 0)
          (else (add a (multiply a (sub1 b)))))))

(display (multiply 15 20)) (newline)

;向量加法
(define tup+
  (lambda (list1 list2)
    (cond ((or (null? list1) (null? list2)) '())
          (else (cons (add (car list1) (car list2)) (tup+ (cdr list1) (cdr list2)))))))

(display (tup+ '(1 2 3 4 5) '(5 4 3 2 1))) (newline)

(define lt
  (lambda (a b)
    (cond ((zero? b) #f)
          ((zero? a) #t)
          (else (lt (sub1 a) (sub1 b))))))

(define le
  (lambda (a b)
    (cond ((zero? a) #t)
          ((zero? b) #f)
          (else (le (sub1 a) (sub1 b))))))

(define gt
  (lambda (a b)
    (cond ((zero? a) #f)
          ((zero? b) #t)
          (else (gt (sub1 a) (sub1 b))))))

(define ge
  (lambda (a b)
    (cond ((zero? b) #t)
          ((zero? a) #f)
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
    (cond ((zero? b) 1)
          (else (multiply a (mypow a (sub1 b)))))))

(display (mypow 3 3)) (newline)

(define div
  (lambda (a b)
    (cond ((< a b) 0)
          (else (add1 (div (- a b) b))))))

(display (div 21 4)) (newline)

(define len
  (lambda (lat)
    (cond ((null? lat) 0)
          (else (add1 (len (cdr lat)))))))

(display (len '(1 a 3))) (newline)
(display (len '())) (newline)

