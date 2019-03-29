(import "./testcase/test2.scm" TEST2)
(import "./testcase/test4.scm" TEST4)
(define hello
  (lambda () (begin
    (display TEST4.greeting)
    (display TEST2.greeting))))

