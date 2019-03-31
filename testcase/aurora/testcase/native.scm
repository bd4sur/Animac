(native HTTPS)
(native String)
(native Math)
(native File)

(import "./factorial.scm" Fac)

;; NOTE （已修复：凡是被引用的模块，其顶级作用域的非define节点会被逻辑删除）模块import机制有重大缺陷：import的模块，不要求值其顶级作用域begin内部的子表达式。

;; HTTPS测试
(define res #f)
(display "请求作者博客RSS……")
(set! res (HTTPS.request "https://mikukonai.com/feed.xml"))
(display "完成。响应文本已保存。")

; 此文件内容是若干个URL（HTTPS），每行一个。
(define path  "E:/text.txt")
; 此文件内容是提示语，用于提示文件已被正确读出。
(define path2 "E:/text2.txt")

;; File测试：按行读取第一个文件的URL，逐个请求。每轮循环都会读取一次第二个文件。
(File.read
    path
    (lambda (content) (begin
      (define segs #f)
      ;; TODO 这里define的行为与预想的有偏差：应当区别对待lambda和SList的求值。Lambda不作处理，但SList需要求值。
      ;; 或者，干脆就把define的语义设计成这样吧。
      (set! segs (String.split content "\n"))
      (define show
        (lambda (segs)
          (if (null? segs)
              #f
              (begin (display "请求URL：")
                     (display (car segs))
                     (display (String.substring (HTTPS.request (car segs)) 0 20))
                     (display "请求完成，现在开始读取文件：")
                     (File.read path2 (lambda (content) (display content)))
                     (show (cdr segs))))))
      (show segs)
      )))

;; String测试
(display (String.length    res        ))
(display (String.charAt    res  10    ))
(display (String.substring res  0  21 ))

;; Math测试
(display (Math.sin (Math.PI)))
(display (Math.dot '(1 2 3 4) '(5 6 7 8)))
(display (Math.scale (Fac.fac 5) '(1 2 3 4)))

;; AppLib测试
(import "../../../source/applib/list.scm" List)
(define multiply
  (lambda (x y) (* x y)))
(display (List.reduce '(1 2 3 4 5 6 7 8 9 10) multiply 1))
