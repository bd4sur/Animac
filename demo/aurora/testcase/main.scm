(import "./test2.scm" TEST2)
(import "../test3.scm" TEST3)
(define hello
  (lambda ()
    (begin
      (TEST2.hello)
      (TEST3.hello))))
(hello)
