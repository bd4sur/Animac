#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <locale.h>
#include <signal.h>
#include <unistd.h>

#include <readline/readline.h>
#include <readline/history.h>

#include "repl.h"

#define ANIMAC_VERSION "V2607"

static volatile sig_atomic_t g_should_stop = 0;

static void signal_handler(int sig) {
    (void)sig;
    g_should_stop = 1;
}

static int repl_event_hook(void) {
    if (g_should_stop) {
        rl_done = 1;
    }
    return 0;
}

int main(int argc, char *argv[]) {
    int js_mode = 0;
    if (argc > 1 && strcmp(argv[1], "--js") == 0) {
        js_mode = 1;
    }

    if (!setlocale(LC_ALL, "")) {
        fprintf(stderr, "setlocale failed\n");
        return 1;
    }

    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = signal_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;  // 不设置 SA_RESTART，使阻塞的 read 被信号打断
    sigaction(SIGINT, &sa, NULL);

    // 注册 readline 事件钩子，使 Ctrl+C 能在超时周期内被响应
    rl_event_hook = repl_event_hook;
    rl_set_keyboard_input_timeout(100000);  // 100 ms

    am_repl_ctx_t *ctx = am_repl_ctx_create();
    if (!ctx) {
        fprintf(stderr, "Failed to create REPL context\n");
        return 1;
    }

    printf("\033[96mAnimac\033[0m " ANIMAC_VERSION " REPL\n");
    printf("Copyright (c) 2018-2026 BD4SUR\n");

    if (js_mode) {
        am_repl_ctx_set_js_mode(ctx, 1);
        printf("\033[93mJavaScript\033[0m mode. Press Ctrl+C to quit. Type \".help\" for more infomation.\n");
    } else {
        printf("\033[93mScheme\033[0m mode. Press Ctrl+C to quit. Type \".help\" for more infomation.\n");
    }

    while (!g_should_stop) {
        char prompt[64];
        if (ctx->accum_len > 0 || ctx->multiline) {
            int spaces = ctx->indent * 2;
            if (spaces < 0) spaces = 0;
            if (spaces > 32) spaces = 32;
            snprintf(prompt, sizeof(prompt), "%s%*s", ctx->prompt_cont, spaces, "");
        } else {
            snprintf(prompt, sizeof(prompt), "%s", ctx->prompt_main);
        }

        char *line_mb = readline(prompt);
        if (line_mb == NULL) {
            printf("\n");
            if (g_should_stop) {
                // readline 因 Ctrl+C 返回 NULL
                break;
            }
            // 终端中 Ctrl+D / EOF 不再退出，重新提示；
            // 管道/文件 EOF 仍正常结束，避免空转。
            if (isatty(STDIN_FILENO)) {
                continue;
            }
            break;
        }

        if (line_mb[0] != '\0') {
            add_history(line_mb);
        }

        am_repl_result_t res = am_repl_ctx_feed(ctx, line_mb);
        free(line_mb);

        if (res.status == AM_REPL_STATUS_EXIT || g_should_stop) {
            break;
        }

        if (res.status == AM_REPL_STATUS_OUTPUT || res.status == AM_REPL_STATUS_ERROR) {
            if (res.output && res.output[0] != '\0') {
                printf("%s", res.output);
                fflush(stdout);
            }
            if (res.error && res.error[0] != '\0') {
                fprintf(stderr, "%s", res.error);
            }
        }
        // AM_REPL_STATUS_CONTINUE：无需输出
    }

    am_repl_ctx_destroy(ctx);
    return 0;
}
