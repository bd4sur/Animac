(native HTTPS)
(native String)
(native Math)

;; TODO 模块import机制有重大缺陷：import的模块，不要求值其顶级作用域begin内部的子表达式。

;; HTTPS测试
(define res #f)
(set! res (HTTPS.request "https://mikukonai.com/feed.xml"))
;(display res)

;; String测试
(display (String.length    res        ))
(display (String.charAt    res  10    ))
(display (String.substring res  0  21 ))

;; Math测试
(display (Math.sin (Math.PI)))
(display (Math.dot '(1 2 3 4) '(5 6 7 8)))
(display (Math.scale (* 2 5) '(1 2 3 4)))
