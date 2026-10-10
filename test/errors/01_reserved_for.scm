;; 预期：编译失败。for 是保留但未实现的关键字（doc/ISSUES.md 保留字清单）
(display "should not compile")
(for i 1 2 3)
