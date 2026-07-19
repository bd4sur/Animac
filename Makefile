CC      := gcc
CFLAGS  := -O3 -Wall -Wextra -Wno-unused-function -Iinclude
LDFLAGS := -lm

SRCS := $(wildcard src/*.c)
# SRCS := $(filter-out src/exclude.c, $(wildcard src/*.c))

all: main repl

main: main.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

repl: main_repl.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS) -lreadline

clean:
	rm -f main repl *.exe
