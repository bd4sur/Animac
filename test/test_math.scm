;; test_math.scm —— Math 本地库函数测试（atan2 与位运算）
;;
;; 注：本解释器的 uint 值有效负载为 (指针位宽 - 5) 位，64 位宿主即 59 位，
;;     故最大 uint 为 2^59 - 1 = 576460752303423487，符号位为第 58 位。

(native Math)

(define pass_count 0)
(define fail_count 0)

;; 精确相等断言（== 即 eqv?，跨数值表示判等，如 (== 1 1.0) 为真）
(define check
  (lambda (name actual expected)
    (if (== actual expected)
        { (display "✅ PASS ") (display name) (newline)
          (set! pass_count (+ pass_count 1)) }
        { (display "❌ FAIL ") (display name)
          (display "  expected=") (display expected)
          (display "  actual=") (display actual) (newline)
          (set! fail_count (+ fail_count 1)) })))

;; 近似相等断言（浮点结果与期望值之差的绝对值小于 eps）
(define check_close
  (lambda (name actual expected eps)
    (check name (< (Math.abs (- actual expected)) eps) #t)))

(define MAX_UINT (Math.bit_not 0))      ; 2^59 - 1 = 576460752303423487
(define SIGN_BIT (Math.bit_shl 1 58))   ; 2^58     = 288230376151711744
(define EPS 0.0000001)

(display "====== Math.atan2 测试 ======") (newline)

;; 基本象限
(check_close "atan2(1, 1)   =  π/4"  (Math.atan2 1 1)   (/ (Math.PI) 4) EPS)
(check_close "atan2(1, -1)  =  3π/4" (Math.atan2 1 -1)  (/ (* 3 (Math.PI)) 4) EPS)
(check_close "atan2(-1, -1) = -3π/4" (Math.atan2 -1 -1) (/ (* -3 (Math.PI)) 4) EPS)
(check_close "atan2(-1, 1)  = -π/4"  (Math.atan2 -1 1)  (/ (Math.PI) -4) EPS)

;; 边界情况（与 JavaScript Math.atan2 一致）
(check       "atan2(0, 0)   =  0"    (Math.atan2 0 0)    0)
(check_close "atan2(0, -1)  =  π"    (Math.atan2 0 -1)   (Math.PI) EPS)
(check_close "atan2(1, 0)   =  π/2"  (Math.atan2 1 0)    (/ (Math.PI) 2) EPS)
(check_close "atan2(-1, 0)  = -π/2"  (Math.atan2 -1 0)   (/ (Math.PI) -2) EPS)

;; 与 atan 的一致性（第一象限）：atan2(y, x) == atan(y / x)
(check_close "atan2(2, 3) == atan(2/3)" (Math.atan2 2 3) (Math.atan (/ 2 3)) EPS)

;; 符号遵循 y：y < 0 时结果为负（第四象限）
(check "atan2(-1, 5) < 0" (< (Math.atan2 -1 5) 0) #t)

;; 参数可以是整数与浮点数的任意混合
(check_close "atan2(1.5, 2.5) 混合参数" (Math.atan2 1.5 2.5) (Math.atan (/ 1.5 2.5)) EPS)

(display "====== Math.bit_and / bit_or / bit_xor / bit_not 测试 ======") (newline)

;; 基本真值
(check "bit_and 12 10 = 8"  (Math.bit_and 12 10) 8)
(check "bit_or  12 10 = 14" (Math.bit_or 12 10) 14)
(check "bit_xor 12 10 = 6"  (Math.bit_xor 12 10) 6)
(check "bit_not 0 = MAX_UINT" (Math.bit_not 0) 576460752303423487)
(check "bit_and 255 15 = 15" (Math.bit_and 255 15) 15)
(check "bit_or 240 15 = 255" (Math.bit_or 240 15) 255)
(check "bit_xor 255 255 = 0" (Math.bit_xor 255 255) 0)

;; 恒等律
(check "bit_and a a = a"   (Math.bit_and 12345 12345) 12345)
(check "bit_or  a 0 = a"   (Math.bit_or 12345 0) 12345)
(check "bit_or  a MAX = MAX" (Math.bit_or 12345 MAX_UINT) MAX_UINT)
(check "bit_and a MAX = a" (Math.bit_and 12345 MAX_UINT) 12345)
(check "bit_xor a a = 0"   (Math.bit_xor 12345 12345) 0)
(check "bit_xor a 0 = a"   (Math.bit_xor 12345 0) 12345)
(check "bit_and a 0 = 0"   (Math.bit_and 12345 0) 0)

;; 双重否定：not(not(a)) = a
(check "bit_not(bit_not a) = a" (Math.bit_not (Math.bit_not 123456789)) 123456789)

;; 德摩根律：not(a & b) = not(a) | not(b)
(check "De Morgan: ~(a&b) = ~a|~b"
       (Math.bit_not (Math.bit_and 12345 67890))
       (Math.bit_or (Math.bit_not 12345) (Math.bit_not 67890)))
;; 德摩根律：not(a | b) = not(a) & not(b)
(check "De Morgan: ~(a|b) = ~a&~b"
       (Math.bit_not (Math.bit_or 12345 67890))
       (Math.bit_and (Math.bit_not 12345) (Math.bit_not 67890)))

(display "====== Math.bit_shl / bit_lshr 测试 ======") (newline)

(check "bit_shl 1 4 = 16"   (Math.bit_shl 1 4) 16)
(check "bit_shl 3 2 = 12"   (Math.bit_shl 3 2) 12)
(check "bit_shl 1 58 = 2^58" SIGN_BIT 288230376151711744)
(check "bit_shl 0 n = 0"    (Math.bit_shl 0 10) 0)
(check "bit_shl a 0 = a"    (Math.bit_shl 777 0) 777)
(check "bit_lshr 16 2 = 4"  (Math.bit_lshr 16 2) 4)
(check "bit_lshr a 0 = a"   (Math.bit_lshr 777 0) 777)
(check "bit_lshr MAX 56 = 7" (Math.bit_lshr MAX_UINT 56) 7)
(check "bit_lshr SIGN_BIT 58 = 1" (Math.bit_lshr SIGN_BIT 58) 1)

;; 移位计数 >= 逻辑位宽（59）：结果为 0
(check "bit_shl 1 59 = 0"   (Math.bit_shl 1 59) 0)
(check "bit_shl 1 100 = 0"  (Math.bit_shl 1 100) 0)
(check "bit_lshr 1 59 = 0"  (Math.bit_lshr 1 59) 0)
(check "bit_lshr MAX 59 = 0" (Math.bit_lshr MAX_UINT 59) 0)

;; 超出有效位的高位被截断：2^58 << 1 = 0
(check "bit_shl 2^58 1 = 0（截断）" (Math.bit_shl SIGN_BIT 1) 0)

;; 往返：lshr(shl a n, n) = a（未溢出时）
(check "lshr(shl 99 7, 7) = 99" (Math.bit_lshr (Math.bit_shl 99 7) 7) 99)

(display "====== Math.bit_ashr 测试 ======") (newline)

;; 正数（符号位为 0）：算术右移与逻辑右移一致
(check "bit_ashr 255 4 = 15" (Math.bit_ashr 255 4) 15)
(check "bit_ashr a 0 = a"    (Math.bit_ashr 777 0) 777)
(check "bit_ashr 正数 == lshr" (Math.bit_ashr 123456 5) (Math.bit_lshr 123456 5))

;; 负数（符号位置位）：高位补 1
(check "bit_ashr MAX 4 = MAX（全 1 不变）" (Math.bit_ashr MAX_UINT 4) MAX_UINT)
(check "bit_ashr MAX 58 = MAX" (Math.bit_ashr MAX_UINT 58) MAX_UINT)
(check "bit_ashr 2^58 58 = MAX" (Math.bit_ashr SIGN_BIT 58) MAX_UINT)
(check "bit_ashr 2^58 56 = MAX - 3" (Math.bit_ashr SIGN_BIT 56) 576460752303423484)

;; 算术右移与逻辑右移的差异：对符号位置位的数
(check "ashr 与 lshr 对负数结果不同"
       (not (== (Math.bit_ashr SIGN_BIT 10) (Math.bit_lshr SIGN_BIT 10))) #t)
(check "lshr 2^58 10 = 2^48" (Math.bit_lshr SIGN_BIT 10) 281474976710656)

;; 移位计数 >= 逻辑位宽：按符号位得到 0 或全 1
(check "bit_ashr 正数 59 = 0"  (Math.bit_ashr 255 59) 0)
(check "bit_ashr 正数 100 = 0" (Math.bit_ashr 255 100) 0)
(check "bit_ashr MAX 59 = MAX" (Math.bit_ashr MAX_UINT 59) MAX_UINT)
(check "bit_ashr MAX 100 = MAX" (Math.bit_ashr MAX_UINT 100) MAX_UINT)

(display "====== 测试结果汇总 ======") (newline)
(display "PASS: ") (display pass_count) (display "  FAIL: ") (display fail_count) (newline)
(if (== fail_count 0)
    (display "✅ PASS math\n")
    (display "❌ FAIL math\n"))
