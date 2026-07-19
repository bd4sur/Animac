#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#include "module.h"
#include "object.h"
#include "allocator.h"
#include "ast.h"
#include "heap.h"
#include "vocab.h"
#include "list.h"
#include "map.h"

#define MODULE_MAGIC     "BD4SURAM"
#define MODULE_VERSION   (202607ULL)
#define MODULE_ALIGNMENT (8)

#define MODULE_ALIGN_UP(x) (((x) + MODULE_ALIGNMENT - 1) & ~(MODULE_ALIGNMENT - 1))

#pragma pack(push, 1)
typedef struct {
    char     magic[8];
    uint64_t version;
    uint64_t total_size;

    int32_t  base_type;
    uint32_t base_hash;
    uint32_t base_gcmark;
    uint64_t header;

    size_t   opstack_depth;
    am_iaddr_t ilcode_length;

    size_t   ilcode_offset;
    size_t   nodes_heap_offset;

    size_t   var_vocab_offset;
    size_t   symbol_vocab_offset;
    size_t   var_type_offset;
    size_t   natives_offset;
    size_t   dependencies_offset;
    size_t   scopes_offset;
    size_t   var_arn_mapping_offset;
    size_t   node_token_mapping_offset;
    size_t   lambda_handles_offset;
    size_t   tailcall_handles_offset;
    size_t   var_top_offset;
    size_t   strindex_offset;
} module_header_t;
#pragma pack(pop)

static void module_free_ast(am_allocator_t *container_alloc,
                            am_allocator_t *obj_alloc,
                            am_ast_t *ast,
                            int parts) {
    if (!ast) return;

    /* parts 用于区分哪些子对象已经加载成功；
     * 0 表示全部尝试释放，1 表示只释放已经加载的节点堆。 */
    if (parts == 0) {
        if (ast->var_vocab)        am_vocab_destroy(obj_alloc, ast->var_vocab);
        if (ast->symbol_vocab)     am_vocab_destroy(obj_alloc, ast->symbol_vocab);
        if (ast->var_type)         am_list_destroy(obj_alloc, ast->var_type);
        if (ast->natives)          am_map_destroy(obj_alloc, ast->natives);
        if (ast->dependencies)     am_map_destroy(obj_alloc, ast->dependencies);
        if (ast->scopes)           am_map_destroy(obj_alloc, ast->scopes);
        if (ast->var_arn_mapping)  am_map_destroy(obj_alloc, ast->var_arn_mapping);
        if (ast->node_token_mapping) am_map_destroy(obj_alloc, ast->node_token_mapping);
        if (ast->lambda_handles)   am_list_destroy(obj_alloc, ast->lambda_handles);
        if (ast->tailcall_handles) am_list_destroy(obj_alloc, ast->tailcall_handles);
        if (ast->var_top)          am_list_destroy(obj_alloc, ast->var_top);
        if (ast->strindex)         am_strindex_destroy(obj_alloc, ast->strindex);
    }

    if (ast->nodes) {
        am_heap_destroy(container_alloc, obj_alloc, ast->nodes);
    }

    am_free(container_alloc, ast);
}

size_t am_module_dump(am_allocator_t *container_alloc,
                      am_allocator_t *obj_alloc,
                      am_module_t *mod,
                      uint8_t *buffer,
                      size_t offset) {
    (void)container_alloc;
    (void)obj_alloc;

    if (!mod || !mod->ast || !mod->ilcode) {
        fprintf(stderr, "[module_dump] invalid module\n");
        return SIZE_MAX;
    }

    am_ast_t *ast = mod->ast;

    module_header_t hdr;
    memset(&hdr, 0, sizeof(hdr));
    memcpy(hdr.magic, MODULE_MAGIC, 8);
    hdr.version = MODULE_VERSION;
    hdr.base_type = mod->base.type;
    hdr.base_hash = mod->base.hash;
    hdr.base_gcmark = mod->base.gcmark;
    hdr.header = mod->header;
    hdr.opstack_depth = mod->opstack_depth;
    hdr.ilcode_length = mod->ilcode_length;

    size_t off = MODULE_ALIGN_UP(offset + sizeof(hdr));

    /* IL code */
    hdr.ilcode_offset = off - offset;
    size_t il_size = mod->ilcode_length * sizeof(am_instruction_t);
    off = MODULE_ALIGN_UP(off + il_size);

    /* AST nodes heap (deep dump) */
    hdr.nodes_heap_offset = off - offset;
    size_t nodes_size = am_heap_deep_dump(ast->alloc, ast->alloc, ast->nodes, NULL, 0);
    if (nodes_size == SIZE_MAX) {
        fprintf(stderr, "[module_dump] failed to compute nodes heap size\n");
        return SIZE_MAX;
    }
    off = MODULE_ALIGN_UP(off + nodes_size);

    /* symbol / variable vocabularies */
    if (ast->var_vocab) {
        hdr.var_vocab_offset = off - offset;
        size_t sz = am_vocab_dump(ast->alloc, ast->var_vocab, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->symbol_vocab) {
        hdr.symbol_vocab_offset = off - offset;
        size_t sz = am_vocab_dump(ast->alloc, ast->symbol_vocab, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }

    /* var_type list */
    if (ast->var_type) {
        hdr.var_type_offset = off - offset;
        size_t sz = am_list_dump(ast->alloc, ast->var_type, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }

    /* maps */
    if (ast->natives) {
        hdr.natives_offset = off - offset;
        size_t sz = am_map_dump(ast->alloc, ast->natives, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->dependencies) {
        hdr.dependencies_offset = off - offset;
        size_t sz = am_map_dump(ast->alloc, ast->dependencies, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->scopes) {
        hdr.scopes_offset = off - offset;
        size_t sz = am_map_dump(ast->alloc, ast->scopes, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->var_arn_mapping) {
        hdr.var_arn_mapping_offset = off - offset;
        size_t sz = am_map_dump(ast->alloc, ast->var_arn_mapping, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->node_token_mapping) {
        hdr.node_token_mapping_offset = off - offset;
        size_t sz = am_map_dump(ast->alloc, ast->node_token_mapping, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }

    /* lists */
    if (ast->lambda_handles) {
        hdr.lambda_handles_offset = off - offset;
        size_t sz = am_list_dump(ast->alloc, ast->lambda_handles, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->tailcall_handles) {
        hdr.tailcall_handles_offset = off - offset;
        size_t sz = am_list_dump(ast->alloc, ast->tailcall_handles, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }
    if (ast->var_top) {
        hdr.var_top_offset = off - offset;
        size_t sz = am_list_dump(ast->alloc, ast->var_top, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }

    /* strindex */
    if (ast->strindex) {
        hdr.strindex_offset = off - offset;
        size_t sz = am_strindex_dump(ast->alloc, ast->strindex, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off = MODULE_ALIGN_UP(off + sz);
    }

    hdr.total_size = off - offset;

    if (buffer != NULL && offset != SIZE_MAX) {
        memcpy(buffer + offset, &hdr, sizeof(hdr));

        memcpy(buffer + offset + hdr.ilcode_offset,
               mod->ilcode,
               il_size);

        size_t written = am_heap_deep_dump(ast->alloc, ast->alloc, ast->nodes,
                                           buffer, offset + hdr.nodes_heap_offset);
        if (written != nodes_size) {
            fprintf(stderr, "[module_dump] nodes heap dump size mismatch\n");
            return SIZE_MAX;
        }

        if (hdr.var_vocab_offset) {
            am_vocab_dump(ast->alloc, ast->var_vocab,
                          buffer, offset + hdr.var_vocab_offset);
        }
        if (hdr.symbol_vocab_offset) {
            am_vocab_dump(ast->alloc, ast->symbol_vocab,
                          buffer, offset + hdr.symbol_vocab_offset);
        }
        if (hdr.var_type_offset) {
            am_list_dump(ast->alloc, ast->var_type,
                         buffer, offset + hdr.var_type_offset);
        }
        if (hdr.natives_offset) {
            am_map_dump(ast->alloc, ast->natives,
                        buffer, offset + hdr.natives_offset);
        }
        if (hdr.dependencies_offset) {
            am_map_dump(ast->alloc, ast->dependencies,
                        buffer, offset + hdr.dependencies_offset);
        }
        if (hdr.scopes_offset) {
            am_map_dump(ast->alloc, ast->scopes,
                        buffer, offset + hdr.scopes_offset);
        }
        if (hdr.var_arn_mapping_offset) {
            am_map_dump(ast->alloc, ast->var_arn_mapping,
                        buffer, offset + hdr.var_arn_mapping_offset);
        }
        if (hdr.node_token_mapping_offset) {
            am_map_dump(ast->alloc, ast->node_token_mapping,
                        buffer, offset + hdr.node_token_mapping_offset);
        }
        if (hdr.lambda_handles_offset) {
            am_list_dump(ast->alloc, ast->lambda_handles,
                         buffer, offset + hdr.lambda_handles_offset);
        }
        if (hdr.tailcall_handles_offset) {
            am_list_dump(ast->alloc, ast->tailcall_handles,
                         buffer, offset + hdr.tailcall_handles_offset);
        }
        if (hdr.var_top_offset) {
            am_list_dump(ast->alloc, ast->var_top,
                         buffer, offset + hdr.var_top_offset);
        }
        if (hdr.strindex_offset) {
            am_strindex_dump(ast->alloc, ast->strindex,
                             buffer, offset + hdr.strindex_offset);
        }
    }

    return hdr.total_size;
}

am_module_t *am_module_load(am_allocator_t *container_alloc,
                            am_allocator_t *obj_alloc,
                            uint8_t *buffer,
                            size_t offset) {
    if (!container_alloc || !obj_alloc || !buffer) {
        fprintf(stderr, "[module_load] invalid arguments\n");
        return NULL;
    }

    module_header_t *hdr = (module_header_t *)(buffer + offset);
    if (memcmp(hdr->magic, MODULE_MAGIC, 8) != 0) {
        fprintf(stderr, "[module_load] bad magic\n");
        return NULL;
    }
    if (hdr->version != MODULE_VERSION) {
        fprintf(stderr, "[module_load] unsupported version %llu\n",
                (unsigned long long)hdr->version);
        return NULL;
    }

    am_module_t *mod = (am_module_t *)am_malloc(container_alloc, sizeof(am_module_t));
    if (!mod) {
        fprintf(stderr, "[module_load] failed to allocate module\n");
        return NULL;
    }

    mod->base.type = hdr->base_type;
    mod->base.hash = hdr->base_hash;
    mod->base.gcmark = hdr->base_gcmark;
    mod->header = hdr->header;
    mod->opstack_depth = hdr->opstack_depth;
    mod->ilcode_length = hdr->ilcode_length;

    mod->ilcode = (am_instruction_t *)am_malloc(container_alloc,
                                                mod->ilcode_length * sizeof(am_instruction_t));
    if (!mod->ilcode) {
        fprintf(stderr, "[module_load] failed to allocate ilcode\n");
        am_free(container_alloc, mod);
        return NULL;
    }
    memcpy(mod->ilcode,
           buffer + offset + hdr->ilcode_offset,
           mod->ilcode_length * sizeof(am_instruction_t));

    am_ast_t *ast = (am_ast_t *)am_malloc(container_alloc, sizeof(am_ast_t));
    if (!ast) {
        fprintf(stderr, "[module_load] failed to allocate ast\n");
        am_free(container_alloc, mod->ilcode);
        am_free(container_alloc, mod);
        return NULL;
    }
    memset(ast, 0, sizeof(am_ast_t));
    ast->alloc = obj_alloc;

    mod->ast = ast;

    if (hdr->nodes_heap_offset) {
        ast->nodes = am_heap_deep_load(container_alloc, obj_alloc,
                                       buffer, offset + hdr->nodes_heap_offset);
        if (!ast->nodes) {
            fprintf(stderr, "[module_load] failed to load nodes heap\n");
            goto fail;
        }
    }

    if (hdr->var_vocab_offset) {
        ast->var_vocab = am_vocab_load(obj_alloc, buffer,
                                       offset + hdr->var_vocab_offset);
        if (!ast->var_vocab) goto fail;
    }
    if (hdr->symbol_vocab_offset) {
        ast->symbol_vocab = am_vocab_load(obj_alloc, buffer,
                                          offset + hdr->symbol_vocab_offset);
        if (!ast->symbol_vocab) goto fail;
    }
    if (hdr->var_type_offset) {
        ast->var_type = am_list_load(obj_alloc, buffer,
                                     offset + hdr->var_type_offset);
        if (!ast->var_type) goto fail;
    }

    if (hdr->natives_offset) {
        ast->natives = am_map_load(obj_alloc, buffer,
                                   offset + hdr->natives_offset);
        if (!ast->natives) goto fail;
    }
    if (hdr->dependencies_offset) {
        ast->dependencies = am_map_load(obj_alloc, buffer,
                                        offset + hdr->dependencies_offset);
        if (!ast->dependencies) goto fail;
    }
    if (hdr->scopes_offset) {
        ast->scopes = am_map_load(obj_alloc, buffer,
                                  offset + hdr->scopes_offset);
        if (!ast->scopes) goto fail;
    }
    if (hdr->var_arn_mapping_offset) {
        ast->var_arn_mapping = am_map_load(obj_alloc, buffer,
                                           offset + hdr->var_arn_mapping_offset);
        if (!ast->var_arn_mapping) goto fail;
    }
    if (hdr->node_token_mapping_offset) {
        ast->node_token_mapping = am_map_load(obj_alloc, buffer,
                                              offset + hdr->node_token_mapping_offset);
        if (!ast->node_token_mapping) goto fail;
    }

    if (hdr->lambda_handles_offset) {
        ast->lambda_handles = am_list_load(obj_alloc, buffer,
                                           offset + hdr->lambda_handles_offset);
        if (!ast->lambda_handles) goto fail;
    }
    if (hdr->tailcall_handles_offset) {
        ast->tailcall_handles = am_list_load(obj_alloc, buffer,
                                             offset + hdr->tailcall_handles_offset);
        if (!ast->tailcall_handles) goto fail;
    }
    if (hdr->var_top_offset) {
        ast->var_top = am_list_load(obj_alloc, buffer,
                                    offset + hdr->var_top_offset);
        if (!ast->var_top) goto fail;
    }

    if (hdr->strindex_offset) {
        ast->strindex = am_strindex_load(obj_alloc, buffer,
                                         offset + hdr->strindex_offset);
        if (!ast->strindex) goto fail;
    }

    return mod;

fail:
    fprintf(stderr, "[module_load] failed to load AST sub-object\n");
    module_free_ast(container_alloc, obj_alloc, ast, 0);
    am_free(container_alloc, mod->ilcode);
    am_free(container_alloc, mod);
    return NULL;
}

// =============================================================
// PackBits 压缩/解压
// =============================================================

size_t am_packbits_compress(uint8_t *src, size_t src_len, uint8_t *dst) {
    if (!src) return SIZE_MAX;

    size_t i = 0;
    size_t out_pos = 0;

    while (i < src_len) {
        // 探测从当前位置开始的重复字节游程
        size_t run_end = i + 1;
        while (run_end < src_len &&
               src[run_end] == src[i] &&
               run_end - i < 128) {
            run_end++;
        }
        size_t run_len = run_end - i;

        // 重复 3 次及以上才编码为游程，否则并入字面量
        if (run_len >= 3) {
            if (dst) dst[out_pos] = (uint8_t)(257 - run_len);
            out_pos++;
            if (dst) dst[out_pos] = src[i];
            out_pos++;
            i = run_end;
        } else {
            // 编码字面量游程
            size_t lit_start = i;
            while (i < src_len) {
                // 遇到 3 个及以上重复字节时结束字面量
                if (i + 2 < src_len &&
                    src[i] == src[i + 1] &&
                    src[i] == src[i + 2]) {
                    break;
                }
                i++;
                if (i - lit_start >= 128) break;
            }
            size_t lit_len = i - lit_start;
            if (dst) dst[out_pos] = (uint8_t)(lit_len - 1);
            out_pos++;
            if (dst) memcpy(dst + out_pos, src + lit_start, lit_len);
            out_pos += lit_len;
        }
    }

    return out_pos;
}

size_t am_packbits_decompress(uint8_t *src, size_t src_len, uint8_t *dst) {
    if (!src) return SIZE_MAX;

    size_t i = 0;
    size_t out_pos = 0;

    while (i < src_len) {
        int8_t ctrl = (int8_t)src[i++];

        if (ctrl >= 0) {
            // 0..127：复制接下来的 ctrl+1 个字节
            size_t count = (size_t)ctrl + 1;
            if (i + count > src_len) return SIZE_MAX;
            if (dst) memcpy(dst + out_pos, src + i, count);
            out_pos += count;
            i += count;
        } else if (ctrl != -128) {
            // -127..-1：将下一个字节重复 -ctrl+1 次
            size_t count = (size_t)(-ctrl + 1);
            if (i >= src_len) return SIZE_MAX;
            if (dst) memset(dst + out_pos, src[i], count);
            out_pos += count;
            i++;
        }
        // ctrl == -128 为无操作
    }

    return out_pos;
}
