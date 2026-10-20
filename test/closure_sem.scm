;; 闭包语义专项用例：把"创建时快照 + set! 写穿透"模型的每个可观察行为钉死。
;; 输出完全确定，不依赖时间/随机。任何优化改动前后必须逐字节一致。
;; 运行：./main test/closure_sem.scm
;;
;; 语言子集限制（均与本次优化无关，属既有实现约束）：
;;   - 不支持 (define (f x) ...) 简写，一律用 (define f (lambda ...))；
;;   - 不支持顶层同名重复 define、不支持体内同名重复 define；
;;   - 不支持可变引数（点号参数表）；
;;   - define 不得出现在 begin/while 块内（应放在 lambda 体顶层）。

(define pass 0)
(define fail 0)
(define chk (lambda (name actual expected) {
  (if (equal? actual expected)
      (begin (set! pass (+ pass 1)) (display "  [PASS] ") (display name) (newline))
      (begin (set! fail (+ fail 1))
             (display "  [FAIL] ") (display name)
             (display "  期望=") (display expected)
             (display " 实际=") (display actual) (newline)))
}))

;; ---------------------------------------------------------------- I1 快照语义
(display "== I1 创建时快照 ==") (newline)

;; 尾调用自复用同一闭包对象，每轮重新 store 同一变量；每轮新建的闭包各自持有当轮快照。
(define call-all (lambda (lst acc)
  (if (null? lst) acc (call-all (cdr lst) (cons ((car lst)) acc)))))
(define saved '())
(define loop2 (lambda (k)
  (define v k)
  (define g (lambda () v))
  (set! saved (cons g saved))
  (if (== k 0) 'done (loop2 (- k 1)))))
(loop2 3)
(chk "I1-a 每轮闭包各自快照" (call-all saved '()) '(3 2 1 0))

;; set! 之后的旧快照必须失效（脏标记路径）
(define saved2 '())
(define loop3 (lambda (k)
  (define v k)
  (define g (lambda () v))
  (set! saved2 (cons g saved2))
  (if (== k 0) (set! v 99) (loop3 (- k 1)))))
(loop3 2)
(chk "I1-b set! 后旧快照失效" (call-all saved2 '()) '(99 99 99))

;; ---------------------------------------------------------------- I2 写穿透语义
(display "== I2 set! 写穿透 ==") (newline)
(define y 10)
(define reader (lambda () y))
(set! y 20)
(chk "I2-a 子闭包看到新值" (reader) 20)

(define outer (lambda ()
  (define z 100)
  (define r1 (lambda () z))
  (define r2 (lambda () z))
  (set! z 200)
  (cons (r1) (cons (r2) '()))))
(chk "I2-b 兄弟闭包" (outer) '(200 200))

(define deep (lambda ()
  (define w 1)
  (define lv1 (lambda () (define lv2 (lambda () w)) (lv2)))
  (set! w 2)
  (lv1)))
(chk "I2-c 多层嵌套" (deep) 2)

(define before-after (lambda ()
  (define v 5)
  (define old (lambda () v))
  (define before (old))
  (set! v 6)
  (cons before (cons (old) '()))))
(chk "I2-d 变更前后" (before-after) '(5 6))

;; ---------------------------------------------------------------- I3 局部遮蔽
(display "== I3 本帧绑定优先于外层同名 ==") (newline)
(define n 111)
(define shadow (lambda (n) n))
(chk "I3-a 形参遮蔽全局" (shadow 222) 222)
(chk "I3-b 全局未被破坏" n 111)

(define bump (lambda (k)
  (define m 1)
  (set! k (+ k m))
  k))
(chk "I3-c 形参被 set!" (bump 10) 11)

(define mixed (lambda ()
  (define a 1)
  (define inner (lambda (a) a))
  (cons (inner 5) (cons a '()))))
(chk "I3-d 内层形参遮蔽外层局部" (mixed) '(5 1))

;; ---------------------------------------------------------------- I4 闭包存活
(display "== I4 闭包跨 GC 存活 ==") (newline)
(define keepers '())
(define make-keeper (lambda (v) (lambda () v)))
(define fill (lambda (k)
  (if (== k 0) #t
      (begin (set! keepers (cons (make-keeper k) keepers))
             (fill (- k 1))))))
(fill 200)
(define sum-keepers (lambda (lst acc)
  (if (null? lst) acc (sum-keepers (cdr lst) (+ acc ((car lst)))))))
(chk "200 个闭包跨 GC" (sum-keepers keepers 0) 20100)

;; ---------------------------------------------------------------- 尾调用自复用
(display "== 尾调用自复用 ==") (newline)
(define loopsum (lambda (i acc)
  (if (<= i 0) acc (loopsum (- i 1) (+ acc i)))))
(chk "尾递归" (loopsum 1000 0) 500500)

(define tail-closure (lambda (k)
  (define go (lambda (i)
    (define f (lambda () i))
    (if (<= i 0) (f) (go (- i 1)))))
  (go k)))
(chk "尾递归内建闭包" (tail-closure 5) 0)

;; ---------------------------------------------------------------- 高阶函数
(display "== 高阶函数与返回闭包 ==") (newline)
(define adder (lambda (k) (lambda (v) (+ v k))))
(define add5 (adder 5))
(chk "返回闭包" (add5 37) 42)
(define compose (lambda (f g) (lambda (v) (f (g v)))))
(chk "闭包组合" ((compose (adder 1) (adder 2)) 39) 42)

;; ---------------------------------------------------------------- 递归
(display "== 递归与相互递归 ==") (newline)
(define ev (lambda (k) (if (== k 0) #t (od (- k 1)))))
(define od (lambda (k) (if (== k 0) #f (ev (- k 1)))))
(chk "相互递归" (ev 100) #t)
(define fib (lambda (k) (if (< k 2) k (+ (fib (- k 1)) (fib (- k 2))))))
(chk "fib(18)" (fib 18) 2584)

;; ---------------------------------------------------------------- call/cc
(display "== call/cc 与续体 ==") (newline)
(chk "call/cc 非局部退出"
     (call/cc (lambda (k) (+ 1 (k 99))))
     99)
(define cc-count 0)
(chk "call/cc 恢复"
     (+ 1 (call/cc (lambda (k)
            (set! cc-count (+ cc-count 1))
            (if (== cc-count 1) (k 10) 20))))
     11)

;; ---------------------------------------------------------------- dynamic-wind
(display "== dynamic-wind ==") (newline)
(define wind-log '())
(define log! (lambda (s) (set! wind-log (cons s wind-log))))
(chk "dynamic-wind 返回值"
     (dynamic-wind (lambda () (log! 'in))
                   (lambda () (log! 'body) 7)
                   (lambda () (log! 'out)))
     7)
(chk "dynamic-wind 顺序" wind-log '(out body in))

;; ---------------------------------------------------------------- 汇总
(display "PASS: ") (display pass)
(display "  FAIL: ") (display fail) (newline)