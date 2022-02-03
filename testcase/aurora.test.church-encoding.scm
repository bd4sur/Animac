;; 丘奇编码
;; https://en.wikipedia.org/wiki/Church_encoding

(import Utils "E:/Desktop/GitRepos/Animach/testcase/aurora.test.utils.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 布尔值
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define SHOWBOOL
  (lambda (b)
    (b #t #f)))

(define TRUE  (lambda (x y) x))
(define FALSE (lambda (x y) y))

(define NOT
  (lambda (bool)
    (bool FALSE TRUE)))

(define AND
  (lambda (boolx booly)
    (boolx booly boolx)))

(define OR
  (lambda (boolx booly)
    (boolx boolx booly)))

(define IS_ZERO
  (lambda (n)
    (n (lambda (x) FALSE) TRUE)))

(define IF
  (lambda (p x y)
    (p x y)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 自然数
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define SHOWNUM
  (lambda (n)
    (n (lambda (x) (+ x 1)) 0)))

(define NUM_TO_LAMBDA
  (lambda (number)
    (if (= number 0)
        <0>
        (INC (NUM_TO_LAMBDA (- number 1))))))

(define <0> (lambda (f a) a))

(define <1> (lambda (f a) (f a)))

(define INC
  (lambda (n)
    (lambda (f a)
      (f (n f a)))))

(define ADD
  (lambda (m n)
    (m INC n)))

;Curried-ADD - for function MUL
(define ADD-c
  (lambda (m)
    (lambda (n)
      (m INC n))))

(define MUL
  (lambda (m n)
    (n (ADD-c m) <0>)))

;Curried-MUL - for function POW
(define MUL-c
  (lambda (m)
    (lambda (n)
      (n (ADD-c m) <0>))))

(define POW
  (lambda (m n)
    (n (MUL-c m) <1>)))

;some paticular numbers
(define <2> (lambda (f a) (f (f a))))
(define <3> (lambda (f a) (f (f (f a)))))
(define <4> (lambda (f a) (f (f (f (f a))))))
(define <5> (lambda (f a) (f (f (f (f (f a)))))))
(define <6> (lambda (f a) (f (f (f (f (f (f a))))))))
(define <7> (lambda (f a) (f (f (f (f (f (f (f a)))))))))
(define <8> (lambda (f a) (f (f (f (f (f (f (f (f a))))))))))
(define <9> (lambda (f a) (f (f (f (f (f (f (f (f (f a)))))))))))
(define <10> (lambda (f a) (f (f (f (f (f (f (f (f (f (f a))))))))))))
(define <11> (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))
(define <12> (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f a))))))))))))))
(define <13> (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 有序对和减法
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define PAIR
  (lambda (x y)
    (lambda (f)
      (f x y))))

(define LEFT
  (lambda (pair)
    (pair TRUE)))

(define RIGHT
  (lambda (pair)
    (pair FALSE)))

;substraction
(define SLIDE
  (lambda (pair)
    (PAIR (RIGHT pair) (INC (RIGHT pair)))))

(define DEC
  (lambda (n)
    (LEFT (n SLIDE (PAIR <0> <0>)))))

(define SUB
  (lambda (m n)
    (n DEC m)))

;comparation
(define IS_LE
  (lambda (num1 num2)
    (IS_ZERO (SUB num1 num2))))

(define IS_EQUAL
  (lambda (num1 num2)
    (AND (IS_LE num1 num2) (IS_LE num2 num1))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Z组合子（Y组合子的应用序求值版本）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;Y-Combinator
;注意：目标函数应使用单参形式
(define Y
  (lambda (S)
    ( (lambda (x) (S (lambda (y) ((x x) y))))
      (lambda (x) (S (lambda (y) ((x x) y)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 整数（暂时没有用）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define INT
  (lambda (neg pos)
    (PAIR neg pos)))

(define INT_ZREO
  (PAIR <0> <0>))

(define INT_IS_ZERO
  (lambda (int)
    (AND (IS_ZERO (LEFT  int))
         (IS_ZERO (RIGHT int)))))

;整数标准化，也就是简化成至少一边为0的形式，这样就可以实现绝对值函数和符号函数了
(define INT_NORMALIZE
  (lambda (int)
    (IF (IS_LE (LEFT int) (RIGHT int))
        (INT <0> (SUB (RIGHT int) (LEFT int)))
        (INT (SUB (LEFT int) (RIGHT int)) <0>))))

(define INT_ABS
  (lambda (int)
    (IF (IS_ZERO (LEFT (INT_NORMALIZE int)))
        (RIGHT (INT_NORMALIZE int))
        (LEFT  (INT_NORMALIZE int)))))

;TRUE +; FALSE -
(define INT_SGN
  (lambda (int)
    (IS_ZERO (LEFT (INT_NORMALIZE int)))))

(define SHOWINT
  (lambda (int)
    (if (SHOWBOOL (INT_SGN int))
        {(Utils.show "+") (SHOWNUM (INT_ABS int))}
        {(Utils.show "-") (SHOWNUM (INT_ABS int))})))

(define INT_ADD
  (lambda (i j)
    (INT (ADD (LEFT  i) (LEFT  j))
         (ADD (RIGHT i) (RIGHT j)))))

(define INT_MUL
  (lambda (i j)
    (INT (ADD (MUL (LEFT i) (LEFT j)) (MUL (RIGHT i) (RIGHT j)))
         (ADD (MUL (LEFT i) (RIGHT j)) (MUL (RIGHT i) (LEFT j))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 列表（二叉树）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; TODO NOTE 【注意】这里体现了Animach的define与标准define的不同之处。Aurora的被define的项是不求值的，因此如果想使用它的值，就需要把它封装成一个thunk，使用的时候调用之。
(define NULL_LIST
  (lambda ()
    (PAIR TRUE TRUE)))

(define IS_NULLLIST
  (lambda (list)
    (LEFT list)))

(define CONS
  (lambda (e l)
    (PAIR FALSE (PAIR e l))))

(define CAR
  (lambda (list)
    (LEFT (RIGHT list))))

(define CDR
  (lambda (list)
    (RIGHT (RIGHT list))))

(define COUNT
  (lambda (l)
    ((Y (lambda (f)
          (lambda (list)
            (IF (NOT (IS_NULLLIST list))
                (lambda (x y) ((INC (f (CDR list)))
                               x
                               y))
                <0>))))
     l)))

(define SHOWLIST
  (lambda (list)
    (if (SHOWBOOL (IS_NULLLIST list))
        (Utils.show "N)")
        {
            (Utils.show (SHOWNUM (CAR list)))
            ;(Utils.show ",")
            (SHOWLIST (CDR list))
        }
    )))

;闭区间
;注意Currying
(define RANGE
  (lambda (m n)
    (((Y (lambda (f)
          (lambda (a)
            (lambda (b)
            (IF (IS_LE a b)
                (lambda (z) ((CONS a ((f (INC a)) b))
                               z ))
                (NULL_LIST)
            )))))m)n)))

;高阶函数Fold和Map
(define FOLD
  (lambda (list init func)
    ((((Y (lambda (f)
          (lambda (l)
            (lambda (i)
              (lambda (g)
                (IF (IS_NULLLIST l)
                    i
                    (lambda (x y) (
                      (g (CAR l) (((f (CDR l)) i) g))
                      x y))
                ))))))list)init)func)))

(define MAP
  (lambda (list func)
    (((Y (lambda (f)
           (lambda (l)
             (lambda (g)
               (IF (IS_NULLLIST l)
                   (NULL_LIST)
                   (lambda (x) ((CONS (g (CAR l)) ((f (CDR l)) g)) x))
                )))))list)func)))

; 投影函数（常用）
(define PROJ
  (lambda (list index)
    ((((Y (lambda (f)
            (lambda (l)
              (lambda (i)
                (lambda (j)
                  (IF (IS_EQUAL i j)
                      (CAR l)
                      (lambda (x y) ((((f (CDR l)) i) (INC j)) x y))
                   ))))))list)index)<0>)))
