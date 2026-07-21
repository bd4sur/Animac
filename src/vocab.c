#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>
#include "object.h"
#include "allocator.h"
#include "vocab.h"
#include "diskio.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

static am_vocab_t *am_vocab_resize(am_allocator_t *alloc, am_vocab_t *vocab, size_t new_capacity) {
    if (new_capacity < vocab->length) new_capacity = vocab->length;

    size_t total_size = sizeof(am_vocab_t) + new_capacity * sizeof(wchar_t *);
    am_vocab_t *new_vocab = (am_vocab_t *)am_malloc(alloc, total_size);
    if (!new_vocab) return NULL;

    new_vocab->base = vocab->base;
    new_vocab->capacity = new_capacity;
    new_vocab->length = vocab->length;

    if (vocab->length > 0) {
        memcpy(new_vocab->words, vocab->words, vocab->length * sizeof(wchar_t *));
    }

    am_free(alloc, vocab);
    return new_vocab;
}


static am_vocab_t *am_vocab_grow_if_needed(am_allocator_t *alloc, am_vocab_t *vocab) {
    if (vocab->length < vocab->capacity) return vocab;

    size_t new_capacity = vocab->capacity * 2;
    if (new_capacity < 8) new_capacity = 8;
    return am_vocab_resize(alloc, vocab, new_capacity);
}


// ===============================================================================
// 构造函数
// ===============================================================================

am_vocab_t *am_vocab_create(am_allocator_t *alloc, size_t capacity) {
    if (capacity < 4) capacity = 4;

    size_t total_size = sizeof(am_vocab_t) + capacity * sizeof(wchar_t *);
    am_vocab_t *vocab = (am_vocab_t *)am_calloc(alloc, total_size);
    if (!vocab) return NULL;

    vocab->base.type = AM_OBJECT_TYPE_VOCAB;
    vocab->capacity = capacity;
    vocab->length = 0;

    return vocab;
}


// ===============================================================================
// 析构
// ===============================================================================

int32_t am_vocab_destroy(am_allocator_t *alloc, am_vocab_t *vocab) {
    if (!vocab) return 0;
    for (size_t i = 0; i < vocab->length; i++) {
        if (vocab->words[i]) am_free(alloc, vocab->words[i]);
    }
    am_free(alloc, vocab);
    return 0;
}


// ===============================================================================
// 拷贝
// ===============================================================================

am_vocab_t *am_vocab_copy(am_allocator_t *alloc, am_vocab_t *vocab) {
    if (!vocab) return NULL;

    am_vocab_t *copy = am_vocab_create(alloc, vocab->capacity);
    if (!copy) return NULL;

    copy->base = vocab->base;
    copy->length = vocab->length;

    for (size_t i = 0; i < vocab->length; i++) {
        size_t len = wcslen(vocab->words[i]);
        copy->words[i] = (wchar_t *)am_malloc(alloc, (len + 1) * sizeof(wchar_t));
        if (!copy->words[i]) {
            am_vocab_destroy(alloc, copy);
            return NULL;
        }
        wcscpy(copy->words[i], vocab->words[i]);
    }

    return copy;
}


// ===============================================================================
// 对象二进制转储
// ===============================================================================

// 功能说明：将词典对象序列化成二进制序列，并转储到buffer[offset]
// 实现说明：offset是写入buffer的起点offset。成功则返回向buffer新增字节数，失败则返回SIZE_MAX。
// 注意：若buffer设为NULL，或者offset设为SIZE_MAX，则仅计算转储后的二进制序列的字节数，不实际写入buffer。
//       将words所指向的wchar_t*宽字符串依次展平拼接，各字符串之间以L'\0'为间隔符，最后一个字符串以L'\0'结束。
//       压缩对象，将capacity压缩到跟length一致，删除多余分配的空闲部分。
// 磁盘格式（平台无关固定宽度，小端；详见 include/diskio.h）：
//   [16B] 对象基类头（type=AM_OBJECT_TYPE_VOCAB）
//   [uvarint] length（词条数；capacity 压缩为与 length 一致，不落盘）
//   [length * (uvarint 码点数, 码点0..n-1 各一个 uvarint)] 词条内容
//   说明：词条以 Unicode 码点序列存储，不使用平台相关的 wchar_t 宽度，
//         也不存储运行时指针（原实现会将 words[i] 绝对地址落盘，跨地址空间失效）。
size_t am_vocab_dump(am_allocator_t *alloc, am_vocab_t *vocab, uint8_t *buffer, size_t offset) {
    (void)alloc;
    if (!vocab) return SIZE_MAX;

    size_t pos = offset;
    if (buffer != NULL && offset != SIZE_MAX) {
        am_disk_write_base(buffer, pos, &vocab->base);
    }
    pos += AM_DISK_BASE_SIZE;
    pos += am_disk_write_uvarint(buffer, pos, (uint64_t)vocab->length);

    for (size_t i = 0; i < vocab->length; i++) {
        size_t len = wcslen(vocab->words[i]);
        pos += am_disk_write_uvarint(buffer, pos, (uint64_t)len);
        for (size_t j = 0; j < len; j++) {
            pos += am_disk_write_uvarint(buffer, pos, (uint64_t)(uint32_t)vocab->words[i][j]);
        }
    }

    return pos - offset;
}


// 功能说明：转储（dump）操作的逆操作。从二进制字节序列buffer[offset]开始，读取转储的词典对象，构造词典对象并返回其指针。
// 实现说明：offset是读取buffer的起点offset。成功则返回加载后am_vocab_t对象的指针，失败则返回NULL。
am_vocab_t *am_vocab_load(am_allocator_t *alloc, uint8_t *buffer, size_t offset) {
    if (!alloc || !buffer) return NULL;

    size_t pos = offset;
    am_object_t base;
    am_disk_read_base(buffer, pos, &base);
    pos += AM_DISK_BASE_SIZE;
    if (base.type != AM_OBJECT_TYPE_VOCAB) return NULL;

    uint64_t length = 0;
    size_t n;
    if (!(n = am_disk_read_uvarint(buffer, pos, &length))) return NULL;
    pos += n;
    if (length > (uint64_t)((SIZE_MAX - sizeof(am_vocab_t)) / sizeof(wchar_t *))) return NULL;

    // 本宿主 wchar_t 可表示的码点上界（16 位 wchar_t 平台不支持代理项）
    const uint64_t cp_max = (sizeof(wchar_t) >= 4) ? (uint64_t)0x10FFFF : (uint64_t)0xFFFF;

    am_vocab_t *vocab = am_vocab_create(alloc, (size_t)length);
    if (!vocab) return NULL;
    vocab->base = base;

    for (size_t i = 0; i < (size_t)length; i++) {
        uint64_t len = 0;
        if (!(n = am_disk_read_uvarint(buffer, pos, &len))) goto fail;
        pos += n;
        if (len > (uint64_t)(SIZE_MAX / sizeof(wchar_t)) - 1) goto fail;

        wchar_t *word = (wchar_t *)am_malloc(alloc, ((size_t)len + 1) * sizeof(wchar_t));
        if (!word) goto fail;

        int ok = 1;
        for (size_t j = 0; j < (size_t)len; j++) {
            uint64_t cp = 0;
            if (!(n = am_disk_read_uvarint(buffer, pos, &cp)) || cp > cp_max) {
                ok = 0;
                break;
            }
            pos += n;
            word[j] = (wchar_t)cp;
        }
        if (!ok) {
            am_free(alloc, word);
            goto fail;
        }
        word[(size_t)len] = L'\0';
        vocab->words[i] = word;
        vocab->length++;
    }

    return vocab;

fail:
    am_vocab_destroy(alloc, vocab);
    return NULL;
}


// ===============================================================================
// 基本操作
// ===============================================================================

size_t am_vocab_find(am_allocator_t *alloc, am_vocab_t *vocab, wchar_t *word) {
    (void)alloc;
    if (!vocab || !word) return SIZE_MAX;
    for (size_t i = 0; i < vocab->length; i++) {
        if (vocab->words[i] && wcscmp(vocab->words[i], word) == 0) {
            return i;
        }
    }
    return SIZE_MAX;
}


am_vocab_t *am_vocab_insert(am_allocator_t *alloc, am_vocab_t *vocab, wchar_t *word, size_t *out_index) {
    if (!vocab || !word) return NULL;
    if (out_index) *out_index = SIZE_MAX;

    size_t existing = am_vocab_find(alloc, vocab, word);
    if (existing != SIZE_MAX) {
        if (out_index) *out_index = existing;
        return vocab;
    }

    /* 先复制待插入的字符串：如果这里分配失败，不会破坏原 vocab。
     * 注意：必须在扩容前完成，因为 am_vocab_grow_if_needed 会释放旧 vocab。 */
    size_t len = wcslen(word);
    wchar_t *word_copy = (wchar_t *)am_malloc(alloc, (len + 1) * sizeof(wchar_t));
    if (!word_copy) return NULL;
    wcscpy(word_copy, word);

    am_vocab_t *new_vocab = am_vocab_grow_if_needed(alloc, vocab);
    if (!new_vocab) {
        am_free(alloc, word_copy);
        return NULL;
    }

    new_vocab->words[new_vocab->length] = word_copy;
    if (out_index) *out_index = new_vocab->length;
    new_vocab->length++;
    return new_vocab;
}


wchar_t *am_vocab_get(am_allocator_t *alloc, am_vocab_t *vocab, size_t *index) {
    (void)alloc;
    if (!vocab || !index || *index >= vocab->length) return NULL;
    return vocab->words[*index];
}
