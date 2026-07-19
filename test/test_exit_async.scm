(native System)

(System.set_timeout 100 (lambda () (display "Timer fired after exit\n")))
(display "Before exit\n")
(System.exit)
(display "After exit (should not print)\n")
