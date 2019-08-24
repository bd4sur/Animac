
///////////////////////////////////////////////
// UT.ts
// 单元测试

// Test
const TESTCASE = `
((lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; AppLib测试
(native HTTPS)
(native String)
(native Math)
(native File)
(import "../../../source/applib/list.scm" List)
(define multiply
  (lambda (x y) (Math.mul x y)))
(display (List.reduce '(1 2 3 4 5 6 7 8 9 10) multiply 1))

(define filter
  (lambda (f lst)
    (if (null? lst)
        '()
        (if (f (car lst))
            (cons (car lst) (filter f (cdr lst)))
            (filter f (cdr lst))))))

(define concat
  (lambda (a b)
    (if (null? a)
        b
        (cons (car a) (concat (cdr a) b)))))

(define quicksort
  (lambda (array)
    (if (or (null? array) (null? (cdr array)))
        array
        (concat (quicksort (filter (lambda (x)
                                     (if (< x (car array)) #t #f))
                                   array))
                           (cons (car array)
                                 (quicksort (filter (lambda (x)
                                                      (if (> x (car array)) #t #f))
                                                    array)))))))

(display "【SSC编译】快速排序：")
(display (quicksort '(5 9 1 7 (5 3 0) 4 6 8 2)))
(newline)


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
))
`;

let ast = Parse(TESTCASE, "me.aurora.TestModule");

console.log(JSON.stringify(ast));
