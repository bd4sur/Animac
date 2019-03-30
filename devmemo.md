## 问题记录（20190331）

关于静态作用域实现

在使用丘奇编码用例进行测试的时候，发现在执行以下代码时，会出现无限循环的错误：

```Scheme
(define SHOWNUM
  (lambda (n)
    (n (lambda (x) (+ x 1)) 0)))

(define <0> (lambda (f a) a))
(define <1> (lambda (f a) (f a)))
(define <2> (lambda (f2 a2) (f2 (f2 a2)))) ; 闭包2
(define <3> (lambda (f a) (f (f (f a))))) ; 闭包3

(define INC
  (lambda (n) ; 闭包A
    (lambda (f a) ; 闭包B
      (f (n f a)))))

;; 求值此表达式会出现无限循环
(SHOWNUM (<2> INC <3>)) ;实际上就是(ADD <2> <3>)
```

在a56ccd4提交之前，静态作用域采用简单策略实现，即：创建新闭包时不继承自由变量，使用时上溯闭包链查找自由变量。这样做的好处是速度快、且可以满足`set!`的需要，因`set!`对变量的改动，是要传染到所有派生闭包的。如果每个闭包都不保存自由变量，那么在执行`set!`的时候，也就无需“传染”这个过程了。

但这是不对的，错误就在上面这段代码中暴露出来。

执行`(<2> INC <3>)`时，由`INC`生成的`闭包A`，以及由`<3>`生成的`闭包3`，被传入`<2>`，分别被保存到`闭包2`的`f2`和`a2`变量中。

在执行`<2>`的`(f2 a2)`时，生成`闭包B`且被返回。在以往的实现中，其自由变量`n`=`闭包3`，是被保存在`闭包A`的。

继续执行外层的`(f2=闭包A 闭包B)`，则`闭包A`的变量`n`被修改为`闭包B`，**这就导致`闭包B`的自由变量`n`失去了它原本应该自己保存的`闭包3`，导致执行`闭包B`内部的`(n f a)`的时候，使自己陷入无限递归。**

因此自由变量绑定是必须保存在闭包内部的。

新实现借鉴Lua的命名“upvalue”，将自由变量绑定保存在闭包的upvalue字段中。由于每个闭包都保存了从上位闭包继承的绑定，这会给`set!`的实现带来麻烦。因此，新实现中，采用以下方法实现：

- 凡是被`set!`改动过的约束变量，会在值的最后加上脏标记“!”；
- 变量解析时，并不立即返回upvalue中的绑定，而是继续上溯闭包链，如果发现上位闭包中的值带有脏标记，说明此变量被`set!`修改过，就应当采用上位闭包中的值。

为什么上溯闭包这个行为也是静态作用域的实现？因为编译阶段已经消除了所有可能导致作用域覆盖的变量命名，保证每个变量的名称都是全局唯一的，因此只要是能够在闭包中找到的绑定，必然是词法作用域的。沿着闭包链查找，则在满足词法作用域的前提之下，满足运行时的时间-因果顺序，换句话说，能够保证“现在”所需的值是最新的（而不是在别的无关闭包中被修改）。这样就满足了绑定的时空两方面的唯一性。

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

