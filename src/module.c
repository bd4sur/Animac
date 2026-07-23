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
#define MODULE_VERSION   ((uint32_t)202607u)

// flags 位定义：目前格式固定为小端序（bit0=0），其余位保留
#define MODULE_FLAGS_LITTLE_ENDIAN ((uint32_t)0u)

// 模块磁盘格式（平台无关固定宽度，小端；详见 include/object.h）。
// 头部为以下定宽字段的顺序拼接（所有多字节整数小端），总长 104 字节：
//   [8]  magic "BD4SURAM"
//   [u32] version
//   [u32] flags（bit0=0：小端）
//   [u32] total_size（模块转储总字节数）
//   [i32] base_type / [u32] base_hash / [u32] base_gcmark
//   [u64] header（保留元数据）
//   [u32] opstack_depth
//   [u32] ilcode_length（指令条数）
//   [u32] ilcode_offset
//   [u32] nodes_heap_offset
//   [u32] var_vocab_offset / symbol_vocab_offset / var_type_offset
//   [u32] natives_offset / dependencies_offset / scopes_offset
//   [u32] var_arn_mapping_offset / node_token_mapping_offset
//   [u32] lambda_handles_offset / tailcall_handles_offset / var_top_offset
//   [u32] strindex_offset
// 各区段在头部之后紧密排列（无对齐填充），偏移量相对于模块转储起点，0 表示该区段不存在。
// ilcode 区段：每条指令为 [u8 opcode, dvalue operand]。

typedef struct {
    uint32_t total_size;

    int32_t  base_type;
    uint32_t base_hash;
    uint32_t base_gcmark;
    uint64_t header;

    uint32_t opstack_depth;
    uint32_t ilcode_length;

    uint32_t ilcode_offset;
    uint32_t nodes_heap_offset;

    uint32_t var_vocab_offset;
    uint32_t symbol_vocab_offset;
    uint32_t var_type_offset;
    uint32_t natives_offset;
    uint32_t dependencies_offset;
    uint32_t scopes_offset;
    uint32_t var_arn_mapping_offset;
    uint32_t node_token_mapping_offset;
    uint32_t lambda_handles_offset;
    uint32_t tailcall_handles_offset;
    uint32_t var_top_offset;
    uint32_t strindex_offset;
} module_header_t;

#define MODULE_HEADER_DISK_SIZE (104)

// 将模块头写入 buffer（字段逐个小端写入，与宿主字节序/填充无关）
static void module_header_write(uint8_t *buffer, size_t offset, const module_header_t *hdr) {
    size_t pos = offset;
    memcpy(buffer + pos, MODULE_MAGIC, 8);            pos += 8;
    am_disk_write_u32(buffer, pos, MODULE_VERSION);   pos += 4;
    am_disk_write_u32(buffer, pos, MODULE_FLAGS_LITTLE_ENDIAN); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->total_size);  pos += 4;
    am_disk_write_u32(buffer, pos, (uint32_t)hdr->base_type);   pos += 4;
    am_disk_write_u32(buffer, pos, hdr->base_hash);   pos += 4;
    am_disk_write_u32(buffer, pos, hdr->base_gcmark); pos += 4;
    am_disk_write_u64(buffer, pos, hdr->header);      pos += 8;
    am_disk_write_u32(buffer, pos, hdr->opstack_depth);  pos += 4;
    am_disk_write_u32(buffer, pos, hdr->ilcode_length);  pos += 4;
    am_disk_write_u32(buffer, pos, hdr->ilcode_offset);  pos += 4;
    am_disk_write_u32(buffer, pos, hdr->nodes_heap_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->var_vocab_offset);  pos += 4;
    am_disk_write_u32(buffer, pos, hdr->symbol_vocab_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->var_type_offset);   pos += 4;
    am_disk_write_u32(buffer, pos, hdr->natives_offset);    pos += 4;
    am_disk_write_u32(buffer, pos, hdr->dependencies_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->scopes_offset);     pos += 4;
    am_disk_write_u32(buffer, pos, hdr->var_arn_mapping_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->node_token_mapping_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->lambda_handles_offset);  pos += 4;
    am_disk_write_u32(buffer, pos, hdr->tailcall_handles_offset); pos += 4;
    am_disk_write_u32(buffer, pos, hdr->var_top_offset);    pos += 4;
    am_disk_write_u32(buffer, pos, hdr->strindex_offset);   pos += 4;
}

// 从 buffer 读取模块头。成功返回 0，失败（magic/version/flags 不匹配）返回 -1。
static int32_t module_header_read(const uint8_t *buffer, size_t offset, module_header_t *hdr) {
    size_t pos = offset;
    if (memcmp(buffer + pos, MODULE_MAGIC, 8) != 0) {
        fprintf(stderr, "[module_load] bad magic\n");
        return -1;
    }
    pos += 8;
    uint32_t version = am_disk_read_u32(buffer, pos); pos += 4;
    if (version != MODULE_VERSION) {
        fprintf(stderr, "[module_load] unsupported version %u\n", version);
        return -1;
    }
    uint32_t flags = am_disk_read_u32(buffer, pos); pos += 4;
    if (flags != MODULE_FLAGS_LITTLE_ENDIAN) {
        fprintf(stderr, "[module_load] unsupported flags %u\n", flags);
        return -1;
    }

    hdr->total_size    = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->base_type     = (int32_t)am_disk_read_u32(buffer, pos); pos += 4;
    hdr->base_hash     = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->base_gcmark   = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->header        = am_disk_read_u64(buffer, pos); pos += 8;
    hdr->opstack_depth = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->ilcode_length = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->ilcode_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->nodes_heap_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->var_vocab_offset  = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->symbol_vocab_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->var_type_offset   = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->natives_offset    = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->dependencies_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->scopes_offset     = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->var_arn_mapping_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->node_token_mapping_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->lambda_handles_offset  = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->tailcall_handles_offset = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->var_top_offset    = am_disk_read_u32(buffer, pos); pos += 4;
    hdr->strindex_offset   = am_disk_read_u32(buffer, pos); pos += 4;
    return 0;
}

// 计算 ilcode 区段的磁盘字节数（每条指令：u8 opcode + dvalue operand）
static size_t module_ilcode_disk_size(am_module_t *mod) {
    size_t size = 0;
    for (am_iaddr_t i = 0; i < mod->ilcode_length; i++) {
        size += 1 + am_disk_value_size(mod->ilcode[i].operand);
    }
    return size;
}

// 转储 ilcode 区段。返回写入字节数。buffer 为 NULL 时仅计算字节数。
static size_t module_ilcode_dump(am_module_t *mod, uint8_t *buffer, size_t offset) {
    size_t pos = offset;
    for (am_iaddr_t i = 0; i < mod->ilcode_length; i++) {
        if (buffer) buffer[pos] = (uint8_t)mod->ilcode[i].opcode;
        pos += 1;
        pos += am_disk_write_value(buffer, pos, mod->ilcode[i].operand);
    }
    return pos - offset;
}

// 加载 ilcode 区段。成功返回 0，失败返回 -1。
static int32_t module_ilcode_load(am_module_t *mod, const uint8_t *buffer, size_t offset) {
    size_t pos = offset;
    for (am_iaddr_t i = 0; i < mod->ilcode_length; i++) {
        mod->ilcode[i].opcode = (uint32_t)buffer[pos];
        pos += 1;
        am_value_t operand = 0;
        size_t n = am_disk_read_value(buffer, pos, &operand);
        if (!n) return -1;
        pos += n;
        mod->ilcode[i].operand = operand;
    }
    return 0;
}

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

    if (mod->ilcode_length > UINT32_MAX || mod->opstack_depth > UINT32_MAX) {
        fprintf(stderr, "[module_dump] module too large\n");
        return SIZE_MAX;
    }

    module_header_t hdr;
    memset(&hdr, 0, sizeof(hdr));
    hdr.base_type = mod->base.type;
    hdr.base_hash = mod->base.hash;
    hdr.base_gcmark = mod->base.gcmark;
    hdr.header = mod->header;
    hdr.opstack_depth = (uint32_t)mod->opstack_depth;
    hdr.ilcode_length = (uint32_t)mod->ilcode_length;

    /* 各区段在头部之后紧密排列（无对齐填充，加载端全部按字节解码） */
    size_t off = offset + MODULE_HEADER_DISK_SIZE;

    /* IL code */
    hdr.ilcode_offset = (uint32_t)(off - offset);
    size_t il_size = module_ilcode_disk_size(mod);
    off += il_size;

    /* AST nodes heap (deep dump) */
    hdr.nodes_heap_offset = (uint32_t)(off - offset);
    size_t nodes_size = am_heap_deep_dump(ast->alloc, ast->alloc, ast->nodes, NULL, 0);
    if (nodes_size == SIZE_MAX) {
        fprintf(stderr, "[module_dump] failed to compute nodes heap size\n");
        return SIZE_MAX;
    }
    off += nodes_size;

    /* symbol / variable vocabularies */
    if (ast->var_vocab) {
        hdr.var_vocab_offset = (uint32_t)(off - offset);
        size_t sz = am_vocab_dump(ast->alloc, ast->var_vocab, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->symbol_vocab) {
        hdr.symbol_vocab_offset = (uint32_t)(off - offset);
        size_t sz = am_vocab_dump(ast->alloc, ast->symbol_vocab, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }

    /* var_type list */
    if (ast->var_type) {
        hdr.var_type_offset = (uint32_t)(off - offset);
        size_t sz = am_list_dump(ast->alloc, ast->var_type, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }

    /* maps */
    if (ast->natives) {
        hdr.natives_offset = (uint32_t)(off - offset);
        size_t sz = am_map_dump(ast->alloc, ast->natives, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->dependencies) {
        hdr.dependencies_offset = (uint32_t)(off - offset);
        size_t sz = am_map_dump(ast->alloc, ast->dependencies, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->scopes) {
        hdr.scopes_offset = (uint32_t)(off - offset);
        size_t sz = am_map_dump(ast->alloc, ast->scopes, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->var_arn_mapping) {
        hdr.var_arn_mapping_offset = (uint32_t)(off - offset);
        size_t sz = am_map_dump(ast->alloc, ast->var_arn_mapping, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->node_token_mapping) {
        hdr.node_token_mapping_offset = (uint32_t)(off - offset);
        size_t sz = am_map_dump(ast->alloc, ast->node_token_mapping, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }

    /* lists */
    if (ast->lambda_handles) {
        hdr.lambda_handles_offset = (uint32_t)(off - offset);
        size_t sz = am_list_dump(ast->alloc, ast->lambda_handles, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->tailcall_handles) {
        hdr.tailcall_handles_offset = (uint32_t)(off - offset);
        size_t sz = am_list_dump(ast->alloc, ast->tailcall_handles, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }
    if (ast->var_top) {
        hdr.var_top_offset = (uint32_t)(off - offset);
        size_t sz = am_list_dump(ast->alloc, ast->var_top, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }

    /* strindex */
    if (ast->strindex) {
        hdr.strindex_offset = (uint32_t)(off - offset);
        size_t sz = am_strindex_dump(ast->alloc, ast->strindex, NULL, 0);
        if (sz == SIZE_MAX) return SIZE_MAX;
        off += sz;
    }

    if (off - offset > UINT32_MAX) {
        fprintf(stderr, "[module_dump] module dump exceeds 4GiB\n");
        return SIZE_MAX;
    }
    hdr.total_size = (uint32_t)(off - offset);

    if (buffer != NULL && offset != SIZE_MAX) {
        module_header_write(buffer, offset, &hdr);

        size_t il_written = module_ilcode_dump(mod, buffer, offset + hdr.ilcode_offset);
        if (il_written != il_size) {
            fprintf(stderr, "[module_dump] ilcode dump size mismatch\n");
            return SIZE_MAX;
        }

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

    return (size_t)hdr.total_size;
}

am_module_t *am_module_load(am_allocator_t *container_alloc,
                            am_allocator_t *obj_alloc,
                            uint8_t *buffer,
                            size_t offset) {
    if (!container_alloc || !obj_alloc || !buffer) {
        fprintf(stderr, "[module_load] invalid arguments\n");
        return NULL;
    }

    module_header_t hdr_buf;
    module_header_t *hdr = &hdr_buf;
    if (module_header_read(buffer, offset, hdr) != 0) {
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

    if ((uint64_t)hdr->ilcode_length * (uint64_t)sizeof(am_instruction_t) > (uint64_t)SIZE_MAX) {
        fprintf(stderr, "[module_load] ilcode too large\n");
        am_free(container_alloc, mod);
        return NULL;
    }

    mod->ilcode = (am_instruction_t *)am_malloc(container_alloc,
                                                (size_t)mod->ilcode_length * sizeof(am_instruction_t));
    if (!mod->ilcode) {
        fprintf(stderr, "[module_load] failed to allocate ilcode\n");
        am_free(container_alloc, mod);
        return NULL;
    }
    if (module_ilcode_load(mod, buffer, offset + hdr->ilcode_offset) != 0) {
        fprintf(stderr, "[module_load] failed to decode ilcode\n");
        am_free(container_alloc, mod->ilcode);
        am_free(container_alloc, mod);
        return NULL;
    }

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
