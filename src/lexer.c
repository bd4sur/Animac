#include <stdint.h>
#include <wchar.h>
#include <wctype.h>
#include <string.h>

#include "object.h"
#include "lexer.h"


// 关键字表
const wchar_t* AM_KEYWORDS[] = {
    L"lambda", L"define", L"set!", L"let", L"begin", L"return", L"...", L"_",
    L"if", L"and", L"or", L"cond", L"else", L"for", L"while", L"break", L"continue", L"case", L"do",
    L"quote", L"quasiquote", L"unquote",
    L"import", L"native",
    L"define-syntax", L"let-syntax", L"letrec-syntax", L"syntax-rules", NULL
};

// 关键字对应的保留symbol值，索引与AM_KEYWORDS一一对应
static const am_value_t AM_KEYWORD_SYMBOLS[] = {
    AM_VALUE_KW_lambda,
    AM_VALUE_KW_define,
    AM_VALUE_KW_set,
    AM_VALUE_KW_let,
    AM_VALUE_KW_begin,
    AM_VALUE_KW_return,
    AM_VALUE_KW_dot3,
    AM_VALUE_KW_underscore,
    AM_VALUE_KW_if,
    AM_VALUE_KW_and,
    AM_VALUE_KW_or,
    AM_VALUE_KW_cond,
    AM_VALUE_KW_else,
    AM_VALUE_KW_for,
    AM_VALUE_KW_while,
    AM_VALUE_KW_break,
    AM_VALUE_KW_continue,
    AM_VALUE_KW_case,
    AM_VALUE_KW_do,
    AM_VALUE_KW_quote,
    AM_VALUE_KW_quasiquote,
    AM_VALUE_KW_unquote,
    AM_VALUE_KW_import,
    AM_VALUE_KW_native,
    AM_VALUE_KW_define_syntax,
    AM_VALUE_KW_let_syntax,
    AM_VALUE_KW_letrec_syntax,
    AM_VALUE_KW_syntax_rules
};

// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 解析字符串字面量，返回长度；出错返回 -1
static int32_t parse_string(wchar_t *code, int32_t start, int32_t *end_pos) {
    if(code[start] != L'"') return -1;
    int32_t pos = start + 1;
    while(code[pos]) {
        if(code[pos] == L'"' && !is_escaped(code, pos)) {
            *end_pos = pos + 1;
            return pos - start + 1;
        }
        if(code[pos] == L'\n' || code[pos] == L'\r') return -1;
        pos++;
    }
    return -1;
}

// 更严格的数字字面值判断
// 是合法数字返回 1；不是数字返回 -1。
static int32_t is_number(wchar_t *code, int32_t start, int32_t len) {
    if(len == 0) return -1;
    wchar_t first = code[start];
    // 首字符必须是 +/- 或数字
    if(!(first == L'-' || first == L'+' || iswdigit(first))) return -1;

    int32_t has_digit = 0, has_dot = 0, has_exp = 0;
    for(int32_t i = 0; i < len; i++) {
        wchar_t c = code[start + i];
        if(iswdigit(c)) { has_digit = 1; }
        else if(c == L'.') {
            if(has_dot || has_exp) return -1; // 多个. 或 . 在指数后
            has_dot = 1;
        }
        else if(c == L'e' || c == L'E') {
            if(has_exp || !has_digit) return -1; // 多个e 或 e前无数字
            has_exp = 1;
            // e后可跟 +/-
            if(i+1 < len && (code[start+i+1] == L'+' || code[start+i+1] == L'-')) i++;
            has_digit = 0; // 指数部分需重新验证有数字
        }
        else if(c == L'+' || c == L'-') {
            // +/- 只能出现在开头或e/E之后
            if(i != 0 && code[start+i-1] != L'e' && code[start+i-1] != L'E') return -1;
        }
        else {
            return -1; // 非法字符
        }
    }
    return has_digit ? 1 : -1; // 必须至少有一个数字
}

// 判断是否为关键字。
// 是关键字返回在 AM_KEYWORDS 中的索引（非负）；不是关键字返回 -1。
static int32_t is_keyword(wchar_t *code, int32_t start, int32_t len) {
    if(len == 0) return -1;
    for(int32_t i = 0; AM_KEYWORDS[i]; i++) {
        if(wcsncmp(&code[start], AM_KEYWORDS[i], len) == 0 && AM_KEYWORDS[i][len] == L'\0') {
            return i;
        }
    }
    return -1;
}

// 解析 # 开头的特殊字面值
// 成功返回对应的 AM_TOKEN_TYPE_*（正数），并通过 len_out 输出长度；失败返回 -1。
static int32_t parse_hash_literal(wchar_t *code, int32_t start, int32_t *len_out) {
    if(code[start] != L'#') return -1;
    int32_t pos = start + 1;

    // #t / #f (布尔值)
    if(code[pos] == L't' || code[pos] == L'f') {
        wchar_t next = code[pos + 1];
        if(!is_delimiter(next) && !is_whitespace(next) && next != L'\0') {
            return -1; // #ta 不是合法布尔值
        }
        *len_out = 2;
        return AM_TOKEN_TYPE_BOOLEAN;
    }

    // #undefined
    if(wcsncmp(&code[pos], L"undefined", 9) == 0) {
        wchar_t next = code[pos + 9];
        if(!is_delimiter(next) && !is_whitespace(next) && next != L'\0') return -1;
        *len_out = 10; // # + undefined(9)
        return AM_TOKEN_TYPE_UNDEFINED;
    }

    // #null
    if(wcsncmp(&code[pos], L"null", 4) == 0) {
        wchar_t next = code[pos + 4];
        if(!is_delimiter(next) && !is_whitespace(next) && next != L'\0') return -1;
        *len_out = 5; // # + null(4)
        return AM_TOKEN_TYPE_NULL;
    }

    return -1; // 不识别的 # 字面值
}

static void update_pos(wchar_t c, int32_t *line, int32_t *column) {
    if(c == L'\n') { *line += 1; *column = 0; }
    else if(c == L'\r') {
        if(*column >= 0) { *line += 1; *column = 0; }
    }
    else if(c != L'\0') { (*column)++; }
}

// ===============================================================================
// 主Lexer函数
// ===============================================================================

int32_t am_lexer(wchar_t *code, am_token_t *tokens) {
    if(!code || !tokens) return -1;

    int32_t pos = 0, tok_cnt = 0;
    int32_t line = 1, col = 0;
    int32_t buf_start = -1, buf_line = -1, buf_col = -1;

#define EMIT(t_type, t_len, t_idx, t_id)    \
    do {                                    \
        am_token_t *t = &tokens[tok_cnt++]; \
        t->index = (t_idx);                 \
        t->length = (t_len);                \
        t->type = (t_type);                 \
        t->id = (t_id);                     \
        t->line = buf_line;                 \
        t->column = buf_col;                \
        buf_start = -1;                     \
    } while(0)

// 重写：类型判断逻辑匹配新Token定义
#define FLUSH()                                                 \
    do {                                                        \
        if(buf_start != -1) {                                   \
            int32_t len = pos - buf_start;                      \
            int32_t t_type = AM_TOKEN_TYPE_IDENTIFIER;          \
            size_t t_id = SIZE_MAX;                             \
            wchar_t first = code[buf_start];                    \
            /* #开头的特殊字面值 */                              \
            if(first == L'#') {                                 \
                int32_t hash_len;                               \
                int32_t hash_type = parse_hash_literal(code, buf_start, &hash_len); \
                if(hash_type >= 0 && hash_len == len) {         \
                    t_type = hash_type;                         \
                } else {                                        \
                    t_type = AM_TOKEN_TYPE_UNEXPECTED;          \
                }                                               \
            }                                                   \
            else if (first == L'\'') {                          \
                if (len > 1) t_type = AM_TOKEN_TYPE_SYMBOL;     \
                else t_type = AM_TOKEN_TYPE_QUOTE;              \
            }                                                   \
            /* 数字字面值 */                                     \
            else if(is_number(code, buf_start, len) >= 0) {     \
                t_type = AM_TOKEN_TYPE_NUMBER;                  \
            }                                                   \
            /* 关键字 */                                        \
            else {                                              \
                int32_t kw_idx = is_keyword(code, buf_start, len); \
                if (kw_idx >= 0) {                              \
                    t_type = AM_TOKEN_TYPE_KEYWORD;             \
                    t_id = am_value_to_symbol(AM_KEYWORD_SYMBOLS[kw_idx]); \
                }                                               \
            }                                                   \
            EMIT(t_type, len, buf_start, t_id);                 \
        }                                                       \
    } while(0)

    while(code[pos]) {
        wchar_t c = code[pos];

        /* 1. 注释: ; 到行尾 */
        if(c == L';' && !is_escaped(code, pos)) {
            FLUSH();
            while(code[pos] && code[pos] != L'\n' && code[pos] != L'\r')
                update_pos(code[pos++], &line, &col);
            if(code[pos]) update_pos(code[pos++], &line, &col);
            continue;
        }

        /* 2. 定界符处理 */
        if(is_delimiter(c) && !is_escaped(code, pos)) {
            FLUSH();

            // 2.1 字符串字面量
            if(c == L'"') {
                int32_t end_pos;
                int32_t len = parse_string(code, pos, &end_pos);
                if(len < 0) return -1;
                buf_line = line; buf_col = col;
                EMIT(AM_TOKEN_TYPE_STRING, len, pos, SIZE_MAX);
                while(pos < end_pos) update_pos(code[pos++], &line, &col);
                continue;
            }

            // 2.2 { 特殊转换: { -> ( + begin (虚拟token)
            if(c == L'{') {
                buf_line = line; buf_col = col;
                EMIT(AM_TOKEN_TYPE_LB, 1, pos, SIZE_MAX);

                am_token_t *t2 = &tokens[tok_cnt++];
                t2->index = SIZE_MAX; t2->length = 5; t2->type = AM_TOKEN_TYPE_KEYWORD;
                t2->id = am_value_to_symbol(AM_VALUE_KW_begin);
                t2->line = line; t2->column = col + 1;

                update_pos(c, &line, &col);
                pos++;
                continue;
            }

            // 2.4 普通定界符类型映射
            int32_t t_type;
            if(c == L'(' || c == L'[')
                t_type = AM_TOKEN_TYPE_LB;
            else if(c == L')' || c == L']' || c == L'}')
                t_type = AM_TOKEN_TYPE_RB;
            else if(c == L'`')
                t_type = AM_TOKEN_TYPE_QUASIQUOTE;
            else if(c == L',')
                t_type = AM_TOKEN_TYPE_UNQUOTE;
            else
                t_type = AM_TOKEN_TYPE_DELIMITER;

            buf_line = line; buf_col = col;
            EMIT(t_type, 1, pos, SIZE_MAX);
            update_pos(c, &line, &col);
            pos++;
            continue;
        }

        /* 3. 空白字符 */
        if(is_whitespace(c)) {
            FLUSH();
            update_pos(c, &line, &col);
            if(c == L'\r' && code[pos+1] == L'\n')
                update_pos(code[++pos], &line, &col);
            pos++;
            continue;
        }

        /* 4. 普通字符累积 */
        if(buf_start == -1) {
            buf_start = pos;
            buf_line = line;
            buf_col = col;
        }
        update_pos(c, &line, &col);
        pos++;
    }

    FLUSH();
    return tok_cnt;

#undef EMIT
#undef FLUSH
}

// 安全获取 token 文本（处理虚拟 token）
const wchar_t* token_text(am_token_t *tok, wchar_t *code) {
    static wchar_t buf[256];
    if(tok->index == SIZE_MAX) {
        // 虚拟 token
        if(tok->type == AM_TOKEN_TYPE_KEYWORD && tok->length == 5) return L"begin";
        return L"[virtual]";
    }
    // 真实 token
    int32_t len = tok->length < 255 ? tok->length : 255;
    wcsncpy(buf, &code[tok->index], len);
    buf[len] = L'\0';
    return buf;
}
