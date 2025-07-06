;; 自研Nano语言模型推理
;; 2025-07-04

(native LLM)
(native String)
(native Math)
(native System)

(import List "list.scm")
(import NanoModels "nano_llm_model.scm")

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 从base64加载模型

(LLM.init NanoModels.PSYCHO_90K_MODEL)
; (LLM.init NanoModels.TINYSTORIES_3K_MODEL)

(display "Loading LLM...") (newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 模型结构参数

(define llm_config (LLM.get_config))

(define block_size (get_item llm_config 0))
(define vocab_size (get_item llm_config 1))
(define n_layer    (get_item llm_config 2))
(define n_embd     (get_item llm_config 3))
(define n_head     (get_item llm_config 4))
(define n_kv_head  (get_item llm_config 5))
(define head_dim   (get_item llm_config 6))
(define n_hidden   (get_item llm_config 7))
(define is_shared_classifier (get_item llm_config 8))

(define kv_dim (* n_kv_head head_dim))
(define kv_mul (/ n_head n_kv_head))

(display "    block_size = ") (display block_size) (newline)
(display "    vocab_size = ") (display vocab_size) (newline)
(display "    n_layer = ") (display n_layer) (newline)
(display "    n_embd = ") (display n_embd) (newline)
(display "    n_head = ") (display n_head) (newline)
(display "    n_kv_head = ") (display n_kv_head) (newline)
(display "    head_dim = ") (display head_dim) (newline)
(display "    n_hidden = ") (display n_hidden) (newline)
(display "    is_shared_classifier = ") (display is_shared_classifier) (newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 模型权重

(define param (LLM.get_param))

(define token_embedding  (get_item param 0))  ;; (vocab_size, n_embd)
(define rms_norm_attn    (get_item param 1))  ;; (n_layer, n_embd)
(define wq               (get_item param 2))  ;; (n_layer, n_embd, n_embd)
(define wk               (get_item param 3))  ;; (n_layer, n_embd, kv_dim)
(define wv               (get_item param 4))  ;; (n_layer, n_embd, kv_dim)
(define wo               (get_item param 5))  ;; (n_layer, n_embd, n_embd)
(define rms_norm_ffn     (get_item param 6))  ;; (n_layer, n_embd)
(define w1               (get_item param 7))  ;; (n_layer, n_hidden, n_embd)
(define w2               (get_item param 8))  ;; (n_layer, n_embd, n_hidden)
(define w3               (get_item param 9))  ;; (n_layer, n_hidden, n_embd)
(define rms_norm_final   (get_item param 10)) ;; (n_embd)
(define token_classifier (get_item param 11)) ;; (vocab_size, n_embd)
(define freq_cis_real    (get_item param 12)) ;; (block_size, head_dim/2)
(define freq_cis_imag    (get_item param 13)) ;; (block_size, head_dim/2)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 激活值中间缓冲区

(define new_buffer
  (lambda (len)
    (define iter
      (lambda (buf i)
        (if (= i 0) buf (iter (cons 0 buf) (- i 1)))))
    (iter '() len)))

(define x   (new_buffer n_embd))
(define xb  (new_buffer n_embd))
(define xba (new_buffer n_embd)) ;; (q_dim == n_embd)
(define xb2 (new_buffer n_embd))
(define hb  (new_buffer n_hidden))
(define hb2 (new_buffer n_hidden))
(define q   (new_buffer n_embd))

(define k_cache (new_buffer n_layer)) ;; '(n_layer * (block_size, kv_dim))
(define v_cache (new_buffer n_layer)) ;; '(n_layer * (block_size, kv_dim))
(define i 0)
(while (< i n_layer) {
  (set_item! k_cache i (new_buffer (* block_size kv_dim)))
  (set_item! v_cache i (new_buffer (* block_size kv_dim)))
  (set! i (+ i 1))
})

(define att (new_buffer (* n_head block_size))) ;; '(n_head, block_size)

(define logits (new_buffer vocab_size))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 基础算子

(define accum
  (lambda (a b size)
    (define i 0)
    (while (< i size) {
      (set_item! a i (+ (get_item a i) (get_item b i)))
      (set! i (+ i 1))
    })))

(define scale
  (lambda (a k size)
    (define i 0)
    (while (< i size) {
      (set_item! a i (* (get_item a i) k))
      (set! i (+ i 1))
    })))

(define rms_norm
  (lambda (out x weight weight_offset size)
    (define ss 0)
    (define i 0)
    (define xi 0)
    (while (< i size) {
      (set! xi (get_item x i))
      (set! ss (+ ss (* xi xi)))
      (set! i (+ i 1))
    })
    (set! ss (/ ss size))
    (set! ss (+ ss 0.00001)) ;; 1e-5
    (set! ss (/ 1.0 (Math.sqrt ss)))
    (set! i 0)
    (while (< i size) {
      (set_item! out i (* (get_item weight (+ weight_offset i)) (* ss (get_item x i))))
      (set! i (+ i 1))
    })))

(define softmax
  (lambda (x x_offset size)
    (define max_val -10000000) ;; TODO
    (define xi 0)
    (define i 0)
    (while (< i size) {
      (set! xi (get_item x (+ x_offset i)))
      (if (> xi max_val) (set! max_val xi))
      (set! i (+ i 1))
    })
    (define sum 0)
    (set! i 0)
    (while (< i size) {
      (set! xi (Math.exp (- (get_item x (+ x_offset i)) max_val)))
      (set_item! x (+ x_offset i) xi)
      (set! sum (+ sum xi))
      (set! i (+ i 1))
    })
    (set! i 0)
    (while (< i size) {
      (set_item! x (+ x_offset i) (/ (get_item x (+ x_offset i)) sum))
      (set! i (+ i 1))
    })))

(define matmul
  (lambda (xout x w xout_offset w_offset n d)
    (define i 0)
    (define j 0)
    (define val 0)
    (while (< i d) {
      (set! val 0)
      (set! j 0)
      (while (< j n) {
        (set! val (+ val (* (get_item w (+ w_offset (+ (* i n) j))) (get_item x j))))
        (set! j (+ j 1))
      })
      (set_item! xout (+ xout_offset i) val)
      (set! i (+ i 1))
    })))

(define rope
  (lambda (q k pos k_offset)
    (define h 0)
    (define i 0)
    (define offset 0)
    (define freq_offset (* pos (/ head_dim 2)))
    (define val0 0) (define val1 0)
    (define fcr 0)  (define fci 0)
    ;; q = RoPE(q)
    (set! h 0)
    (while (< h n_head) {
      (set! offset (* h head_dim))
      (set! i 0)
      (while (< i head_dim) {
        (set! val0 (get_item q (+ offset i)))
        (set! val1 (get_item q (+ offset (+ i 1))))
        (set! fcr  (get_item freq_cis_real (+ freq_offset (/ i 2))))
        (set! fci  (get_item freq_cis_imag (+ freq_offset (/ i 2))))
        (set_item! q (+ offset i)       (- (* val0 fcr) (* val1 fci)))
        (set_item! q (+ offset (+ i 1)) (+ (* val0 fci) (* val1 fcr)))
        (set! i (+ i 2))
      })
      (set! h (+ h 1))
    })
    ;; k = RoPE(k)
    (set! h 0)
    (while (< h n_kv_head) {
      (set! offset (+ k_offset (* h head_dim)))
      (set! i 0)
      (while (< i head_dim) {
        (set! val0 (get_item k (+ offset i)))
        (set! val1 (get_item k (+ offset (+ i 1))))
        (set! fcr  (get_item freq_cis_real (+ freq_offset (/ i 2))))
        (set! fci  (get_item freq_cis_imag (+ freq_offset (/ i 2))))
        (set_item! k (+ offset i)       (- (* val0 fcr) (* val1 fci)))
        (set_item! k (+ offset (+ i 1)) (+ (* val0 fci) (* val1 fcr)))
        (set! i (+ i 2))
      })
      (set! h (+ h 1))
    })
  ))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 语言模型前向传播

(define llm_forward
  (lambda (token pos)

    (define layer 0)
    (define i 0)
    (define h 0)
    (define m 0)
    (define t 0)

    (define k #f)
    (define v #f)
    (define kv_pos_offset 0)

    (define wq_offset 0)
    (define wkv_offset 0)
    (define wo_offset 0)

    (define q_head_offset 0)
    (define k_head_offset 0)
    (define v_head_offset 0)

    (define att_head_offset 0)
    (define xba_head_offset 0)

    (define score 0)

    ;; copy the token embedding into x
    (set! i 0)
    (while (< i n_embd) {
      (set_item! x i (get_item token_embedding (+ (* token n_embd) i)))
      (set! i (+ i 1))
    })

    ;; forward all the layers
    (set! layer 0)
    (while (< layer n_layer) {

      ;; attention rmsnorm
      (rms_norm xb x rms_norm_attn (* layer n_embd) n_embd)

      ;; kv_cache at current layer
      (set! k (get_item k_cache layer)) ;; (block_size, kv_dim)
      (set! v (get_item v_cache layer)) ;; (block_size, kv_dim)

      ;; qkv matmuls for this position
      (set! wq_offset  (* layer (* n_embd n_embd)))
      (set! wkv_offset (* layer (* n_embd kv_dim)))
      (set! kv_pos_offset (* pos kv_dim))
      (matmul  q  xb  wq  0              wq_offset   n_embd  n_embd)
      (matmul  k  xb  wk  kv_pos_offset  wkv_offset  n_embd  kv_dim)
      (matmul  v  xb  wv  kv_pos_offset  wkv_offset  n_embd  kv_dim)

      ;; RoPE on q k
      (rope q k pos kv_pos_offset)

      ;; GQA-MHA: iterate over all heads
      (set! h 0)
      (while (< h n_head) {
        (set! m (Math.floor (/ h kv_mul)))
        (set! q_head_offset (* h head_dim))
        ;; iterate over all timesteps, including the current one
        (set! att_head_offset (* h block_size))
        (set! t 0)
        (while (<= t pos) {
          (set! k_head_offset (+ (* t kv_dim) (* m head_dim)))
          ;; calculate the attention score as the dot product of q and k
          (set! score 0)
          (set! i 0)
          (while (< i head_dim) {
            (set! score
                  (+ score (* (get_item q (+ q_head_offset i))
                              (get_item k (+ k_head_offset i)))))
            (set! i (+ i 1))
          })
          (set! score (/ score (Math.sqrt head_dim)))
          ;; save the score to the attention buffer
          (set_item! att (+ att_head_offset t) score)

          (set! t (+ t 1))
        })

        ;; softmax the scores to get attention weights, from 0..pos inclusively
        (softmax att att_head_offset (+ pos 1))

        ;; weighted sum of the values, store back into xba
        (set! xba_head_offset (* h head_dim))
        (set! i 0)
        (while (< i head_dim) {
          (set! score 0)
          (set! t 0)
          (while (<= t pos) {
            (set! v_head_offset (+ (* t kv_dim) (* m head_dim)))
            (set! score
                  (+ score
                     (* (get_item att (+ att_head_offset t))
                        (get_item v (+ v_head_offset i)))))
            (set! t (+ t 1))
          })
          (set_item! xba (+ xba_head_offset i) score)
          (set! i (+ i 1))
        })

        (set! h (+ h 1))
      })

      ;; final matmul to get the output of the attention
      (set! wo_offset (* layer (* n_embd n_embd)))
      (matmul  xb2  xba  wo  0  wo_offset  n_embd  n_embd)

      ;; residual connection back into x
      (accum x xb2 n_embd)

      ;; ffn rmsnorm
      (rms_norm xb x rms_norm_ffn (* layer n_embd) n_embd)

      ;; FFN matmul
      (matmul  hb  xb  w1  0  (* layer (* n_hidden n_embd))  n_embd  n_hidden)
      (matmul  hb2 xb  w3  0  (* layer (* n_hidden n_embd))  n_embd  n_hidden)

      ;; SwiGLU
      (set! i 0)
      (set! score 0)
      (while (< i n_hidden) {
        (set! score (get_item hb i))
        (set! score (* score (/ 1.0 (+ 1.0 (Math.exp (- 0 score))))))
        (set! score (* score (get_item hb2 i)))
        (set_item! hb i score)
        (set! i (+ i 1))
      })

      ;; final matmul to get the output of the ffn
      (matmul  xb  hb  w2  0  (* layer (* n_embd n_hidden))  n_hidden  n_embd)

      ;; residual connection
      (accum x xb n_embd)

      (set! layer (+ layer 1))
    })

    ;; final rmsnorm
    (rms_norm x x rms_norm_final 0 n_embd)

    ;; classifier into logits
    (matmul logits x token_classifier 0 0 n_embd vocab_size)

    ;; return logits
    logits

  )) ;; end of llm_forward

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 采样

;; 贪心采样：返回概率最大的下标
(define sample_argmax
  (lambda (probs vocab_size)
    (define maxv -100000000) ;; TODO
    (define maxi 0)
    (define v 0)
    (define i 0)
    (while (< i vocab_size) {
      (set! v (get_item probs i))
      (if (> v maxv) {
        (set! maxv v)
        (set! maxi i)
      })
      (set! i (+ i 1))
    })
    maxi))

;; 概率采样：输入的probs必须是积分为1的，也就是softmax的输出
(define sample_multinomial
  (lambda (probs vocab_size)
    (define i 0)
    (define r (Math.random))
    (define cdf 0.0)
    (define ret_index (- vocab_size 1))
    (set! i 0)
    (while (< i vocab_size) {
      (set! cdf (+ cdf (get_item probs i)))
      (if (> cdf r) {
        (set! ret_index i)
        break
      })
      (set! i (+ i 1))
    })
    ;; return
    ret_index))

;; 概率采样之改进：Top-K采样，只在概率排名前K个词元中采样
(define sample_top_k
  (lambda (probs vocab_size top_k)
    (define probindex '())
    (define i 0)
    (while (< i vocab_size) {
      (set! probindex (cons `(,i ,(get_item probs i)) probindex))
      (set! i (+ i 1))
    })

    (List.heap_sort probindex (lambda (a b) (> (get_item b 1) (get_item a 1))))

    ;; 取概率最大的前k个，计算累计概率用于归一化
    (define cumulative_prob 0.0)
    (set! i 0)
    (while (< i top_k) {
      (set! cumulative_prob (+ cumulative_prob (get_item (get_item probindex i) 1)))
      (set! i (+ i 1))
    })

    ;; 在只有前K个词元的列表上执行概率采样
    (define r (* cumulative_prob (Math.random)))
    (define cdf 0.0)
    (define ret_index (- vocab_size 1))
    (set! i 0)
    (while (< i top_k) {
      (set! cdf (+ cdf (get_item (get_item probindex i) 1)))
      (if (> cdf r) {
        (set! ret_index (get_item (get_item probindex i) 0))
        break
      })
      (set! i (+ i 1))
    })
    ;; return
    ret_index))

;; 核采样（top-p）
(define sample_top_p
  (lambda (probs vocab_size top_p)
    (define cutoff (/ (- 1.0 top_p) (- vocab_size 1)))
    (define n0 0)
    (define probindex '())
    (define i 0)
    (while (< i vocab_size) {
      (if (>= (get_item probs i) cutoff) {
        (set! probindex (cons `(,i ,(get_item probs i)) probindex))
        (set! n0 (+ n0 1))
      })
      (set! i (+ i 1))
    })

    (List.heap_sort probindex (lambda (a b) (> (get_item b 1) (get_item a 1))))

    (define cumulative_prob 0.0)
    (define last_idx (- n0 1))
    (set! i 0)
    (while (< i n0) {
      (set! cumulative_prob (+ cumulative_prob (get_item (get_item probindex i) 1)))
      (if (> cumulative_prob top_p) {
        (set! last_idx i)
        break
      })
      (set! i (+ i 1))
    })

    (define r (* cumulative_prob (Math.random)))
    (define cdf 0.0)
    (define ret_index (get_item (get_item probindex last_idx) 0))
    (set! i 0)
    (while (<= i last_idx) {
      (set! cdf (+ cdf (get_item (get_item probindex i) 1)))
      (if (> cdf r) {
        (set! ret_index (get_item (get_item probindex i) 0))
        break
      })
      (set! i (+ i 1))
    })
    ;; return
    ret_index))


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 自回归生成

(define make_renderer
  (lambda ()
    (define is_first #t)
    (define buffer "")
    (lambda (tps new_char)
      ;; 通过退格删除最后附加的TPS统计信息
      (if (not is_first) {
        (display "\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b\b")
      })
      (set! is_first #f)
      (define i (String.length buffer))
      (while (>= i 0) {
        (display "\b")
        (set! i (- i 1))
      })
      (if (String.equals new_char "\b") {
        (set! buffer (String.slice buffer 0 (- (String.length buffer) 1)))
      } {
        (set! buffer (String.concat buffer new_char))
      })
      (display buffer)
      (display "\n")
      (display "TPS = ")
      (display (Math.to_fixed tps 3))
      (display " token/s\n"))))

(define generate
  (lambda (prompt max_seq_len repetition_penalty temperature top_p top_k)
    (define t_0 0)
    (define tps 0)
    (define ids (LLM.encode prompt))
    (define new_token (get_item ids 0))
    (define probs #f)
    (define show (make_renderer))
    (define pos 0)
    (newline) (newline)
    (while (< pos max_seq_len) {
      (if (= t_0 0) (set! t_0 (System.timestamp)))
      (show tps "▁")
      (set! probs (llm_forward new_token pos))
      (show tps "\b")
      (show tps "░")
      (if (< pos (length ids)) {
        ;; Pre-filling
        (set! new_token (get_item ids pos))
      } {
        ;; Decoding
        ;; 暂不实现幅度惩罚（待实现字典）
        ;; 温度采样：当温度设为0时，退化为贪心采样
        (if (= temperature 0) {
          (set! new_token (sample_argmax probs vocab_size))
        } {
          (set! i 0)
          (while (< i vocab_size) {
            (set_item! probs i (/ (get_item probs i) temperature))
            (set! i (+ i 1))
          })
          (softmax probs 0 vocab_size)
          (cond ((and (> top_p 0) (< top_p 1)) {
                  (set! new_token (sample_top_p probs vocab_size top_p))
                })
                ((> top_k 0) {
                  (set! new_token (sample_top_k probs vocab_size top_k))
                })
                (else {
                  (set! new_token (sample_multinomial probs vocab_size))
                }))
        })
      })
      (show tps "\b")
      (show tps (LLM.decode new_token))
      (set! tps (* (/ pos (- (System.timestamp) t_0)) 1000) 3)
      (set! pos (+ pos 1))
    })
  ))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 程序入口

(generate "人类的本质是" 256 1.0 1.05 0.5 0)

(newline)

