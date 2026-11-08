#!/usr/bin/env python3
"""生成「静态字面量图规模可调」的 GC 微基准（供 test/gc_attack/README.md 引用）。

用途
----
静态字面量在进程堆中带 static 标志，每轮 GC 都会被重新遍历。本脚本生成三个
只差「静态图规模」的微基准，用于隔离测量这部分开销：

    mb_none30k.scm    无静态数据（只标记根集合）           —— 基准
    mb_flat300.scm    N 个立即值的平坦静态字面量           —— 测静态出边
    mb_nested40k.scm  M 个静态子列表的嵌套静态字面量       —— 测静态对象本身

每个基准都反复调用 System.gc（只做标记-清除，不含压缩），从而把成本限定在
根收集 + 标记 + 清除三个阶段。

用法
----
    python3 gen_static_literal_bench.py [输出目录] [平坦元素数] [嵌套子表数]
    python3 gen_static_literal_bench.py /tmp/gcbench 200000 40000

默认写出到 ./gcbench/。生成物体积较大（数十万字节到 1MB+），请勿入库。
注意：嵌套规模过大会在**解析期**耗尽 VM 工作区（实测 20 万个子列表节点即触发
`[allocator] VM segregated 分配失败`），这属于解析期容量限制，与 GC 无关。
"""

import os
import sys

GC_ROUNDS = 300          # mb_flat300 / mb_nested40k 的 GC 轮次
GC_ROUNDS_TINY = 30000   # mb_none30k 的 GC 轮次（无静态数据，单轮极快，故多跑）


def emit(path, note, literal, rounds):
    body = (
        "; %s\n"
        "(native System)\n"
        "(define D %s)\n"
        "\n"
        "(define t0 (System.timestamp))\n"
        "(define i 0)\n"
        "(while (< i %d) { (System.gc) (set! i (+ i 1)) })\n"
        '(display "elapsed_ms=") (display (- (System.timestamp) t0))\n'
        '(display " len=") (display (length D)) (newline)\n'
    ) % (note, literal, rounds)
    with open(path, "w") as f:
        f.write(body)
    print("wrote %-46s %8d bytes" % (path, os.path.getsize(path)))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "gcbench"
    n_flat = int(sys.argv[2]) if len(sys.argv) > 2 else 200000
    n_nested = int(sys.argv[3]) if len(sys.argv) > 3 else 40000
    os.makedirs(out, exist_ok=True)

    emit(os.path.join(out, "mb_none30k.scm"),
         "微基准：无静态数据（只标记根集合），%d 轮 GC" % GC_ROUNDS_TINY,
         "'()", GC_ROUNDS_TINY)
    emit(os.path.join(out, "mb_flat300.scm"),
         "微基准：平坦静态字面量 %d 个立即值，%d 轮 GC" % (n_flat, GC_ROUNDS),
         "'(" + " ".join(["0"] * n_flat) + ")", GC_ROUNDS)
    emit(os.path.join(out, "mb_nested40k.scm"),
         "微基准：嵌套静态字面量 %d 个静态子列表，%d 轮 GC" % (n_nested, GC_ROUNDS),
         "'(" + " ".join(["(0)"] * n_nested) + ")", GC_ROUNDS)


if __name__ == "__main__":
    main()