(native String)
(import "../../../source/applib/list.scm" List)

; A simple Brainfuck interpreter
; 简单的Brainfuck解释器
;
; 2017.11.14 BD4SUR
; https://github.com/bd4sur

; 应用序的Y不动点组合子（可以不需要）
(define Y
  (lambda (S)
    ( (lambda (x) (S (lambda (y) ((x x) y))))
      (lambda (x) (S (lambda (y) ((x x) y)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Brainfuck运行时环境初始化
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Brainfuck运行时环境说明
;   BF运行时环境为Scheme列表
;   列表首元素为0位，地址称为index，相当于物理地址
;   index为0、1的两个元素分别是数据指针（DP）和代码指针（CP）
;   index从2开始的部分是数据区和代码区，相对于index=2的元素的偏移量为offset，相当于逻辑地址
;   DP和CP保存的都是offset，即index-2
;   DP是BF的<>两个指令控制的指针，其初始值为0
;   数据区从offset=0开始
;   CP是待执行指令的指针，相当于程序计数器，其初始值由用户指定
;   代码区从offset=初始CP开始
;   数据区默认值为0，代码区存储指令的ASCII码
;   代码以空格结束，解释器通过空格判断程序结束
;
;   例如
;   [ index] 0123456789ABCDEF
;   [offset] --0123456789ABCD
;   [memory] 0223[->+<]_
;
;   上面这段程序将逻辑地址0上面的数字加到逻辑地址1上。下划线代表空格。

; 环境构建
(define env_constructer
  (lambda (dp_init cp_init code_str)
    (lambda (iter)
        (if (= iter 0)
            (cons dp_init ((env_constructer dp_init cp_init code_str) (+ iter 1)))
            (if (= iter 1)
                (cons cp_init ((env_constructer dp_init cp_init code_str) (+ iter 1)))
                (if (<= iter (+ 1 cp_init))
                    (cons 0 ((env_constructer dp_init cp_init code_str) (+ iter 1)))
                    (if (> iter (+ (+ cp_init (String.length code_str)) 1))
                        '()
                        {
                            ;(display (String.fromCharCode (cons (String.charCodeAt (- iter (+ 2 cp_init)) code_str) '())))
                            (cons (String.charCodeAt (- iter (+ 2 cp_init)) code_str)
                                  ((env_constructer dp_init cp_init code_str) (+ iter 1)))
                        })))))))

; 环境初始化
(define ENV_INIT (lambda (dp_init cp_init code_str) ((env_constructer dp_init cp_init code_str) 0)))

; 手动设置数据区
(define MEM_SET (lambda (env addr value) (list-set env (+ 2 addr) value)))

; 打印一行字符串
(define printstr
  (lambda (cstr)
    ;(display (String.fromCharCode cstr))))
    (display cstr)))

; 调试输出
(define BF_DEBUG
  (lambda (env)
    (display "== BrainFUCK DEBUG ===================================================")(newline)
    (display " DP = ")(display (car env))(newline)
    (display " CP = ")(display (car (cdr env)))(newline)
    (display " LA : 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF")(newline)
    (display "MEM = ")
    (printstr (cdr (cdr env)))(newline)
    (display "======================================================================")(newline)
  ))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 列表工具函数
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; 左子列表 [0:index)
(define sub_L
  (lambda (index env)
    (((Y (lambda (f)
           (lambda (e)
             (lambda (iter)
               (if (= index iter)
                   '()
                   (cons (List.ref e iter) ((f e) (+ iter 1)))
               ))))) env) 0)))

; 右子列表 (index:N]
(define sub_R
  (lambda (index env)
    (((Y (lambda (f)
           (lambda (e)
             (lambda (iter)
               (if (= 0 iter)
                   e
                   ((f (cdr e)) (- iter 1))
                ))))) env) (+ index 1))))

; 列表连接
(define list_catenate
  (lambda (_pre _post)
    (((Y (lambda (f)
           (lambda (pre)
             (lambda (post)
               (if (null? pre)
                   post
                   (cons (car pre) ((f (cdr pre)) post))
               ))))) _pre) _post)))


; 列表置数
(define list-set
  (lambda (list index value)
    (list_catenate (sub_L index list)
                   (cons value
                         (sub_R index list)))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 环境访问函数
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; 计算数据指针的物理地址index
(define data_index
  (lambda (env)
    (+ 2 (car env))))

; 读取当前指针指向的cell值
(define read_data
  (lambda (env)
    (List.ref env (data_index env))))

; 修改当前指针指向的cell值
; 注意：传入单参函数
(define modify_data
  (lambda (func env)
    (list_catenate (sub_L (data_index env) env)
                   (cons (func (read_data env))
                         (sub_R (data_index env) env)))))

; 计算程序指针的物理地址index
(define code_index
  (lambda (env)
    (+ 2 (car (cdr env)))))

; 取CP指向的指令码
(define read_code
  (lambda (env)
    (List.ref env (code_index env))))

; 计算当前指令逻辑地址（offset）左侧的**匹配**的“[”指令的所在物理地址（index）
; 这里计算的是（当前所在内层）循环的入口地址
(define ret_index
  (lambda (env)
    ((((Y (lambda (f)
            (lambda (e)
              (lambda (cindex)
                (lambda (flag)
                  (if (= (List.ref env cindex) 93)
                      (((f env) (- cindex 1)) (+ flag 1))
                      (if (= (List.ref env cindex) 91)
                          (if (= flag 0)
                              cindex
                              (((f env) (- cindex 1)) (- flag 1)))
                          (((f env) (- cindex 1)) flag)))
                  ))))) env) (- (code_index env) 1)) 0)))

; 计算当前指令逻辑地址（offset）右侧的**匹配**的“]”指令的所在物理地址（index）的后一位
; 这里计算的是（当前所在内层）循环的跳出地址
(define pass_index
  (lambda (env)
    ((((Y (lambda (f)
            (lambda (e)
              (lambda (cindex)
                (lambda (flag)
                  (if (= (List.ref env cindex) 91)
                      (((f env) (+ cindex 1)) (+ flag 1))
                      (if (= (List.ref env cindex) 93)
                          (if (= flag 0)
                              (+ cindex 1)
                              (((f env) (+ cindex 1)) (- flag 1)))
                          (((f env) (+ cindex 1)) flag)))
                 ))))) env) (+ (code_index env) 1)) 0)))

; 修改指令指针（下条指令逻辑地址）
(define modify_code_offset
  (lambda (coffset env)
    (cons (car env) (cons coffset (sub_R 1 env)))))

; 获取下一条指令的逻辑地址
(define next
  (lambda (env)
    (+ 1 (car (cdr env)))))

; CP加一
(define cp++
  (lambda (env)
    (modify_code_offset (+ 1 (car (cdr env))) env)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 指令语义
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define p>
  (lambda (env)
    (cp++ (cons (+ 1 (car env)) (cdr env)))))

(define p<
  (lambda (env)
    (cp++ (cons (- (car env) 1) (cdr env)))))

(define ++
  (lambda (env)
    (cp++ (modify_data (lambda (x) (+ x 1)) env))))

(define --
  (lambda (env)
    (cp++ (modify_data (lambda (x) (- x 1)) env))))

; .
(define o
  (lambda (env)
    (display (String.fromCharCode (read_data env)))
    (cp++ env)))

; ,暂不实现

; [
(define loopl
  (lambda (env)
    (if (= 0 (read_data env))
        (modify_code_offset (- (pass_index env) 2) env) ;直接跳出
        (cp++ env) ;下条指令
    )))

; ]
(define loopr
  (lambda (env)
    (modify_code_offset (- (ret_index env) 2) env)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 解释器主体
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; 单步执行：执行当前CP指向的指令
; 执行的结果当然是保存在新的env里面啦
(define step
  (lambda (env)
    ;(BF_DEBUG env)
    (if (= (read_code env) 43) ;+
        (++ env)
        (if (= (read_code env) 45) ;-
            (-- env)
            (if (= (read_code env) 62) ;>
                (p> env)
                (if (= (read_code env) 60) ;<
                    (p< env)
                    (if (= (read_code env) 46) ;.
                        (o env)
                        (if (= (read_code env) 44) ;,
                            (p> env) ;暂未实现
                            (if (= (read_code env) 91) ;[
                                (loopl env)
                                (if (= (read_code env) 93) ;]
                                    (loopr env)
                                    env ; 未知指令，不执行任何动作
                                ))))))))))

; 主函数
;   读取到空白字符（32）时停止，并输出调试信息
(define bf_interpreter
  (lambda (env cnt)
    (if (= (read_code env) (String.charCodeAt 0 " "))
        {
            (BF_DEBUG env)
            (display "iteration steps = ")
            (display cnt)(newline)
        }
        {
            ;(display cnt)
            (bf_interpreter (step env) (+ cnt 1))
        }
        )))

; 设置环境
(define env #f)
(set! env (ENV_INIT 0 20 "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++. "))

; (set! env (ENV_INIT 0 20 "[->+<] "))
; (set! env (MEM_SET env 0 10))
; (set! env (MEM_SET env 1 20))

; 开始解释执行
(display "此用例是Brainfuck的Scheme实现。")(newline)
(display "当时出于学习目的，所有的递归全部使用Y组合子实现，因此性能极其低下。")(newline)
(display "Hello World 程序运行需要986个时钟。视机器性能，可能需要十分钟或者更长的时间。")(newline)
(bf_interpreter env 0)
