(import "./test4.scm" TEST4)
(define greeting "来自test2的问候")
(define hello
  (lambda ()
    (display TEST4.greeting)))
