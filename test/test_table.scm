;; Table native 库功能测试

(native Table)

(define fdj (Table.make))
(define key "人类的本质是")
(Table.set fdj key "复读机")
(display (Table.get fdj "人类的本质是")) (newline)

(define assert-equal
  (lambda (name expected actual)
    (if (== expected actual)
        {
          (display "[PASS] ") (display name) (newline)
        }
        {
          (display "[FAIL] ") (display name)
          (display ": expected ") (display expected)
          (display ", actual ") (display actual)
          (newline)
        })))

(define assert-true
  (lambda (name actual)
    (assert-equal name #t actual)))

(define assert-false
  (lambda (name actual)
    (assert-equal name #f actual)))

;; 基本 set/get/length
(define t1 (Table.make))
(assert-equal "empty length" 0 (Table.length t1))
(Table.set t1 "hello" "world")
(assert-equal "string key get" "world" (Table.get t1 "hello"))
(assert-equal "length after one set" 1 (Table.length t1))

;; 覆盖更新
(Table.set t1 "hello" "animac")
(assert-equal "string key overwrite" "animac" (Table.get t1 "hello"))
(assert-equal "length after overwrite" 1 (Table.length t1))

;; number key
(Table.set t1 1 "int1")
(Table.set t1 2 "int2")
(Table.set t1 1.0 "float1")
(assert-equal "int key 1" "int1" (Table.get t1 1))
(assert-equal "int key 2" "int2" (Table.get t1 2))
(assert-equal "float key 1.0" "float1" (Table.get t1 1.0))
(assert-equal "number keys length" 4 (Table.length t1))

;; symbol key
(Table.set t1 'foo "symbol-foo")
(Table.set t1 'bar 42)
(assert-equal "symbol key foo" "symbol-foo" (Table.get t1 'foo))
(assert-equal "symbol key bar" 42 (Table.get t1 'bar))

;; contains
(assert-true "contains hello" (Table.contains t1 "hello"))
(assert-false "contains notexist" (Table.contains t1 "notexist"))
(assert-true "contains int 1" (Table.contains t1 1))
(assert-true "contains float 1.0" (Table.contains t1 1.0))
(assert-true "contains symbol foo" (Table.contains t1 'foo))

;; 不存在的 key 返回 #undefined
(assert-equal "get missing returns undefined" #undefined (Table.get t1 "missing"))

;; value 为 #undefined 时删除 entry
(Table.set t1 "delme" "value")
(assert-true "delme exists" (Table.contains t1 "delme"))
(Table.set t1 "delme" #undefined)
(assert-false "delme removed by undefined value" (Table.contains t1 "delme"))

;; Table.delete
(Table.set t1 "todelete" "x")
(assert-true "todelete exists" (Table.contains t1 "todelete"))
(Table.delete t1 "todelete")
(assert-false "todelete removed" (Table.contains t1 "todelete"))

;; 空表行为
(define t2 (Table.make))
(assert-equal "empty get" #undefined (Table.get t2 "x"))
(assert-false "empty contains" (Table.contains t2 "x"))
(assert-equal "empty length" 0 (Table.length t2))

;; Table.keys：至少检查返回的是列表且长度正确
(define keys1 (Table.keys t1))
(assert-equal "keys length" (Table.length t1) (length keys1))

;; 混合类型 key 共存
(define t3 (Table.make))
(Table.set t3 100 "number")
(Table.set t3 'sym "symbol")
(Table.set t3 "str" "string")
(assert-equal "mixed number" "number" (Table.get t3 100))
(assert-equal "mixed symbol" "symbol" (Table.get t3 'sym))
(assert-equal "mixed string" "string" (Table.get t3 "str"))
(assert-equal "mixed length" 3 (Table.length t3))

;; value 可以是 lambda
(define t4 (Table.make))
(define inc (lambda (x) (+ x 1)))
(Table.set t4 "inc" inc)
(assert-equal "lambda value apply" 6 ((Table.get t4 "inc") 5))

;; GC 压力测试：创建大量 table 和 value，运行时可能触发 GC
(define t5 (Table.make))
(define i 0)
(while (< i 500000) {
  (Table.set t5 i (+ i 1000))
  (set! i (+ i 1))
})
(set! i 0)
(while (< i 500000) {
  (if (not (== (+ i 1000) (Table.get t5 i)))
      {
        (display "[FAIL] GC stress at i=") (display i) (newline)
      })
  (set! i (+ i 1))
})
(display "[PASS] GC stress test") (newline)

(display "=== Table tests finished ===") (newline)
