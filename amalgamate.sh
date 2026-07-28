#!/usr/bin/env bash
# =============================================================================
# Animac Amalgamation 脚本（仿 SQLite 单文件分发形态）
#
# 将【解释器核心】的全部头文件/实现文件按依赖顺序分别合并为
# animac_core.h / animac_core.c（自包含的“上帝模块”）。
#
# 收录范围 = include/animac.h 伞形头文件所登记的解释器核心
# （基础设施、前端、运行时）。明确排除与宿主相关的内容：
#   am_host.*（宿主适配）、am_native_*.*（native 库，经
#   am_runtime_register_native_lib 动态注册）、am_highlight.*（终端呈现）、
#   am_repl.*（上层消费者）。
# 宿主程序（如 main.c）的典型用法：编译 animac_core.c，再按需单独编译
# src/am_host.c、src/am_native_*.c 等宿主侧文件一同链接。
#
# 用法：
#   bash amalgamate.sh   （或 make amalg）
#
# 产物（置于项目根目录）：
#   animac_core.h  —— 单文件公开 API 头文件（内含 extern "C" 包装）
#   animac_core.c  —— 单文件实现（仅需 #include "animac_core.h"）
#
# 原则：绝不修改 include/ 与 src/ 下的任何现有文件；所有变换（剔除局部
#       #include、跨编译单元 static 符号改名）仅在合并产物上进行。
#
# 头文件-only 模块：伞形头文件登记的头文件若没有同名 src/*.c 实现文件
#       （纯 static inline / 宏 / 文档型头文件），仅并入 animac_core.h，
#       不并入 animac_core.c（脚本会列出这类头文件，不再是错误）。
#
# 已查明的跨文件 static 符号冲突（合并到同一编译单元会重定义），
# 统一按 “<文件基名>__<原名>” 规则在产物中改名（不改源文件）：
#   dynamic_wind_entry_{after,before,saved,set_saved}, dynamic_wind_get_entry
#       —— src/am_process.c 与 src/am_runtime.c 各自重复定义
#   parse_term
#       —— src/am_js2scm.c 与 src/am_parser.c 各自重复定义
# =============================================================================

set -euo pipefail
cd "$(dirname "$0")"

OUT_H="animac_core.h"
OUT_C="animac_core.c"

# -----------------------------------------------------------------------------
# 1. 头文件拓扑排序
#    依赖边取自各头文件中的局部 #include "..."；
#    animac.h 是伞形头文件，不并入产物，但其包含列表展开为其引用者的依赖。
# -----------------------------------------------------------------------------

# 伞形头文件的包含列表（即解释器核心头文件全集）
# —— 本脚本只处理该集合，从而与伞形头文件的收录范围自动保持同步，
#    并天然排除 am_host.h、am_native_*.h、am_highlight.h、am_repl.h 等宿主相关头文件。
UMBRELLA_DEPS=$(grep -oE '#include[[:space:]]+"[A-Za-z0-9_]+\.h"' include/animac.h \
                | sed -E 's/.*"([^"]+)".*/\1/')

# 全部待合并头文件 = 伞形头文件登记的解释器核心头文件
ALL_HDRS=$UMBRELLA_DEPS

# 取某头文件的直接依赖（局部 include；animac.h 展开为伞形列表）
header_deps() {
    local f="include/$1"
    local deps
    deps=$(grep -oE '#include[[:space:]]+"[A-Za-z0-9_]+\.h"' "$f" \
           | sed -E 's/.*"([^"]+)".*/\1/' || true)
    local out=""
    for d in $deps; do
        if [ "$d" = "animac.h" ]; then
            out="$out $UMBRELLA_DEPS"
        else
            out="$out $d"
        fi
    done
    echo $out
}

# Kahn 拓扑排序（每轮扫描固定顺序，保证确定性）
topo_sort() {
    local items=$(echo $1)    # 归一化为空格分隔的条目列表（消除换行符）
    local dep_fn="$2"         # 取依赖的函数名
    local emitted=""
    local remaining="$items"
    local progress=1
    while [ -n "$remaining" ] && [ "$progress" -eq 1 ]; do
        progress=0
        local next_remaining=""
        for it in $remaining; do
            local ok=1
            for d in $($dep_fn "$it"); do
                # 依赖项必须在已合并集合内且已输出
                case " $items " in
                    *" $d "*)
                        case " $emitted " in
                            *" $d "*) ;;
                            *) ok=0; break ;;
                        esac
                        ;;
                    *) ;;  # 非本项目头文件，忽略
                esac
            done
            if [ "$ok" -eq 1 ]; then
                emitted="$emitted $it"
                progress=1
            else
                next_remaining="$next_remaining $it"
            fi
        done
        remaining="$next_remaining"
    done
    if [ -n "$remaining" ]; then
        echo "错误：头文件依赖存在环，无法拓扑排序：$remaining" >&2
        exit 1
    fi
    echo $emitted
}

SORTED_HDRS=$(topo_sort "$ALL_HDRS" header_deps)
echo ">> 头文件合并顺序："
for h in $SORTED_HDRS; do echo "   $h"; done

# -----------------------------------------------------------------------------
# 2. 源文件合并顺序：按对应头文件的拓扑位置排序（无对应头文件的排最后）
# -----------------------------------------------------------------------------
# 全部待合并源文件 = 核心头文件对应的实现文件
# —— 容忍头文件-only 模块：没有同名 src/*.c 实现文件的头文件不并入 .c
ALL_SRCS=""
HEADER_ONLY_HDRS=""
for h in $ALL_HDRS; do
    c="${h%.h}.c"
    if [ -f "src/$c" ]; then
        ALL_SRCS="$ALL_SRCS $c"
    else
        HEADER_ONLY_HDRS="$HEADER_ONLY_HDRS $h"
    fi
done
ALL_SRCS=$(echo $ALL_SRCS)   # 归一化为空格分隔（消除前导空白）
if [ -n "$HEADER_ONLY_HDRS" ]; then
    echo ">> 头文件-only 模块（无同名 .c，仅并入 $OUT_H）："
    for h in $HEADER_ONLY_HDRS; do echo "   $h"; done
fi
SORTED_SRCS=""
for h in $SORTED_HDRS; do
    c="${h%.h}.c"
    case " $ALL_SRCS " in
        *" $c "*) SORTED_SRCS="$SORTED_SRCS $c" ;;
    esac
done
for c in $ALL_SRCS; do
    case " $SORTED_SRCS " in
        *" $c "*) ;;
        *) SORTED_SRCS="$SORTED_SRCS $c" ;;
    esac
done
echo ">> 源文件合并顺序："
for c in $SORTED_SRCS; do echo "   $c"; done

# -----------------------------------------------------------------------------
# 3. 跨文件 static 符号改名表（按文件列出需加前缀的符号）
# -----------------------------------------------------------------------------
rename_names_for() {
    case "$1" in
        am_process.c)
            echo "dynamic_wind_entry_after dynamic_wind_entry_before dynamic_wind_entry_saved dynamic_wind_entry_set_saved dynamic_wind_get_entry" ;;
        am_runtime.c)
            echo "dynamic_wind_entry_after dynamic_wind_entry_before dynamic_wind_entry_saved dynamic_wind_entry_set_saved dynamic_wind_get_entry" ;;
        am_js2scm.c)
            echo "parse_term" ;;
        am_parser.c)
            echo "parse_term" ;;
        *)
            echo "" ;;
    esac
}

# -----------------------------------------------------------------------------
# 4. 生成 animac_core.h
# -----------------------------------------------------------------------------
{
    echo "/* ============================================================================="
    echo " * Animac（灵机）解释器 —— Amalgamation 单文件头文件"
    echo " *"
    echo " * 本文件由 amalgamate.sh 自动生成，请勿手工编辑。"
    echo " * 内容来源：include/animac.h 伞形头文件登记的解释器核心头文件，"
    echo " *           按依赖顺序拓扑排序合并；局部 #include 已剔除。"
    echo " *           不含 am_host.h / am_native_*.h / am_highlight.h / am_repl.h 等宿主相关头文件。"
    echo " * 生成时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
    echo " * ============================================================================ */"
    echo
    echo "#ifndef __ANIMAC_CORE_H__"
    echo "#define __ANIMAC_CORE_H__"
    echo
    echo "#ifdef __cplusplus"
    echo "extern \"C\" {"
    echo "#endif"
    echo
    for h in $SORTED_HDRS; do
        echo
        echo "/* ===== begin: include/$h ===== */"
        # 剔除局部 #include "..." 行，保留系统 #include <...> 及其余全部内容
        grep -vE '^[[:space:]]*#[[:space:]]*include[[:space:]]*"' "include/$h"
        echo "/* ===== end:   include/$h ===== */"
    done
    echo
    echo "#ifdef __cplusplus"
    echo "}"
    echo "#endif"
    echo
    echo "#endif /* __ANIMAC_CORE_H__ */"
} > "$OUT_H"
echo ">> 已生成 $OUT_H （$(wc -l < "$OUT_H") 行）"

# -----------------------------------------------------------------------------
# 5. 生成 animac_core.c
# -----------------------------------------------------------------------------
{
    echo "/* ============================================================================="
    echo " * Animac（灵机）解释器 —— Amalgamation 单文件实现"
    echo " *"
    echo " * 本文件由 amalgamate.sh 自动生成，请勿手工编辑。"
    echo " * 内容来源：解释器核心全部实现文件（src/ 下与核心头文件同名的 .c），"
    echo " *           按依赖顺序合并；局部 #include 已剔除；"
    echo " *           跨文件重名的 static 符号已按 “<文件基名>__<原名>” 规则改名。"
    echo " *           不含 am_host.c / am_native_*.c / am_highlight.c / am_repl.c 等宿主相关实现。"
    echo " * 生成时间：$(date '+%Y-%m-%d %H:%M:%S %z')"
    echo " * ============================================================================ */"
    echo
    echo "#include \"animac_core.h\""
    for c in $SORTED_SRCS; do
        echo
        echo "/* ===== begin: src/$c ===== */"
        base="${c%.c}"
        names=$(rename_names_for "$c")
        if [ -n "$names" ]; then
            sed_expr=()
            for n in $names; do
                sed_expr+=(-e "s/\\b${n}\\b/${base}__${n}/g")
            done
            grep -vE '^[[:space:]]*#[[:space:]]*include[[:space:]]*"' "src/$c" \
                | sed "${sed_expr[@]}"
        else
            grep -vE '^[[:space:]]*#[[:space:]]*include[[:space:]]*"' "src/$c"
        fi
        echo "/* ===== end:   src/$c ===== */"
    done
} > "$OUT_C"
echo ">> 已生成 $OUT_C （$(wc -l < "$OUT_C") 行）"

echo ">> Amalgamation 完成。"
