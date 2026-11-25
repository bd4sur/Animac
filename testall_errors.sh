#!/usr/bin/env bash
# ============================================================================
# testall_errors.sh —— 编译期错误路径回归
#
# test/errors/*.scm 中的每个文件都是"预期无法编译"的最小用例（保留关键字、
# 非法调用者、括号不匹配、跨行字符串、尾随 token、未闭合字符串、内建过程元数
# 不符等，共 20 例）。
#
# 判定：./main 对其求值必须以非零退出码终止。
#   - 当前实现：解析/编译失败会触发 main.c 中的断言终止（SIGABRT，exit=134），
#     或 Parser 打印错误后终止；无论哪种形态，只要退出码非零即视为"拒绝编译"。
#   - 已知不足（doc/ISSUES.md #36 同期记录）：解析失败目前以断言崩溃呈现，
#     理想行为是打印诊断信息后以非零码优雅退出——两者在本 runner 中不作区分。
#   - 可选强化：若用例文件内含一行 ";; expect-stderr: <片段>"，则除退出码非零外，
#     还要求 stderr 含该片段。内建元数用例（11–20）均带此行，用于锁定"因元数不符
#     而拒绝"这一具体原因，避免将来因其它原因失败（如误成解析错误）而假通过。
#
# 运行方式：bash testall_errors.sh
# 通过标准：输出末行 "COMPILE-ERROR PASS: 20  FAIL: 0"。
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
    expect="$(sed -n 's/^;; expect-stderr:[[:space:]]*//p' "$f" | head -1)"
    err="$( { timeout 10 ./main "$f" 2>&1 >/dev/null; } 2>/dev/null )"
    ec=$?
    if [ "$ec" -eq 0 ]; then
        fail=$((fail + 1))
        echo "  [FAIL] $(basename "$f") 意外编译通过"
    elif [ -n "$expect" ] && ! printf '%s' "$err" | grep -qF -- "$expect"; then
        fail=$((fail + 1))
        echo "  [FAIL] $(basename "$f") 退出码非零($ec)，但诊断信息不含预期片段：$expect"
    else
        pass=$((pass + 1))
        echo "  [PASS] $(basename "$f") （编译被拒绝，exit=$ec）"
    fi
done

echo "COMPILE-ERROR PASS: $pass  FAIL: $fail"
[ "$fail" -eq 0 ]
