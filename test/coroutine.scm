;; 利用call/cc实现协程（生产者消费者同步问题）
;; 通过轻量级线程队列和基于循环的非抢占式中心调度机，协调管理所有的生产者和消费者
;; 调度机按照LWP加入队列的顺序，启动各个LWP；LWP必须主动将控制权交还给调度机
;; 这段代码中，每个LWP自行维护时间片切换机制，时间片用完之后，主动退出
;;
;; 2023-08-18 初版：三个参与者（生产者、中间商、消费者）顺序读写两个FIFO
;; 2025-06-18 改写：多个生产者和消费者读写同一个FIFO
;;
;; 参考：https://www.scheme.com/tspl4/further.html

(import List "list.scm")

(define PRODUCT_COUNTER 1)      ;; 产品计数器，可以看成是序列号
(define FINISHED #f)            ;; 全局生产完成标记
(define PRODUCT_QUEUE '())      ;; 产品队列
(define PRODUCT_QUEUE_MAXLEN 5) ;; 产品队列最大长度


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
(define push
  (lambda (e)
    (if (>= (watermark PRODUCT_QUEUE) PRODUCT_QUEUE_MAXLEN)
        #f
        { (set! PRODUCT_QUEUE (List.append e PRODUCT_QUEUE)) #t})))

;; 弹出队列头部元素，并返回
(define shift
  (lambda ()
    (if (null? PRODUCT_QUEUE)
        #f
        { (define a (car PRODUCT_QUEUE))
          (set! PRODUCT_QUEUE (cdr PRODUCT_QUEUE))
          a })))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define LWP_LIST '())

(define add_lwp
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
        (add_lwp (lambda () (k #t)))
        (start_next)))))

(define quit
  (lambda (return tag)
    (if (null? LWP_LIST)
        { (display tag) (display " 结束，进程队列空，停机。\n\n") (return) }
        { (display tag) (display " 结束。\n\n") (start_next) })))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; 生产者：其中timeslice是每次获得执行权之后最多能执行的循环次数，消费者同
(define producer
  (lambda (return tag timeslice)
    (define timer timeslice)
    (define loop
      (lambda ()
        ;; 检查时间片是否用完
        (if (= timer 0) {
          (display tag) (display " 暂停（时间片用完）\n\n")
          (set! timer timeslice) ;; 暂停之前，重置时间片计数器
          (wait_this_and_start_next)
        } {
          (set! timer (- timer 1))
          ;; 向存货队列里生产1个产品
          (if (push PRODUCT_COUNTER) {
            (display tag) (display " 生产 ") (display PRODUCT_COUNTER) (display " -> ")
            (showq PRODUCT_QUEUE) (newline)
            (set! PRODUCT_COUNTER (+ PRODUCT_COUNTER 1))
          } {
            (display tag) (display " 暂停（队列满）\n\n")
            (set! timer timeslice) ;; 暂停之前，重置时间片计数器
            (wait_this_and_start_next)
          })
          ;; 判断消费者是否满足
          (if FINISHED (quit return tag) #f)
        })
        (loop)))
    (loop)))

(define consumer
  (lambda (return tag timeslice)
    (define timer timeslice)
    (define loop
      (lambda ()
        ;; 检查时间片是否用完
        (if (= timer 0) {
          (display tag) (display " 暂停（时间片用完）\n\n")
          (set! timer timeslice) ;; 暂停之前，重置时间片计数器
          (wait_this_and_start_next)
        } {
          (set! timer (- timer 1))
          ;; 从存货队列里取出1个产品
          (define t (shift))
          (if (not t) {
            (display tag) (display " 暂停（队列空）\n\n")
            (set! timer timeslice) ;; 暂停之前，重置时间片计数器
            (wait_this_and_start_next)
          } {
            (display tag) (display " 消费 ")
            (showq PRODUCT_QUEUE) (display " -> ") (display t) (newline)
          })
          ;; 判断是否满足
          (if (> PRODUCT_COUNTER 20) { ;; 只要产品序列号大于某值就满足需求，可以结束
            (set! FINISHED #t) (quit return tag)
          } #f)
        })
        (loop)))
    (loop)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(display "利用call/cc实现协程（生产者消费者同步问题）\n\n")

(call/cc (lambda (return) (

  (add_lwp (lambda () (producer return "生产者1" 3)))
  (add_lwp (lambda () (producer return "生产者2" 3)))

  (add_lwp (lambda () (consumer return "消费者1" 1)))
  (add_lwp (lambda () (consumer return "消费者2" 2)))
  (add_lwp (lambda () (consumer return "消费者3" 2)))

  (start_next))))

(display "\n调度器结束，返回最外层。\n")
