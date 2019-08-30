;; 演示了Man-or-Boy测试，以及模块机制测试
;; 依赖关系：utils←MoB←main

(import Utils    "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.utils.scm")
(import ManOrBoy "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.MoB.scm")
(import PureCPS "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.purecps.scm")
(import CallCC "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.callcc-test.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：Man or Boy Test：")
(Utils.show "✅ 期望结果：-67")
(Utils.show (ManOrBoy.A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：真·CPS阶乘：10!=")
(Utils.show "✅ 期望结果：3628800")
(((PureCPS.fac-cps (lambda (x) x)) 10) (lambda (x) (display x)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(Utils.show "⚙️ 测试：Yin-yang Puzzle：")
(Utils.show "✅ 期望结果：@*@**@***@****...")
(CallCC.YinYang)
