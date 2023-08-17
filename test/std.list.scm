;; 应用库
;; 几个高阶函数

;; 判断list是不是lat（list of atoms）
(define lat?
  (lambda (list)
    (cond ((null? list) #t)
          ((atom? (car list)) (lat? (cdr list)))
          (else #f))))

;; 判断某个原子是否为某个lat的成员
(define member?
  (lambda (x lat)
    (cond ((null? lat) #f) ;找遍列表也没找到
          ((eq? x (car lat)) #t)
          (else (member? x (cdr lat))))))

;; 返回删除了第一个a的lat
(define rember
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((eq? a (car lat)) (cdr lat))
          (else (cons (car lat) (rember a (cdr lat)))))))

;; 删除表中所有匹配原子
(define delete_atom
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((member? a lat) (delete_atom a (rember a lat)))
          (else lat))))

;; 输出一个表的各子表的car组成的表
(define firsts
  (lambda (list)
    (cond ((null? list) '())
          ((list? (car list)) (cons (car (car list)) (firsts (cdr list)))) ;; 注：应为pair?
          (else (cons (car list) (firsts (cdr list)))))))

;; 该函数查找old在list的第一次出现位置，并在其后插入new。函数返回新列表
(define insertR
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons (car list) (cons new (cdr list))))
          (else (cons (car list) (insertR new old (cdr list)))))))

;;在左侧插入
(define insertL
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new list))
          (else (cons (car list) (insertL new old (cdr list)))))))

;; 用new替换old在list的首个出现
(define subst
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new (cdr list)))
          (else (cons (car list) (subst new old (cdr list)))))))

;; 用new替换o1或者o2在list的首个出现
(define subst2
  (lambda (new o1 o2 list)
    (cond ((null? list) list)
          ((or (eq? o1 (car list)) (eq? o2 (car list))) (cons new (cdr list)))
          (else (cons (car list) (subst2 new o1 o2 (cdr list)))))))

;; 修改列表pos位置上的元素为new_value，并返回新列表
(define list_set
  (lambda (lst pos new_value)
    (define list_set_iter
      (lambda (lst pos new_value iter)
        (cond ((= iter pos) (cons new_value (cdr lst)))
              (else (cons (car lst) (list_set_iter (cdr lst) pos new_value (+ iter 1)))))))
    (list_set_iter lst pos new_value 0)))

(define map
  (lambda (lst f)
    (if (null? lst)
        (quote ())
        (cons (f (car lst)) (map (cdr lst) f))
    )))

(define filter
  (lambda (lst p)
    (if (null? lst)
        (quote ())
        (if (p (car lst))
            (cons (car lst) (filter (cdr lst) p))
            (filter (cdr lst) p)))))

(define reduce
  (lambda (lst f init)
    (if (null? lst)
        init
        (f (car lst) (reduce (cdr lst) f init)))))

(define ref
  (lambda (lst index)
    (define iter
      (lambda (l count)
        (if (= count index)
            (car l)
            (iter (cdr l) (+ 1 count)))))
    (iter lst 0)))

;; 向列表尾部追加一项
(define append
  (lambda (x lst)
    (define append_cps
      (lambda (x lst cont)
        (if (null? lst)
            (cont (cons x lst))
            (append_cps x (cdr lst)
              (lambda (res)
                (cont (cons (car lst) res)))))))
  (append_cps x lst (lambda (x) x))))

;; 连接两个列表
(define concat
  (lambda (a b)
    (if (null? b)
        a
        (concat (append (car b) a) (cdr b)))))

(define run
  (lambda () {
    (display "通用列表操作测试（其中大多数是 The Little Schemer 书中的练习题）\n")(newline)

    (display "lat? 测试\n")
    (display "期望输出：#t #f #f\n")
    (display "实际输出：")
    (display (lat? '(1 2 3 a b))) (display " ")     ; #t
    (display (lat? '(1 2 3 a "b"))) (display " ")   ; #f
    (display (lat? '(1 (2) 3 (a b)))) (display " ") ; #f
    (newline)

    (display "member? 测试\n")
    (display "期望输出：#t #f\n")
    (display "实际输出：")
    (display (member? 'a '(1 2 3 a b))) (display " ")  ; #t
    (display (member? 'c '(1 2 3 a b))) (display " ")  ; #f
    (newline)

    (display "rember 测试\n")
    (display "期望输出：(1 2 3 b a 4 5 6)\n")
    (display "实际输出：")
    (display (rember 'a '(1 2 3 a b a 4 5 6))) (newline)
    (display "期望输出：(1 2 3 b 4 5 6)\n")
    (display "实际输出：")
    (display (rember 'a '(1 2 3 b 4 5 6))) (newline)

    (display "delete_atom 测试\n")
    (display "期望输出：(1 2 3 b 4 5 6)\n")
    (display "实际输出：")
    (display (delete_atom 'a '(1 2 3 a b a 4 5 6))) (newline)
    (display "期望输出：(1 2 3 b 4 5 6)\n")
    (display "实际输出：")
    (display (delete_atom 'a '(1 2 3 b 4 5 6))) (newline)

    (display "firsts 测试\n")
    (display "期望输出：(1 (3) b 4)\n")
    (display "实际输出：")
    (display (firsts '((1 2) ((3) a) (b (a)) (4 5 6)))) (newline)

    (display "insertR 测试\n")
    (display "期望输出：(1 2 a hello 3 a)\n")
    (display "实际输出：")
    (display (insertR 'hello 'a '(1 2 a 3 a))) (newline)

    (display "insertL 测试\n")
    (display "期望输出：(1 2 hello a 3 a)\n")
    (display "实际输出：")
    (display (insertL 'hello 'a '(1 2 a 3 a))) (newline)

    (display "subst 测试\n")
    (display "期望输出：(1 2 hello 3 a)\n")
    (display "实际输出：")
    (display (subst 'hello 'a '(1 2 a 3 a))) (newline)

    (display "subst2 测试\n")
    (display "期望输出：(1 2 hello a)\n")
    (display "实际输出：")
    (display (subst2 'hello 'a 3 '(1 2 3 a))) (newline)

    (display "list_set 测试\n")
    (display "期望输出：(10 2 3 4) (1 20 3 4) (1 2 30 4) (1 2 3 40)\n")
    (display "实际输出：")
    (display (list_set '(1 2 3 4) 0 10)) (display " ")
    (display (list_set '(1 2 3 4) 1 20)) (display " ")
    (display (list_set '(1 2 3 4) 2 30)) (display " ")
    (display (list_set '(1 2 3 4) 3 40)) (display " ")

    (newline)
    (newline)
  })
)
