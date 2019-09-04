;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

(import Utils    "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.utils.scm")
(import ManOrBoy "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.MoB.scm")
(import PureCPS  "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.purecps.scm")
(import CallCC   "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.callcc-test.scm")
(import Sort     "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.sort.scm")
(import Church   "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.church-encoding.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：Man or Boy Test：")
(Utils.show "此用例用来测试系统能否正确处理词法作用域、一等函数、set!等基本特性。")
(Utils.show "期望结果：-67")
(Utils.show (ManOrBoy.A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：真·CPS阶乘：10!=")
(Utils.show "此用例用来测试系统能否正确处理复杂嵌套的匿名函数及其调用。")
(Utils.show "期望结果：3628800")
(((PureCPS.fac-cps (lambda (x) x)) 10) (lambda (x) (display x)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;(Utils.show "测试：Yin-yang Puzzle：")
;(Utils.show "此用例用来测试call/cc功能。")
;(Utils.show "期望结果：@*@**@***@****...")
;(CallCC.YinYang)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：快速排序")
(Utils.show "此用例用来测试列表操作。")
(Utils.show "期望结果：'(0 1 2 3 4 5 6 7 8 9)")
(display (Sort.quicksort '(6 5 9 6 1 7 5 3 0 4 6 8 2)))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：Quine")
(Utils.show "此用例用来测试列表操作、display对于复杂列表的处理是否正确。")
(Utils.show
(
       (lambda (x) (cons x (cons (cons 'quote (cons x '())) '())))
(quote (lambda (x) (cons x (cons (cons 'quote (cons x '())) '()))))
)
)
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

(Utils.show "测试：尾递归优化")
(Utils.show "此用例用来尾调用（尾递归）优化。")
(Utils.show "期望结果：5000050000")
;; 尾递归优化演示
(define sum
  (lambda (n s)
    (if (= n 0)
        s
        (sum (- n 1) (+ n s)))))
(display (sum 100000 0))
(newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "测试：Fork和本地库函数")

(fork {
    (Utils.show "子进程1开始啦")
    (define infinite
      (lambda ()
        ;(Utils.show "无限循环的进程")
        (infinite)))
    (infinite)
    (Utils.show "子进程1结束啦（并不会）")
})

(fork {
    (Utils.show "子进程2开始啦")
    (native Console)
    (native HTTPS)
    (define res #f)
    (set! res (HTTPS.Request "https://mikukonai.com/feed.xml"))
    (Utils.show res)
    (Utils.show "子进程2结束啦")
})

(fork {
    (Utils.show "子进程3开始啦")
    (native File)
    (define res #f)
    (set! res (File.Read "E:/text.txt"))
    (Utils.show res)
    (define foo
    (lambda (n)
        (if (= n 0)
            1
            (* n (foo (- n 1))))))
    ((lambda (kkk)
       (Utils.show "子进程里计算阶乘的结果：")
       (Utils.show kkk))
     (foo 10))
    (Utils.show "子进程3结束啦")
})
