(import Utils "utils.scm")

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


(define sum_iter
  (lambda (n init)
    (if (= n 0)
        init
        (sum_iter (- n 1) (+ n init)))))


(define run
  (lambda () {

    (Utils.show "阶乘测试①：真·CPS阶乘")(newline)
    (Utils.show "期望结果：3628800")(newline)
    (Utils.show "实际结果：")
    (((fac_cps (lambda (x) x)) 10) (lambda (x) (display x)))
    (newline)
    (newline)

    (Utils.show "阶乘测试②：CPS和set!的结合")(newline)
    (display "5!（期望120）=")
    (display (fac 5 (lambda (x) x)))
    (newline)
    (display "闭包调用次数（期望5）=")
    (display clo-count)
    (newline)
    (display "阶乘递归调用次数（期望6）=")
    (display fac-count)
    (newline)
    (newline)

    (Utils.show "尾调用优化测试：大量的尾递归调用")(newline)
    (Utils.show "期望结果：5000050000")(newline)
    (Utils.show "实际结果：")
    (display (sum_iter 100000 0))
    (newline)
    (newline)

    (Utils.show "快速求幂算法：测试cond语句")(newline)
    (Utils.show "期望结果：1073741824")(newline)
    (Utils.show "实际结果：")
    (define power
      (lambda (base exp init)
        (cond ((= exp 0) init)
              ((= 0 (% exp 2)) (power (* base base) (/ exp 2) init))
              (else (power base (- exp 1) (* base init))))))
    (display (power 2 30 1))
    (newline)
    (newline)

  })
)
