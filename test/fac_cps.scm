(define fac_cps
(lambda (cont)
  (cont (lambda (n)
          (lambda (k)
            ((lambda (cont)
               ((lambda (cont)
                  ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (= x y)))))) ; 内置相等判断
                   (lambda (node0)
                     ((node0 0 n)
                      (lambda (res) (cont res))))))
                (lambda (p_res)
                  (if p_res
                      ((lambda (cont) (cont 1))
                       cont)
                      ((lambda (cont)
                         ; 以下仅仅是对每个AST节点进行简单的遍历CPST/重命名,并未体现求值顺序，可以理解成并行的
                         ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (* x y)))))) (lambda (node0) ; 内置乘法
                         ( fac_cps                                                       (lambda (node1) ; 递归调用(重命名后的)
                         ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (- x y)))))) (lambda (node2) ; 内置减法
                         ; 从这里开始体现求值顺序,几乎等于是 A-Normal Form
                         ((node2 n 1)    (lambda (res2)
                         ((node1 res2)   (lambda (res1)
                         ((node0 n res1) (lambda (res)
                         ; 最后执行总的continuation
                         ( cont res))))))))))))))
                       cont)))))
             (lambda (m) (k m))))))))
