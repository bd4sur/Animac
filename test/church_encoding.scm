;; 丘奇编码
;; https://en.wikipedia.org/wiki/Church_encoding

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
        NUM_0
        (INC (NUM_TO_LAMBDA (- number 1))))))

(define NUM_0 (lambda (f a) a))

(define NUM_1 (lambda (f a) (f a)))

(define INC
  (lambda (n)
    (lambda (f a)
      (f (n f a)))))

(define ADD
  (lambda (m n)
    (m INC n)))

;Curried-ADD - for function MUL
(define ADD_c
  (lambda (m)
    (lambda (n)
      (m INC n))))

(define MUL
  (lambda (m n)
    (n (ADD_c m) NUM_0)))

;Curried-MUL - for function POW
(define MUL_c
  (lambda (m)
    (lambda (n)
      (n (ADD_c m) NUM_0))))

(define POW
  (lambda (m n)
    (n (MUL_c m) NUM_1)))

;some paticular numbers
(define NUM_2 (lambda (f a) (f (f a))))
(define NUM_3 (lambda (f a) (f (f (f a)))))
(define NUM_4 (lambda (f a) (f (f (f (f a))))))
(define NUM_5 (lambda (f a) (f (f (f (f (f a)))))))
(define NUM_6 (lambda (f a) (f (f (f (f (f (f a))))))))
(define NUM_7 (lambda (f a) (f (f (f (f (f (f (f a)))))))))
(define NUM_8 (lambda (f a) (f (f (f (f (f (f (f (f a))))))))))
(define NUM_9 (lambda (f a) (f (f (f (f (f (f (f (f (f a)))))))))))
(define NUM_10 (lambda (f a) (f (f (f (f (f (f (f (f (f (f a))))))))))))
(define NUM_11 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))
(define NUM_12 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f a))))))))))))))
(define NUM_13 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))))

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
    (LEFT (n SLIDE (PAIR NUM_0 NUM_0)))))

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
  (PAIR NUM_0 NUM_0))

(define INT_IS_ZERO
  (lambda (int)
    (AND (IS_ZERO (LEFT  int))
         (IS_ZERO (RIGHT int)))))

;整数标准化，也就是简化成至少一边为0的形式，这样就可以实现绝对值函数和符号函数了
(define INT_NORMALIZE
  (lambda (int)
    (IF (IS_LE (LEFT int) (RIGHT int))
        (INT NUM_0 (SUB (RIGHT int) (LEFT int)))
        (INT (SUB (LEFT int) (RIGHT int)) NUM_0))))

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
        {(display "+") (SHOWNUM (INT_ABS int))}
        {(display "-") (SHOWNUM (INT_ABS int))})))

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

;; TODO NOTE 【注意】这里体现了Animac的define与标准define的不同之处。Aurora的被define的项是不求值的，因此如果想使用它的值，就需要把它封装成一个thunk，使用的时候调用之。
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
                NUM_0))))
     l)))

(define SHOWLIST
  (lambda (list)
    (if (SHOWBOOL (IS_NULLLIST list))
        (display "N)")
        {
            (display (SHOWNUM (CAR list)))
            ;(display ",")
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
                   ))))))list)index)NUM_0)))

(define run
  (lambda () {

    (display "Church编码：测试Scheme语言核心")
    (newline)

    (display "6!=")
    (display
    (SHOWNUM 
    ((Y (lambda (f)
        (lambda (n)
          (IF (IS_EQUAL n NUM_0)
              NUM_1
              (lambda (x y) ((MUL n (f (DEC n)))
                              x
                              y))
          ))))
    NUM_6)))
    (newline)

    (display "Count(1,2,3,3,3)=")
    (display (SHOWNUM (COUNT (CONS NUM_1 (CONS NUM_2 (CONS NUM_3 (CONS NUM_3 (CONS NUM_3 (NULL_LIST)))))))))
    (newline)

    (display "List=(")
    (SHOWLIST (CONS NUM_1 (CONS NUM_2 (CONS NUM_3 (CONS NUM_4 (CONS NUM_5 (NULL_LIST)))))))
    (newline)

    (display "Range(2,7)=(")
    (SHOWLIST (RANGE NUM_2 NUM_7))
    (newline)

    (display "Fold(1:10,0,ADD)=")
    (display (SHOWNUM (FOLD (RANGE NUM_1 NUM_10) NUM_0 ADD)))
    (newline)

    (display "MAP(1:9,0,INC)=(")
    (SHOWLIST (MAP (RANGE NUM_1 NUM_9) INC))
    (newline)

    (display "Proj(2:10,5)=")
    (display (SHOWNUM (PROJ (MAP (RANGE NUM_1 NUM_9) INC) NUM_5)))
    (newline)

    (newline)

  })
)

