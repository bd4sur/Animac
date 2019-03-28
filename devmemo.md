## 新BNF

计划重构Parser以支持quasiquote。

```
※ 星号代表解析动作发生位置
          <Term> ::= <SList> | <Lambda> | <Quote> | <Unquote> | <Quasiquote> | <Symbol>
         <SList> ::= ( ※ <SListSeq> )
      <SListSeq> ::= <Term> ※ <SListSeq> | ε
        <Lambda> ::= ( ※ lambda <ArgList> <Body> )
       <ArgList> ::= ( ※1 <ArgListSeq> ※2)
    <ArgListSeq> ::= <ArgSymbol> ※ <ArgListSeq> | ε
     <ArgSymbol> ::= <Symbol>
          <Body> ::= <BodyTerm> ※ <Body_>
         <Body_> ::= <BodyTerm> ※ <Body_> | ε
      <BodyTerm> ::= <Term>
         <Quote> ::= ' ※1 <QuoteTerm> ※2
       <Unquote> ::= , ※1 <UnquoteTerm> ※2
    <Quasiquote> ::= ` ※1 <QuasiquoteTerm> ※2
     <QuoteTerm> ::= <Term>
   <UnquoteTerm> ::= <Term>
<QuasiquoteTerm> ::= <Term>
        <Symbol> ::= ※ SYMBOL

解析时数据结构：
节点栈、状态栈

解析动作：
      <SList>  pushSList(quoteType) 向节点栈内压入一个新的SList，其中quoteType从状态栈栈顶取得。
   <SListSeq>  从节点栈顶弹出节点，追加到新栈顶节点的children中。
     <Lambda>  pushLambda() 向节点栈内压入一个新的Lambda，忽略状态。
   <ArgList>1  {Parameter}压状态栈。
   <ArgList>2  退状态栈。
 <ArgListSeq>  从节点栈顶弹出节点（必须是符号），追加到新栈顶Lambda节点的parameters中。
       <Body>  从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
      <Body_>  从节点栈顶弹出节点，追加到新栈顶Lambda节点的body中。
    <*Quote>1  {*QUOTE}压状态栈。
    <*Quote>2  退状态栈。
     <Symbol>  pushSymbol(s, quoteType) 符号压栈：QUOTE和QUASIQUOTE压栈为's，UNQUOTE压栈为新节点(unquote s)

function isSymbol(token) {
    if(/[\s\(\)\[\]\{\}]/gi.test(token)) { return false; } // 不允许包含的字符
    if(/^[0-9\'\`\,]/gi.test(token)) { return false; } // 不允许开头的字符
    return true; // 其余的都是词法意义上的Symbol
}
```

## 准引用列表的处理

+ 只允许单层qq和uq，不允许嵌套多层
+ (quote ..)和(quosiquote ..(unquote ..)...)的处理，移到AST后处理中进行

```Scheme
(define y 100)
(define qq `((x ,y) ,(+ 1 y) z))

;; 简写的qq经预处理（在parse之前）：
(quasiquote '((x (unquote y)) (unquote (+ 1 y)) z))

;; 上面这句应该被编译成立即执行的thunk，以保证qq的词法作用域特性：
((lambda ()
  (cons (cons 'x (cons y '()))
    (cons (+ 1 y)
      (cons 'z
        '())))))

((lambda (x y z)
  (display qq)) 777 888 999)

;; 应该输出'((x 100) 101 z)而不是'((x 888) 889 z)
```

## 模板字符串（分析时预处理，执行时使用native字符串库）

```Scheme

;`XXX${var}YYY`
;预处理后被转换为：
(native String)
(String.concat (cons "XXX" (cons var (cons "YYY" '()))))
;; 如果实现了qq，则
(String.concat `("XXX" ,var "YYY"))
;; 等效于
(String.concat (quasiquote '("XXX" (unquote var) "YYY")))
```


## 字典（通过native机制实现）

```Scheme
(native Dict)

Dict.new       kvQq
Dict.keySet    dict
Dict.get       dict  key
Dict.set       dict  key  value
Dict.iterate   dict  callback
Dict.toJson    dict
Dict.parseJson string

;; 需要实现qq
(define test
  (Dict.new `(
      (key1  ,value1)
      (key2  ,value2)
      (key3  ,value3))))

;; 需要实现完整的ANI（JS调Scheme）
(Dict.iterate test
  (lambda (key value dict)
    (display value)))

(Dict.keySet test)       ;'(key1 key2 key3)
(Dict.get test key1)     ;value1
(Dict.set test key2 xxx) ;#SET-VALUE

```

