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
