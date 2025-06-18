ANIMAC_VFS["/test/list.scm"] = `;; 应用库
;; 几个高阶函数

;; 判断list是不是lat（list of atoms）
(define lat?
  (lambda (list)
    (cond ((null? list) #t)
          ((atom? (car list)) (lat? (cdr list)))
          (else #f))))

;; 判断某个原子是否为某个lat的成员
(define member?
  (lambda (x lat)
    (cond ((null? lat) #f) ;找遍列表也没找到
          ((eq? x (car lat)) #t)
          (else (member? x (cdr lat))))))

;; 返回删除了第一个a的lat
(define rember
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((eq? a (car lat)) (cdr lat))
          (else (cons (car lat) (rember a (cdr lat)))))))

;; 删除表中所有匹配原子
(define delete_atom
  (lambda (a lat)
    (cond ((null? lat) lat)
          ((member? a lat) (delete_atom a (rember a lat)))
          (else lat))))

;; 输出一个表的各子表的car组成的表
(define firsts
  (lambda (list)
    (cond ((null? list) '())
          ((list? (car list)) (cons (car (car list)) (firsts (cdr list)))) ;; 注：应为pair?
          (else (cons (car list) (firsts (cdr list)))))))

;; 该函数查找old在list的第一次出现位置，并在其后插入new。函数返回新列表
(define insertR
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons (car list) (cons new (cdr list))))
          (else (cons (car list) (insertR new old (cdr list)))))))

;;在左侧插入
(define insertL
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new list))
          (else (cons (car list) (insertL new old (cdr list)))))))

;; 用new替换old在list的首个出现
(define subst
  (lambda (new old list)
    (cond ((null? list) list)
          ((eq? old (car list)) (cons new (cdr list)))
          (else (cons (car list) (subst new old (cdr list)))))))

;; 用new替换o1或者o2在list的首个出现
(define subst2
  (lambda (new o1 o2 list)
    (cond ((null? list) list)
          ((or (eq? o1 (car list)) (eq? o2 (car list))) (cons new (cdr list)))
          (else (cons (car list) (subst2 new o1 o2 (cdr list)))))))

;; 修改列表pos位置上的元素为new_value，并返回新列表
(define list_set
  (lambda (lst pos new_value)
    (define list_set_iter
      (lambda (lst pos new_value iter)
        (cond ((= iter pos) (cons new_value (cdr lst)))
              (else (cons (car lst) (list_set_iter (cdr lst) pos new_value (+ iter 1)))))))
    (list_set_iter lst pos new_value 0)))

(define map
  (lambda (lst f)
    (if (null? lst)
        (quote ())
        (cons (f (car lst)) (map (cdr lst) f))
    )))

(define filter
  (lambda (lst p)
    (if (null? lst)
        (quote ())
        (if (p (car lst))
            (cons (car lst) (filter (cdr lst) p))
            (filter (cdr lst) p)))))

(define reduce
  (lambda (lst f init)
    (if (null? lst)
        init
        (f (car lst) (reduce (cdr lst) f init)))))

(define ref
  (lambda (lst index)
    (define iter
      (lambda (l count)
        (if (= count index)
            (car l)
            (iter (cdr l) (+ 1 count)))))
    (iter lst 0)))

;; 向列表尾部追加一项
(define append
  (lambda (x lst)
    (define append_cps
      (lambda (x lst cont)
        (if (null? lst)
            (cont (cons x lst))
            (append_cps x (cdr lst)
              (lambda (res)
                (cont (cons (car lst) res)))))))
  (append_cps x lst (lambda (x) x))))

;; 连接两个列表
(define concat
  (lambda (a b)
    (if (null? b)
        a
        (concat (append (car b) a) (cdr b)))))
`;

ANIMAC_VFS["/test/quine.scm"] = `(display "Quine测试：")(newline)
(display "预期输出：")
(display "((lambda (x) (cons x (cons (cons quote (cons x '())) '()))) (quote (lambda (x) (cons x (cons (cons quote (cons x '())) '())))))")
(newline)
(display "实际输出：")
(display
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ((lambda (x) (cons x (cons (cons quote (cons x '())) '()))) (quote (lambda (x) (cons x (cons (cons quote (cons x '())) '())))))
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
)
(newline)
`;

ANIMAC_VFS["/test/quicksort.scm"] = `(define filter
  (lambda (f lst)
    (if (null? lst)
        '()
        (if (f (car lst))
            (cons (car lst) (filter f (cdr lst)))
            (filter f (cdr lst))))))

(define concat
  (lambda (a b)
    (if (null? a)
        b
        (cons (car a) (concat (cdr a) b)))))

(define partition
  (lambda (op pivot array)
    (filter (lambda (x) (if (op x pivot) #t #f)) array)))

(define quicksort
  (lambda (array)
    (define pivot #f)
    (if (or (null? array) (null? (cdr array)))
        array
        {
          (set! pivot (car array))
          (concat (quicksort (partition < pivot array))
                  (concat (partition = pivot array)
                          (quicksort (partition > pivot array))))
        }
    )
))

(display "快速排序：测试验证列表操作、if、and/or等特殊结构")(newline)
(display "期望结果：(-3 -3 -2 -1 0 1 2 3 4 5 5 6 6 6 7 8 9)")(newline)
(display "实际结果：")
(display (quicksort '(6 -3 5 9 -2 6 1 7 -3 5 3 0 4 -1 6 8 2)))
`;

ANIMAC_VFS["/test/man_or_boy_test.scm"] = `(define A
  (lambda (k x1 x2 x3 x4 x5)
      (define B
        (lambda ()
            (set! k (- k 1))
            (A k B x1 x2 x3 x4)))
      (if (<= k 0)
          (+ (x4) (x5))
          (B))))

(define thunk_1  (lambda () 1))
(define thunk_m1 (lambda () -1))
(define thunk_0  (lambda () 0))

(display "Man or Boy Test")(newline)
(display "A[10] = ") (display (A 10 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)
(display "A[11] = ") (display (A 11 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)
(display "A[12] = ") (display (A 12 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)
(display "A[13] = ") (display (A 13 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)
(display "A[14] = ") (display (A 14 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)
(display "A[15] = ") (display (A 15 thunk_1 thunk_m1 thunk_m1 thunk_1 thunk_0)) (newline)`;

ANIMAC_VFS["/test/brainfuck.scm"] = `(native String)

(import List "/test/list.scm")

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
    (display "== Brainfuck DEBUG ===================================================")(newline)
    (display " DP = ")(display (car env))(newline)
    (display " CP = ")(display (car (cdr env)))(newline)
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

; (set! env (ENV_INIT 0 20 "[->+<] "))
; (set! env (MEM_SET env 0 10))
; (set! env (MEM_SET env 1 20))

; 开始解释执行
(define run
  (lambda () {
    (display "本测试用例是Brainfuck的Scheme实现。")(newline)
    (display "出于学习研究目的，所有递归全部使用Y组合子实现，可能需要数十秒或者更长的时间才能执行完毕。")(newline)
    (display "预期输出：Hello World!")(newline)
    (define env #f)
    (set! env (ENV_INIT 0 20 "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++. "))
    (bf_interpreter env 0)
    (newline)
    (newline)
  })
)

(run)`;

ANIMAC_VFS["/test/fft.scm"] = `;; 递归实现快速傅里叶变换
;; 2023-08

(native Math)
(import List "/test/list.scm")

;; 把序列按照奇偶分成两部分
(define sep
  (lambda (x)
    (define even
      (lambda (input even_items odd_items)
        (if (null? input)
            \`(,even_items ,odd_items)
            (odd (cdr input) (List.append (car input) even_items) odd_items))))
    (define odd
      (lambda (input even_items odd_items)
        (if (null? input)
            \`(,even_items ,odd_items)
            (even (cdr input) even_items (List.append (car input) odd_items)))))
    (even x '() '())))

(define complex_mul
  (lambda (x y)
    (define a (car x)) (define b (car (cdr x)))
    (define c (car y)) (define d (car (cdr y)))
    \`(,(- (* a c) (* b d)) ,(+ (* b c) (* a d)))))

(define complex_add (lambda (x y) \`(,(+ (car x) (car y)) ,(+ (car (cdr x)) (car (cdr y))))))

(define complex_sub (lambda (x y) \`(,(- (car x) (car y)) ,(- (car (cdr x)) (car (cdr y))))))

(define list_pointwise
  (lambda (op x y)
    (if (or (null? x) (null? y))
        '()
        (cons (op (car x) (car y))
              (list_pointwise op (cdr x) (cdr y))))))

(define W_nk
  (lambda (N k)
    \`(,(Math.cos (/ (* -2 (* (Math.PI) k)) N))
      ,(Math.sin (/ (* -2 (* (Math.PI) k)) N)))))

(define twiddle_factors
  (lambda (N iter)
    (if (= iter (/ N 2)) ;; 只取前一半
        '()
        (cons (W_nk N iter)
              (twiddle_factors N (+ iter 1))))))

(define fft
  (lambda (input N)
    (if (= N 1)
        input
        {
          (define s (sep input))
          (define even_dft (fft (car s)       (/ N 2)))
          (define odd_dft  (fft (car (cdr s)) (/ N 2)))
          (define tf (twiddle_factors N 0))
          (List.concat (list_pointwise complex_add even_dft (list_pointwise complex_mul odd_dft tf))
                       (list_pointwise complex_sub even_dft (list_pointwise complex_mul odd_dft tf)))
        })))

(define ifft
  (lambda (input N)
    ;; 复数列表逐个取共轭
    (define cv_conj
      (lambda (cv)
        (List.map cv (lambda (c) \`(,(car c) ,(- 0 (car (cdr c))))))))
    (List.map (cv_conj (fft (cv_conj input) N))
              (lambda (x) \`(,(/ (car x) N) ,(/ (car (cdr x)) N))))))

(define run
  (lambda () {
    (display "快速傅里叶变换：用于测试数学本地库和列表操作")(newline)
    (display "FFT期望结果：((8 1) (0 1) (0 1) (0 1) (0 1) (0 1) (0 1) (0 1))")(newline)
    (define N 8)
    (define x '((1 1) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0)))
    (define xx (fft x N))
    (define x2 (ifft xx N))
    (display "FFT实际结果：")
    (display xx)
    (newline)
    (display "IFFT期望结果：((1 1) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0) (1 0))")(newline)
    (display "IFFT实际结果：")
    (display x2)
    (newline)
    (newline)
  })
)
`;

ANIMAC_VFS["/test/bigint.scm"] = `;; 基于离散傅里叶变换的大整数乘法算法
;; 2023-08-15

(native String)
(native Math)
(import List "/test/list.scm")
(import FFT "/test/fft.scm")

(define charcode_of_zero (String.charCodeAt 0 "0"))

;; 乘法结果位数（FFT所需序列长度）
(define fft_len
  (lambda (str1 str2)
    (define str1len (String.length str1))
    (define str2len (String.length str2))
    (define maxlen (* 2 (if (> str1len str2len) str1len str2len)))
    (define loglen (Math.round (Math.log2 maxlen)))
    (if (= (% loglen 2) 0) (pow 2 (+ 2 loglen)) (pow 2 (+ 1 loglen)))))

;; 十进制数字字符串转为复数（虚部为0）列表
(define numstr_to_complex_vector
  (lambda (numstr fftlen)
    (define numlen (String.length numstr))
    (define complex_vector '())
    (define iter
      (lambda (pos)
        (if (= pos fftlen)
            complex_vector {
            (if (and (>= pos numlen) (< pos fftlen))
                (set! complex_vector (List.append '(0 0) complex_vector))
                { (define charcode (String.charCodeAt (- (- numlen pos) 1) numstr))
                  (define digit (- charcode charcode_of_zero))
                  (set! complex_vector (List.append \`(,digit 0) complex_vector)) })
            (iter (+ 1 pos)) })))
    (iter 0)))

;; 复数列表转回十进制数字字符串
(define complex_vector_to_numstr
  (lambda (cv fftlen)
    (define numstr "")
    (define carry 0)
    (define iter
      (lambda (i)
        (if (>= i fftlen)
            numstr
            { (define complex_value (List.ref cv i))
              (define c (+ carry (Math.round (car complex_value))))
              (if (and (>= c 0)(<= c 9))
                  { (set! numstr (String.concat (String.fromCharCode (+ c charcode_of_zero)) numstr))
                    (set! carry 0) }
                  { (set! numstr (String.concat (String.fromCharCode (+ (% c 10) charcode_of_zero)) numstr))
                    (set! carry (Math.round (/ (- c (% c 10)) 10))) })
              (iter(+ i 1)) })))
    (iter 0)))

;; 去掉数字字符串的前导零
(define trim_leading_zeros
  (lambda (nstr)
    (define s "")
    (define slen (String.length nstr))
    (define iter
      (lambda (i is_leading)
        (define current_digit (- (String.charCodeAt i nstr) charcode_of_zero))
        (if (= i slen)
            s
            (if (and is_leading (= current_digit 0))
                (iter (+ i 1) #t)
                { (set! s (String.concat s (String.fromCharCode (+ current_digit charcode_of_zero))))
                  (iter (+ i 1) #f) }))))
    (iter 0 #t)))

;; 两个十进制大整数字符串相乘，输出也是字符串
(define big_int_multiply
  (lambda (astr bstr)
    (define fftlen (fft_len astr bstr))
    (define a_cv (numstr_to_complex_vector astr fftlen))
    (define b_cv (numstr_to_complex_vector bstr fftlen))
    (define aa_cv (FFT.fft a_cv fftlen))
    (define bb_cv (FFT.fft b_cv fftlen))
    (define cc_cv (FFT.list_pointwise FFT.complex_mul aa_cv bb_cv))
    (define c_cv (FFT.ifft cc_cv fftlen))
    (trim_leading_zeros (complex_vector_to_numstr c_cv fftlen))))

(define run
  (lambda () {
    (display "基于FFT的大整数乘法\\n")
    (display "预期结果（直接数字相乘） = ")
    (display (* 114514 1919810))
    (newline)
    (display "实际结果（大数乘法算法） = ")
    (display (big_int_multiply "114514" "1919810"))
    (newline)
    (newline)
  })
)

`;

ANIMAC_VFS["/test/yinyang.scm"] = `;; 警告：无穷循环，谨慎运行

(define Yinyang
(lambda ()
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
(((lambda (x) (begin (display "@") x)) (call/cc (lambda (k) k)))
 ((lambda (x) (begin (display "*") x)) (call/cc (lambda (k) k))))
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
)
)

(display "测试 Yin-yang Puzzle：")
(display "期望结果：@*@**@***@****...") (newline)
(Yinyang)
`;

ANIMAC_VFS["/test/interpreter.scm"] = `
;; The Little Schemer 书中给出的Scheme解释器

(define build
  (lambda (s1 s2)
    (cons s1 (cons s2 '()))))

(define first
  (lambda (list-pair)
    (car list-pair)))

(define second
  (lambda (list-pair)
    (car (cdr list-pair))))

(define third
  (lambda (list-pair)
    (car (cdr (cdr list-pair)))))

(define new-entry build)

(define lookup-in-entry-help
  (lambda (name names values entry-f)
    (cond ((null? names) (entry-f name))
          ((eq? (car names) name) (car values))
          (else (lookup-in-entry-help name (cdr names) (cdr values) entry-f)))))

(define lookup-in-entry
  (lambda (name entry entry-f)
    (lookup-in-entry-help name (first entry) (second entry) entry-f)))

(define extend-table cons)

(define lookup-in-table
  (lambda (name table table-f)
    (cond ((null? table) (table-f name))
          (else (lookup-in-entry name
                                 (car table)
                                 (lambda (n)
                                   (lookup-in-table n
                                                    (cdr table)
                                                    table-f)))))))

(define expression-to-action
  (lambda (e)
    (cond ((atom? e) (atom-to-action e))
          (else (list-to-action e)))))

(define atom-to-action
  (lambda (e)
    (cond ((number? e) *const)
          ((eq? e #t) *const)
          ((eq? e #f) *const)
          ((eq? e 'cons) *const)
          ((eq? e 'car) *const)
          ((eq? e 'cdr) *const)
          ((eq? e 'null?) *const)
          ((eq? e 'eq?) *const)
          ((eq? e 'atom?) *const)
          ((eq? e 'zero?) *const)
          ((eq? e 'add1) *const)
          ((eq? e 'sub1) *const)
          ((eq? e '+) *const)
          ((eq? e '-) *const)
          ((eq? e '*) *const)
          ((eq? e '/) *const)
          ((eq? e '=) *const)
          ((eq? e 'begin) *const)
          ((eq? e 'display) *const)
          ((eq? e 'number?) *const)
          (else *identifier))))

(define list-to-action
  (lambda (e)
    (cond ((atom? (car e))
           (cond ((eq? (car e) 'quote)  *quote)
                 ((eq? (car e) 'lambda) *lambda)
                 ((eq? (car e) 'cond)   *cond)
                 (else *application)))
          (else *application))))

(define meaning
  (lambda (e table)
    ((expression-to-action e) e table)))

(define value
  (lambda (e)
    (meaning e '())))

(define *const
  (lambda (e table)
    (cond ((number? e) e)
          ((eq? e #t) #t)
          ((eq? e #f) #f)
          (else (build 'primitive e)))))

(define text-of second)

(define *quote
  (lambda (e table)
    (text-of e)))

(define initial-table (lambda (name) (car '())))

(define *identifier
  (lambda (e table)
    (lookup-in-table e table initial-table)))

(define *lambda
  (lambda (e table)
    (build 'non-primitive (cons table (cdr e)))))

(define table-of first)
(define formals-of second)
(define body-of third)

(define else?
  (lambda (x)
    (cond ((atom? x) (eq? x 'else))
          (else #f))))

(define question-of first)
(define answer-of second)

(define evcon
  (lambda (lines table)
    (cond ((else? (question-of (car lines))) (meaning (answer-of (car lines)) table))
          ((meaning (question-of (car lines)) table) (meaning (answer-of (car lines)) table))
          (else (evcon (cdr lines) table)))))

(define cond-lines-of cdr)

(define *cond
  (lambda (e table)
    (evcon (cond-lines-of e) table)))

(define evlis
  (lambda (args table)
    (cond ((null? args) '())
          (else (cons (meaning (car args) table)
                      (evlis (cdr args) table))))))

(define function-of car)
(define arguments-of cdr)

(define *application
  (lambda (e table)
    (apply (meaning (function-of e) table)
           (evlis (arguments-of e) table))))

(define primitive?
  (lambda (l)
    (eq? (first l) 'primitive)))

(define non-primitive?
  (lambda (l)
    (eq? (first l) 'non-primitive)))

(define apply
  (lambda (fun vals)
    (cond ((primitive? fun)
           (apply-primitive (second fun) vals))
          ((non-primitive? fun)
           (apply-closure (second fun) vals))
          (else (display "Error occured in 'apply'!")))))

(define isAtom
  (lambda (x)
    (cond ((atom? x) #t)
          ((null? x) #f)
          ((eq? (car x) 'primitive) #t)
          ((eq? (car x) 'non-primitive) #t)
          (else #f))))

(define apply-primitive
  (lambda (name vals)
    (cond ((eq? name 'cons)  (cons (first vals) (second vals)))
          ((eq? name 'car)   (car (first vals)))
          ((eq? name 'cdr)   (cdr (first vals)))
          ((eq? name 'null?) (null? (first vals)))
          ((eq? name 'eq?)   (eq? (first vals) (second vals)))
          ((eq? name 'atom?) (isAtom (first vals)))
          ((eq? name 'zero?) (= (first vals) 0))
          ((eq? name 'add1)  (+ 1 (first vals)))
          ((eq? name 'sub1)  (- (first vals) 1))
          ((eq? name '+)     (+ (first vals) (second vals)))
          ((eq? name '-)     (- (first vals) (second vals)))
          ((eq? name '*)     (* (first vals) (second vals)))
          ((eq? name '/)     (/ (first vals) (second vals)))
          ((eq? name '=)     (= (first vals) (second vals)))
          ((eq? name 'begin)   (second vals))
          ((eq? name 'display) (display (first vals)))
          ((eq? name 'number?) (number? (first vals)))
          (else (display "Unknown primitive function.")))))

(define apply-closure
  (lambda (closure vals)
    (meaning (body-of closure)
             (extend-table (new-entry (formals-of closure) vals)
                           (table-of closure)))))

(define run
  (lambda () {
    (display "The Little Schemer 书中给出的Scheme解释器：")(newline)

    (display "期望输出：31") (newline)
    (display "((lambda (x) (add1 x)) 30)=")
    (display (value '((lambda (x) (add1 x)) 30))) (newline)

    (display "10!（期望输出3628000）=")
    (display (value '(((lambda (S)
                        ((lambda (x) (S (lambda (y) ((x x) y))))
                          (lambda (x) (S (lambda (y) ((x x) y))))))
                      (lambda (f)
                        (lambda (n)
                          (cond ((= n 0) 1)
                                (else (* n (f (- n 1)))))))) 10)))

    (newline)
    (newline)
  })
)

(run)
`;

ANIMAC_VFS["/test/quasiquote.scm"] = `;; 准引用列表（quasiquote）

(define printf
  (lambda (template)
    (cond ((null? template) #f)
          ((not (list? template)) (display template))
          (else {
              (display (car template))
              (printf (cdr template))
          }))))

(define run
  (lambda () {
    (display "准引用列表（quasiquote）测试：")(newline)

    (define a 100)
    (define qq \`("a=\${" ,(car \`((a ,(* a 2) ,a) 1 a ,a ,(* a a))) "}"))

    ;; 直接输出
    (display "期望输出：a=\${(a 200 100)}")(newline)
    (display "实际输出：")
    (printf qq)
    (newline)

    ;; 准引用列表里面的unquote也应该是词法作用域的。
    (display "期望输出：a=\${(a 200 100)}")(newline)
    (display "实际输出：")
    ((lambda (a) (printf qq) (newline)) 200)

    ;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
    ;; 以下是故障单#16的测试用例

    (define foo (lambda (a lst) (cons \`(,a) lst)))
    (define lst '())

    (set! lst (foo 100 lst))
    (display "期望输出：((100))")(newline)
    (display "实际输出：")
    (display lst)(newline)

    (set! lst (foo 200 lst))
    (display "期望输出：((200) (100))")(newline)
    (display "实际输出：")
    (display lst)(newline)

    (newline)

  })
)

(run)

`;

ANIMAC_VFS["/test/calendar.scm"] = `;;;;;;;;;;;;;;;;;;;;;;;;;
;; Animac测试用例
;; 2012.6    C语言编写
;; 2017.8.26 改写为Scheme
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 打印某年某月的日历

(define get-value-iter
  (lambda (list i counter)
    (if (= counter i)
        (car list)
        (get-value-iter (cdr list) i (+ counter 1)))))

(define get-value
  (lambda (list i)
    (get-value-iter list i 0)))

(define is-leap-year?
  (lambda (year)
    (cond ((and (= (% year 4) 0)
                (not (= (% year 100) 0)))
           #t)
          ((= (% year 400) 0)
           #t)
          (else
           #f))))

(define days-of-month
  (lambda (year month)
    (cond ((< month 1) 0)
          ((> month 12) 0)
          (else (cond ((is-leap-year? year)
                       (get-value '(0 31 29 31 30 31 30 31 31 30 31 30 31) month))
                      (else
                       (get-value '(0 31 28 31 30 31 30 31 31 30 31 30 31) month)))))))

(define days-of-year
  (lambda (year)
    (if (is-leap-year? year)
        366 
        365)))

;某月某日是某年的第几天
(define day-count
  (lambda (year month day)
    (cond ((= month 0) day)
          (else (+ (days-of-month year (- month 1)) (day-count year (- month 1) day))))))

;计算两个日期之间的日数差
(define day-diff
  (lambda (y1 m1 d1 y2 m2 d2)
    (cond ((= y1 y2) (- (day-count y2 m2 d2) (day-count y1 m1 d1)))
          (else (+ (days-of-year (- y2 1)) (day-diff y1 m1 d1 (- y2 1) m2 d2))))))

;计算某日的星期数
(define get-week
  (lambda (year month day)
    (define wk (% (day-diff 2017 1 1 year month day) 7))
    (if (= wk 0) 7 wk)))

;格式输出
(define print-iter
  (lambda (year month iter blank-flag)
    (cond ((>= iter (+ (get-week year month 1) (days-of-month year month)))
           (newline)) ;月末结束
          ((< iter (get-week year month 1)) {
             (display "   ")
             (print-iter year month (+ iter 1) blank-flag)}) ;月初空格
          (else
             (cond ((and (< (- iter (get-week year month 1)) 9) (= blank-flag 0)) {
                      (display " ")
                      (print-iter year month iter 1)})
                   (else
                      (cond ((= (% iter 7) 0) {
                               (display (+ 1 (- iter (get-week year month 1)))) (newline) (print-iter year month (+ iter 1) 0)}) ;行末换行
                            (else {(display (+ 1 (- iter (get-week year month 1)))) (display " ") (print-iter year month (+ iter 1) 0)}))))))))

(define print-calendar
  (lambda (year month)
    (print-iter year month 1 0)))

(define Calendar
  (lambda (year month)
    (display "Animac测试用例：日历")(newline)
    (display year)(display "年")(display month)(display "月")(newline)
    (display "====================")(newline)
    (display "Mo Tu We Th Fr Sa Su")(newline)
    (display "====================")(newline)
    (print-calendar year month)
    (display "====================")(newline)
  ))

(define run
  (lambda () {
    (Calendar 2025 6)
  })
)

(run)
`;

ANIMAC_VFS["/test/church_encoding.scm"] = `;; 丘奇编码
;; https://en.wikipedia.org/wiki/Church_encoding

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 布尔值
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define SHOWBOOL
  (lambda (b)
    (b #t #f)))

(define TRUE  (lambda (x y) x))
(define FALSE (lambda (x y) y))

(define NOT
  (lambda (bool)
    (bool FALSE TRUE)))

(define AND
  (lambda (boolx booly)
    (boolx booly boolx)))

(define OR
  (lambda (boolx booly)
    (boolx boolx booly)))

(define IS_ZERO
  (lambda (n)
    (n (lambda (x) FALSE) TRUE)))

(define IF
  (lambda (p x y)
    (p x y)))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 自然数
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define SHOWNUM
  (lambda (n)
    (n (lambda (x) (+ x 1)) 0)))

(define NUM_TO_LAMBDA
  (lambda (number)
    (if (= number 0)
        NUM_0
        (INC (NUM_TO_LAMBDA (- number 1))))))

(define NUM_0 (lambda (f a) a))

(define NUM_1 (lambda (f a) (f a)))

(define INC
  (lambda (n)
    (lambda (f a)
      (f (n f a)))))

(define ADD
  (lambda (m n)
    (m INC n)))

;Curried-ADD - for function MUL
(define ADD_c
  (lambda (m)
    (lambda (n)
      (m INC n))))

(define MUL
  (lambda (m n)
    (n (ADD_c m) NUM_0)))

;Curried-MUL - for function POW
(define MUL_c
  (lambda (m)
    (lambda (n)
      (n (ADD_c m) NUM_0))))

(define POW
  (lambda (m n)
    (n (MUL_c m) NUM_1)))

;some paticular numbers
(define NUM_2 (lambda (f a) (f (f a))))
(define NUM_3 (lambda (f a) (f (f (f a)))))
(define NUM_4 (lambda (f a) (f (f (f (f a))))))
(define NUM_5 (lambda (f a) (f (f (f (f (f a)))))))
(define NUM_6 (lambda (f a) (f (f (f (f (f (f a))))))))
(define NUM_7 (lambda (f a) (f (f (f (f (f (f (f a)))))))))
(define NUM_8 (lambda (f a) (f (f (f (f (f (f (f (f a))))))))))
(define NUM_9 (lambda (f a) (f (f (f (f (f (f (f (f (f a)))))))))))
(define NUM_10 (lambda (f a) (f (f (f (f (f (f (f (f (f (f a))))))))))))
(define NUM_11 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))
(define NUM_12 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f a))))))))))))))
(define NUM_13 (lambda (f a) (f (f (f (f (f (f (f (f (f (f (f (f (f a)))))))))))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 有序对和减法
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define PAIR
  (lambda (x y)
    (lambda (f)
      (f x y))))

(define LEFT
  (lambda (pair)
    (pair TRUE)))

(define RIGHT
  (lambda (pair)
    (pair FALSE)))

;substraction
(define SLIDE
  (lambda (pair)
    (PAIR (RIGHT pair) (INC (RIGHT pair)))))

(define DEC
  (lambda (n)
    (LEFT (n SLIDE (PAIR NUM_0 NUM_0)))))

(define SUB
  (lambda (m n)
    (n DEC m)))

;comparation
(define IS_LE
  (lambda (num1 num2)
    (IS_ZERO (SUB num1 num2))))

(define IS_EQUAL
  (lambda (num1 num2)
    (AND (IS_LE num1 num2) (IS_LE num2 num1))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; Z组合子（Y组合子的应用序求值版本）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;Y-Combinator
;注意：目标函数应使用单参形式
(define Y
  (lambda (S)
    ( (lambda (x) (S (lambda (y) ((x x) y))))
      (lambda (x) (S (lambda (y) ((x x) y)))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 整数（暂时没有用）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(define INT
  (lambda (neg pos)
    (PAIR neg pos)))

(define INT_ZREO
  (PAIR NUM_0 NUM_0))

(define INT_IS_ZERO
  (lambda (int)
    (AND (IS_ZERO (LEFT  int))
         (IS_ZERO (RIGHT int)))))

;整数标准化，也就是简化成至少一边为0的形式，这样就可以实现绝对值函数和符号函数了
(define INT_NORMALIZE
  (lambda (int)
    (IF (IS_LE (LEFT int) (RIGHT int))
        (INT NUM_0 (SUB (RIGHT int) (LEFT int)))
        (INT (SUB (LEFT int) (RIGHT int)) NUM_0))))

(define INT_ABS
  (lambda (int)
    (IF (IS_ZERO (LEFT (INT_NORMALIZE int)))
        (RIGHT (INT_NORMALIZE int))
        (LEFT  (INT_NORMALIZE int)))))

;TRUE +; FALSE -
(define INT_SGN
  (lambda (int)
    (IS_ZERO (LEFT (INT_NORMALIZE int)))))

(define SHOWINT
  (lambda (int)
    (if (SHOWBOOL (INT_SGN int))
        {(display "+") (SHOWNUM (INT_ABS int))}
        {(display "-") (SHOWNUM (INT_ABS int))})))

(define INT_ADD
  (lambda (i j)
    (INT (ADD (LEFT  i) (LEFT  j))
         (ADD (RIGHT i) (RIGHT j)))))

(define INT_MUL
  (lambda (i j)
    (INT (ADD (MUL (LEFT i) (LEFT j)) (MUL (RIGHT i) (RIGHT j)))
         (ADD (MUL (LEFT i) (RIGHT j)) (MUL (RIGHT i) (LEFT j))))))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; 列表（二叉树）
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; TODO NOTE 【注意】这里体现了Animac的define与标准define的不同之处。Aurora的被define的项是不求值的，因此如果想使用它的值，就需要把它封装成一个thunk，使用的时候调用之。
(define NULL_LIST
  (lambda ()
    (PAIR TRUE TRUE)))

(define IS_NULLLIST
  (lambda (list)
    (LEFT list)))

(define CONS
  (lambda (e l)
    (PAIR FALSE (PAIR e l))))

(define CAR
  (lambda (list)
    (LEFT (RIGHT list))))

(define CDR
  (lambda (list)
    (RIGHT (RIGHT list))))

(define COUNT
  (lambda (l)
    ((Y (lambda (f)
          (lambda (list)
            (IF (NOT (IS_NULLLIST list))
                (lambda (x y) ((INC (f (CDR list)))
                               x
                               y))
                NUM_0))))
     l)))

(define SHOWLIST
  (lambda (list)
    (if (SHOWBOOL (IS_NULLLIST list))
        (display "N)")
        {
            (display (SHOWNUM (CAR list)))
            ;(display ",")
            (SHOWLIST (CDR list))
        }
    )))

;闭区间
;注意Currying
(define RANGE
  (lambda (m n)
    (((Y (lambda (f)
          (lambda (a)
            (lambda (b)
            (IF (IS_LE a b)
                (lambda (z) ((CONS a ((f (INC a)) b))
                               z ))
                (NULL_LIST)
            )))))m)n)))

;高阶函数Fold和Map
(define FOLD
  (lambda (list init func)
    ((((Y (lambda (f)
          (lambda (l)
            (lambda (i)
              (lambda (g)
                (IF (IS_NULLLIST l)
                    i
                    (lambda (x y) (
                      (g (CAR l) (((f (CDR l)) i) g))
                      x y))
                ))))))list)init)func)))

(define MAP
  (lambda (list func)
    (((Y (lambda (f)
           (lambda (l)
             (lambda (g)
               (IF (IS_NULLLIST l)
                   (NULL_LIST)
                   (lambda (x) ((CONS (g (CAR l)) ((f (CDR l)) g)) x))
                )))))list)func)))

; 投影函数（常用）
(define PROJ
  (lambda (list index)
    ((((Y (lambda (f)
            (lambda (l)
              (lambda (i)
                (lambda (j)
                  (IF (IS_EQUAL i j)
                      (CAR l)
                      (lambda (x y) ((((f (CDR l)) i) (INC j)) x y))
                   ))))))list)index)NUM_0)))

(define run
  (lambda () {

    (display "Church编码：测试Scheme语言核心")
    (newline)

    (display "6!=")
    (display
    (SHOWNUM 
    ((Y (lambda (f)
        (lambda (n)
          (IF (IS_EQUAL n NUM_0)
              NUM_1
              (lambda (x y) ((MUL n (f (DEC n)))
                              x
                              y))
          ))))
    NUM_6)))
    (newline)

    (display "Count(1,2,3,3,3)=")
    (display (SHOWNUM (COUNT (CONS NUM_1 (CONS NUM_2 (CONS NUM_3 (CONS NUM_3 (CONS NUM_3 (NULL_LIST)))))))))
    (newline)

    (display "List=(")
    (SHOWLIST (CONS NUM_1 (CONS NUM_2 (CONS NUM_3 (CONS NUM_4 (CONS NUM_5 (NULL_LIST)))))))
    (newline)

    (display "Range(2,7)=(")
    (SHOWLIST (RANGE NUM_2 NUM_7))
    (newline)

    (display "Fold(1:10,0,ADD)=")
    (display (SHOWNUM (FOLD (RANGE NUM_1 NUM_10) NUM_0 ADD)))
    (newline)

    (display "MAP(1:9,0,INC)=(")
    (SHOWLIST (MAP (RANGE NUM_1 NUM_9) INC))
    (newline)

    (display "Proj(2:10,5)=")
    (display (SHOWNUM (PROJ (MAP (RANGE NUM_1 NUM_9) INC) NUM_5)))
    (newline)

  })
)

(run)
`;

ANIMAC_VFS["/test/factorial.scm"] = `(define fac_cps
(lambda (cont)
  (cont (lambda (n)
          (lambda (k)
            ((lambda (cont)
               ((lambda (cont)
                  ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (= x y)))))) ; 内置相等判断
                   (lambda (node0)
                     ((node0 0 n)
                      (lambda (res) (cont res))))))
                (lambda (p_res)
                  (if p_res
                      ((lambda (cont) (cont 1))
                       cont)
                      ((lambda (cont)
                         ; 以下仅仅是对每个AST节点进行简单的遍历CPST/重命名,并未体现求值顺序，可以理解成并行的
                         ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (* x y)))))) (lambda (node0) ; 内置乘法
                         ( fac_cps                                                       (lambda (node1) ; 递归调用(重命名后的)
                         ((lambda (cont) (cont (lambda (x y) (lambda (k) (k (- x y)))))) (lambda (node2) ; 内置减法
                         ; 从这里开始体现求值顺序,几乎等于是 A-Normal Form
                         ((node2 n 1)    (lambda (res2)
                         ((node1 res2)   (lambda (res1)
                         ((node0 n res1) (lambda (res)
                         ; 最后执行总的continuation
                         ( cont res))))))))))))))
                       cont)))))
             (lambda (m) (k m))))))))


(define fac-count 0)
(define clo-count 0)
(define fac
  (lambda (n cont) (begin
    (set! fac-count (+ fac-count 1))
    (if (= n 0)
        (cont 1)
        (fac (- n 1)
             (lambda (res) (begin
               (set! clo-count (+ clo-count 1))
               (cont (* res n)))))))))


(define sum_iter
  (lambda (n init)
    (if (= n 0)
        init
        (sum_iter (- n 1) (+ n init)))))


(define run
  (lambda () {

    (display "阶乘测试①：真·CPS阶乘")(newline)
    (display "期望结果：3628800")(newline)
    (display "实际结果：")
    (((fac_cps (lambda (x) x)) 10) (lambda (x) (display x)))
    (newline)
    (newline)

    (display "阶乘测试②：CPS和set!的结合")(newline)
    (display "5!（期望120）=")
    (display (fac 5 (lambda (x) x)))
    (newline)
    (display "闭包调用次数（期望5）=")
    (display clo-count)
    (newline)
    (display "阶乘递归调用次数（期望6）=")
    (display fac-count)
    (newline)
    (newline)

    (display "尾调用优化测试：大量的尾递归调用")(newline)
    (display "期望结果：5000050000")(newline)
    (display "实际结果：")
    (display (sum_iter 100000 0))
    (newline)
    (newline)

    (display "快速求幂算法：测试cond语句")(newline)
    (display "期望结果：1073741824")(newline)
    (display "实际结果：")
    (define power
      (lambda (base exp init)
        (cond ((= exp 0) init)
              ((= 0 (% exp 2)) (power (* base base) (/ exp 2) init))
              (else (power base (- exp 1) (* base init))))))
    (display (power 2 30 1))
    (newline)
    (newline)

  })
)

(run)
`;

ANIMAC_VFS["/test/calculator.scm"] = `;;;;;;;;;;;;;;;;;;;;;;;;;
;; Animac测试用例 ;;
;;;;;;;;;;;;;;;;;;;;;;;;;

;; 简单的中缀表达式解析
;; 参见 The Little Schemer

(define numbered?
  (lambda (aexp)
    (cond ((atom? aexp) (number? aexp))
          ((atom? (car (cdr aexp))) (and (numbered? (car aexp)) (numbered? (car (cdr (cdr aexp))))))
          (else #f))))

(define value
  (lambda (aexp)
    (cond ((atom? aexp) aexp)
          ((eq? (car (cdr aexp)) '+)
           (+ (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '-)
           (- (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '*)
           (* (value (car aexp)) (value (car (cdr (cdr aexp))))))
          ((eq? (car (cdr aexp)) '/)
           (/ (value (car aexp)) (value (car (cdr (cdr aexp))))))
          (else (display "Unexpected operator")))))

(define run
  (lambda () {
    (display "简单的中缀表达式解析：")(newline)
    (display "预期输出：0.08333333333333331")(newline)
    (display "(1 / 3) - (1 / 4) = ")
    (display (value '((1 / 3) - (1 / 4))))

    (newline)
    (newline)
  })
)

(run)
`;

ANIMAC_VFS["/test/generator.scm"] = `;; 生成器示例
;; 用于演示一等Continuation
;; 说明：本解释器暂时没有将顶级作用域特殊看待，导致捕获Continuation时会同时捕获到后续的generator调用，形成递归。因此引入了判断，使得演示程序能够在10轮递归之内结束。
;; 预期结果：输出1~10

(define count 0)
(define generator #f)
(define g
  (lambda ()
    ((lambda (init)
      (call/cc (lambda (Kont)
                 (set! generator Kont)))
      (set! init (+ init 1))
      (set! count init)
      init) 0)))

(define run
  (lambda () {

    (display "测试：使用call/cc模拟其他高级语言的生成器。")(newline)
    (display "此用例用来测试call/cc。")(newline)
    (display "期望结果：1 2 3 4 5 6 7 8 9 10")(newline)
    (display "实际结果：")
    (display (g))
    (display " ")
    (if (>= count 10)
        (newline)
        (display (generator 666)))
    (newline)

  })
)

(run)
`;

ANIMAC_VFS["/test/coroutine.scm"] = `;; 利用call/cc实现协程（生产者消费者同步问题）
;; 通过轻量级线程队列和基于循环的非抢占式中心调度机，协调管理所有的生产者和消费者
;; 调度机按照LWP加入队列的顺序，启动各个LWP；LWP必须主动将控制权交还给调度机
;; 这段代码中，每个LWP自行维护时间片切换机制，时间片用完之后，主动退出
;;
;; 2025-06-18 基于2023-08-18初版改写：多个生产者和消费者读写同一个FIFO
;;
;; 参考：https://www.scheme.com/tspl4/further.html

(import List "/test/list.scm")

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
        { (display tag) (display " 结束，进程队列空，停机。\\n\\n") (return) }
        { (display tag) (display " 结束。\\n\\n") (start_next) })))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

;; 生产者：其中timeslice是每次获得执行权之后最多能执行的循环次数，消费者同
(define producer
  (lambda (return tag timeslice)
    (define timer timeslice)
    (define loop
      (lambda ()
        ;; 检查时间片是否用完
        (if (= timer 0) {
          (display tag) (display " 暂停（时间片用完）\\n\\n")
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
            (display tag) (display " 暂停（队列满）\\n\\n")
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
          (display tag) (display " 暂停（时间片用完）\\n\\n")
          (set! timer timeslice) ;; 暂停之前，重置时间片计数器
          (wait_this_and_start_next)
        } {
          (set! timer (- timer 1))
          ;; 从存货队列里取出1个产品
          (define t (shift))
          (if (not t) {
            (display tag) (display " 暂停（队列空）\\n\\n")
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

(display "利用call/cc实现协程（生产者消费者同步问题）\\n\\n")

(call/cc (lambda (return) (

  (add_lwp (lambda () (producer return "生产者1" 3)))
  (add_lwp (lambda () (producer return "生产者2" 3)))

  (add_lwp (lambda () (consumer return "消费者1" 1)))
  (add_lwp (lambda () (consumer return "消费者2" 2)))
  (add_lwp (lambda () (consumer return "消费者3" 2)))

  (start_next))))

(display "\\n调度器结束，返回最外层。\\n")
`;

ANIMAC_VFS["/test/deadlock.scm"] = `;; 端口、信号量和死锁演示

;; 临界区：需要独占端口资源的过程，这里是一段空转延时。
(define Critical
    (lambda (countdown)
        (if (= countdown 0)
            #f
            (Critical (- countdown 1)))))

;; 请求资源，并在回调中使用申请到的资源。当然回调中也可以申请新的资源。
(define Request
    (lambda (lock pid callback)
        (if (= (read lock) 0) {
            (display "进程 ")(display pid)(display " 获得并占用资源 ")(display lock)(display " ...")(newline)
            (write lock 1)
            (callback)
            (write lock 0)
            (display "进程 ")(display pid)(display " 已释放资源 ")(display lock)(display " !")(newline)
        } {
            (Request lock pid callback)
        })
    )
)

;; 初始化两个信号量，对应两个资源
(write :lock1 0)
(write :lock2 0)

;; 进程1：先后请求资源1和资源2
(fork {
    (display "进程 1 开始尝试请求资源 :lock1 ...")(newline)
    (Request :lock1 1 (lambda ()
        (Critical 100000) ;; 需要不短于一个时间片，保证另一进程申请到另一资源之前不释放，以满足死锁条件。下同。
        (display "进程 1 开始尝试请求资源 :lock2 ...")(newline)
        (Request :lock2 1 (lambda () #f))
    ))
})

;; 进程2：先后请求资源2和资源1
(fork {
    (display "进程 2 开始尝试请求资源 :lock2 ...")(newline)
    (Request :lock2 2 (lambda ()
        (Critical 100000)
        (display "进程 2 开始尝试请求资源 :lock1 ...")(newline)
        (Request :lock1 2 (lambda () #f))
    ))
})
`;

ANIMAC_VFS["/test/async_callback.scm"] = `;; 异步回调演示
(native System)

(define g 0)
(define timer1 0)

(set! timer1
  (System.set_timeout 800 (lambda ()
                             (set! g (+ 1 g))
                             (display "\\nT1 ============= ") (display g) (newline)
                             )))

(define count (lambda (x) (if (< x 0) 0 { (display x) (newline) (count (- x 1)) })))

(count 100)



`;