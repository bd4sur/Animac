(native HTTPS)
(native String)
(native Math)
(native File)

(import "./factorial.scm" Fac)

;; NOTE （已修复：凡是被引用的模块，其顶级作用域的非define节点会被逻辑删除）模块import机制有重大缺陷：import的模块，不要求值其顶级作用域begin内部的子表达式。

;; HTTPS测试
(define res #f)
(set! res (HTTPS.request "https://mikukonai.com/feed.xml"))

;; File测试：读取文件，并将其内容按行打印出来
(File.read
    "E:/text.txt"
    (lambda (content) (begin
      (define segs #f)
      ;; TODO 这里define的行为与预想的有偏差：应当区别对待lambda和SList的求值。Lambda不作处理，但SList需要求值。
      ;; 或者，干脆就把define的语义设计成这样吧。
      (set! segs (String.split content "\n"))
      (define show
        (lambda (segs)
          (if (null? segs)
              #f
              (begin (display (car segs))
                     (show (cdr segs))))))
      (show segs))))

;; String测试
(display (String.length    res        ))
(display (String.charAt    res  10    ))
(display (String.substring res  0  21 ))

;; Math测试
(display (Math.sin (Math.PI)))
(display (Math.dot '(1 2 3 4) '(5 6 7 8)))
(display (Math.scale (Fac.fac 5) '(1 2 3 4)))
