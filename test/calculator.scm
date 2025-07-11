;; 中缀表达式解析器
;; 2017, 2025-07-11

;; 中缀表达式文法（BNF）
;;      <expr_list> ::= <expr> <expr_list_tail>
;; <expr_list_tail> ::= , <expr> <expr_list_tail> | ε
;;           <expr> ::= <term> <expr_tail>
;;      <expr_tail> ::= [+-] <term> <expr_tail> | ε
;;           <term> ::= <factor> <term_tail>
;;      <term_tail> ::= [*/] <factor> <term_tail> | ε
;;         <factor> ::= <unaried> [^%] <factor> | <unaried>
;;        <unaried> ::= [!-] <primary> | <primary>
;;       <arg_list> ::= <expr_list> | ε
;;        <primary> ::= ( <expr> ) | <IDENTIFIER> ( <expr> ) | <literal>
;;        <literal> ::= <NUMBER> | <IDENTIFIER>
;;         <NUMBER> ::= [\+\-]*\d+\.*\d*
;;     <IDENTIFIER> ::= [a-zA-Z_][a-zA-Z0-9_]*

(native String)
(native Math)
(import List "list.scm")

(define lexer
  (lambda (expr)
    (define len (String.length expr))

    (define is_sep
      (lambda (ch)
        (or (String.equals ch " ") (String.equals ch "\t") (String.equals ch "\n") (String.equals ch "\r"))))

    (define is_comma
      (lambda (ch)
        (String.equals ch ",")))

    (define is_operator
      (lambda (ch)
        (or (String.equals ch "+") (String.equals ch "-") (String.equals ch "*") (String.equals ch "/")
            (String.equals ch "^") (String.equals ch "%") (String.equals ch "&") (String.equals ch "|")
            (String.equals ch "!") (String.equals ch "<") (String.equals ch ">") (String.equals ch "="))))
    
    (define is_digit
      (lambda (ch)
        (and (>= (String.charCodeAt 0 ch) 48) (<= (String.charCodeAt 0 ch) 57))))

    (define is_letter
      (lambda (ch)
        (or (and (>= (String.charCodeAt 0 ch) 97) (<= (String.charCodeAt 0 ch) 122))
            (and (>= (String.charCodeAt 0 ch) 65) (<= (String.charCodeAt 0 ch) 90))
            (= (String.charCodeAt 0 ch) 95))))

    (define read_number
      (lambda (start)
        (define end start)
        (define has_decimal #f)
        (define ch 0)
        (while (< end len) {
          (set! ch (String.charAt expr end))
          (cond ((is_digit ch) {
                  (set! end (+ end 1))
                })
                ((String.equals ch ".") {
                  (if has_decimal break)
                  (set! has_decimal #t)
                  (set! end (+ end 1))
                })
                (else break))
        })
        (String.slice expr start end)))

    (define read_identifier
      (lambda (start)
        (define end start)
        (define ch 0)
        (if (is_letter (String.charAt expr end)) {
          (set! end (+ start 1))
          (while (and (< end len) (or (is_letter (String.charAt expr end)) (is_digit (String.charAt expr end)))) {
            (set! end (+ end 1))
          })
          (String.slice expr start end)
        } {
          #f
        })))

    ;; 主体部分
    (define tokens '())
    (define is_prev_number #f)
    (define num_start 0)
    (define sign 0)
    (define number 0)
    (define identifier 0)
    (define ch 0)
    (define index 0)
    (while (< index len) {
      (set! ch (String.charAt expr index))

      (if (is_sep ch) {
        (set! index (+ index 1))
        continue
      })

      (cond ((or (is_digit ch)
                 (and (or (String.equals ch "-") (String.equals ch "+"))
                      (< (+ index 1) len)
                      (not is_prev_number)
                      (or (is_digit (String.charAt expr (+ index 1)))
                          (String.equals (String.charAt expr (+ index 1)) ".")))) {
              (set! is_prev_number #t)
              (set! num_start index)
              (if (or (String.equals ch "-") (String.equals ch "+")) {
                (set! sign ch)
                (set! index (+ index 1))
              } {
                (set! sign "")
                (set! num_start index)
              })
              (set! number (read_number index))
              (set! tokens (List.append `(,index 'number ,(String.concat sign number)) tokens))
              (set! index (+ index (String.length number)))
            })
            ;; 运算符
            ((is_operator ch) {
              (set! is_prev_number #f)
              (set! tokens (List.append `(,index 'operator ,ch) tokens))
              (set! index (+ index 1))
            })
            ;; 左右括号
            ((or (String.equals ch "(") (String.equals ch ")")) {
              (set! is_prev_number (String.equals ch ")"))
              (set! tokens (List.append `(,index 'bracket ,ch) tokens))
              (set! index (+ index 1))
            })
            ;; 标识符
            ((is_letter ch) {
              (set! is_prev_number #f)
              (set! identifier (read_identifier index))
              (set! tokens (List.append `(,index 'identifier ,identifier) tokens))
              (set! index (+ index (String.length identifier)))
            })
            ;; 逗号
            ((is_comma ch) {
              (set! is_prev_number #f)
              (set! tokens (List.append `(,index 'comma ,ch) tokens))
              (set! index (+ index 1))
            })
            (else {
              (display "Unexpected character: ") (display ch) (newline)
              break
            })
      )
    })
    tokens
  ))


(define parser
  (lambda (tokens)
    (define index 0)

    (define eat
      (lambda ()
        (define ret (get_item tokens index))
        (set! index (+ index 1))
        ret))

    (define match
      (lambda (expected)
        (if (< index (length tokens)) 
          (String.equals expected (get_item (get_item tokens index) 2))
          #f)))

    (define is_number
      (lambda ()
        (eq? 'number (get_item (get_item tokens index) 1))))

    (define is_identifier
      (lambda ()
        (eq? 'identifier (get_item (get_item tokens index) 1))))

    (define parse_literal
      (lambda ()
        (if (or (is_number) (is_identifier)) (eat) {
          (display "Error @ <literal>") (newline)
          #f
        })))

    (define parse_primary
      (lambda ()
        (define expr 0)
        (define func 0)
        (cond ((match "(") {
                (eat)
                (set! expr (parse_expr))
                (if (match ")") (eat) { (display "Error @ <primary>: missing ')'") (newline) #f })
                expr
              })
              ((is_identifier) {
                (set! func (eat))
                (if (match "(") (eat) { (display "Error @ <primary>: missing '('") (newline) #f })
                (set! expr (parse_expr))
                (if (match ")") (eat) { (display "Error @ <primary>: missing ')'") (newline) #f })
                `(,func ,expr)
              })
              (else {
                (parse_literal)
              }))))

    (define parse_unaried
      (lambda ()
        (if (or (match "!") (match "-")) {
          (define op (eat))
          (define primary (parse_primary))
          `(,op ,primary)
        } {
          (parse_primary)
        })))

    (define parse_factor
      (lambda ()
        (define unaried (parse_unaried))
        (if (or (match "^") (match "%")) {
          (define op (eat))
          `(,op ,unaried ,(parse_factor))
        } {
          unaried
        })))

    (define parse_term_tail
      (lambda (left)
        (if (or (match "*") (match "/")) {
          (define op (eat))
          (define factor (parse_factor))
          (define new_left `(,op ,left ,factor))
          (parse_term_tail new_left)
        } {
          left
        })))

    (define parse_term
      (lambda ()
        (parse_term_tail (parse_factor))))

    (define parse_expr_tail
      (lambda (left)
        (if (or (match "+") (match "-")) {
          (define op (eat))
          (define term (parse_term))
          (define new_left `(,op ,left ,term))
          (parse_expr_tail new_left)
        } {
          left
        })))

    (define parse_expr
      (lambda ()
        (parse_expr_tail (parse_term))))

    (define parse
      (lambda ()
        (define ast (parse_expr))
        (if (< index (length tokens)) {
          (display "Unexpected token '") (display (get_item tokens index)) (display "'") (newline)
          #f
        } {
          ast
        })))

    (parse)
  ))


(define type_of_token
  (lambda (token)
    (if (atom? (get_item token 1)) {
      (get_item token 1)
    } {
      'application
    })))

(define eval
  (lambda (ast)
    (define tot (type_of_token ast))
    (cond ((eq? tot 'number) {
            (String.parseNumber (get_item ast 2))
          })
          ((eq? tot 'application) {
            (define op (get_item (get_item ast 0) 2))
            (define left  (get_item ast 1))
            (define right (get_item ast 2))
            (cond ((String.equals op "+") (+ (eval left) (eval right)))
                  ((String.equals op "-") (if (eq? #undefined right) (- 0 (eval left)) (- (eval left) (eval right)))) ;; 区分一元和二元运算
                  ((String.equals op "*") (* (eval left) (eval right)))
                  ((String.equals op "/") (/ (eval left) (eval right)))
                  ((String.equals op "%") (% (eval left) (eval right)))
                  ((String.equals op "^") (pow (eval left) (eval right)))
                  ((String.equals op "sqrt") (pow (eval left) 0.5))
                  ((String.equals op "exp") (Math.exp (eval left)))
                  ((String.equals op "log") (Math.log (eval left)))
                  ((String.equals op "sin") (Math.sin (eval left)))
                  ((String.equals op "cos") (Math.cos (eval left)))
                  ((String.equals op "tan") (Math.tan (eval left)))
                  ((String.equals op "atan") (Math.atan (eval left)))
                  ((String.equals op "floor") (Math.floor (eval left)))
                  ((String.equals op "ceil") (Math.ceil (eval left)))
                  (else { (display "Unsupported operator") #f }))
          })
          (else {
            (display "Unexpected item")
          }))))



(define show_tokens
  (lambda (tokens)
    (if (null? tokens) {
      (newline)
    } {
      (display (get_item (car tokens) 2))
      (display " | ")
      (show_tokens (cdr tokens))
    })))

(define show_ast
  (lambda (ast level)
    (cond ((not (list? ast)) #f)
          ((number? (get_item ast 0)) (display (get_item ast 2)))
          (else {
            (define i 0)
            (display "( ")
            (show_ast (get_item ast 0) (+ level 1))
            (display "\n  ")
            (set! i 0) (while (< i level) { (display "  ") (set! i (+ i 1)) })
            (show_ast (get_item ast 1) (+ level 1))
            (display "\n  ")
            (set! i 0) (while (< i level) { (display "  ") (set! i (+ i 1)) })
            (show_ast (get_item ast 2) (+ level 1))
            (display "\n")
            (set! i 0) (while (< i level) { (display "  ") (set! i (+ i 1)) })
            (display ")")
          }))))


(define run
  (lambda () {
    (display "中缀表达式解析：")(newline)

    (define expr "1 +-2 * -(3.0 + -4 * (+5 + -(13 % 7) * -(7 + +8 * -9) / 2.5 + -sqrt(3.0^2)) / 4) - -5")
    (display "表达式：") (display expr) (newline)

    (define tokens (lexer expr))
    (display "词元序列：")(newline)
    (show_tokens tokens)
    (define ast (parser tokens))
    (display "抽象语法树：") (newline)
    ;(show_ast ast 0)
    (display ast)
    (newline)
    (display "预期结果：320") (newline)
    (display "实际结果：")
    (display (eval ast))

    (newline)
    (newline)
  })
)
