
;; The Little Schemer 书中给出的Scheme解释器

(define build
  (lambda (s1 s2)
    (cons s1 (cons s2 '()))))

(define first
  (lambda (list-pair)
    (car list-pair)))

(define second
  (lambda (list-pair)
    (car (cdr list-pair))))

(define third
  (lambda (list-pair)
    (car (cdr (cdr list-pair)))))

(define new-entry build)

(define lookup-in-entry-help
  (lambda (name names values entry-f)
    (cond ((null? names) (entry-f name))
          ((eq? (car names) name) (car values))
          (else (lookup-in-entry-help name (cdr names) (cdr values) entry-f)))))

(define lookup-in-entry
  (lambda (name entry entry-f)
    (lookup-in-entry-help name (first entry) (second entry) entry-f)))

(define extend-table cons)

(define lookup-in-table
  (lambda (name table table-f)
    (cond ((null? table) (table-f name))
          (else (lookup-in-entry name
                                 (car table)
                                 (lambda (n)
                                   (lookup-in-table n
                                                    (cdr table)
                                                    table-f)))))))

(define expression-to-action
  (lambda (e)
    (cond ((atom? e) (atom-to-action e))
          (else (list-to-action e)))))

(define atom-to-action
  (lambda (e)
    (cond ((number? e) *const)
          ((eq? e #t) *const)
          ((eq? e #f) *const)
          ((eq? e 'cons) *const)
          ((eq? e 'car) *const)
          ((eq? e 'cdr) *const)
          ((eq? e 'null?) *const)
          ((eq? e 'eq?) *const)
          ((eq? e 'atom?) *const)
          ((eq? e 'zero?) *const)
          ((eq? e 'add1) *const)
          ((eq? e 'sub1) *const)
          ((eq? e '+) *const)
          ((eq? e '-) *const)
          ((eq? e '*) *const)
          ((eq? e '/) *const)
          ((eq? e '=) *const)
          ((eq? e 'begin) *const)
          ((eq? e 'display) *const)
          ((eq? e 'number?) *const)
          (else *identifier))))

(define list-to-action
  (lambda (e)
    (cond ((atom? (car e))
           (cond ((eq? (car e) 'quote)  *quote)
                 ((eq? (car e) 'lambda) *lambda)
                 ((eq? (car e) 'cond)   *cond)
                 (else *application)))
          (else *application))))

(define meaning
  (lambda (e table)
    ((expression-to-action e) e table)))

(define value
  (lambda (e)
    (meaning e '())))

(define *const
  (lambda (e table)
    (cond ((number? e) e)
          ((eq? e #t) #t)
          ((eq? e #f) #f)
          (else (build 'primitive e)))))

(define text-of second)

(define *quote
  (lambda (e table)
    (text-of e)))

(define initial-table (lambda (name) (car '())))

(define *identifier
  (lambda (e table)
    (lookup-in-table e table initial-table)))

(define *lambda
  (lambda (e table)
    (build 'non-primitive (cons table (cdr e)))))

(define table-of first)
(define formals-of second)
(define body-of third)

(define else?
  (lambda (x)
    (cond ((atom? x) (eq? x 'else))
          (else #f))))

(define question-of first)
(define answer-of second)

(define evcon
  (lambda (lines table)
    (cond ((else? (question-of (car lines))) (meaning (answer-of (car lines)) table))
          ((meaning (question-of (car lines)) table) (meaning (answer-of (car lines)) table))
          (else (evcon (cdr lines) table)))))

(define cond-lines-of cdr)

(define *cond
  (lambda (e table)
    (evcon (cond-lines-of e) table)))

(define evlis
  (lambda (args table)
    (cond ((null? args) '())
          (else (cons (meaning (car args) table)
                      (evlis (cdr args) table))))))

(define function-of car)
(define arguments-of cdr)

(define *application
  (lambda (e table)
    (apply (meaning (function-of e) table)
           (evlis (arguments-of e) table))))

(define primitive?
  (lambda (l)
    (eq? (first l) 'primitive)))

(define non-primitive?
  (lambda (l)
    (eq? (first l) 'non-primitive)))

(define apply
  (lambda (fun vals)
    (cond ((primitive? fun)
           (apply-primitive (second fun) vals))
          ((non-primitive? fun)
           (apply-closure (second fun) vals))
          (else (display "Error occured in 'apply'!")))))

(define isAtom
  (lambda (x)
    (cond ((atom? x) #t)
          ((null? x) #f)
          ((eq? (car x) 'primitive) #t)
          ((eq? (car x) 'non-primitive) #t)
          (else #f))))

(define apply-primitive
  (lambda (name vals)
    (cond ((eq? name 'cons)  (cons (first vals) (second vals)))
          ((eq? name 'car)   (car (first vals)))
          ((eq? name 'cdr)   (cdr (first vals)))
          ((eq? name 'null?) (null? (first vals)))
          ((eq? name 'eq?)   (eq? (first vals) (second vals)))
          ((eq? name 'atom?) (isAtom (first vals)))
          ((eq? name 'zero?) (= (first vals) 0))
          ((eq? name 'add1)  (+ 1 (first vals)))
          ((eq? name 'sub1)  (- (first vals) 1))
          ((eq? name '+)     (+ (first vals) (second vals)))
          ((eq? name '-)     (- (first vals) (second vals)))
          ((eq? name '*)     (* (first vals) (second vals)))
          ((eq? name '/)     (/ (first vals) (second vals)))
          ((eq? name '=)     (= (first vals) (second vals)))
          ((eq? name 'begin)   (second vals))
          ((eq? name 'display) (display (first vals)))
          ((eq? name 'number?) (number? (first vals)))
          (else (display "Unknown primitive function.")))))

(define apply-closure
  (lambda (closure vals)
    (meaning (body-of closure)
             (extend-table (new-entry (formals-of closure) vals)
                           (table-of closure)))))

(display "((lambda (x) (add1 x)) 30)=")
(display (value '((lambda (x) (add1 x)) 30))) (newline)

(display "30!=")
(display (value '(((lambda (S)
                     ((lambda (x) (S (lambda (y) ((x x) y))))
                      (lambda (x) (S (lambda (y) ((x x) y))))))
                   (lambda (f)
                     (lambda (n)
                       (cond ((= n 0) 1)
                             (else (* n (f (- n 1)))))))) 30)))

