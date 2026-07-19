(native System)

(System.set_timeout 100 (lambda () (display "Timer fired (should not print)\n")))
(display "Before kill\n")
(System.kill 0)
(display "After kill (should not print)\n")
