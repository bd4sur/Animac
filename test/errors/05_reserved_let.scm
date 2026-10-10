;; 预期：编译失败。let 未支持（Animac 原生不支持各类 let，见 README；需用 lambda 或卫生宏）
(display (let ((x 1)) x))
