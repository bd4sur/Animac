;; 演示了Man-or-Boy测试，以及模块机制测试
;; 依赖关系：utils←MoB←main

(import Utils    "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.utils.scm")
(import ManOrBoy "E:/Desktop/GitRepos/AuroraScheme/testcase/aurora.test.MoB.scm")

(Utils.show "Man or Boy Test = ")
(Utils.show (ManOrBoy.A 10 (lambda () 1) (lambda () -1) (lambda () -1) (lambda () 1) (lambda () 0)))
(newline)
