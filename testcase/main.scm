;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

(import Utils      "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.utils.scm")
(import ManOrBoy   "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.MoB.scm")
(import PureCPS    "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.purecps.scm")
(import CallCC     "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.callcc-test.scm")
(import Sort       "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.sort.scm")
(import Church     "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.church-encoding.scm")
(import Generator  "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.generator.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：Man or Boy Test")(newline)
(Utils.show "此用例用来测试系统能否正确处理词法作用域、一等函数、set!等基本特性。")(newline)
(Utils.show "期望结果：-67")(newline)
(Utils.show "实际结果：")
(Utils.show (ManOrBoy.A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：真·CPS阶乘：10!")(newline)
(Utils.show "此用例用来测试系统能否正确处理复杂嵌套的匿名函数及其调用。")(newline)
(Utils.show "期望结果：3628800")(newline)
(Utils.show "实际结果：")
(((PureCPS.fac-cps (lambda (x) x)) 10) (lambda (x) (display x)))
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：CPS阶乘+set！")(newline)
(Utils.show "此用例用来测试系统能否正确处理复杂嵌套的匿名函数及其调用。")(newline)
(Utils.show "期望结果：120 5 6")(newline)
(define fac-count 0)
(define clo-count 0)
(define fac
  (lambda (n cont) (begin
    (set! fac-count (+ fac-count 1))
    (if (= n 0)
        (cont 1)
        (fac (- n 1)
             (lambda (res) (begin
               (set! clo-count (+ clo-count 1))
               (cont (* res n)))))))))
(display "5!=")
(display (fac 5 (lambda (x) x)))
(newline)
(display "闭包调用次数=")
(display clo-count)
(newline)
(display "阶乘递归调用次数=")
(display fac-count)
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;(Utils.show "测试：Yin-yang Puzzle：")
;(Utils.show "此用例用来测试call/cc功能。")
;(Utils.show "期望结果：@*@**@***@****...")
;(CallCC.YinYang)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：快速排序")(newline)
(Utils.show "此用例用来测试列表操作。")(newline)
(Utils.show "期望结果：'(0 1 2 3 4 5 5 6 6 6 7 8 9)")(newline)
(Utils.show "实际结果：")
(Utils.show (Sort.quicksort '(6 5 9 6 1 7 5 3 0 4 6 8 2)))
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：Quine")(newline)
(Utils.show "此用例用来测试列表操作、display对于复杂列表的处理是否正确。")(newline)
(Utils.show
(
       (lambda (x) (cons x (cons (cons 'quote (cons x '())) '())))
(quote (lambda (x) (cons x (cons (cons 'quote (cons x '())) '()))))
)
)
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; TODO 在没有靠谱的垃圾回收之前，不要跑这个测试用例，否则后续测试无法执行。

;(Utils.show "测试：丘奇编码")
;(Utils.show "此用例用来测试Scheme语言核心。")
;(Utils.show "期望结果：略（结果比较直观）")
;
;(display "6!=")
;(display
;(Church.SHOWNUM 
;((Church.Y (lambda (f)
;     (lambda (n)
;       (Church.IF (Church.IS_EQUAL n Church.<0>)
;           Church.<1>
;           (lambda (x y) ((Church.MUL n (f (Church.DEC n)))
;                          x
;                          y))
;       ))))
; Church.<6>)))
;
;(Utils.show "Count(1,2,3,3,3)=")
;(Utils.show (Church.SHOWNUM (Church.COUNT (Church.CONS Church.<1> (Church.CONS Church.<2> (Church.CONS Church.<3> (Church.CONS Church.<3> (Church.CONS Church.<3> (Church.NULL_LIST)))))))))
;
;(Utils.show "List=(")
;(Church.SHOWLIST (Church.CONS Church.<1> (Church.CONS Church.<2> (Church.CONS Church.<3> (Church.CONS Church.<4> (Church.CONS Church.<5> (Church.NULL_LIST)))))))
;
;(Utils.show "Range(2,7)=(")
;(Church.SHOWLIST (Church.RANGE Church.<2> Church.<7>))
;
;(Utils.show "Fold(1:10,0,ADD)=")
;(Utils.show (Church.SHOWNUM (Church.FOLD (Church.RANGE Church.<1> Church.<10>) Church.<0> Church.ADD)))
;
;(Utils.show "MAP(1:9,0,INC)=(")
;(Church.SHOWLIST (Church.MAP (Church.RANGE Church.<1> Church.<9>) Church.INC))
;
;(Utils.show "Proj(2:10,5)=")
;(Utils.show (Church.SHOWNUM (Church.PROJ (Church.MAP (Church.RANGE Church.<1> Church.<9>) Church.INC) Church.<5>)))
;
;(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：尾递归优化")(newline)
(Utils.show "此用例用来测试尾调用（尾递归）优化。")(newline)
(Utils.show "期望结果：5000050000")(newline)
(Utils.show "实际结果：")
(define sum
  (lambda (n s)
    (if (= n 0)
        s
        (sum (- n 1) (+ n s)))))
(display (sum 100000 0))
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：使用call/cc模拟其他高级语言的生成器。")(newline)
(Utils.show "此用例用来测试call/cc。")(newline)
(Utils.show "期望结果：输出1~10")(newline)
(Utils.show "实际结果：")
(Utils.show (Generator.g))
(Utils.show " ")
(if (>= Generator.count 10)
    (newline)
    (Utils.show (Generator.generator 666)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define power
  (lambda (base exp init)
    (cond ((= exp 0) init)
          ((= 0 (% exp 2)) (power (* base base) (/ exp 2) init))
          (else (power base (- exp 1) (* base init))))))

(display (power 2 10 1))
(newline)
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


(Utils.show "测试：Fork和本地库函数")(newline)

(fork {
    (Utils.show "子进程1开始啦")(newline)
    (define infinite
      (lambda ()
        ;(Utils.show "无限循环的进程 ")
        (infinite)))
    (infinite)
    (Utils.show "子进程1结束啦（并不会）")(newline)
})

(fork {
    (Utils.show "子进程2开始啦")(newline)
    (native Console)
    (native HTTPS)
    (define res #f)
    (set! res (HTTPS.Request "https://www.baidu.com/"))
    (Utils.show res)
    (Utils.show "子进程2结束啦")(newline)
})

(fork {
    (Utils.show "子进程3开始啦")(newline)
    (native File)
    (define res #f)
    (set! res (File.Read "E:/text.txt"))
    (Utils.show res)
    (newline)
    (define foo
    (lambda (n)
        (if (= n 0)
            1
            (* n (foo (- n 1))))))
    ((lambda (kkk)
       (Utils.show "子进程里计算阶乘的结果：")
       (Utils.show kkk)
       (newline))
     (foo 10))
    (Utils.show "子进程3结束啦")(newline)
})
