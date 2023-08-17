;; 利用call/cc实现协程（生产者消费者同步问题）
;; 实际上不是完全的协程，因不具备yield到任意协程的能力
;; 参考：https://www.scheme.com/tspl4/further.html

(import List "std.list.scm")

(define QUEUE_1 '())
(define QUEUE_2 '())
(define QUEUE_1_MAXLEN 8)
(define QUEUE_2_MAXLEN 8)

;; 倒序显示队列（左边进右边出）
(define showq
  (lambda (q)
    (define rev
      (lambda (q)
        (if (null? q)
            '()
            (List.append (car q) (rev (cdr q))))))
    (if (null? q)
        (display "()")
        (display (rev q)))))

;; 队列长度
(define watermark (lambda (q) (if (null? q) 0 (+ 1 (watermark (cdr q))))))

;; 元素插入队列尾部：插入成功返回#t，否则返回#f
(define push_1
  (lambda (e)
    (if (>= (watermark QUEUE_1) QUEUE_1_MAXLEN)
        #f
        { (set! QUEUE_1 (List.append e QUEUE_1)) #t})))
(define push_2
  (lambda (e)
    (if (>= (watermark QUEUE_2) QUEUE_2_MAXLEN)
        #f
        { (set! QUEUE_2 (List.append e QUEUE_2)) #t})))

;; 弹出队列头部元素，并返回
(define shift_1
  (lambda ()
    (if (null? QUEUE_1)
        #f
        { (define a (car QUEUE_1))
          (set! QUEUE_1 (cdr QUEUE_1))
          a })))
(define shift_2
  (lambda ()
    (if (null? QUEUE_2)
        #f
        { (define a (car QUEUE_2))
          (set! QUEUE_2 (cdr QUEUE_2))
          a })))

(define LWP_LIST '())

(define lwp
  (lambda (thunk)
    (set! LWP_LIST (List.append thunk LWP_LIST))))

(define start_next
  (lambda ()
    (define p (car LWP_LIST))
    (set! LWP_LIST (cdr LWP_LIST))
    (p)))

(define wait_this_and_start_next
  (lambda ()
    (call/cc
      (lambda (k)
        (lwp (lambda () (k #t)))
        (start_next)))))

(define quit
  (lambda (return msg)
    (if (null? LWP_LIST)
        { (display msg) (display "已结束，进程队列空，停机。\n") (return) }
        { (display msg) (display "已结束。\n") (start_next) })))


(define COUNTER 1)

(display "利用call/cc实现协程（生产者消费者同步问题）\n")

(call/cc (lambda (return) (

  (lwp
    (lambda ()
      (define f
        (lambda ()
          ;(display "生产者 ")
          (if (push_1 COUNTER)
              { (set! COUNTER (+ COUNTER 1))
                (showq QUEUE_1) (display " -> ")
                (showq QUEUE_2) (newline)
              }
              (wait_this_and_start_next))
          (if (and (null? QUEUE_1) (null? QUEUE_2)) (quit return "生产者") #f)
          (f)))
      (f)))

  (lwp
    (lambda ()
      (define f
        (lambda ()
          ;(display "中间商 ")
          (define t (shift_1))
          (if (not t)
              (wait_this_and_start_next)
              (if (push_2 t)
                  { (showq QUEUE_1) (display " -> ")
                    (showq QUEUE_2) (newline)
                  }
                  { (wait_this_and_start_next)
                    (display "丢弃：") (display t) (newline) }))
          (if (and (null? QUEUE_1) (null? QUEUE_2)) (quit return "中间商") #f)
          (f)))
      (f)))

  (lwp
    (lambda ()
      (define f
        (lambda ()
          ;(display "消费者 ")
          (define t (shift_2))
          (if (not t)
              (wait_this_and_start_next)
              { (showq QUEUE_1) (display " -> ")
                (showq QUEUE_2) (newline)
              })
          (if (and (null? QUEUE_1) (null? QUEUE_2)) (quit return "消费者") #f)
          (f)))
      (f)))

  (start_next))))

(display "\n调度器结束，返回最外层。\n")
