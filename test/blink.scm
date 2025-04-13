;; 用 Scheme 控制路由器上的LED使其闪烁

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

(define counter 0)

(define Blink
  (lambda () {
      (File.writeStringSync "/sys/devices/platform/leds/leds/yellow:network/brightness" (ToStr (% counter 2)) "w")
      (display (ToStr (% counter 2)))
      (set! counter (+ counter 1))
      (if (= (% counter 2) 0)
          (Delay 1000)
          (Delay 2000))
      (Blink)
  }))

(display "Start blinking...") (newline)
(Blink)
