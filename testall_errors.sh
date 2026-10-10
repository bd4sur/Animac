#!/usr/bin/env bash
# ============================================================================
# testall_errors.sh —— 编译期错误路径回归
#
# test/errors/*.scm 中的每个文件都是"预期无法编译"的最小用例（保留关键字、
# 非法调用者、括号不匹配、跨行字符串、尾随 token、未闭合字符串等）。
#
# 判定：./main 对其求值必须以非零退出码终止。
#   - 当前实现：解析/编译失败会触发 main.c 中的断言终止（SIGABRT，exit=134），
#     或 Parser 打印错误后终止；无论哪种形态，只要退出码非零即视为"拒绝编译"。
#   - 已知不足（doc/ISSUES.md #36 同期记录）：解析失败目前以断言崩溃呈现，
#     理想行为是打印诊断信息后以非零码优雅退出——两者在本 runner 中不作区分。
#
# 运行方式：bash testall_errors.sh
# 通过标准：输出末行 "COMPILE-ERROR PASS: 10  FAIL: 0"。
# ============================================================================
set -u
cd "$(dirname "$0")"

make >/dev/null 2>&1
if [ ! -x ./main ]; then
    echo "build failed"; exit 1
fi

pass=0
fail=0
for f in test/errors/*.scm; do
    { timeout 10 ./main "$f" >/dev/null 2>&1; } 2>/dev/null
    ec=$?
    if [ "$ec" -ne 0 ]; then
        pass=$((pass + 1))
        echo "  [PASS] $(basename "$f") （编译被拒绝，exit=$ec）"
    else
        fail=$((fail + 1))
        echo "  [FAIL] $(basename "$f") 意外编译通过"
    fi
done

echo "COMPILE-ERROR PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
