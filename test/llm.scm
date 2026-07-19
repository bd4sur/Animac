;; 自研Nano语言模型推理 2025-07-04 2025-12-12 2026-07
;; 本测试用例展示了自回归文本生成和全局注意力序列生成两类任务。
;; 前者使用自行训练的230k参数的哲学黑话模型，进行自回归文本生成。
;; 后者对长度为6的输入序列执行全局自注意力序列生成，输出序列是输入序列的升序排列。
;; 详见 https://github.com/bd4sur/Nano

(native LLM)
(native String)
(native Math)
(native System)

(import List "list.scm")
(import NanoModels "llm_model.scm")

(display "Animac测试用例：自研Nano语言模型推理\n  (c) 2025-2026 BD4SUR\n")

(define memstat
  (lambda ()
    (define mem (System.memstat))
    (define vm_cap (get_item mem 0))
    (define vm_use (get_item mem 1))
    (define heap_cap (get_item mem 2))
    (define heap_use (get_item mem 3))
    (display "============ 内存统计 ============\n")
    (display "  总内存：") (display (/ (/ (+ vm_cap heap_cap) 1024) 1024)) (display "MiB") (newline)
    (display "    工作区容量：") (display vm_cap) (display "B") (newline)
    (display "    工作区已用：") (display (* 100 (/ vm_use vm_cap))) (display "%") (newline)
    (display "    用户区容量：") (display heap_cap) (display "B") (newline)
    (display "    用户区已用：") (display (* 100 (/ heap_use heap_cap))) (display "%") (newline)
    (display "=================================\n")))


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 辅助函数

(define make_random_list
  (lambda (len)
    (define mkranlst_iter
      (lambda (lst idx)
        (if (== idx 0)
          lst
          (mkranlst_iter (cons (Math.floor (* 10 (Math.random))) lst) (- idx 1))
        )))
    (mkranlst_iter '() len)))

(define list_to_str
  (lambda (lst)
    (define str "")
    (define count 0)
    (define len (length lst))
    (while (< count len) {
      (set! str (String.concat str (String.atom_to_string (get_item lst count))))
      (set! count (+ count 1))
    })
    str))


;;; 用于支持多个任务的外层函数：开始 ;;;
(define LLM_RUN (lambda (task)
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 从base64加载模型

(if (== task 0)
    (LLM.init NanoModels.SORT_6_MODEL)
    (LLM.init NanoModels.PSYCHO_230K_MODEL)
)

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
(define n_hidden   (get_item llm_config 6))
(define is_shared_classifier (get_item llm_config 7))
(define head_dim   (get_item llm_config 8))

(define kv_dim (* n_kv_head head_dim))
(define kv_mul (/ n_head n_kv_head))

(display "block_size: ") (display block_size)
(display " | vocab_size: ") (display vocab_size)
(display " | n_layer: ") (display n_layer)
(display " | n_embd: ") (display n_embd)
(display " | n_head: ") (display n_head)
(display " | n_kv_head: ") (display n_kv_head)
(display " | head_dim: ") (display head_dim)
(display " | n_hidden: ") (display n_hidden)
(display " | is_shared_classifier: ") (display is_shared_classifier) (newline)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 模型权重

(define param (LLM.get_param))


(define rms_norm_attn    (get_item param 0))  ;; (n_layer, n_embd)
(define rms_norm_ffn     (get_item param 1))  ;; (n_layer, n_embd)
(define rms_norm_final   (get_item param 2)) ;; (n_embd)
(define token_embedding  (get_item param 3))  ;; (vocab_size, n_embd)
(define wq               (get_item param 4))  ;; (n_layer, n_embd, n_embd)
(define wk               (get_item param 5))  ;; (n_layer, n_embd, kv_dim)
(define wv               (get_item param 6))  ;; (n_layer, n_embd, kv_dim)
(define wo               (get_item param 7))  ;; (n_layer, n_embd, n_embd)
(define w1               (get_item param 8))  ;; (n_layer, n_hidden, n_embd)
(define w2               (get_item param 9))  ;; (n_layer, n_embd, n_hidden)
(define w3               (get_item param 10))  ;; (n_layer, n_hidden, n_embd)
(define freq_cis_real    (get_item param 11)) ;; (block_size, head_dim/2)
(define freq_cis_imag    (get_item param 12)) ;; (block_size, head_dim/2)
(define token_classifier (get_item param 13)) ;; (vocab_size, n_embd)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 激活值中间缓冲区

(define new_buffer
  (lambda (len)
    (define iter
      (lambda (buf i)
        (if (== i 0) buf (iter (cons 0 buf) (- i 1)))))
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
  (lambda (token pos max_seq_len is_causal)

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

    ;; NOTE 用于兼容因果自注意力和全局自注意力
    (define attn_range (if is_causal (+ pos 1) max_seq_len))

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
      (LLM.matmul  q  xb  wq  0              wq_offset   n_embd  n_embd)
      (LLM.matmul  k  xb  wk  kv_pos_offset  wkv_offset  n_embd  kv_dim)
      (LLM.matmul  v  xb  wv  kv_pos_offset  wkv_offset  n_embd  kv_dim)

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
        (while (< t attn_range) {
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
        (softmax att att_head_offset attn_range)

        ;; weighted sum of the values, store back into xba
        (set! xba_head_offset (* h head_dim))
        (set! i 0)
        (while (< i head_dim) {
          (set! score 0)
          (set! t 0)
          (while (< t attn_range) {
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
      (LLM.matmul  xb2  xba  wo  0  wo_offset  n_embd  n_embd)

      ;; residual connection back into x
      (accum x xb2 n_embd)

      ;; ffn rmsnorm
      (rms_norm xb x rms_norm_ffn (* layer n_embd) n_embd)

      ;; FFN matmul
      (LLM.matmul  hb  xb  w1  0  (* layer (* n_hidden n_embd))  n_embd  n_hidden)
      (LLM.matmul  hb2 xb  w3  0  (* layer (* n_hidden n_embd))  n_embd  n_hidden)

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
      (LLM.matmul  xb  hb  w2  0  (* layer (* n_embd n_hidden))  n_hidden  n_embd)

      ;; residual connection
      (accum x xb n_embd)

      (set! layer (+ layer 1))
    })

    ;; final rmsnorm
    (rms_norm x x rms_norm_final 0 n_embd)

    ;; classifier into logits
    (LLM.matmul logits x token_classifier 0 0 n_embd vocab_size)

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
    (newline)
    (while (< pos max_seq_len) {
      (if (== t_0 0) (set! t_0 (System.timestamp)))
      (display "▁")
      (set! probs (llm_forward new_token pos max_seq_len #t))
      (display "\b")
      (display "░")
      (if (< pos (length ids)) {
        ;; Pre-filling
        (set! new_token (get_item ids pos))
      } {
        ;; Decoding
        ;; 暂不实现幅度惩罚（待实现字典）
        ;; 温度采样：当温度设为0时，退化为贪心采样
        (if (== temperature 0) {
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
      (display "\b")
      (display (LLM.decode new_token))
      (set! tps (* (/ pos (- (System.timestamp) t_0)) 1000) 3)
      (set! pos (+ pos 1))
      ; (memstat)
    })
    (display "\n")
    (display "TPS = ")
    (display (Math.to_fixed tps 3))
    (display " token/s\n")
  ))

(define ai_sort
  (lambda (input_list max_seq_len)
    (define input_str (list_to_str input_list))
    (define ids (LLM.encode input_str))
    (define new_token 0)
    (define logits #f)
    (define pos 0)
    (define layer 0)

    ;; 阶段1：预填充KVCache。
    (while (< layer n_layer) {
      (while (< pos max_seq_len) {
        (llm_forward (get_item ids pos) pos max_seq_len #f)
        (set! pos (+ pos 1))
      })
      (set! layer (+ layer 1))
    })

    ;; 阶段2：前向传播与采样
    (define sorted (new_buffer max_seq_len))
    (define sorted_len 0)
    (set! pos 0)
    (while (< pos max_seq_len) {
      (set! logits (llm_forward (get_item ids pos) pos max_seq_len #f))
      (set! new_token (sample_argmax logits vocab_size))
      (define tk (LLM.decode new_token))
      (set_item! sorted sorted_len (String.parseNumber tk))
      (set! sorted_len (+ sorted_len 1))
      ;(display tk)
      (set! pos (+ pos 1))
    })

    sorted
  ))

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 六路归并排序（基于 ai_sort）

;; 复制列表
(define copy_list
  (lambda (lst)
    (define len (length lst))
    (define result (new_buffer len))
    (define i 0)
    (while (< i len) {
      (set_item! result i (get_item lst i))
      (set! i (+ i 1))
    })
    result))

;; 去掉列表末尾的 0
(define trim_trailing_zeros
  (lambda (lst)
    (define len (length lst))
    (while (and (> len 0) (== (get_item lst (- len 1)) 0)) {
      (set! len (- len 1))
    })
    (define result (new_buffer len))
    (define i 0)
    (while (< i len) {
      (set_item! result i (get_item lst i))
      (set! i (+ i 1))
    })
    result))

;; 比较两个列表是否逐项相等
(define lists_equal?
  (lambda (a b)
    (if (not (== (length a) (length b)))
        #f
        {
          (define i 0)
          (define equal #t)
          (while (and (< i (length a)) equal) {
            (if (not (== (get_item a i) (get_item b i))) {
              (set! equal #f)
            })
            (set! i (+ i 1))
          })
          equal
        })))

;; 将列表补 0 到 6 个元素
(define pad_to_6
  (lambda (lst)
    (define len (length lst))
    (define result (new_buffer 6))
    (define i 0)
    (while (< i len) {
      (set_item! result i (get_item lst i))
      (set! i (+ i 1))
    })
    (while (< i 6) {
      (set_item! result i 0)
      (set! i (+ i 1))
    })
    result))

;; 将列表切分为每组最多 6 个元素的若干组
(define split_into_groups
  (lambda (lst)
    (define temp_groups (new_buffer 6))
    (define groups_len 0)
    (define current (new_buffer 6))
    (define current_len 0)
    (define i 0)
    (define len (length lst))
    (while (< i len) {
      (set_item! current current_len (get_item lst i))
      (set! current_len (+ current_len 1))
      (if (== current_len 6) {
        (set_item! temp_groups groups_len current)
        (set! groups_len (+ groups_len 1))
        (set! current (new_buffer 6))
        (set! current_len 0)
      })
      (set! i (+ i 1))
    })
    (if (> current_len 0) {
      (define trimmed (new_buffer current_len))
      (define j 0)
      (while (< j current_len) {
        (set_item! trimmed j (get_item current j))
        (set! j (+ j 1))
      })
      (set_item! temp_groups groups_len trimmed)
      (set! groups_len (+ groups_len 1))
    })
    (define groups (new_buffer groups_len))
    (define k 0)
    (while (< k groups_len) {
      (set_item! groups k (get_item temp_groups k))
      (set! k (+ k 1))
    })
    groups))

;; 对 6 个有序列表执行六路归并
(define merge6
  (lambda (groups)
    (define positions (new_buffer 6))
    (define result (new_buffer 36))
    (define result_len 0)
    (define active 6)
    (while (> active 0) {
      (define min_val 10)
      (define min_idx -1)
      (define i 0)
      (while (< i 6) {
        (define pos (get_item positions i))
        (define group (get_item groups i))
        (if (< pos (length group)) {
          (define val (get_item group pos))
          (if (< val min_val) {
            (set! min_val val)
            (set! min_idx i)
          })
        })
        (set! i (+ i 1))
      })
      (if (>= min_idx 0) {
        (set_item! result result_len min_val)
        (set! result_len (+ result_len 1))
        (define new_pos (+ (get_item positions min_idx) 1))
        (set_item! positions min_idx new_pos)
        (if (== new_pos (length (get_item groups min_idx))) {
          (set! active (- active 1))
        })
      } {
        (set! active 0)
      })
    })
    (define trimmed (new_buffer result_len))
    (define k 0)
    (while (< k result_len) {
      (set_item! trimmed k (get_item result k))
      (set! k (+ k 1))
    })
    trimmed))

;; 将若干有序组合并为 1 个；若组数不足 6 路则补全 0 组
(define merge_groups
  (lambda (groups)
    (define n (length groups))
    (define padded (new_buffer 6))
    (define i 0)
    (while (< i n) {
      (set_item! padded i (get_item groups i))
      (set! i (+ i 1))
    })
    (while (< i 6) {
      (set_item! padded i '(0 0 0 0 0 0))
      (set! i (+ i 1))
    })
    (merge6 padded)))

;; 对单组（<=6 个元素）先补 0 再调用 ai_sort
(define sort_group
  (lambda (group)
    (ai_sort (pad_to_6 group) 6)))

;; 列表反转
(define reverse_list
  (lambda (lst)
    (define iter
      (lambda (src result)
        (if (null? src)
            result
            (iter (cdr src) (cons (car src) result)))))
    (iter lst '())))

;; 多组六路归并排序（使用 cons 避免 set_item! ai_sort 结果导致的问题）
(define ai_merge_sort_multi
  (lambda (groups groups_len)
    (define sorted_groups '())
    (define i 0)
    (while (< i groups_len) {
      (set! sorted_groups (cons (sort_group (get_item groups i)) sorted_groups))
      (set! i (+ i 1))
    })
    (set! sorted_groups (reverse_list sorted_groups))
    (while (> (length sorted_groups) 1) {
      (define new_groups '())
      (set! i 0)
      (define n (length sorted_groups))
      (while (< i n) {
        (define chunk '())
        (define j 0)
        (while (and (< i n) (< j 6)) {
          (set! chunk (cons (get_item sorted_groups i) chunk))
          (set! i (+ i 1))
          (set! j (+ j 1))
        })
        (set! chunk (reverse_list chunk))
        (set! new_groups (cons (merge_groups chunk) new_groups))
      })
      (set! sorted_groups (reverse_list new_groups))
    })
    (if (not (null? sorted_groups))
        (car sorted_groups)
        '(0 0 0 0 0 0))))

;; 六路归并排序主函数
(define ai_merge_sort
  (lambda (lst)
    (define groups (split_into_groups lst))
    (define groups_len (length groups))
    (if (== groups_len 1)
        (sort_group (get_item groups 0))
        (ai_merge_sort_multi groups groups_len))))

;; 去掉列表前导的 count 个元素
(define trim_leading
  (lambda (lst count)
    (define len (length lst))
    (define result_len (- len count))
    (define result (new_buffer result_len))
    (define i 0)
    (while (< i result_len) {
      (set_item! result i (get_item lst (+ i count)))
      (set! i (+ i 1))
    })
    result))

;; 验证 AI 排序结果：去掉前置补充的 0 后应与参考结果一致
(define verify_sort
  (lambda (ai_result ref_result)
    (define ai_len (length ai_result))
    (define ref_len (length ref_result))
    (define padding (- ai_len ref_len))
    (if (< padding 0)
        #f
        (lists_equal? (trim_leading ai_result padding) ref_result))))

;; 测试函数
(define run_tests
  (lambda ()
    (define test_lengths '(0 1 2 5 6 7 11 12 13 35 36))
    (define i 0)
    (define all_passed #t)
    (display "========== 六路归并排序测试 ==========\n")
    (while (< i (length test_lengths)) {
      (define len (get_item test_lengths i))
      (define test_list (make_random_list len))
      (define ai_result (ai_merge_sort test_list))
      (define ref_result (copy_list test_list))
      (List.bubble_sort ref_result >)
      (display "长度 ") (display len) (display "：\n")
      (display "   输入 ") (display test_list) (newline)
      (display "   输出 ") (display (trim_leading ai_result (- (length ai_result) len))) (newline)
      (display "   参考 ") (display ref_result) (newline)
      (define ai_trim (trim_leading ai_result (- (length ai_result) len)))
      (define norm_kt (normalized_kendall_tau_distance ref_result ai_trim))
      (define dl_dist (damerau_levenshtein_distance ref_result ai_trim))
      (define norm_dl (if (== len 0) 0.0 (/ dl_dist len)))
      (display "   KT距离 ") (display (Math.to_fixed norm_kt 4))
      (display " | DL距离 ") (display dl_dist)
      (display " (") (display (Math.to_fixed norm_dl 4)) (display ")") (newline)
      (if (verify_sort ai_result ref_result) {
        (display "   PASS\n")
      } {
        (display "   FAIL（可能由 ai_sort 模型误差导致）\n")
        (set! all_passed #f)
      })
      (set! i (+ i 1))
    })
    (display "======================================\n")
    (if all_passed {
      (display "所有测试通过。\n")
    } {
      (display "存在测试失败。\n")
    })
    all_passed))

;; Kendall Tau 距离：统计 GT 与输出序列中相对顺序不一致的元素对数
;; 忽略相等元素的对
(define kendall_tau_distance
  (lambda (gt output)
    (define n (length gt))
    (define dist 0)
    (define i 0)
    (define j 0)
    (while (< i n) {
      (set! j (+ i 1))
      (while (< j n) {
        (define gi (get_item gt i))
        (define gj (get_item gt j))
        (define oi (get_item output i))
        (define oj (get_item output j))
        (if (and (not (== gi gj)) (not (== oi oj))) {
          (if (< (* (- gi gj) (- oi oj)) 0) {
            (set! dist (+ dist 1))
          })
        })
        (set! j (+ j 1))
      })
      (set! i (+ i 1))
    })
    dist))

;; 归一化 Kendall Tau 距离，范围 [0, 1]，0 表示完全一致
(define normalized_kendall_tau_distance
  (lambda (gt output)
    (define n (length gt))
    (define total_pairs (/ (* n (- n 1)) 2))
    (if (== total_pairs 0)
        0.0
        (/ (kendall_tau_distance gt output) total_pairs))))

;; Damerau-Levenshtein 距离：允许插入、删除、替换和相邻交换
;; 返回将序列 a 转换为序列 b 所需的最少编辑次数
(define damerau_levenshtein_distance
  (lambda (a b)
    (define n (length a))
    (define m (length b))
    (define cols (+ m 1))
    (define dp_len (* (+ n 1) cols))
    (define dp (new_buffer dp_len))
    (define i 0)
    (define j 0)
    (while (<= i n) {
      (set_item! dp (* i cols) i)
      (set! i (+ i 1))
    })
    (set! j 0)
    (while (<= j m) {
      (set_item! dp j j)
      (set! j (+ j 1))
    })
    (set! i 1)
    (while (<= i n) {
      (set! j 1)
      (while (<= j m) {
        (define ai (- i 1))
        (define bj (- j 1))
        (define cost (if (== (get_item a ai) (get_item b bj)) 0 1))
        (define idx (+ (* i cols) j))
        (define deletion (+ (get_item dp (- idx cols)) 1))
        (define insertion (+ (get_item dp (- idx 1)) 1))
        (define substitution (+ (get_item dp (- (- idx cols) 1)) cost))
        (define best (if (< deletion insertion) deletion insertion))
        (if (< substitution best) (set! best substitution))
        (if (and (> i 1) (> j 1)
                 (== (get_item a ai) (get_item b (- j 2)))
                 (== (get_item a (- i 2)) (get_item b bj))) {
          (define transposition (+ (get_item dp (- (- idx (* 2 cols)) 2)) 1))
          (if (< transposition best) (set! best transposition))
        })
        (set_item! dp idx best)
        (set! j (+ j 1))
      })
      (set! i (+ i 1))
    })
    (get_item dp (- dp_len 1))))

;; 长度36压测：统计平均 KT 距离与 DL 距离
(define benchmark_length36
  (lambda (rounds)
    (define LEN 36)
    (define total_kt 0.0)
    (define total_dl 0)
    (define total_norm_dl 0.0)
    (define i 0)
    (display "========== 长度36归并排序 ==========\n")
    (while (< i rounds) {
      (display "第") (display (+ i 1)) (display "轮测试：\n")
      (define test_list (make_random_list LEN))
      (define ai_result (ai_merge_sort test_list))
      (define ref_result (copy_list test_list))
      (List.bubble_sort ref_result >)
      (define ai_trim (trim_leading ai_result (- (length ai_result) LEN)))
      (define kt (normalized_kendall_tau_distance ref_result ai_trim))
      (define dl (damerau_levenshtein_distance ref_result ai_trim))
      (define norm_dl (/ dl LEN))
      (display "   输入 ") (display test_list) (newline)
      (display "   输出 ") (display (trim_leading ai_result (- (length ai_result) LEN))) (newline)
      (display "   参考 ") (display ref_result) (newline)
      (display "   KT距离 ") (display (Math.to_fixed kt 4))
      (display " | DL距离 ") (display dl)
      (display " (") (display (Math.to_fixed norm_dl 4)) (display ")") (newline)
      (set! total_kt (+ total_kt kt))
      (set! total_dl (+ total_dl dl))
      (set! total_norm_dl (+ total_norm_dl norm_dl))
      (set! i (+ i 1))
    })
    (display "总次数：") (display rounds) (newline)
    (display "平均 KT距离：") (display (Math.to_fixed (/ total_kt rounds) 4)) (newline)
    (display "平均 DL距离：") (display (/ (* 1.0 total_dl) rounds)) (newline)
    (display "平均归一化 DL距离：") (display (Math.to_fixed (/ total_norm_dl rounds) 4)) (newline)
    (display "========================================\n")
    (/ total_norm_dl rounds)))


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
;; 程序入口

(if (== task 0) {
  (display "序列生成任务：用LLM解决排序问题\n")
  (define rlist (make_random_list 6))
  (display "  排序前：")
  (display rlist)
  (display "\n  排序后：")
  (display (ai_sort rlist 6))
  (display "\n\n")
  ;(run_tests)
  ;(display "\n")
  (benchmark_length36 10)
  (display "\n")
} {
  (display "自回归文本生成\n")
  (generate "人类的本质是" 256 1.0 1.05 0.5 0)
})

(newline)

;;; 用于支持多个任务的外层函数：结束 ;;;
))
;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

(LLM_RUN 0)
(LLM_RUN 1)
