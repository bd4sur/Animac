;; 自研Nano语言模型适配 Animac Scheme 的宿主接口
;; 2025-06-30

(native LLM)
(native String)

(import NanoModels "nano_llm_model.scm")

(define llm_generate_native
  (lambda ()
    (define i 0)
    (define prev_output_len 0)
    (while (<= i 256) {
      (define output (LLM.step))
      (define status (get_item output 0))
      (if (String.equals status "finished") { (display "<|eos|>") break })
      (define output_str (get_item output 1))
      (define output_len (String.length output_str))
      (if (<= output_len 0) continue)
      (display (String.slice output_str (if (> prev_output_len output_len) 0 prev_output_len) output_len))
      (set! prev_output_len output_len)
      (set! i (+ i 1))
    })
    (newline)
    (newline)
  ))

(define run
  (lambda () {
    ;; 注意：输入prompt不要含有未登录（OOV）词元
    (display "Psycho_230k:") (newline)
    (LLM.init NanoModels.PSYCHO_230K_MODEL)
    (LLM.new_session "人类的本质是" 256 1.0 1.0 0.5 20)
    (llm_generate_native)
  })
)
