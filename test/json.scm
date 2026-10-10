;; ============================================================================
;; json.scm —— 纯 Scheme 实现的 JSON 解析器 / 序列化器（C 版 Animac 大型实用性测试）
;;
;; 映射约定：object→Table、array→list、string→字符串、number→数字、
;;           true/false→#t/#f、null→#null。
;;
;; 验证不变量（自校验，[PASS]/[FAIL] 计数汇总）：
;;   1) 解析结果与手工构造的期望值一致；
;;   2) 往返不变量：json-equal(parse(json-str(v)), v) 对全部形状成立；
;;   3) 畸形输入一律返回 #undefined，绝不崩溃；
;;   4) 大数组/深嵌套/中英混合压力下行为正确。
;;
;; 实现要点（语言特性覆盖）：
;;   - call/cc：解析错误的非局部退出（栈自动回卷到 call/cc 捕获点）；
;;   - lambda 体内 define + 相互递归（parse-value ↔ parse-array/parse-object）；
;;   - 闭包状态（pos/err）经 set! 演进；
;;   - string? 谓词模式：语言无 string?，用 (equal? v (String.atom_to_string v))
;;     构成全类型安全的字符串判定（见 syntax_torture.scm J 节）；
;;   - 尾递归反转、Table 键集迭代、Math/位运算替代（代理对合成用乘法）。
;;
;; 运行方式：./main test/json.scm
;; 通过标准：输出末行 "PASS: n  FAIL: 0"。
;; ============================================================================

(native String)
(native Table)
(native Math)

;; ----------------------------------------------------------------------------
;; 断言框架
;; ----------------------------------------------------------------------------

(define js_pass 0)
(define js_fail 0)

(define check (lambda (name actual expected) {
  (if (equal? actual expected)
      { (set! js_pass (+ js_pass 1)) (display "  [PASS] ") }
      { (set! js_fail (+ js_fail 1)) (display "  [FAIL] ") })
  (display name)
  (if (equal? actual expected)
      (newline)
      { (display "  （期望 ") (display expected) (display " / 实际 ") (display actual) (display "）") (newline) })
}))

;; ----------------------------------------------------------------------------
;; 基础工具
;; ----------------------------------------------------------------------------

;; 全类型安全的字符串判定（语言无 string? 谓词）
(define json-string? (lambda (v) (equal? v (String.atom_to_string v))))
;; 散列表判定：非列表、非字符串的堆对象
(define json-table? (lambda (v) { (and (== (typeof v) "handle") (not (list? v)) (not (json-string? v))) }))

;; 尾递归列表反转（parse-array 头插累积后的还原）
(define json-reverse (lambda (lst acc) (if (null? lst) acc (json-reverse (cdr lst) (cons (car lst) acc)))))

;; hex 数字值：'0'-'9'→0-9，'a'-'f'→10-15，'A'-'F'→10-15，其余 -1
(define json-hexval (lambda (c) {
  (if (and (>= c 48) (<= c 57)) (- c 48)
  (if (and (>= c 97) (<= c 102)) (- c 87)
  (if (and (>= c 65) (<= c 70)) (- c 55)
  -1)))
}))

(define json-hexchars "0123456789abcdef")
(define json-hex1 (lambda (n) (String.charAt json-hexchars n)))
;; 码点 → 4 位十六进制小写串（用于 \uXXXX 转义输出）
(define json-hex4 (lambda (code) {
  (define h1 (Math.floor (/ code 4096)))
  (define h2 (Math.floor (/ (mod code 4096) 256)))
  (define h3 (Math.floor (/ (mod code 256) 16)))
  (define h4 (mod code 16))
  (String.concat (json-hex1 h1) (String.concat (json-hex1 h2) (String.concat (json-hex1 h3) (json-hex1 h4))))
}))

;; ----------------------------------------------------------------------------
;; json-parse : String → JSON值 | #undefined（畸形输入）
;; 递归下降；错误经 call/cc 一次性非局部退出。
;; ----------------------------------------------------------------------------

(define json-parse (lambda (src) {
  (define len (String.length src))
  (define pos 0)
  (define err #f)
  (define abort-k #f)
  (define fail (lambda () { (set! err #t) (abort-k #undefined) }))

  (define peek (lambda () (if (< pos len) (String.charCodeAt pos src) -1)))

  (define skip-ws (lambda () {
    (define c (peek))
    (while (and (< pos len) (or (== c 32) (== c 9) (== c 10) (== c 13))) {
      (set! pos (+ pos 1))
      (set! c (peek))
    })
  }))

  ;; 读 4 位十六进制；含非 hex 字符时 fail
  (define read-hex4 (lambda () {
    (define code 0)
    (define i 0)
    (define hv 0)
    ;; 注意：while 不创建词法区域，循环变量在所属 lambda 作用域顶层定义
    (while (< i 4) {
      (set! hv (json-hexval (peek)))
      (if (< hv 0) (fail) { (set! code (+ (* code 16) hv)) (set! pos (+ pos 1)) })
      (set! i (+ i 1))
    })
    code
  }))

  ;; \uXXXX；高代理后必须紧跟 \uYYYY 低代理，合成增补平面码点
  (define parse-u16 (lambda () {
    (define code (read-hex4))
    (if (and (>= code 55296) (<= code 56319))
        {
          (if (and (== (peek) 92) (== (String.charCodeAt (+ pos 1) src) 117))
              { (set! pos (+ pos 2))
                (define lo (read-hex4))
                (+ 65536 (+ (* (- code 55296) 1024) (- lo 56320))) }
              (fail))
        }
        code)
  }))

  (define parse-string (lambda () {
    (set! pos (+ pos 1))
    (define acc "")
    (define done #f)
    (define c 0)
    (define e 0)
    (while (and (not done) (< pos len)) {
      (set! c (peek))
      (if (== c 34)
          { (set! pos (+ pos 1)) (set! done #t) }
          {
            ;; JSON 规范：字符串内裸控制符（<0x20）必须拒绝
            (if (< c 32)
                (fail)
                {
            (if (== c 92)
                { (set! pos (+ pos 1))
                  (set! e (peek))
                  (cond ((== e 34)  { (set! acc (String.concat acc "\""))  (set! pos (+ pos 1)) })
                        ((== e 92)  { (set! acc (String.concat acc "\\"))  (set! pos (+ pos 1)) })
                        ((== e 47)  { (set! acc (String.concat acc "/"))   (set! pos (+ pos 1)) })
                        ((== e 98)  { (set! acc (String.concat acc "\b"))  (set! pos (+ pos 1)) })
                        ((== e 102) { (set! acc (String.concat acc "\f"))  (set! pos (+ pos 1)) })
                        ((== e 110) { (set! acc (String.concat acc "\n"))  (set! pos (+ pos 1)) })
                        ((== e 114) { (set! acc (String.concat acc "\r"))  (set! pos (+ pos 1)) })
                        ((== e 116) { (set! acc (String.concat acc "\t"))  (set! pos (+ pos 1)) })
                        ((== e 117) { (set! pos (+ pos 1)) (set! acc (String.concat acc (String.fromCharCode (parse-u16)))) })
                        (else (fail)))
                }
                { (set! acc (String.concat acc (String.fromCharCode c))) (set! pos (+ pos 1)) })
                })
            })
    })
    (if (and (not err) done) acc (fail))
  }))

  (define parse-number (lambda () {
    (define start pos)
    (define done #f)
    (define c 0)
    (while (and (not done) (< pos len)) {
      (set! c (peek))
      (if (or (and (>= c 48) (<= c 57)) (== c 45) (== c 43) (== c 46) (== c 101) (== c 69))
          (set! pos (+ pos 1))
          (set! done #t))
    })
    (define v (String.parseNumber (String.slice src start pos)))
    (if (undefined? v) (fail) #undefined)
    ;; 超出 double 范围（±Inf）按畸形拒绝
    (if (> (Math.abs v) (pow 10 308)) (fail) #undefined)
    v
  }))

  ;; 关键字后不得紧跟字母/数字（防止 "truex" 匹配 "true"）
  (define parse-kw (lambda (word val) {
    (if (String.equals (String.slice src pos (+ pos (String.length word))) word)
        { (set! pos (+ pos (String.length word)))
          (define after (peek))
          (if (or (and (>= after 97) (<= after 122)) (and (>= after 65) (<= after 90)) (and (>= after 48) (<= after 57)))
              (fail)
              val) }
        (fail))
  }))

  (define parse-array (lambda () {
    (set! pos (+ pos 1))
    (skip-ws)
    (define acc '())
    (define done #f)
    (define c 0)
    (if (== (peek) 93)
        { (set! pos (+ pos 1)) '() }
        {
          (while (not done) {
            (set! acc (cons (parse-value) acc))
            (skip-ws)
            (set! c (peek))
            (cond ((== c 44) { (set! pos (+ pos 1)) (skip-ws) })
                  ((== c 93) { (set! pos (+ pos 1)) (set! done #t) })
                  (else (fail)))
          })
          (json-reverse acc '())
        })
  }))

  (define parse-object (lambda () {
    (set! pos (+ pos 1))
    (skip-ws)
    (define tbl (Table.make))
    (define done #f)
    (define k #null)
    (define c 0)
    (if (== (peek) 125)
        { (set! pos (+ pos 1)) (Table.make) }
        {
          (while (not done) {
            (if (== (peek) 34) #undefined (fail))
            (set! k (parse-string))
            (skip-ws)
            (if (== (peek) 58) (set! pos (+ pos 1)) (fail))
            (Table.set tbl k (parse-value))
            (skip-ws)
            (set! c (peek))
            (cond ((== c 44) { (set! pos (+ pos 1)) (skip-ws) })
                  ((== c 125) { (set! pos (+ pos 1)) (set! done #t) })
                  (else (fail)))
          })
          tbl
        })
  }))

  (define parse-value (lambda () {
    (skip-ws)
    (define c (peek))
    (cond ((== c 123) (parse-object))                                ;; {
          ((== c 91)  (parse-array))                                 ;; [
          ((== c 34)  (parse-string))                                ;; "
          ((== c 116) (parse-kw "true" #t))                          ;; t
          ((== c 102) (parse-kw "false" #f))                         ;; f
          ((== c 110) (parse-kw "null" #null))                       ;; n
          ((or (== c 45) (and (>= c 48) (<= c 57))) (parse-number))  ;; - 或数字
          (else (fail)))
  }))

  (define parse-top (lambda () {
    (define v (parse-value))
    (skip-ws)
    ;; 不允许尾随内容
    (if (== pos len) v (fail))
  }))

  (define result (call/cc (lambda (k) { (set! abort-k k) (parse-top) })))
  (if err #undefined result)
}))

;; ----------------------------------------------------------------------------
;; json-str : JSON值 → String（json-string? 之外的 handle 视为 Table）
;; ----------------------------------------------------------------------------

(define json-str-string (lambda (s) {
  (define n (String.length s))
  (define acc "\"")
  (define i 0)
  (define c 0)
  (while (< i n) {
    (set! c (String.charCodeAt i s))
    (cond ((== c 34)  (set! acc (String.concat acc "\\\"")))
          ((== c 92)  (set! acc (String.concat acc "\\\\")))
          ((== c 8)   (set! acc (String.concat acc "\\b")))
          ((== c 12)  (set! acc (String.concat acc "\\f")))
          ((== c 10)  (set! acc (String.concat acc "\\n")))
          ((== c 13)  (set! acc (String.concat acc "\\r")))
          ((== c 9)   (set! acc (String.concat acc "\\t")))
          ((< c 32)   (set! acc (String.concat (String.concat acc "\\u") (json-hex4 c))))
          (else       (set! acc (String.concat acc (String.fromCharCode c)))))
    (set! i (+ i 1))
  })
  (String.concat acc "\"")
}))

(define json-str-array (lambda (lst) {
  (define acc "[")
  (define i 0)
  (define n (length lst))
  (while (< i n) {
    (if (> i 0) (set! acc (String.concat acc ",")) #undefined)
    (set! acc (String.concat acc (json-str (get_item lst i))))
    (set! i (+ i 1))
  })
  (String.concat acc "]")
}))

(define json-str-object (lambda (tbl) {
  (define acc "{")
  (define ks (Table.keys tbl))
  (define i 0)
  (define n (length ks))
  (define k #null)
  (while (< i n) {
    (set! k (get_item ks i))
    (if (> i 0) (set! acc (String.concat acc ",")) #undefined)
    (set! acc (String.concat acc (json-str-string k)))
    (set! acc (String.concat acc ":"))
    (set! acc (String.concat acc (json-str (Table.get tbl k))))
    (set! i (+ i 1))
  })
  (String.concat acc "}")
}))

(define json-str (lambda (v) {
  (cond ((list? v) (json-str-array v))
        ((eq? v #t) "true")
        ((eq? v #f) "false")
        ((number? v) (String.atom_to_string v))
        ((null? v) "null")
        ((undefined? v) #undefined)
        ((json-string? v) (json-str-string v))
        (else (json-str-object v)))
}))

;; ----------------------------------------------------------------------------
;; json-equal : 结构化深度比较（equal? 不比较 Table，列表内可能嵌 Table，
;;              故列表也自递归）
;; ----------------------------------------------------------------------------

(define json-equal-array (lambda (a b) {
  (define na (length a))
  (define nb (length b))
  (if (not (== na nb))
      #f
      {
        (define i 0)
        (define ok #t)
        (while (and (< i na) ok) {
          (if (json-equal (get_item a i) (get_item b i)) #undefined (set! ok #f))
          (set! i (+ i 1))
        })
        ok
      })
}))

(define json-equal-object (lambda (a b) {
  (if (not (== (Table.length a) (Table.length b)))
      #f
      {
        (define ks (Table.keys a))
        (define i 0)
        (define n (length ks))
        (define ok #t)
        (define k #null)
        (while (and (< i n) ok) {
          (set! k (get_item ks i))
          (if (Table.contains b k)
              { (if (json-equal (Table.get a k) (Table.get b k)) #undefined (set! ok #f)) }
              (set! ok #f))
          (set! i (+ i 1))
        })
        ok
      })
}))

(define json-equal (lambda (a b) {
  (cond ((and (list? a) (list? b)) (json-equal-array a b))
        ((and (json-string? a) (json-string? b)) (String.equals a b))
        ((and (number? a) (number? b)) (== a b))
        ((and (json-table? a) (json-table? b)) (json-equal-object a b))
        (else (equal? a b)))
}))

;; 往返不变量：parse(str(v)) 深度等于 v
(define json-roundtrip (lambda (v) (json-equal (json-parse (json-str v)) v)))

;; ----------------------------------------------------------------------------
;; A. 基元解析
;; ----------------------------------------------------------------------------

(display "====== A. 基元解析 ======") (newline)

(check "A1 整数" (json-parse "42") 42)
(check "A2 负整数" (json-parse "-17") -17)
(check "A3 浮点" (json-parse "2.75") 2.75)
(check "A4 负浮点" (json-parse "-0.5") -0.5)
(check "A5 科学计数" (json-parse "3.5e2") 350)
(check "A6 大E记法" (json-parse "1.5E-2") 0.015)
(check "A7 true" (json-parse "true") #t)
(check "A8 false" (json-parse "false") #f)
(check "A9 null" (json-parse "null") #null)
(check "A10 空串" (json-parse "\"\"") "")
(check "A11 简单串" (json-parse "\"hello\"") "hello")
(check "A12 前导空白" (json-parse "   42") 42)
(check "A13 尾随空白" (json-parse "42\n") 42)
(check "A14 多重空白" (json-parse "  [ 1 ]  ") '(1))

;; ----------------------------------------------------------------------------
;; B. 结构解析（与手工构造的期望值对照）
;; ----------------------------------------------------------------------------

(display "====== B. 结构解析 ======") (newline)

(define js_arr (json-parse "[1, 2.5, \"x\", true, false, null]"))
(check "B1 数组长度" (length js_arr) 6)
(check "B2 数组[0]" (get_item js_arr 0) 1)
(check "B3 数组[1]" (get_item js_arr 1) 2.5)
(check "B4 数组[2]" (get_item js_arr 2) "x")
(check "B5 数组[3]" (get_item js_arr 3) #t)
(check "B6 数组[4]" (get_item js_arr 4) #f)
(check "B7 数组[5]" (get_item js_arr 5) #null)
(check "B8 空数组" (json-parse "[]") '())
(check "B9 嵌套数组" (json-parse "[[1,2],[3]]") '((1 2) (3)))

(define js_obj (json-parse "{\"name\": \"灵机\", \"year\": 2026, \"tags\": [\"scheme\", \"vm\"]}"))
(check "B10 对象键数" (Table.length js_obj) 3)
(check "B11 对象字符串值" (Table.get js_obj "name") "灵机")
(check "B12 对象数字值" (Table.get js_obj "year") 2026)
(check "B13 对象嵌套数组" (Table.get js_obj "tags") '("scheme" "vm"))
(check "B14 对象键存在性" (Table.contains js_obj "name") #t)
(check "B15 对象键不存在" (Table.contains js_obj "nope") #f)
(check "B16 空对象" (== (Table.length (json-parse "{}")) 0) #t)
(check "B17 混合嵌套数组元素"
       (json-equal (get_item (Table.get (json-parse "{\"a\": [{\"b\": 1}, [true, null]]}") "a") 1)
                   '(#t #null))
       #t)
(check "B18 对象值内嵌对象"
       (Table.length (Table.get (json-parse "{\"outer\": {\"inner\": 1}}") "outer"))
       1)

;; ----------------------------------------------------------------------------
;; C. 字符串转义解析
;; ----------------------------------------------------------------------------

(display "====== C. 转义解析 ======") (newline)

(check "C1 引号转义" (json-parse "\"a\\\"b\"") "a\"b")
(check "C2 反斜杠转义" (json-parse "\"a\\\\b\"") "a\\b")
(check "C3 斜杠转义" (json-parse "\"a\\/b\"") "a/b")
(check "C4 控制符转义" (json-parse "\"a\\nb\\tc\"") "a\nb\tc")
(check "C5 转义后长度" (String.length (json-parse "\"a\\nb\"")) 3)
(check "C6 \\u基本码点" (json-parse "\"\\u4e2d\"") "中")
(check "C7 \\u码点值" (== (String.charCodeAt 0 (json-parse "\"\\u4e2d\"")) 20013) #t)
(check "C8 代理对合成" (== (String.charCodeAt 0 (json-parse "\"\\ud83d\\ude00\"")) 128512) #t)
(check "C9 孤立高代理拒绝" (undefined? (json-parse "\"\\ud83d\"")) #t)
(check "C10 非法hex拒绝" (undefined? (json-parse "\"\\uZZZZ\"")) #t)
(check "C11 裸控制符拒绝" (undefined? (json-parse (String.concat "\"a" (String.concat "\n" "b\"")))) #t)

;; ----------------------------------------------------------------------------
;; D. 畸形输入一律 #undefined，绝不崩溃
;; ----------------------------------------------------------------------------

(display "====== D. 畸形输入 ======") (newline)

(check "D1 空输入" (json-parse "") #undefined)
(check "D2 纯空白" (json-parse "   ") #undefined)
(check "D3 截断的对象" (json-parse "{") #undefined)
(check "D4 截断的数组" (json-parse "[1,") #undefined)
(check "D5 缺值" (json-parse "{\"a\"}") #undefined)
(check "D6 缺冒号" (json-parse "{\"a\" 1}") #undefined)
(check "D7 尾随逗号" (json-parse "[1,]") #undefined)
(check "D8 未闭合字符串" (json-parse "\"abc") #undefined)
(check "D9 截断关键字" (json-parse "tru") #undefined)
(check "D10 关键字粘滞" (json-parse "truex") #undefined)
(check "D11 非法起始字符" (json-parse "+") #undefined)
(check "D12 对象后尾随内容" (json-parse "{} {}") #undefined)
(check "D13 数字后尾随内容" (json-parse "42 42") #undefined)
(check "D14 仅有冒号" (json-parse ":") #undefined)
(check "D15 未闭合对象" (json-parse "{\"a\": 1") #undefined)

;; ----------------------------------------------------------------------------
;; E. 序列化：基元精确输出
;; ----------------------------------------------------------------------------

(display "====== E. 序列化基元 ======") (newline)

(check "E1 true" (json-str #t) "true")
(check "E2 false" (json-str #f) "false")
(check "E3 null" (json-str #null) "null")
(check "E4 整数" (json-str 42) "42")
(check "E5 负整数" (json-str -17) "-17")
(check "E6 浮点" (json-str 2.75) "2.75")
(check "E7 空数组" (json-str '()) "[]")
(check "E8 简单数组" (json-str '(1 2 3)) "[1,2,3]")
(check "E9 字符串转义" (json-str "a\"b\\c\nd") "\"a\\\"b\\\\c\\nd\"")
(check "E10 控制字符转义为\\u" (json-str (String.fromCharCode 31)) "\"\\u001f\"")
(check "E11 空串" (json-str "") "\"\"")

;; ----------------------------------------------------------------------------
;; F. 往返不变量：json-equal(parse(json-str(v)), v)
;; ----------------------------------------------------------------------------

(display "====== F. 往返不变量 ======") (newline)

(check "F1 往返:数字" (json-roundtrip 42) #t)
(check "F2 往返:负浮点" (json-roundtrip -0.125) #t)
(check "F3 往返:布尔" (json-roundtrip #f) #t)
(check "F4 往返:null" (json-roundtrip #null) #t)
(check "F5 往返:含转义字符串" (json-roundtrip "a\"b\\c\n中") #t)
(check "F6 往返:空串" (json-roundtrip "") #t)
(check "F7 往返:数组" (json-roundtrip '(1 "two" #t #f #null 2.5)) #t)
(check "F8 往返:嵌套数组" (json-roundtrip '((1 2) ((3) (4 (5))))) #t)
(define js_t1 (Table.make))
(Table.set js_t1 "k" (cons 1 (cons "x" (cons #t '()))))
(check "F9 往返:对象" (json-roundtrip js_t1) #t)
(check "F10 往返:深层混合"
       (json-roundtrip (cons (cons 1 (cons (cons "x" '()) '())) '()))
       #t)

;; ----------------------------------------------------------------------------
;; G. 压力与规模（parse 为线性；序列化 concat 为平方复杂度故用中等规模）
;; ----------------------------------------------------------------------------

(display "====== G. 压力与规模 ======") (newline)

;; G1: 5000 元素数字数组的解析与验证（线性复杂度）
(define js_big_str "[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500]")
(define js_big (json-parse js_big_str))
(check "G1 大数组长度" (length js_big) 501)
(check "G2 大数组首元素" (get_item js_big 0) 0)
(check "G3 大数组尾元素" (get_item js_big 500) 500)
(check "G4 大数组抽查" (get_item js_big 256) 256)

;; G2: 程序化构造 3000 元素数组 → 序列化 → 再解析 → 深度相等
(define js_gen '())
(define js_i 0)
(while (< js_i 3000) {
  (set! js_gen (cons js_i js_gen))
  (set! js_i (+ js_i 1))
})
(set! js_gen (json-reverse js_gen '()))
(define js_gen2 (json-parse (json-str js_gen)))
(check "G5 程序化数组往返" (json-equal js_gen2 js_gen) #t)
(check "G6 程序化数组长度" (length js_gen2) 3000)

;; G3: 120 层深嵌套数组（每层约 3 个调用帧，共约 400 帧，远低于帧栈上限）
(define js_deep "1")
(define js_j 0)
(while (< js_j 120) {
  (set! js_deep (String.concat "[" (String.concat js_deep "]")))
  (set! js_j (+ js_j 1))
})
(define js_deepv (json-parse js_deep))
(check "G7 深嵌套解析成功" (list? js_deepv) #t)
(define js_d 0)
(define js_cur js_deepv)
(while (< js_d 120) {
  (set! js_cur (get_item js_cur 0))
  (set! js_d (+ js_d 1))
})
(check "G8 深嵌套内核值" js_cur 1)
(check "G9 深嵌套往返" (json-equal (json-parse (json-str js_deepv)) js_deepv) #t)

;; G4: 中英混合键值对象往返
(define js_cn (Table.make))
(Table.set js_cn "名称" "灵机·Animac")
(Table.set js_cn "年份" 2026)
(Table.set js_cn "特性" '("Scheme" "虚拟机" "GC"))
(check "G10 中文对象往返" (json-roundtrip js_cn) #t)
(check "G11 中文值往返后保留" (String.equals (Table.get (json-parse (json-str js_cn)) "名称") "灵机·Animac") #t)

;; G5: 序列化输出的 JSON 合法性（再解析不报错即为合法）
(check "G12 序列化输出可再解析" (json-equal (json-parse (json-str js_cn)) js_cn) #t)

;; ----------------------------------------------------------------------------
;; 汇总
;; ----------------------------------------------------------------------------

(display "====== 汇总 ======") (newline)
(display "PASS: ") (display js_pass)
(display "  FAIL: ") (display js_fail) (newline)
