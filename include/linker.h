#ifndef __AM_LINKER_H__
#define __AM_LINKER_H__

#ifdef __cplusplus
extern "C" {
#endif

#include <stddef.h>
#include <wchar.h>

#include "ast.h"


// 功能描述：链接器入口。从 main_ast 出发，递归解析所有依赖模块，按拓扑顺序合并成一个大 AST。
// 参数说明：main_ast 为引用根模块的 AST；base_dir 为基准工作目录（用于解析相对路径 import）。
// 返回值：  成功返回链接后的 AST（即基于 main_ast 修改后的 AST）；失败返回 NULL。
am_ast_t *am_link(am_ast_t *main_ast, wchar_t *base_dir);


// 前向声明：链接器上下文（opaque pointer）
struct am_linker_ctx_t;
typedef struct am_linker_ctx_t am_linker_ctx_t;


// 功能描述：对合并后的 AST 执行外部引用解析。
// 参数说明：merged_ast 为已完成模块合并的 AST。base_dir为搜索基准目录。
// 返回值：  成功返回 0；失败返回 -1。
int32_t am_linker_import_ref_resolution(am_ast_t *merged_ast, wchar_t *base_dir);


#ifdef __cplusplus
}
#endif

#endif
