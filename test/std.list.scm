;; 应用库
;; 几个高阶函数

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

