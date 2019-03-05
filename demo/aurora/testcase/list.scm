(define trav
  (lambda (lat)
    (if (null? lat)
        #f
        (begin
          (display (car lat))
          (trav (cdr lat))))))
(display "【编译】列表遍历测试<br>期望输出“AuroraVirtualMachine”=")
(trav (car (cdr '("Hello" ("Aurora" "Virtual" "Machine")))))
(display "<br>")

(define concat
  (lambda (lat atom)
    (concat (cons atom lat) atom)))
(display "【编译】测试无限cons列表的内存管理<br>")
(concat '("Aurora" "Virtual" "Machine")
        "Hello")
