;; 用 Scheme 控制树莓派上的LED使其闪烁

(native File)

(define Delay
    (lambda (countdown)
        (if (= countdown 0)
            #f
            (Delay (- countdown 1)))))

(define ToStr
  (lambda (num01)
    (cond ((= num01 0) "0")
          ((= num01 1) "1")
          (else "1"))))

;; 应当加入GPIO是否被exported的判断。但是现在因缺乏相关接口，无法做到这一点。
(File.WriteString "/sys/class/gpio/unexport" "2" "w")
(File.WriteString "/sys/class/gpio/export" "2" "w")
(File.WriteString "/sys/class/gpio/gpio2/direction" "out" "w")

(define counter 0)

(define Blink
  (lambda () {
      (File.WriteString "/sys/class/gpio/gpio2/value" (ToStr (% counter 2)) "w")
      (display (ToStr (% counter 2)))
      (set! counter (+ counter 1))
      (if (= (% counter 2) 0)
          (Delay 10)
          (Delay 2000))
      (Blink)
  }))

(display "Start blinking...") (newline)
(Blink)
