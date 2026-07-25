CC      := gcc
CFLAGS  := -O3 -Wall -Wextra -Wno-unused-function -Iinclude
LDFLAGS := -lm

SRCS := $(wildcard src/*.c)
SRCS := $(filter-out src/am_host_esp32.cpp, $(wildcard src/*))

all: main repl

main: main.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

repl: main_repl.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS) -lreadline

# =============================================================================
# Amalgamation 单文件分发形态（详见 doc/AGENTS.md）
#   make amalg        —— 生成 animac_core.h / animac_core.c（源文件更新时自动重新生成）
#   make amalg-all    —— 生成并用单文件形态构建 main_amalg / repl_amalg
#   make amalg-clean  —— 清理单文件形态的全部产物（生成文件 + 可执行文件）
# =============================================================================
AMALG_DEPS := amalgamate.sh include/animac.h $(wildcard include/am_*.h) $(wildcard src/am_*.c)

# 两个产物由脚本一次生成（&: 分组目标，GNU make >= 4.3）
animac_core.h animac_core.c &: $(AMALG_DEPS)
	bash amalgamate.sh

amalg: animac_core.h animac_core.c

# 宿主侧源文件：Amalgamation 仅含解释器核心，host 适配/native 库/终端呈现
# 等宿主相关内容按需单独编译链接
HOST_SRCS := src/am_host.c src/am_highlight.c $(wildcard src/am_native_*.c)

main_amalg: main.c animac_core.c animac_core.h $(HOST_SRCS)
	$(CC) $(CFLAGS) -o $@ main.c animac_core.c $(HOST_SRCS) $(LDFLAGS)

repl_amalg: main_repl.c src/am_repl.c animac_core.c animac_core.h $(HOST_SRCS)
	$(CC) $(CFLAGS) -o $@ main_repl.c src/am_repl.c animac_core.c $(HOST_SRCS) $(LDFLAGS) -lreadline

amalg-all: main_amalg repl_amalg

amalg-clean:
	rm -f animac_core.h animac_core.c main_amalg repl_amalg amalg_test_output.txt ref_test_output.txt

clean:
	rm -f main repl main_amalg repl_amalg *.exe

.PHONY: all amalg amalg-all amalg-clean clean
