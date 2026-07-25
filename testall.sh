#!/usr/bin/env bash
# Animac 回归测试脚本：按如下硬编码顺序逐个执行测试用例，stdout+stderr 直接输出到终端。
# 每个用例限时 30 秒。test_fork.scm 与 jstest.js 因无限循环，不纳入测试。

set -u
cd "$(dirname "$0")"

make || exit 1

for t in \
    test.scm \
    test_deadlock.scm \
    test_dw_basic.scm \
    test_dw_callcc.scm \
    test_dw_callcc_after.scm \
    test_dw_callcc_before.scm \
    test_dw_callcc_simple.scm \
    test_dw_complex_eval_async.scm \
    test_dw_complex_macro.scm \
    test_dw_coroutine.scm \
    test_dw_escape.scm \
    test_dw_fork.scm \
    test_dw_gc_stress.scm \
    test_dw_nested.scm \
    test_eval.scm \
    test_exit.scm \
    test_exit_async.scm \
    test_gc_watermark.scm \
    test_ipc1.scm \
    test_ipc2.scm \
    test_kill_other.scm \
    test_kill_self.scm \
    test_kill_timer.scm \
    test_macro.scm \
    test_mec.scm \
    test_table.scm \
    yinyang.scm \
    yinyang_cps.scm \
    llm.scm \
    mlp.scm
do
    echo "================ $t ================"
    timeout 30 ./main "test/$t" 2>&1
    echo
done
