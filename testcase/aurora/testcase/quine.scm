(display
(
       (lambda (x) (cons x (cons (cons 'quote (cons x '())) '())))
(quote (lambda (x) (cons x (cons (cons 'quote (cons x '())) '()))))
)
)