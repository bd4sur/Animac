;;;;;;;;;;;;;;;;;;;;;;;;;
;; AuroraScheme测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

(import Utils    "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.utils.scm")
(import ManOrBoy "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.MoB.scm")
(import PureCPS  "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.purecps.scm")
(import CallCC   "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.callcc-test.scm")
(import Sort     "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.sort.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：Man or Boy Test：")
(Utils.show "⚙️ 此用例用来测试系统能否正确处理词法作用域、一等函数、set!等基本特性。")
(Utils.show "✅ 期望结果：-67")
(Utils.show (ManOrBoy.A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：真·CPS阶乘：10!=")
(Utils.show "⚙️ 此用例用来测试系统能否正确处理复杂嵌套的匿名函数及其调用。")
(Utils.show "✅ 期望结果：3628800")
(((PureCPS.fac-cps (lambda (x) x)) 10) (lambda (x) (display x)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;(Utils.show "⚙️ 测试：Yin-yang Puzzle：")
(Utils.show "⚙️ 此用例用来测试call/cc功能。")
;(Utils.show "✅ 期望结果：@*@**@***@****...")
;(CallCC.YinYang)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：快速排序")
(Utils.show "⚙️ 此用例用来测试列表操作。")
(Utils.show "✅ 期望结果：'(0 1 2 3 4 5 6 7 8 9)")
(display (Sort.quicksort '(5 9 1 7 5 3 0 4 6 8 2)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：Quine")
(Utils.show "⚙️ 此用例用来测试列表操作、display对于复杂列表的处理是否正确。")
(Utils.show "✅ 期望结果：'(0 1 2 3 4 5 6 7 8 9)")
(display
(
       (lambda (x) (cons x (cons (cons 'quote (cons x '())) '())))
(quote (lambda (x) (cons x (cons (cons 'quote (cons x '())) '()))))
)
)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

