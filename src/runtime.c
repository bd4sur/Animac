#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>
#include <time.h>
#include <math.h>
#include <stdbool.h>

#include "runtime.h"
#include "native.h"
#include "closure.h"
#include "continuation.h"
#include "list.h"
#include "wstring.h"
#include "heap.h"
#include "map.h"
#include "debug.h"


// ===============================================================================
// 内部辅助函数
// ===============================================================================

// 将数值 TPV 统一转换为浮点数
am_float_t am_runtime_number_to_float(am_value_t v) {
    if (am_value_is_float(v)) return am_value_to_float(v);
    if (am_value_is_int(v)) return (am_float_t)am_value_to_int(v);
    if (am_value_is_uint(v)) return (am_float_t)am_value_to_uint(v);
    return 0.0;
}

// 将数值 TPV 统一（强制）转换为int
am_int_t am_runtime_number_to_int(am_value_t v) {
    if (am_value_is_float(v)) return (am_int_t)am_value_to_float(v);
    if (am_value_is_int(v)) return am_value_to_int(v);
    if (am_value_is_uint(v)) return (am_int_t)am_value_to_uint(v);
    return 0;
}

// 将数值 TPV 统一（强制）转换为uint
am_int_t am_runtime_number_to_uint(am_value_t v) {
    if (am_value_is_float(v)) return (am_uint_t)am_value_to_float(v);
    if (am_value_is_int(v)) return (am_uint_t)am_value_to_int(v);
    if (am_value_is_uint(v)) return am_value_to_uint(v);
    return 0;
}


// 释放 FIFO 中保存的 wstring 对象并销毁列表
static void destroy_fifo(am_runtime_t *rt, am_list_t *fifo) {
    if (!fifo) return;
    for (size_t i = 0; i < fifo->length; i++) {
        am_value_t v = am_list_get(rt->vm_alloc, fifo, i);
        if (am_value_is_ptr(v)) {
            am_object_t *obj = am_value_to_ptr(v);
            if (obj && obj->type == AM_OBJECT_TYPE_WSTRING) {
                am_wstring_destroy(rt->vm_alloc, (am_wstring_t *)obj);
            }
        }
    }
    am_list_destroy(rt->vm_alloc, fifo);
}


// ===============================================================================
// 队列 IPC 内部辅助函数
// ===============================================================================

// 根据 ID 在队列列表中线性查找队列。
static am_queue_t *runtime_find_queue(am_runtime_t *rt, size_t queue_id) {
    if (!rt || !rt->queue_list) return NULL;
    for (size_t i = 0; i < rt->queue_list->length; i++) {
        am_value_t v = am_list_get(rt->vm_alloc, rt->queue_list, i);
        if (!am_value_is_ptr(v)) continue;
        am_queue_t *q = (am_queue_t *)am_value_to_ptr(v);
        if (q && q->id == queue_id) return q;
    }
    return NULL;
}


// 分配并初始化一个等待者节点。
static am_queue_waiter_t *runtime_queue_waiter_create(am_runtime_t *rt, am_pid_t pid,
                                                       am_value_t value,
                                                       am_timestamp_t deadline_ms,
                                                       bool is_writer) {
    if (!rt) return NULL;
    am_queue_waiter_t *w = (am_queue_waiter_t *)am_malloc(rt->vm_alloc, sizeof(am_queue_waiter_t));
    if (!w) return NULL;
    w->pid = pid;
    w->value = value;
    w->deadline_ms = deadline_ms;
    w->is_writer = is_writer;
    w->next = NULL;
    return w;
}


// 唤醒指定进程：将结果压入操作数栈、步进 PC、置为 READY 并入队。
static void runtime_queue_wake_process(am_runtime_t *rt, am_pid_t pid, am_value_t result) {
    if (!rt || pid >= rt->process_poll_counter) return;
    am_process_t *proc = rt->process_pool[pid];
    if (!proc) return;

    if (am_process_push_operand(proc, result) != 0) return;
    am_process_step(proc);
    am_process_set_state(proc, AM_PROCESS_STATE_READY);

    am_list_t *new_queue = am_list_push(rt->vm_alloc, rt->process_queue,
                                        am_make_value_of_uint((am_uint_t)pid));
    if (new_queue) rt->process_queue = new_queue;
}


// 扫描所有队列，将已超时的等待者唤醒。
static void runtime_queue_check_waiters(am_runtime_t *rt) {
    if (!rt || !rt->queue_list) return;

    am_timestamp_t now = am_runtime_now_ms();
    for (size_t i = 0; i < rt->queue_list->length; i++) {
        am_value_t qv = am_list_get(rt->vm_alloc, rt->queue_list, i);
        if (!am_value_is_ptr(qv)) continue;
        am_queue_t *q = (am_queue_t *)am_value_to_ptr(qv);
        if (!q) continue;

        am_queue_waiter_t **cur = &q->send_waiters;
        while (*cur) {
            am_queue_waiter_t *w = *cur;
            // 防御性检查：进程已被 kill，直接丢弃等待者而不唤醒
            am_process_t *wproc = am_runtime_get_process(rt, w->pid);
            if (wproc && wproc->state == AM_PROCESS_STATE_KILLED) {
                *cur = w->next;
                am_free(rt->vm_alloc, w);
                continue;
            }
            if (w->deadline_ms <= now) {
                *cur = w->next;
                runtime_queue_wake_process(rt, w->pid, AM_VALUE_FALSE);
                am_free(rt->vm_alloc, w);
            } else {
                cur = &w->next;
            }
        }

        cur = &q->recv_waiters;
        while (*cur) {
            am_queue_waiter_t *w = *cur;
            am_process_t *wproc = am_runtime_get_process(rt, w->pid);
            if (wproc && wproc->state == AM_PROCESS_STATE_KILLED) {
                *cur = w->next;
                am_free(rt->vm_alloc, w);
                continue;
            }
            if (w->deadline_ms <= now) {
                *cur = w->next;
                runtime_queue_wake_process(rt, w->pid, AM_VALUE_UNDEFINED);
                am_free(rt->vm_alloc, w);
            } else {
                cur = &w->next;
            }
        }
    }
}


// 判断当前是否还有阻塞等待者，并返回最近的超时时间。
static bool runtime_queue_has_waiters(am_runtime_t *rt, am_timestamp_t *nearest) {
    if (!rt || !rt->queue_list) return false;

    bool has = false;
    for (size_t i = 0; i < rt->queue_list->length; i++) {
        am_value_t qv = am_list_get(rt->vm_alloc, rt->queue_list, i);
        if (!am_value_is_ptr(qv)) continue;
        am_queue_t *q = (am_queue_t *)am_value_to_ptr(qv);
        if (!q) continue;

        for (am_queue_waiter_t *w = q->send_waiters; w; w = w->next) {
            if (nearest && (!has || w->deadline_ms < *nearest)) *nearest = w->deadline_ms;
            has = true;
        }
        for (am_queue_waiter_t *w = q->recv_waiters; w; w = w->next) {
            if (nearest && (!has || w->deadline_ms < *nearest)) *nearest = w->deadline_ms;
            has = true;
        }
    }
    return has;
}


am_queue_t *am_runtime_get_queue(am_runtime_t *rt, size_t queue_id) {
    return runtime_find_queue(rt, queue_id);
}


am_queue_t *am_runtime_queue_create(am_runtime_t *rt, size_t capacity) {
    if (!rt || capacity == 0) return NULL;

    am_queue_t *q = (am_queue_t *)am_malloc(rt->vm_alloc, sizeof(am_queue_t));
    if (!q) return NULL;

    q->id = rt->queue_next_id++;
    if (q->id == 0) q->id = rt->queue_next_id++; // 跳过 0
    q->capacity = capacity;
    q->items = am_list_create(rt->vm_alloc, capacity, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    q->send_waiters = NULL;
    q->recv_waiters = NULL;

    if (!q->items) {
        am_free(rt->vm_alloc, q);
        return NULL;
    }

    am_list_t *new_list = am_list_push(rt->vm_alloc, rt->queue_list,
                                       am_make_value_of_ptr((am_object_t *)q));
    if (!new_list) {
        am_list_destroy(rt->vm_alloc, q->items);
        am_free(rt->vm_alloc, q);
        return NULL;
    }
    rt->queue_list = new_list;
    return q;
}


int32_t am_runtime_queue_destroy(am_runtime_t *rt, am_queue_t *q) {
    if (!rt || !q) return 0;

    am_queue_waiter_t *w = q->send_waiters;
    while (w) {
        am_queue_waiter_t *next = w->next;
        am_free(rt->vm_alloc, w);
        w = next;
    }
    w = q->recv_waiters;
    while (w) {
        am_queue_waiter_t *next = w->next;
        am_free(rt->vm_alloc, w);
        w = next;
    }

    if (q->items) {
        am_list_destroy(rt->vm_alloc, q->items);
        q->items = NULL;
    }

    am_free(rt->vm_alloc, q);
    return 0;
}


int32_t am_runtime_queue_write(am_runtime_t *rt, am_queue_t *q, am_value_t value,
                               am_timestamp_t timeout_ms, am_process_t *proc) {
    if (!rt || !q || !proc) return -1;

    // 优先直接交给等待中的接收者
    if (q->recv_waiters) {
        am_queue_waiter_t *reader = q->recv_waiters;
        q->recv_waiters = reader->next;
        runtime_queue_wake_process(rt, reader->pid, value);
        am_free(rt->vm_alloc, reader);

        if (am_process_push_operand(proc, AM_VALUE_TRUE) != 0) return -1;
        am_process_step(proc);
        return 0;
    }

    // 队列未满，直接入队
    if (q->items->length < q->capacity) {
        am_list_t *new_items = am_list_push(rt->vm_alloc, q->items, value);
        if (!new_items) return -1;
        q->items = new_items;

        if (am_process_push_operand(proc, AM_VALUE_TRUE) != 0) return -1;
        am_process_step(proc);
        return 0;
    }

    // 队列已满：超时为 0 时立即失败
    if (timeout_ms == 0) {
        if (am_process_push_operand(proc, AM_VALUE_FALSE) != 0) return -1;
        am_process_step(proc);
        return 0;
    }

    // 阻塞当前发送者
    am_queue_waiter_t *w = runtime_queue_waiter_create(rt, proc->pid, value,
                                                         am_runtime_now_ms() + timeout_ms, true);
    if (!w) return -1;
    w->next = q->send_waiters;
    q->send_waiters = w;

    am_process_set_state(proc, AM_PROCESS_STATE_BLOCKED);
    return 0;
}


int32_t am_runtime_queue_read(am_runtime_t *rt, am_queue_t *q, am_timestamp_t timeout_ms,
                              am_process_t *proc) {
    if (!rt || !q || !proc) return -1;

    // 队列非空，直接出队
    if (q->items->length > 0) {
        am_value_t v = am_list_shift(rt->vm_alloc, q->items);

        // 若有等待中的发送者，现在腾出了空间，允许一个发送者入队
        if (q->send_waiters) {
            am_queue_waiter_t *writer = q->send_waiters;
            q->send_waiters = writer->next;

            am_list_t *new_items = am_list_push(rt->vm_alloc, q->items, writer->value);
            if (new_items) q->items = new_items;
            // 即使 push 失败，也已腾出一个位置，发送者仍视为成功
            runtime_queue_wake_process(rt, writer->pid, AM_VALUE_TRUE);
            am_free(rt->vm_alloc, writer);
        }

        if (am_process_push_operand(proc, v) != 0) return -1;
        am_process_step(proc);
        return 0;
    }

    // 队列空：超时为 0 时立即失败
    if (timeout_ms == 0) {
        if (am_process_push_operand(proc, AM_VALUE_UNDEFINED) != 0) return -1;
        am_process_step(proc);
        return 0;
    }

    // 阻塞当前接收者
    am_queue_waiter_t *w = runtime_queue_waiter_create(rt, proc->pid, AM_VALUE_UNDEFINED,
                                                         am_runtime_now_ms() + timeout_ms, false);
    if (!w) return -1;
    w->next = q->recv_waiters;
    q->recv_waiters = w;

    am_process_set_state(proc, AM_PROCESS_STATE_BLOCKED);
    return 0;
}


// 复制当前闭包的所有绑定到新闭包作为自由变量（用于 load/loadclosure/call）
// new_closure_hd 必须已绑定到一个新创建的 closure 对象。
static int32_t copy_current_closure_bindings_as_free_vars(am_process_t *proc, am_handle_t new_closure_hd) {
    am_obj_closure_t *current = am_process_get_current_closure(proc);
    am_obj_closure_t *new_closure = am_process_get_closure(proc, new_closure_hd);
    if (!new_closure) return -1;

    if (current) {
        for (size_t i = 0; i < current->length; i++) {
            am_binding_t *b = &current->bindings[i];
            new_closure = am_closure_init_free_var(proc->heap_alloc, new_closure, b->varid, b->value);
            if (!new_closure) return -1;
        }
        if (new_closure != am_process_get_closure(proc, new_closure_hd)) {
            am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, new_closure_hd,
                        am_make_value_of_ptr((am_object_t *)new_closure));
        }
    }
    return 0;
}


// 将值以人类可读形式输出到宽字符串缓冲区（简易实现）
static void value_to_wchar_buf(am_process_t *proc, am_value_t v, wchar_t *buf, size_t buf_size) {
    if (buf_size == 0) return;
    buf[0] = L'\0';

    if (am_value_is_handle(v)) {
        am_handle_t hd = am_value_to_handle(v);
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (am_value_is_ptr(obj_val)) {
            am_object_t *obj = am_value_to_ptr(obj_val);
            if (obj->type == AM_OBJECT_TYPE_WSTRING) {
                am_wstring_t *ws = (am_wstring_t *)obj;
                size_t n = ws->length;
                if (n >= buf_size) n = buf_size - 1;
                for (size_t i = 0; i < n; i++) {
                    buf[i] = (wchar_t)am_value_to_wchar(ws->content[i]);
                }
                buf[n] = L'\0';
                return;
            }
            else if (obj->type == AM_OBJECT_TYPE_LIST) {
                swprintf(buf, buf_size, L"#<list:%#x>", (uintptr_t)obj);
                return;
            }
            else if (obj->type == AM_OBJECT_TYPE_CLOSURE) {
                swprintf(buf, buf_size, L"#<closure:%#x>", (uintptr_t)obj);
                return;
            }
            else if (obj->type == AM_OBJECT_TYPE_CONTINUATION) {
                swprintf(buf, buf_size, L"#<continuation:%#x>", (uintptr_t)obj);
                return;
            }
        }
        swprintf(buf, buf_size, L"#<handle:%zu>", hd);
    }
    else if (am_value_is_float(v)) {
        swprintf(buf, buf_size, L"%g", (double)am_value_to_float(v));
    }
    else if (am_value_is_int(v)) {
        swprintf(buf, buf_size, L"%lld", (long long)am_value_to_int(v));
    }
    else if (am_value_is_uint(v)) {
        swprintf(buf, buf_size, L"%llu", (unsigned long long)am_value_to_uint(v));
    }
    else if (am_value_is_boolean(v)) {
        swprintf(buf, buf_size, L"%ls", am_value_to_boolean(v) ? L"#t" : L"#f");
    }
    else if (am_value_is_null(v)) {
        swprintf(buf, buf_size, L"#null");
    }
    else if (am_value_is_undefined(v)) {
        swprintf(buf, buf_size, L"#undefined");
    }
    else if (am_value_is_symbol(v)) {
        am_symbol_t sym = am_value_to_symbol(v);
        wchar_t *s = am_vocab_get(proc->vm_alloc, proc->symbol_vocab, &sym);
        if (!s) {
            swprintf(buf, buf_size, L"#<symbol>");
            return;
        }
        else {
            swprintf(buf, buf_size, L"%ls", s);
        }
    }
    else if (am_value_is_varid(v)) {
        am_varid_t vid = am_value_to_varid(v);
        wchar_t *s = am_vocab_get(proc->vm_alloc, proc->var_vocab, &vid);
        if (!s) {
            swprintf(buf, buf_size, L"#<varid:%zu>", vid);
            return;
        }
        else {
            swprintf(buf, buf_size, L"#<builtin:%ls>", s);
        }
    }
    // else {
    //     swprintf(buf, buf_size, L"#<value>");
    // }
}


// 递归比较两个值是否结构相等（用于 equal?）
static bool runtime_value_equal(am_process_t *proc, am_value_t a, am_value_t b) {
    if (a == b) return true;

    // 数字按数值比较
    if (am_value_is_number(a) && am_value_is_number(b)) {
        am_float_t fa = am_runtime_number_to_float(a);
        am_float_t fb = am_runtime_number_to_float(b);
        return fa == fb;
    }

    // 同为 handle 时按对象类型递归比较
    if (am_value_is_handle(a) && am_value_is_handle(b)) {
        am_handle_t ha = am_value_to_handle(a);
        am_handle_t hb = am_value_to_handle(b);
        am_value_t va = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, ha);
        am_value_t vb = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hb);
        if (!am_value_is_ptr(va) || !am_value_is_ptr(vb)) return false;

        am_object_t *oa = am_value_to_ptr(va);
        am_object_t *ob = am_value_to_ptr(vb);
        if (oa->type != ob->type) return false;

        if (oa->type == AM_OBJECT_TYPE_LIST) {
            am_list_t *la = (am_list_t *)oa;
            am_list_t *lb = (am_list_t *)ob;
            if (la->length != lb->length) return false;
            for (size_t i = 0; i < la->length; i++) {
                if (!runtime_value_equal(proc, la->children[i], lb->children[i])) return false;
            }
            return true;
        }

        if (oa->type == AM_OBJECT_TYPE_WSTRING) {
            am_wstring_t *wa = (am_wstring_t *)oa;
            am_wstring_t *wb = (am_wstring_t *)ob;
            if (wa->length != wb->length) return false;
            for (size_t i = 0; i < wa->length; i++) {
                if (wa->content[i] != wb->content[i]) return false;
            }
            return true;
        }
    }

    return false;
}


// ===============================================================================
// 第一类：基本存取指令
// ===============================================================================

static int32_t op_store(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_varid(operand)) return -1;

    am_varid_t varid = am_value_to_varid(operand);
    am_value_t value = am_process_pop_operand(proc);

    am_obj_closure_t *current = am_process_get_current_closure(proc);
    if (!current) return -1;

    am_obj_closure_t *new_current = am_closure_init_bound_var(proc->heap_alloc, current, varid, value);
    if (!new_current) return -1;
    if (new_current != current) {
        am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, proc->current_closure_handle,
                    am_make_value_of_ptr((am_object_t *)new_current));
    }

    am_process_step(proc);
    return 0;
}


static int32_t op_load(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_varid(operand)) return -1;

    am_varid_t varid = am_value_to_varid(operand);
    am_value_t value = am_process_dereference(proc, varid);
    if (value == (am_value_t)UINTPTR_MAX) {
        wchar_t *name = am_vocab_get(proc->vm_alloc, proc->var_vocab, &varid);
        wchar_t errmsg[256];
        swprintf(errmsg, 256, L"[Runtime] load: 变量 %ls 未定义\n", name ? name : L"?");
        am_runtime_error(rt, errmsg);
        return -1;
    }

    // 若值为 iaddr，说明是 lambda 标签解析后的地址，创建闭包
    if (am_value_is_iaddr(value)) {
        am_iaddr_t iaddr = am_value_to_iaddr(value);
        am_handle_t closure_hd = am_process_make_closure(proc, iaddr, proc->current_closure_handle);
        if (closure_hd == AM_HANDLE_NULL) return -1;
        if (copy_current_closure_bindings_as_free_vars(proc, closure_hd) != 0) return -1;
        am_process_push_operand(proc, am_make_value_of_handle(closure_hd));
    }
    else {
        am_process_push_operand(proc, value);
    }

    am_process_step(proc);
    return 0;
}


static int32_t op_loadclosure(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_iaddr(operand)) return -1;

    am_iaddr_t iaddr = am_value_to_iaddr(operand);
    am_handle_t closure_hd = am_process_make_closure(proc, iaddr, proc->current_closure_handle);
    if (closure_hd == AM_HANDLE_NULL) return -1;
    if (copy_current_closure_bindings_as_free_vars(proc, closure_hd) != 0) return -1;

    am_process_push_operand(proc, am_make_value_of_handle(closure_hd));
    am_process_step(proc);
    return 0;
}


static int32_t op_push(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (am_process_push_operand(proc, operand) != 0) return -1;
    am_process_step(proc);
    return 0;
}


static int32_t op_pop(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_process_pop_operand(proc);
    am_process_step(proc);
    return 0;
}


static int32_t op_swap(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t top1 = am_process_pop_operand(proc);
    am_value_t top2 = am_process_pop_operand(proc);
    if (top1 == (am_value_t)UINTPTR_MAX || top2 == (am_value_t)UINTPTR_MAX) return -1;
    am_process_push_operand(proc, top1);
    am_process_push_operand(proc, top2);
    am_process_step(proc);
    return 0;
}


static int32_t op_set(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_varid(operand)) return -1;

    am_varid_t varid = am_value_to_varid(operand);
    am_value_t right = am_process_pop_operand(proc);

    am_handle_t current_h = proc->current_closure_handle;
    am_obj_closure_t *current = am_process_get_current_closure(proc);
    if (!current) return -1;

    // 若当前闭包中存在该自由变量，则更新自由变量（带脏标记）
    if (am_closure_has_free_var(proc->heap_alloc, current, varid) == 0) {
        am_obj_closure_t *new_current = am_closure_set_free_var(proc->heap_alloc, current, varid, right);
        if (!new_current) return -1;
        if (new_current != current) {
            am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, current_h,
                        am_make_value_of_ptr((am_object_t *)new_current));
            current = new_current;
        }
    }

    // 沿闭包链上溯，找到约束变量定义位置并更新（带脏标记）
    am_handle_t h = current_h;
    while (h != AM_HANDLE_NULL) {
        am_obj_closure_t *closure = am_process_get_closure(proc, h);
        if (!closure) break;
        if (am_closure_has_bound_var(proc->heap_alloc, closure, varid) == 0) {
            am_obj_closure_t *new_closure = am_closure_set_bound_var(proc->heap_alloc, closure, varid, right);
            if (!new_closure) return -1;
            if (new_closure != closure) {
                am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, h,
                            am_make_value_of_ptr((am_object_t *)new_closure));
            }
            break;
        }
        h = closure->parent;
    }

    am_process_step(proc);
    return 0;
}


// ===============================================================================
// 第二类：分支跳转指令
// ===============================================================================

// 判断变量名是否对应 builtin 操作。
// 基于 AM_GLOBAL_BUILTIN_VAR 与 AM_BUILTIN_OPCODE_MAP：若变量名是 builtin 且映射opcode非 -1，则是 builtin。
static int32_t check_builtin_varid(am_process_t *proc, am_varid_t varid) {
    if (!proc || !proc->var_vocab) return -1;
    wchar_t *name = am_vocab_get(proc->vm_alloc, proc->var_vocab, &varid);
    if (!name) return -1;

    for (size_t i = 0; i < AM_GLOBAL_BUILTIN_VAR_NUM; i++) {
        if (wcscmp(name, AM_GLOBAL_BUILTIN_VAR[i]) == 0) {
            return AM_BUILTIN_OPCODE_MAP[i];
        }
    }
    return -1;
}

static int32_t op_callnative(am_runtime_t *rt, am_process_t *proc, am_value_t operand);

// 功能描述：检查call指令参数（已解析为varid）是否是本地宿主库的调用
// 是返回0，不是返回-1
int32_t am_runtime_check_native_ref(am_runtime_t *rt, am_process_t *proc, am_varid_t varid) {
    (void)rt;
    if (!proc || !proc->var_type) return -1;

    if ((size_t)varid >= proc->var_type->length) return -1;

    am_value_t type_val = am_list_get(proc->vm_alloc, proc->var_type, (size_t)varid);
    if (!am_value_is_uint(type_val)) return -1;

    return (am_value_to_uint(type_val) == (am_uint_t)AM_VAR_TYPE_NATIVE_REF) ? 0 : -1;
}


// ===============================================================================
// dynamic-wind 内部辅助函数
// ===============================================================================

// 创建 dynamic-wind 条目：[before_handle, after_handle, mark_value, saved_value, opstack_base]
// opstack_base 记录进入 dynamic-wind 时 opstack 的长度，用于判断 before/thunk/after 是否压入返回值。
// 条目本身为 AM_OBJECT_TYPE_LIST 对象，绑定到 proc->heap。成功返回 handle，失败返回 AM_HANDLE_NULL。
static am_handle_t dynamic_wind_create_entry(am_process_t *proc, am_handle_t before, am_handle_t after, am_uint_t mark, size_t opstack_base) {
    if (!proc || !proc->heap || !proc->heap_alloc) return AM_HANDLE_NULL;

    am_list_t *entry = am_list_create(proc->heap_alloc, 5, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!entry) return AM_HANDLE_NULL;

    entry->children[0] = am_make_value_of_handle(before);
    entry->children[1] = am_make_value_of_handle(after);
    entry->children[2] = am_make_value_of_uint(mark);
    entry->children[3] = AM_VALUE_UNDEFINED;
    entry->children[4] = am_make_value_of_uint((am_uint_t)opstack_base);
    entry->length = 5;

    am_handle_t hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (hd == AM_HANDLE_NULL) {
        am_list_destroy(proc->heap_alloc, entry);
        return AM_HANDLE_NULL;
    }

    am_value_t entry_value = am_make_value_of_ptr((am_object_t *)entry);
    if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, hd, entry_value) != 0) {
        am_list_destroy(proc->heap_alloc, entry);
        am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        return AM_HANDLE_NULL;
    }

    return hd;
}

static am_list_t *dynamic_wind_get_entry(am_process_t *proc, am_handle_t entry_hd) {
    if (!proc || !proc->heap || entry_hd == AM_HANDLE_NULL) return NULL;
    am_value_t v = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, entry_hd);
    if (!am_value_is_ptr(v)) return NULL;
    am_object_t *obj = am_value_to_ptr(v);
    if (!obj || obj->type != AM_OBJECT_TYPE_LIST) return NULL;
    return (am_list_t *)obj;
}

static inline am_handle_t dynamic_wind_entry_before(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_HANDLE_NULL;
    return am_value_to_handle(entry->children[0]);
}

static inline am_handle_t dynamic_wind_entry_after(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_HANDLE_NULL;
    return am_value_to_handle(entry->children[1]);
}

static inline am_value_t dynamic_wind_entry_saved(am_list_t *entry) {
    if (!entry || entry->length < 4) return AM_VALUE_UNDEFINED;
    return entry->children[3];
}

static inline void dynamic_wind_entry_set_saved(am_list_t *entry, am_value_t v) {
    if (!entry || entry->length < 4) return;
    entry->children[3] = v;
}

static inline size_t dynamic_wind_entry_base(am_list_t *entry) {
    if (!entry || entry->length < 5) return 0;
    return (size_t)am_value_to_uint(entry->children[4]);
}

// 调用一个闭包 handle，返回地址为 return_iaddr
static int32_t dynamic_wind_call_closure(am_runtime_t *rt, am_process_t *proc, am_handle_t closure_handle, am_iaddr_t return_iaddr) {
    (void)rt;
    if (!proc) return -1;

    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, closure_handle);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (!obj || obj->type != AM_OBJECT_TYPE_CLOSURE) return -1;
    am_obj_closure_t *closure = (am_obj_closure_t *)obj;

    am_value_t closure_val = am_make_value_of_handle(proc->current_closure_handle);
    am_value_t ret_val = am_make_value_of_iaddr(return_iaddr);
    if (am_process_push_stack_frame(proc, closure_val, ret_val) != 0) return -1;

    am_process_set_current_closure(proc, closure_handle);
    am_process_goto(proc, closure->iaddr);
    return 0;
}

// 将 entry handle 压入 proc->dynamic_wind_stack
static int32_t dynamic_wind_stack_push(am_process_t *proc, am_handle_t entry_hd) {
    if (!proc || !proc->dynamic_wind_stack) return -1;
    am_list_t *lst = am_list_push(proc->vm_alloc, proc->dynamic_wind_stack, am_make_value_of_handle(entry_hd));
    if (!lst) return -1;
    proc->dynamic_wind_stack = lst;
    return 0;
}

// 从 proc->dynamic_wind_stack 弹出 entry handle
static am_handle_t dynamic_wind_stack_pop(am_process_t *proc) {
    if (!proc || !proc->dynamic_wind_stack || proc->dynamic_wind_stack->length == 0) return AM_HANDLE_NULL;
    return am_value_to_handle(am_list_pop(proc->vm_alloc, proc->dynamic_wind_stack));
}


// call / tailcall 的共享实现。return_target 为 SIZE_MAX 表示尾调用不压栈帧。
static int32_t op_call_async(am_runtime_t *rt, am_process_t *proc, am_value_t operand, am_iaddr_t return_target) {
    (void)rt;

    am_value_t target;
    if (am_value_is_varid(operand)) {
        am_varid_t varid = am_value_to_varid(operand);
        // 判断 native 调用
        if (am_runtime_check_native_ref(rt, proc, varid) == 0) {
            return op_callnative(rt, proc, operand);
        }
        else {
            target = am_process_dereference(proc, varid);
            if (target == (am_value_t)UINTPTR_MAX) {
                wchar_t *name = am_vocab_get(proc->vm_alloc, proc->var_vocab, &varid);
                wchar_t errmsg[256];
                swprintf(errmsg, 256, L"[Runtime] call: 变量 %ls 未定义\n", name ? name : L"?");
                am_runtime_error(rt, errmsg);
                return -1;
            }
        }
    }
    else {
        target = operand;
    }

    // iaddr：直接调用 lambda
    if (am_value_is_iaddr(target)) {
        am_iaddr_t iaddr = am_value_to_iaddr(target);

        if (return_target != SIZE_MAX) {
            am_value_t closure_val = am_make_value_of_handle(proc->current_closure_handle);
            am_value_t ret_val = am_make_value_of_iaddr(return_target);
            if (am_process_push_stack_frame(proc, closure_val, ret_val) != 0) return -1;
        }
        else {
            // 尾调用优化：若目标与当前闭包地址相同，复用当前闭包
            am_obj_closure_t *cur = am_process_get_current_closure(proc);
            if (cur && cur->iaddr == iaddr) {
                am_process_goto(proc, iaddr);
                return 0;
            }
        }

        am_handle_t closure_hd = am_process_make_closure(proc, iaddr, proc->current_closure_handle);
        if (closure_hd == AM_HANDLE_NULL) return -1;
        if (copy_current_closure_bindings_as_free_vars(proc, closure_hd) != 0) return -1;

        am_process_set_current_closure(proc, closure_hd);
        am_process_goto(proc, iaddr);
        return 0;
    }

    // handle：闭包或 continuation
    if (am_value_is_handle(target)) {
        am_handle_t hd = am_value_to_handle(target);
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (!am_value_is_ptr(obj_val)) return -1;
        am_object_t *obj = am_value_to_ptr(obj_val);

        if (obj->type == AM_OBJECT_TYPE_CLOSURE) {
            am_obj_closure_t *closure = (am_obj_closure_t *)obj;
            if (return_target != SIZE_MAX) {
                am_value_t closure_val = am_make_value_of_handle(proc->current_closure_handle);
                am_value_t ret_val = am_make_value_of_iaddr(return_target);
                if (am_process_push_stack_frame(proc, closure_val, ret_val) != 0) return -1;
            }
            am_process_set_current_closure(proc, hd);
            am_process_goto(proc, closure->iaddr);
            return 0;
        }
        else if (obj->type == AM_OBJECT_TYPE_CONTINUATION) {
            if (return_target != SIZE_MAX) {
                am_value_t closure_val = am_make_value_of_handle(proc->current_closure_handle);
                am_value_t ret_val = am_make_value_of_iaddr(return_target);
                if (am_process_push_stack_frame(proc, closure_val, ret_val) != 0) return -1;
            }
            am_value_t top = am_process_pop_operand(proc);
            am_iaddr_t cont_target = am_process_load_continuation(proc, hd, top);
            if (cont_target == SIZE_MAX) return -1;
            am_process_goto(proc, cont_target);
            return 0;
        }
        else {
            am_runtime_error(rt, L"[Runtime] call: 目标对象类型错误\n");
            return -1;
        }
    }

    if (am_value_is_varid(target)) {
        int32_t opcode = check_builtin_varid(proc, am_value_to_varid(target));
        if (opcode >= 0)
            return am_runtime_op_dispatch(rt, proc, (uint32_t)opcode, operand);
    }

    am_runtime_error(rt, L"[Runtime] call: 错误的调用目标\n");

    return -1;
}


static int32_t op_call(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    return op_call_async(rt, proc, operand, proc->PC + 1);
}


static int32_t op_tailcall(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    return op_call_async(rt, proc, operand, SIZE_MAX);
}


static int32_t op_callnative(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!proc || !proc->var_vocab) return -1;
    if (!am_value_is_varid(operand)) return -1;

    am_varid_t varid = am_value_to_varid(operand);
    size_t idx = (size_t)varid;
    wchar_t *name = am_vocab_get(proc->vm_alloc, proc->var_vocab, &idx);
    if (!name) return -1;

    // 变量名应为 "LibID.funcName" 形式，且只能有一个点号
    wchar_t *dot = wcschr(name, L'.');
    if (!dot || dot == name || dot[1] == L'\0') {
        am_runtime_error(rt, L"[Runtime] callnative: 错误的native变量名\n");
        return -1;
    }
    if (wcschr(dot + 1, L'.')) {
        am_runtime_error(rt, L"[Runtime] callnative: native变量名包含多个点号\n");
        return -1;
    }

    size_t len = wcslen(name);
    wchar_t *buf = (wchar_t *)am_malloc(proc->vm_alloc, (len + 1) * sizeof(wchar_t));
    if (!buf) return -1;
    wcscpy(buf, name);

    wchar_t *prefix = buf;
    wchar_t *suffix = buf + (dot - name);
    *suffix = L'\0';
    suffix++;

    am_native_func_t func = am_native_find_func(prefix, suffix);
    if (!func) {
        wchar_t errmsg[256];
        swprintf(errmsg, 256, L"[Runtime] callnative: 未找到native函数 %ls.%ls\n", prefix, suffix);
        am_runtime_error(rt, errmsg);
        am_free(proc->vm_alloc, buf);
        return -1;
    }
    am_free(proc->vm_alloc, buf);

    return func(rt, proc);
}


static int32_t op_return(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t closure_val, ret_val;
    if (am_process_pop_stack_frame(proc, &closure_val, &ret_val) != 0) {
        am_runtime_error(rt, L"[Runtime] return: 函数调用栈为空\n");
        return -1;
    }

    am_process_set_current_closure(proc, am_value_to_handle(closure_val));
    am_process_goto(proc, am_value_to_iaddr(ret_val));
    return 0;
}


static int32_t op_capturecc(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_varid(operand)) return -1;

    am_varid_t varid = am_value_to_varid(operand);
    // 续体返回目标：capturecc 之后固定有 load 和 call 两条指令，返回点位于 PC+3
    am_iaddr_t ret_target = proc->PC + 3;

    am_handle_t cont_hd = am_process_capture_continuation(proc, ret_target);
    if (cont_hd == AM_HANDLE_NULL) return -1;

    am_obj_closure_t *current = am_process_get_current_closure(proc);
    if (!current) return -1;
    am_obj_closure_t *new_current = am_closure_init_bound_var(
        proc->heap_alloc, current, varid, am_make_value_of_handle(cont_hd));
    if (!new_current) return -1;
    if (new_current != current) {
        am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, proc->current_closure_handle,
                    am_make_value_of_ptr((am_object_t *)new_current));
    }

    am_process_step(proc);
    return 0;
}


// dynamic-wind 第一阶段：opstack 上有 [..., before, thunk, after]
// 创建条目，暂存 entry/thunk，调用 before
static int32_t op_dynamicwind(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt; (void)operand;
    if (!proc) return -1;

    am_value_t after_val = am_process_pop_operand(proc);
    am_value_t thunk_val = am_process_pop_operand(proc);
    am_value_t before_val = am_process_pop_operand(proc);

    if (!am_value_is_handle(before_val) || !am_value_is_handle(thunk_val) || !am_value_is_handle(after_val)) {
        am_runtime_error(rt, L"[Runtime] dynamic-wind: 参数必须是闭包\n");
        return -1;
    }

    am_handle_t before_hd = am_value_to_handle(before_val);
    am_handle_t thunk_hd = am_value_to_handle(thunk_val);
    am_handle_t after_hd = am_value_to_handle(after_val);

    if (!am_process_get_closure(proc, before_hd) || !am_process_get_closure(proc, thunk_hd) || !am_process_get_closure(proc, after_hd)) {
        am_runtime_error(rt, L"[Runtime] dynamic-wind: 参数必须是闭包\n");
        return -1;
    }

    size_t opstack_base = am_process_length_of_opstack(proc);
    am_uint_t mark = (am_uint_t)proc->dynamic_wind_mark_counter++;
    am_handle_t entry_hd = dynamic_wind_create_entry(proc, before_hd, after_hd, mark, opstack_base);
    if (entry_hd == AM_HANDLE_NULL) return -1;

    proc->current_dynamic_wind_entry = entry_hd;
    proc->current_dynamic_wind_thunk = thunk_hd;

    return dynamic_wind_call_closure(rt, proc, before_hd, proc->PC + 1);
}


// 辅助：将 opstack 恢复到指定长度（弹出多余部分），返回最后弹出的值（若无则返回 AM_VALUE_UNDEFINED）
static am_value_t dynamic_wind_trim_opstack_to_base(am_process_t *proc, size_t base) {
    size_t current_len = am_process_length_of_opstack(proc);
    am_value_t last = AM_VALUE_UNDEFINED;
    while (current_len > base) {
        last = am_process_pop_operand(proc);
        current_len--;
    }
    return last;
}


// dynamic-wind 第二阶段：before 已返回
// 丢弃 before 返回值（若有），将条目压入 dynamic_wind_stack，调用 thunk
static int32_t op_dynamicwind_after_before(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt; (void)operand;
    if (!proc) return -1;

    am_handle_t entry_hd = proc->current_dynamic_wind_entry;

    if (entry_hd == AM_HANDLE_NULL) {
        am_runtime_error(rt, L"[Runtime] dynamicwind_after_before: 无当前条目\n");
        return -1;
    }

    am_list_t *entry = dynamic_wind_get_entry(proc, entry_hd);
    if (!entry) return -1;
    size_t opstack_base = dynamic_wind_entry_base(entry);

    // 丢弃 before 的返回值（0 个或 1 个）
    dynamic_wind_trim_opstack_to_base(proc, opstack_base);

    proc->current_dynamic_wind_entry = AM_HANDLE_NULL;

    if (dynamic_wind_stack_push(proc, entry_hd) != 0) return -1;

    am_handle_t thunk_hd = proc->current_dynamic_wind_thunk;
    if (thunk_hd == AM_HANDLE_NULL) {
        am_runtime_error(rt, L"[Runtime] dynamicwind_after_before: 无当前 thunk\n");
        return -1;
    }

    return dynamic_wind_call_closure(rt, proc, thunk_hd, proc->PC + 1);
}


// dynamic-wind 第三阶段：thunk 已返回
// 保存返回值（若有），弹出 dynamic_wind_stack 条目，将条目 handle 压入 dynamic_wind_after_stack，调用 after
static int32_t op_dynamicwind_before_after(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt; (void)operand;
    if (!proc) return -1;

    am_handle_t entry_hd = dynamic_wind_stack_pop(proc);
    if (entry_hd == AM_HANDLE_NULL) {
        am_runtime_error(rt, L"[Runtime] dynamicwind_before_after: dynamic_wind_stack 为空\n");
        return -1;
    }

    am_list_t *entry = dynamic_wind_get_entry(proc, entry_hd);
    if (!entry) return -1;
    size_t opstack_base = dynamic_wind_entry_base(entry);

    // thunk 的返回值：若 thunk 压入了返回值，则弹出并保存；否则保存 AM_VALUE_UNDEFINED
    am_value_t thunk_result = dynamic_wind_trim_opstack_to_base(proc, opstack_base);
    dynamic_wind_entry_set_saved(entry, thunk_result);

    // 将条目 handle 压入 dynamic_wind_after_stack，供 dynamicwind_done 取回 saved_value
    am_list_t *after_stack = am_list_push(proc->vm_alloc, proc->dynamic_wind_after_stack,
                                          am_make_value_of_handle(entry_hd));
    if (!after_stack) return -1;
    proc->dynamic_wind_after_stack = after_stack;

    proc->current_dynamic_wind_thunk = AM_HANDLE_NULL;

    am_handle_t after_hd = dynamic_wind_entry_after(entry);
    if (after_hd == AM_HANDLE_NULL) return -1;

    return dynamic_wind_call_closure(rt, proc, after_hd, proc->PC + 1);
}


// dynamic-wind 第四阶段：after 已返回
// 丢弃 after 返回值（若有），从 dynamic_wind_after_stack 弹出条目，将 saved_value 压回 opstack，继续执行
static int32_t op_dynamicwind_done(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt; (void)operand;
    if (!proc) return -1;

    if (!proc->dynamic_wind_after_stack || proc->dynamic_wind_after_stack->length == 0) {
        am_runtime_error(rt, L"[Runtime] dynamicwind_done: dynamic_wind_after_stack 为空\n");
        return -1;
    }

    am_handle_t entry_hd = am_value_to_handle(
        am_list_pop(proc->vm_alloc, proc->dynamic_wind_after_stack));

    am_list_t *entry = dynamic_wind_get_entry(proc, entry_hd);
    if (!entry) return -1;
    size_t opstack_base = dynamic_wind_entry_base(entry);

    // 丢弃 after 的返回值（0 个或 1 个）
    dynamic_wind_trim_opstack_to_base(proc, opstack_base);

    am_value_t saved = dynamic_wind_entry_saved(entry);
    if (am_process_push_operand(proc, saved) != 0) return -1;

    am_process_step(proc);
    return 0;
}


// wind 跳板：continuation 恢复前执行 afters / befores
static int32_t op_wind(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt; (void)operand;
    if (!proc) return -1;

    switch (proc->wind_state) {
        case 1: { // 执行 afters（从内到外）
            if (proc->pending_after_count > 0) {
                am_handle_t entry_hd = proc->pending_after_entries[--proc->pending_after_count];
                // 验证条目在 dynamic_wind_stack 栈顶
                am_handle_t top_hd = proc->dynamic_wind_stack && proc->dynamic_wind_stack->length > 0
                    ? am_value_to_handle(proc->dynamic_wind_stack->children[proc->dynamic_wind_stack->length - 1])
                    : AM_HANDLE_NULL;
                if (top_hd != entry_hd) {
                    am_runtime_error(rt, L"[Runtime] op_wind: after 条目与栈顶不一致\n");
                    return -1;
                }
                dynamic_wind_stack_pop(proc);

                am_list_t *entry = dynamic_wind_get_entry(proc, entry_hd);
                if (!entry) return -1;
                am_handle_t after_hd = dynamic_wind_entry_after(entry);
                if (after_hd == AM_HANDLE_NULL) return -1;

                return dynamic_wind_call_closure(rt, proc, after_hd, proc->wind_trampoline_iaddr);
            }
            // afters 执行完毕，转入 befores
            proc->wind_state = 2;
            // 不推进 PC，下一条 tick 继续执行本指令的 state 2 分支
            return 0;
        }
        case 2: { // 执行 befores（从外到内）
            if (proc->pending_before_count > 0) {
                am_handle_t entry_hd = proc->pending_before_entries[0];
                // 将 pending_before_entries 前移
                for (size_t i = 1; i < proc->pending_before_count; i++) {
                    proc->pending_before_entries[i - 1] = proc->pending_before_entries[i];
                }
                proc->pending_before_count--;

                if (dynamic_wind_stack_push(proc, entry_hd) != 0) return -1;

                am_list_t *entry = dynamic_wind_get_entry(proc, entry_hd);
                if (!entry) return -1;
                am_handle_t before_hd = dynamic_wind_entry_before(entry);
                if (before_hd == AM_HANDLE_NULL) return -1;

                return dynamic_wind_call_closure(rt, proc, before_hd, proc->wind_trampoline_iaddr);
            }
            // befores 执行完毕，转入恢复续体
            proc->wind_state = 3;
            // 不推进 PC，下一条 tick 继续执行本指令的 state 3 分支
            return 0;
        }
        case 3: { // 真正恢复续体
            am_handle_t cont_hd = proc->pending_cont_handle;
            am_value_t value = proc->pending_cont_value;

            am_iaddr_t cont_target = am_process_restore_continuation_snapshot(proc, cont_hd);
            if (cont_target == SIZE_MAX) return -1;

            if (am_process_push_operand(proc, value) != 0) return -1;

            // 清空 wind 状态
            proc->wind_state = 0;
            proc->pending_cont_handle = AM_HANDLE_NULL;
            proc->pending_cont_value = AM_VALUE_UNDEFINED;
            if (proc->pending_after_entries) {
                am_free(proc->vm_alloc, proc->pending_after_entries);
                proc->pending_after_entries = NULL;
            }
            proc->pending_after_count = 0;
            if (proc->pending_before_entries) {
                am_free(proc->vm_alloc, proc->pending_before_entries);
                proc->pending_before_entries = NULL;
            }
            proc->pending_before_count = 0;

            am_process_goto(proc, cont_target);
            return 0;
        }
        default: {
            am_runtime_error(rt, L"[Runtime] op_wind: 非法 wind_state\n");
            return -1;
        }
    }
}


static int32_t op_iftrue(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_iaddr(operand)) return -1;

    am_value_t condition = am_process_pop_operand(proc);
    if (condition != AM_VALUE_FALSE) {
        am_process_goto(proc, am_value_to_iaddr(operand));
    }
    else {
        am_process_step(proc);
    }
    return 0;
}


static int32_t op_iffalse(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_iaddr(operand)) return -1;

    am_value_t condition = am_process_pop_operand(proc);
    if (condition == AM_VALUE_FALSE) {
        am_process_goto(proc, am_value_to_iaddr(operand));
    }
    else {
        am_process_step(proc);
    }
    return 0;
}


static int32_t op_goto(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!am_value_is_iaddr(operand)) return -1;
    am_process_goto(proc, am_value_to_iaddr(operand));
    return 0;
}


// ===============================================================================
// 第三类：列表操作指令
// ===============================================================================

static int32_t op_car(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->length == 0) return -1;

    am_process_push_operand(proc, lst->children[0]);
    am_process_step(proc);
    return 0;
}


static int32_t op_cdr(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    if (lst->length == 0) return -1;

    am_list_t *new_lst = am_list_create(proc->heap_alloc, lst->length, lst->type, list_hd);
    if (!new_lst) return -1;

    for (size_t i = 1; i < lst->length; i++) {
        new_lst = am_list_push(proc->heap_alloc, new_lst, lst->children[i]);
        if (!new_lst) return -1;
    }

    am_handle_t new_hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (new_hd == AM_HANDLE_NULL) {
        am_list_destroy(proc->heap_alloc, new_lst);
        return -1;
    }
    am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, new_hd,
                am_make_value_of_ptr((am_object_t *)new_lst));
    am_value_t result = am_make_value_of_handle(new_hd);
    am_process_push_operand(proc, result);
    am_process_step(proc);
    return 0;
}


static int32_t op_cons(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t list_val = am_process_pop_operand(proc);
    am_value_t first = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    am_list_t *new_lst = am_list_create(proc->heap_alloc, lst->length + 1, lst->type, list_hd);
    if (!new_lst) return -1;

    new_lst = am_list_push(proc->heap_alloc, new_lst, first);
    if (!new_lst) return -1;
    for (size_t i = 0; i < lst->length; i++) {
        new_lst = am_list_push(proc->heap_alloc, new_lst, lst->children[i]);
        if (!new_lst) return -1;
    }

    am_handle_t new_hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (new_hd == AM_HANDLE_NULL) {
        am_list_destroy(proc->heap_alloc, new_lst);
        return -1;
    }
    am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, new_hd,
                am_make_value_of_ptr((am_object_t *)new_lst));
    am_process_push_operand(proc, am_make_value_of_handle(new_hd));
    am_process_step(proc);
    return 0;
}


static int32_t op_get_item(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t index_val = am_process_pop_operand(proc);
    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val) || !am_value_is_number(index_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    int32_t idx_type = am_value_type(index_val);
    am_int_t idx = 0;
    if (idx_type == AM_VALUE_TYPE_FLOAT) {
        idx = (am_int_t)roundf(am_value_to_float(index_val));
    }
    else if (idx_type == AM_VALUE_TYPE_UINT) {
        idx = (am_int_t)(am_value_to_uint(index_val));
    }
    else if (idx_type == AM_VALUE_TYPE_INT) {
        idx = am_value_to_int(index_val);
    }
    else {
        am_process_push_operand(proc, AM_VALUE_UNDEFINED);
        am_process_step(proc);
        return 0;
    }

    if (idx < 0 || (size_t)idx >= lst->length) {
        am_process_push_operand(proc, AM_VALUE_UNDEFINED);
    }
    else {
        am_process_push_operand(proc, lst->children[idx]);
    }
    am_process_step(proc);
    return 0;
}


static int32_t op_set_item(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t value = am_process_pop_operand(proc);
    am_value_t index_val = am_process_pop_operand(proc);
    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val) || !am_value_is_number(index_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    int32_t idx_type = am_value_type(index_val);
    am_int_t idx = 0;
    if (idx_type == AM_VALUE_TYPE_FLOAT) {
        idx = (am_int_t)roundf(am_value_to_float(index_val));
    }
    else if (idx_type == AM_VALUE_TYPE_UINT) {
        idx = (am_int_t)(am_value_to_uint(index_val));
    }
    else if (idx_type == AM_VALUE_TYPE_INT) {
        idx = am_value_to_int(index_val);
    }
    else {
        return -1;
    }
    if (idx < 0 || (size_t)idx >= lst->length) return -1;

    am_list_set(proc->heap_alloc, lst, (size_t)idx, value);
    am_process_step(proc);
    return 0;
}


static int32_t op_list_push(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t value = am_process_pop_operand(proc);
    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    am_list_t *new_lst = am_list_push(proc->heap_alloc, lst, value);
    if (!new_lst) return -1;
    if (new_lst != lst) {
        if (am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd,
                        am_make_value_of_ptr((am_object_t *)new_lst)) != 0) {
            am_list_destroy(proc->heap_alloc, new_lst);
            return -1;
        }
    }
    // am_process_push_operand(proc, am_make_value_of_uint((am_uint_t)new_lst->length));
    am_process_step(proc);
    return 0;
}


static int32_t op_list_pop(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    am_value_t popped = am_list_pop(proc->heap_alloc, lst);
    am_process_push_operand(proc, popped);
    am_process_step(proc);
    return 0;
}


static int32_t op_length(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t list_val = am_process_pop_operand(proc);
    if (!am_value_is_handle(list_val)) return -1;

    am_handle_t list_hd = am_value_to_handle(list_val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, list_hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);
    if (obj->type != AM_OBJECT_TYPE_LIST) return -1;

    am_list_t *lst = (am_list_t *)obj;
    am_process_push_operand(proc, am_make_value_of_uint((am_uint_t)lst->length));
    am_process_step(proc);
    return 0;
}


static int32_t op_concat(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t count_val = am_process_pop_operand(proc);
    if (!am_value_is_number(count_val)) return -1;
    am_int_t count = am_value_is_int(count_val) ? am_value_to_int(count_val) : (am_int_t)am_value_to_uint(count_val);
    if (count < 0) return -1;

    am_value_t *children = (am_value_t *)am_malloc(proc->vm_alloc, (size_t)count * sizeof(am_value_t));
    if (!children && count > 0) return -1;

    for (am_int_t i = count - 1; i >= 0; i--) {
        children[i] = am_process_pop_operand(proc);
    }

    am_list_t *new_lst = am_list_create(proc->heap_alloc, (size_t)count, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!new_lst) {
        am_free(proc->vm_alloc, children);
        return -1;
    }

    for (am_int_t i = 0; i < count; i++) {
        new_lst = am_list_push(proc->heap_alloc, new_lst, children[i]);
        if (!new_lst) {
            am_free(proc->vm_alloc, children);
            return -1;
        }
    }

    am_handle_t new_hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
    if (new_hd == AM_HANDLE_NULL) {
        am_free(proc->vm_alloc, children);
        am_list_destroy(proc->heap_alloc, new_lst);
        return -1;
    }
    am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, new_hd,
                am_make_value_of_ptr((am_object_t *)new_lst));

    // 设置子列表的 parent 字段
    for (size_t i = 0; i < new_lst->length; i++) {
        am_value_t child = new_lst->children[i];
        if (am_value_is_handle(child)) {
            am_handle_t child_hd = am_value_to_handle(child);
            am_value_t child_obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, child_hd);
            if (am_value_is_ptr(child_obj_val)) {
                am_object_t *child_obj = am_value_to_ptr(child_obj_val);
                if (child_obj->type == AM_OBJECT_TYPE_LIST) {
                    ((am_list_t *)child_obj)->parent = new_hd;
                }
            }
        }
    }

    am_free(proc->vm_alloc, children);
    am_process_push_operand(proc, am_make_value_of_handle(new_hd));
    am_process_step(proc);
    return 0;
}


static int32_t op_duplicate(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;

    am_value_t val = am_process_pop_operand(proc);
    if (!am_value_is_handle(val)) return -1;

    am_handle_t hd = am_value_to_handle(val);
    am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
    if (!am_value_is_ptr(obj_val)) return -1;
    am_object_t *obj = am_value_to_ptr(obj_val);

    if (obj->type == AM_OBJECT_TYPE_LIST) {
        am_list_t *lst = (am_list_t *)obj;
        am_list_t *copy = am_list_copy(proc->heap_alloc, lst);
        if (!copy) return -1;
        am_handle_t new_hd = am_heap_alloc_handle(proc->vm_alloc, proc->heap_alloc, proc->heap);
        if (new_hd == AM_HANDLE_NULL) {
            am_list_destroy(proc->heap_alloc, copy);
            return -1;
        }
        am_heap_set(proc->vm_alloc, proc->heap_alloc, proc->heap, new_hd,
                    am_make_value_of_ptr((am_object_t *)copy));
        am_process_push_operand(proc, am_make_value_of_handle(new_hd));
    }
    else if (obj->type == AM_OBJECT_TYPE_WSTRING) {
        am_wstring_t *ws = (am_wstring_t *)obj;
        // 构造临时 wchar_t 缓冲区供驻留查询使用（wchar_t 与 am_wchar_t 同为 32 位 Unicode 码点）
        wchar_t *buf = (wchar_t *)am_malloc(proc->vm_alloc, ws->length * sizeof(wchar_t));
        if (!buf) return -1;
        for (size_t i = 0; i < ws->length; i++) {
            buf[i] = (wchar_t)am_value_to_wchar(ws->content[i]);
        }
        am_handle_t new_hd = am_process_make_wstring_handle(proc, buf, ws->length);
        am_free(proc->vm_alloc, buf);
        if (new_hd == AM_HANDLE_NULL) return -1;
        am_process_push_operand(proc, am_make_value_of_handle(new_hd));
    }
    else {
        // 其他类型暂不做深拷贝，直接返回原 handle
        am_process_push_operand(proc, val);
    }

    am_process_step(proc);
    return 0;
}


// ===============================================================================
// evalcleanup：System.eval 执行结束后的清理指令
// ===============================================================================

typedef struct {
    am_handle_t first_handle;
    am_handle_t last_handle;
} eval_unmark_ctx_t;


static void eval_unmark_static_cb(am_handle_t handle, am_value_t value, void *user_data) {
    eval_unmark_ctx_t *ctx = (eval_unmark_ctx_t *)user_data;
    if (handle < ctx->first_handle || handle > ctx->last_handle) return;
    if (!am_value_is_ptr(value)) return;
    am_object_t *obj = am_value_to_ptr(value);
    if (am_object_check_static(obj) == 0) {
        am_object_set_static(obj, -1);
    }
}


static void eval_shrink_var_type(am_process_t *proc, size_t old_len) {
    if (!proc || !proc->var_type || proc->var_type->length <= old_len) return;

    am_list_t *new_list = am_list_create(proc->vm_alloc,
                                         old_len > 0 ? old_len : 4,
                                         AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    if (!new_list) return;

    for (size_t i = 0; i < old_len; i++) {
        new_list = am_list_push(proc->vm_alloc, new_list,
                                am_list_get(proc->vm_alloc, proc->var_type, i));
        if (!new_list) return;
    }

    am_list_destroy(proc->vm_alloc, proc->var_type);
    proc->var_type = new_list;
}


static void eval_shrink_var_vocab(am_process_t *proc, size_t old_len) {
    if (!proc || !proc->var_vocab) return;

    // 释放 eval 引入的所有尾部 var_vocab 条目，保持 var_vocab / var_type 同步
    while (proc->var_vocab->length > old_len) {
        size_t idx = proc->var_vocab->length - 1;
        wchar_t *word = proc->var_vocab->words[idx];
        if (word) {
            am_free(proc->vm_alloc, word);
            proc->var_vocab->words[idx] = NULL;
        }
        proc->var_vocab->length--;
    }

    if (proc->var_vocab->length == old_len && proc->var_vocab->capacity > old_len * 2 + 8) {
        am_vocab_t *new_vocab = am_vocab_create(proc->vm_alloc,
                                                old_len > 0 ? old_len : 4);
        if (!new_vocab) return;

        new_vocab->length = old_len;
        for (size_t i = 0; i < old_len; i++) {
            new_vocab->words[i] = proc->var_vocab->words[i];
            proc->var_vocab->words[i] = NULL;
        }
        proc->var_vocab->length = 0;
        am_vocab_destroy(proc->vm_alloc, proc->var_vocab);
        proc->var_vocab = new_vocab;
    }
}


// 清理 eval 引入的 native 记录，避免 stale varid 残留在 proc->natives 中
static void eval_cleanup_natives(am_process_t *proc, size_t old_var_vocab_len) {
    if (!proc || !proc->natives) return;

    am_map_t *m = proc->natives;
    for (size_t i = 0; i < m->capacity; i++) {
        am_value_t key = m->slots[i].key;
        if (key == AM_MAP_KEY_EMPTY || key == AM_MAP_KEY_TOMBSTONE) continue;
        if (!am_value_is_varid(key)) continue;
        if ((size_t)am_value_to_varid(key) >= old_var_vocab_len) {
            m->slots[i].key = AM_MAP_KEY_TOMBSTONE;
            m->slots[i].value = AM_VALUE_NULL;
            if (m->length > 0) m->length--;
            m->tombstones++;
        }
    }
}


static void eval_cleanup_var_tables(am_process_t *proc, size_t old_var_vocab_len) {
    if (!proc) return;
    eval_shrink_var_type(proc, old_var_vocab_len);
    eval_shrink_var_vocab(proc, old_var_vocab_len);
    eval_cleanup_natives(proc, old_var_vocab_len);
}


static int32_t op_evalcleanup(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    if (!proc || !proc->heap) return -1;
    if (!am_value_is_handle(operand)) return -1;

    am_handle_t rec_h = am_value_to_handle(operand);
    am_value_t rec_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, rec_h);
    if (!am_value_is_ptr(rec_val)) return -1;
    am_list_t *rec = (am_list_t *)am_value_to_ptr(rec_val);
    if (!rec || rec->type != AM_LIST_TYPE_DEFAULT || rec->length < 6) return -1;

    am_value_t ret_val           = rec->children[0];
    am_value_t saved_len_val     = rec->children[1];
    am_value_t first_h_val       = rec->children[2];
    am_value_t last_h_val        = rec->children[3];
    am_value_t old_ilen_val      = rec->children[4];
    am_value_t old_var_len_val   = rec->children[5];

    if (!am_value_is_iaddr(ret_val) ||
        !am_value_is_uint(saved_len_val) ||
        !am_value_is_handle(first_h_val) ||
        !am_value_is_handle(last_h_val) ||
        !am_value_is_uint(old_ilen_val) ||
        !am_value_is_uint(old_var_len_val)) {
        return -1;
    }

    am_iaddr_t ret_iaddr      = am_value_to_iaddr(ret_val);
    size_t     saved_len      = (size_t)am_value_to_uint(saved_len_val);
    am_handle_t first_handle  = am_value_to_handle(first_h_val);
    am_handle_t last_handle   = am_value_to_handle(last_h_val);
    size_t     old_ilen       = (size_t)am_value_to_uint(old_ilen_val);
    size_t     old_var_len    = (size_t)am_value_to_uint(old_var_len_val);

    // 1. 将操作数栈恢复到 eval 调用前的高度
    size_t cur_len = am_process_length_of_opstack(proc);
    if (cur_len != SIZE_MAX) {
        while (cur_len > saved_len) {
            am_process_pop_operand(proc);
            cur_len--;
        }
    }

    // 2. 截断 eval 追加的 ilcode
    if (proc->ilcode && old_ilen < proc->ilcode_length) {
        am_instruction_t *shrunk = (am_instruction_t *)am_realloc(
            proc->vm_alloc, proc->ilcode, old_ilen * sizeof(am_instruction_t));
        if (shrunk) {
            proc->ilcode = shrunk;
        }
        proc->ilcode_length = old_ilen;
    }

    // 3. 清除 eval 引入的静态对象标记，使它们可以被后续 GC 回收
    if (first_handle <= last_handle) {
        eval_unmark_ctx_t ctx = { first_handle, last_handle };
        am_heap_iter(proc->vm_alloc, proc->heap_alloc, proc->heap,
                     eval_unmark_static_cb, &ctx);
    }

    // 4. 清理 eval 引入的 ILTEMP 临时变量（只在尾部且类型为 ILTEMP 时收缩）
    eval_cleanup_var_tables(proc, old_var_len);

    // 5. 释放清理记录本身
    am_object_set_keepalive((am_object_t *)rec, -1);
    am_heap_free_handle(proc->vm_alloc, proc->heap_alloc, proc->heap, rec_h);

    // 6. 跳回到 eval 调用点之后
    am_process_goto(proc, ret_iaddr);
    return 0;
}


// ===============================================================================
// 第四类：算术逻辑运算和谓词
// ===============================================================================

// 数值类型转换规则
// +  u  i  f
// u  u  i  f
// i  i  i  f
// f  f  f  f
static int32_t op_add(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;

    if (am_value_is_float(a) || am_value_is_float(b)) {
        am_float_t result = am_runtime_number_to_float(b) + am_runtime_number_to_float(a);
        am_process_push_operand(proc, am_make_value_of_float(result));
    }
    else if (am_value_is_int(a) || am_value_is_int(b)) {
        am_int_t result = am_runtime_number_to_int(b) + am_runtime_number_to_int(a);
        am_process_push_operand(proc, am_make_value_of_int(result));
    }
    else {
        am_uint_t result = am_runtime_number_to_uint(b) + am_runtime_number_to_uint(a);
        am_process_push_operand(proc, am_make_value_of_uint(result));
    }

    am_process_step(proc);
    return 0;
}


// 数值类型转换规则
// -  u  i  f
// u  i  i  f
// i  i  i  f
// f  f  f  f
static int32_t op_sub(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;

    if (am_value_is_float(a) || am_value_is_float(b)) {
        am_float_t result = am_runtime_number_to_float(b) - am_runtime_number_to_float(a);
        am_process_push_operand(proc, am_make_value_of_float(result));
    }
    else {
        am_int_t result = am_runtime_number_to_int(b) - am_runtime_number_to_int(a);
        am_process_push_operand(proc, am_make_value_of_int(result));
    }

    am_process_step(proc);
    return 0;
}


// 数值类型转换规则
// *  u  i  f
// u  u  i  f
// i  i  i  f
// f  f  f  f
static int32_t op_mul(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;

    if (am_value_is_float(a) || am_value_is_float(b)) {
        am_float_t result = am_runtime_number_to_float(b) * am_runtime_number_to_float(a);
        am_process_push_operand(proc, am_make_value_of_float(result));
    }
    else if (am_value_is_int(a) || am_value_is_int(b)) {
        am_int_t result = am_runtime_number_to_int(b) * am_runtime_number_to_int(a);
        am_process_push_operand(proc, am_make_value_of_int(result));
    }
    else {
        am_uint_t result = am_runtime_number_to_uint(b) * am_runtime_number_to_uint(a);
        am_process_push_operand(proc, am_make_value_of_uint(result));
    }

    am_process_step(proc);
    return 0;
}


// 数值类型转换规则
// /  u  i  f
// u  f  f  f
// i  f  f  f
// f  f  f  f
static int32_t op_div(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    am_float_t fa = am_runtime_number_to_float(a);
    if (fa == 0.0) {
        am_runtime_error(rt, L"[Runtime] 除零错误\n");
        return -1;
    }
    am_float_t result = am_runtime_number_to_float(b) / fa;
    am_process_push_operand(proc, am_make_value_of_float(result));
    am_process_step(proc);
    return 0;
}


static int32_t op_mod(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    am_float_t result = fmod(am_runtime_number_to_float(b), am_runtime_number_to_float(a));
    am_process_push_operand(proc, am_make_value_of_float(result));
    am_process_step(proc);
    return 0;
}


static int32_t op_pow(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    am_float_t result = pow(am_runtime_number_to_float(b), am_runtime_number_to_float(a));
    am_process_push_operand(proc, am_make_value_of_float(result));
    am_process_step(proc);
    return 0;
}


static int32_t op_eq(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    am_value_t result = (b == a) ? AM_VALUE_TRUE : AM_VALUE_FALSE;
    am_process_push_operand(proc, result);
    am_process_step(proc);
    return 0;
}


static int32_t op_eqv(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    bool equal;
    if (am_value_is_number(a) && am_value_is_number(b)) {
        equal = (am_runtime_number_to_float(a) == am_runtime_number_to_float(b));
    }
    else {
        equal = (a == b);
    }
    am_process_push_operand(proc, equal ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_equal(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    bool equal = runtime_value_equal(proc, b, a);
    am_process_push_operand(proc, equal ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_ge(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    bool result = am_runtime_number_to_float(b) >= am_runtime_number_to_float(a);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_le(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    bool result = am_runtime_number_to_float(b) <= am_runtime_number_to_float(a);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_gt(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    bool result = am_runtime_number_to_float(b) > am_runtime_number_to_float(a);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_lt(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    if (!am_value_is_number(a) || !am_value_is_number(b)) return -1;
    bool result = am_runtime_number_to_float(b) < am_runtime_number_to_float(a);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_not(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_process_push_operand(proc, (a == AM_VALUE_FALSE) ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_and(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    bool result = (a != AM_VALUE_FALSE) && (b != AM_VALUE_FALSE);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_or(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t a = am_process_pop_operand(proc);
    am_value_t b = am_process_pop_operand(proc);
    bool result = (a != AM_VALUE_FALSE) || (b != AM_VALUE_FALSE);
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_isnull(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    bool result = false;
    if (am_value_is_null(v)) {
        result = true;
    }
    else if (am_value_is_handle(v)) {
        am_handle_t hd = am_value_to_handle(v);
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (am_value_is_ptr(obj_val)) {
            am_object_t *obj = am_value_to_ptr(obj_val);
            if (obj->type == AM_OBJECT_TYPE_LIST && ((am_list_t *)obj)->length == 0) {
                result = true;
            }
        }
    }
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_isundef(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    am_process_push_operand(proc, am_value_is_undefined(v) ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_isatom(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    am_process_push_operand(proc, !am_value_is_handle(v) ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_islist(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    bool result = false;
    if (am_value_is_handle(v)) {
        am_handle_t hd = am_value_to_handle(v);
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (am_value_is_ptr(obj_val)) {
            am_object_t *obj = am_value_to_ptr(obj_val);
            if (obj->type == AM_OBJECT_TYPE_LIST) {
                result = true;
            }
        }
    }
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_isnumber(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    am_process_push_operand(proc, am_value_is_number(v) ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_isnan(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    bool result = false;
    if (am_value_is_float(v)) {
        result = isnan(am_runtime_number_to_float(v));
    }
    am_process_push_operand(proc, result ? AM_VALUE_TRUE : AM_VALUE_FALSE);
    am_process_step(proc);
    return 0;
}


static int32_t op_typeof(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_value_t v = am_process_pop_operand(proc);
    const wchar_t *type_name = L"unknown";

    if (am_value_is_ptr(v)) {
        am_object_t *obj = am_value_to_ptr(v);
        switch (obj->type) {
            case AM_OBJECT_TYPE_LIST:         type_name = L"list"; break;
            case AM_OBJECT_TYPE_MAP:          type_name = L"map"; break;
            case AM_OBJECT_TYPE_WSTRING:      type_name = L"string"; break;
            case AM_OBJECT_TYPE_PORT:         type_name = L"port"; break;
            case AM_OBJECT_TYPE_CLOSURE:      type_name = L"closure"; break;
            case AM_OBJECT_TYPE_CONTINUATION: type_name = L"continuation"; break;
            case AM_OBJECT_TYPE_FRAME:        type_name = L"frame"; break;
            case AM_OBJECT_TYPE_ILCODE:       type_name = L"ilcode"; break;
            case AM_OBJECT_TYPE_BOX:          type_name = L"box"; break;
            case AM_OBJECT_TYPE_TOKEN:        type_name = L"token"; break;
            case AM_OBJECT_TYPE_SCOPE:        type_name = L"scope"; break;
            case AM_OBJECT_TYPE_VOCAB:        type_name = L"vocab"; break;
            default:                          type_name = L"object"; break;
        }
    }
    else if (am_value_is_handle(v))       type_name = L"handle";
    else if (am_value_is_varid(v))        type_name = L"varid";
    else if (am_value_is_symbol(v))       type_name = L"symbol";
    else if (am_value_is_iaddr(v))        type_name = L"iaddr";
    else if (am_value_is_label(v))        type_name = L"label";
    else if (am_value_is_boolean(v))      type_name = L"boolean";
    else if (am_value_is_null(v))         type_name = L"null";
    else if (am_value_is_undefined(v))    type_name = L"undefined";
    else if (am_value_is_uint(v) ||
             am_value_is_int(v) ||
             am_value_is_float(v))        type_name = L"number";
    else if (am_value_is_wchar(v))        type_name = L"wchar";

    size_t type_name_len = wcslen(type_name);
    am_handle_t hd = am_process_make_wstring_handle(proc, type_name, type_name_len);
    if (hd == AM_HANDLE_NULL) return -1;
    am_process_push_operand(proc, am_make_value_of_handle(hd));
    am_process_step(proc);
    return 0;
}


// ===============================================================================
// 第五类：其他指令
// ===============================================================================

static int32_t op_fork(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)proc;
    (void)operand;
    // NOTE 废弃fork
    am_runtime_error(rt, L"[Runtime] fork 指令已废弃\n");
    return -1;
}


static int32_t op_display_scalar(am_runtime_t *rt, am_process_t *proc, am_value_t content) {
    // 把大缓冲区放在单独的函数帧中，避免在显示列表（尤其是递归字符串化）的路径上占用栈空间
    wchar_t buf[1024];
    value_to_wchar_buf(proc, content, buf, 1024);
    am_runtime_output(rt, buf);
    am_process_step(proc);
    return 0;
}


static int32_t op_display(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)operand;
    am_value_t content = am_process_pop_operand(proc);

    // 列表对象使用专门的字符串化函数
    if (am_value_is_handle(content)) {
        am_handle_t hd = am_value_to_handle(content);
        am_value_t obj_val = am_heap_get(proc->vm_alloc, proc->heap_alloc, proc->heap, hd);
        if (am_value_is_ptr(obj_val)) {
            am_object_t *obj = am_value_to_ptr(obj_val);
            if (obj->type == AM_OBJECT_TYPE_LIST) {
                size_t len = 0;
                wchar_t *str = am_process_list_to_string(proc, hd, &len);
                if (str) {
                    am_runtime_output(rt, str);
                    am_free(proc->vm_alloc, str);
                    am_process_step(proc);
                    return 0;
                }
            }
        }
    }

    return op_display_scalar(rt, proc, content);
}


static int32_t op_newline(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)operand;
    am_runtime_output(rt, L"\n");
    am_process_step(proc);
    return 0;
}


static int32_t op_read(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    // NOTE 废弃该指令
    am_process_step(proc);
    return 0;
}


static int32_t op_write(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    // NOTE 废弃该指令
    am_process_step(proc);
    return 0;
}


static int32_t op_nop(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_process_step(proc);
    return 0;
}


static int32_t op_pause(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_process_set_state(proc, AM_PROCESS_STATE_SUSPENDED);
    return 0;
}


static int32_t op_halt(am_runtime_t *rt, am_process_t *proc, am_value_t operand) {
    (void)rt;
    (void)operand;
    am_process_set_state(proc, AM_PROCESS_STATE_STOPPED);
    return 0;
}


// ===============================================================================
// 异步定时器基础设施（类型定义）
// ===============================================================================

struct am_timer_t {
    size_t        id;          // 定时器编号（全局自增，从1开始）
    am_pid_t      pid;         // 关联进程ID
    am_handle_t   callback;    // 回调闭包把柄
    am_timestamp_t expire_ms;  // 到期时间戳（毫秒）
    bool          repeat;      // 是否周期触发
    am_timestamp_t interval_ms;// 周期触发间隔（毫秒）
    am_timer_t    *next;       // 链表下一个节点
};


// ===============================================================================
// 生命周期
// ===============================================================================

// 向运行时注册一个native库。成功返回0，失败返回-1。
int32_t am_runtime_register_native_lib(am_runtime_t *rt, const am_native_lib_entry_t *lib) {
    if (!rt) return -1;
    return am_native_register_lib(lib);
}


am_runtime_t *am_runtime_create(am_allocator_t *vm_alloc, am_allocator_t *heap_alloc, const wchar_t *base_dir) {
    if (!vm_alloc || !heap_alloc) return NULL;

    am_runtime_t *rt = (am_runtime_t *)am_calloc(vm_alloc, sizeof(am_runtime_t));
    if (!rt) return NULL;

    rt->vm_alloc = vm_alloc;
    rt->heap_alloc = heap_alloc;

    if (base_dir) {
        size_t len = wcslen(base_dir);
        rt->working_dir = (wchar_t *)am_malloc(vm_alloc, (len + 1) * sizeof(wchar_t));
        if (rt->working_dir) {
            memcpy(rt->working_dir, base_dir, (len + 1) * sizeof(wchar_t));
        }
    }

    rt->process_pool_capacity = 16;
    rt->process_pool = (am_process_t **)am_calloc(vm_alloc, rt->process_pool_capacity * sizeof(am_process_t *));
    if (!rt->process_pool) {
        am_free(vm_alloc, rt);
        return NULL;
    }
    rt->process_poll_counter = 0;

    rt->process_queue = am_list_create(vm_alloc, 16, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    rt->input_fifo = am_list_create(vm_alloc, 16, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    rt->output_fifo = am_list_create(vm_alloc, 16, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    rt->error_fifo = am_list_create(vm_alloc, 16, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);
    rt->queue_list = am_list_create(vm_alloc, 8, AM_LIST_TYPE_DEFAULT, AM_HANDLE_NULL);

    if (!rt->process_queue || !rt->input_fifo || !rt->output_fifo || !rt->error_fifo || !rt->queue_list) {
        am_runtime_destroy(rt);
        return NULL;
    }

    rt->queue_next_id = 1;

    rt->callback_on_tick = NULL;
    rt->callback_on_event = NULL;
    rt->callback_on_halt = NULL;
    rt->callback_on_error = NULL;

    rt->tick_counter = 0;
    rt->gc_count = 0;
    rt->gc_timestamp = time(NULL);

    rt->timeslice = 8192;

    rt->timer_list = NULL;
    rt->timer_next_id = 1;

    rt->host_context = NULL;

    return rt;
}


int32_t am_runtime_destroy(am_runtime_t *rt) {
    if (!rt) return 0;

    if (rt->process_pool) {
        for (size_t i = 0; i < rt->process_poll_counter; i++) {
            if (rt->process_pool[i]) {
                am_process_destroy(rt->process_pool[i]);
            }
        }
        am_free(rt->vm_alloc, rt->process_pool);
        rt->process_pool = NULL;
    }

    if (rt->process_queue) {
        am_list_destroy(rt->vm_alloc, rt->process_queue);
        rt->process_queue = NULL;
    }

    destroy_fifo(rt, rt->input_fifo);
    rt->input_fifo = NULL;
    destroy_fifo(rt, rt->output_fifo);
    rt->output_fifo = NULL;
    destroy_fifo(rt, rt->error_fifo);
    rt->error_fifo = NULL;

    if (rt->queue_list) {
        for (size_t i = 0; i < rt->queue_list->length; i++) {
            am_value_t qv = am_list_get(rt->vm_alloc, rt->queue_list, i);
            if (am_value_is_ptr(qv)) {
                am_queue_t *q = (am_queue_t *)am_value_to_ptr(qv);
                if (q) am_runtime_queue_destroy(rt, q);
            }
        }
        am_list_destroy(rt->vm_alloc, rt->queue_list);
        rt->queue_list = NULL;
    }

    if (rt->working_dir) {
        am_free(rt->vm_alloc, rt->working_dir);
        rt->working_dir = NULL;
    }

    am_timer_t *timer = rt->timer_list;
    while (timer) {
        am_timer_t *next = timer->next;
        am_free(rt->vm_alloc, timer);
        timer = next;
    }
    rt->timer_list = NULL;

    am_free(rt->vm_alloc, rt);
    return 0;
}


// ===============================================================================
// 异步定时器基础设施（操作实现）
// ===============================================================================

// 获取当前时间戳（毫秒）。优先使用 POSIX clock_gettime，失败则回退到 time()。
am_timestamp_t am_runtime_now_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_REALTIME, &ts) == 0) {
        return (am_timestamp_t)ts.tv_sec * 1000 + (am_timestamp_t)ts.tv_nsec / 1000000;
    }
    return (am_timestamp_t)time(NULL) * 1000;
}


// 短时睡眠（毫秒）。
static void runtime_sleep_ms(am_timestamp_t ms) {
    struct timespec ts;
    ts.tv_sec = (time_t)(ms / 1000);
    ts.tv_nsec = (long)((ms % 1000) * 1000000);
    nanosleep(&ts, NULL);
}


// 以异步方式调用一个闭包：压入栈帧并跳转到闭包入口，返回地址为 return_target。
int32_t am_runtime_call_async(am_runtime_t *rt, am_process_t *proc, am_handle_t callback,
                              am_iaddr_t return_target) {
    (void)rt;
    if (!proc) return -1;

    am_obj_closure_t *closure = am_process_get_closure(proc, callback);
    if (!closure) return -1;

    am_value_t current_closure_val = am_make_value_of_handle(proc->current_closure_handle);
    am_value_t return_target_val = am_make_value_of_iaddr(return_target);
    if (am_process_push_stack_frame(proc, current_closure_val, return_target_val) != 0) {
        return -1;
    }

    am_process_set_current_closure(proc, callback);
    am_process_goto(proc, closure->iaddr);
    return 0;
}


// 注册一个定时器。成功返回大于0的定时器编号，失败返回0。
size_t am_runtime_set_timer(am_runtime_t *rt, am_pid_t pid, am_handle_t callback,
                            am_timestamp_t delay_ms, bool repeat, am_timestamp_t interval_ms) {
    if (!rt) return 0;

    am_timer_t *timer = (am_timer_t *)am_malloc(rt->vm_alloc, sizeof(am_timer_t));
    if (!timer) return 0;

    if (rt->timer_next_id == 0) rt->timer_next_id = 1;
    timer->id = rt->timer_next_id++;
    timer->pid = pid;
    timer->callback = callback;
    timer->expire_ms = am_runtime_now_ms() + delay_ms;
    timer->repeat = repeat;
    timer->interval_ms = interval_ms;
    timer->next = rt->timer_list;
    rt->timer_list = timer;

    return timer->id;
}


// 根据编号取消一个定时器。成功返回 true，未找到返回 false。
bool am_runtime_clear_timer(am_runtime_t *rt, size_t timer_id) {
    if (!rt || timer_id == 0) return false;

    am_timer_t **cur = &rt->timer_list;
    while (*cur) {
        if ((*cur)->id == timer_id) {
            am_timer_t *to_free = *cur;
            *cur = (*cur)->next;
            am_free(rt->vm_alloc, to_free);
            return true;
        }
        cur = &(*cur)->next;
    }
    return false;
}


// 检查是否存在至少一个关联进程未处于 BLOCKED 状态的定时器。
// 若 nearest 非 NULL，同时返回最近的未阻塞定时器到期时间。
static bool runtime_has_nonblocked_timer(am_runtime_t *rt, am_timestamp_t *nearest) {
    if (!rt || !rt->timer_list) return false;
    bool has = false;
    for (am_timer_t *t = rt->timer_list; t; t = t->next) {
        am_process_t *proc = am_runtime_get_process(rt, t->pid);
        if (proc && proc->state == AM_PROCESS_STATE_BLOCKED) continue;
        if (proc && proc->state == AM_PROCESS_STATE_KILLED) continue;
        if (nearest && (!has || t->expire_ms < *nearest)) *nearest = t->expire_ms;
        has = true;
    }
    return has;
}


// 触发所有已到期的定时器。
static void runtime_fire_expired_timers(am_runtime_t *rt) {
    if (!rt || !rt->timer_list) return;

    am_timestamp_t now = am_runtime_now_ms();
    am_timer_t **cur = &rt->timer_list;
    while (*cur) {
        am_timer_t *timer = *cur;
        if (timer->expire_ms > now) {
            cur = &timer->next;
            continue;
        }

        am_process_t *proc = am_runtime_get_process(rt, timer->pid);
        if (proc) {
            // 进程正在执行阻塞式队列操作：用户定时器暂不触发，避免破坏队列操作状态
            if (proc->state == AM_PROCESS_STATE_BLOCKED) {
                cur = &timer->next;
                continue;
            }

            // 防御性检查：进程已被 kill，清理残留定时器
            if (proc->state == AM_PROCESS_STATE_KILLED) {
                am_timer_t *to_free = *cur;
                *cur = (*cur)->next;
                am_free(rt->vm_alloc, to_free);
                continue;
            }

            am_iaddr_t return_target;
            if (proc->state == AM_PROCESS_STATE_STOPPED) {
                // 进程已停止：回调结束后回到 halt 指令（地址1），并重新入队
                return_target = 1;
                am_value_t pid_val = am_make_value_of_uint((am_uint_t)timer->pid);
                am_list_t *new_queue = am_list_push(rt->vm_alloc, rt->process_queue, pid_val);
                if (new_queue) rt->process_queue = new_queue;
            }
            else {
                // 进程仍在运行：回调结束后回到当前 PC
                return_target = proc->PC;
            }

            am_runtime_call_async(rt, proc, timer->callback, return_target);
            proc->state = AM_PROCESS_STATE_RUNNING;
        }

        if (timer->repeat && proc) {
            // 周期定时器：更新下次到期时间并保留
            timer->expire_ms = now + timer->interval_ms;
            cur = &timer->next;
        }
        else {
            // 一次性定时器：移除并释放
            *cur = timer->next;
            am_free(rt->vm_alloc, timer);
        }
    }
}


// ===============================================================================
// 进程 kill 内部辅助函数
// ===============================================================================

// 释放进程内部资源，但保留 am_process_t 壳（pid/state 等）供外部查检。
static int32_t runtime_process_gut(am_process_t *proc) {
    if (!proc) return -1;

    if (proc->ilcode) {
        am_free(proc->vm_alloc, proc->ilcode);
        proc->ilcode = NULL;
    }
    proc->ilcode_length = 0;

    if (proc->opstack) {
        am_free(proc->vm_alloc, proc->opstack);
        proc->opstack = NULL;
        proc->opstack_top = NULL;
    }
    proc->opstack_capacity = 0;

    if (proc->fstack) {
        am_free(proc->vm_alloc, proc->fstack);
        proc->fstack = NULL;
        proc->fstack_top = NULL;
    }
    proc->fstack_capacity = 0;

    if (proc->var_type) {
        am_list_destroy(proc->vm_alloc, proc->var_type);
        proc->var_type = NULL;
    }
    if (proc->natives) {
        am_map_destroy(proc->vm_alloc, proc->natives);
        proc->natives = NULL;
    }
    if (proc->var_top) {
        am_list_destroy(proc->vm_alloc, proc->var_top);
        proc->var_top = NULL;
    }
    if (proc->var_arn_mapping) {
        am_map_destroy(proc->vm_alloc, proc->var_arn_mapping);
        proc->var_arn_mapping = NULL;
    }
    if (proc->strindex) {
        am_strindex_destroy(proc->vm_alloc, proc->strindex);
        proc->strindex = NULL;
    }
    if (proc->var_vocab) {
        am_vocab_destroy(proc->vm_alloc, proc->var_vocab);
        proc->var_vocab = NULL;
    }
    if (proc->symbol_vocab) {
        am_vocab_destroy(proc->vm_alloc, proc->symbol_vocab);
        proc->symbol_vocab = NULL;
    }
    if (proc->heap) {
        am_heap_destroy(proc->vm_alloc, proc->heap_alloc, proc->heap);
        proc->heap = NULL;
    }

    proc->PC = 0;
    proc->current_closure_handle = AM_HANDLE_NULL;
    proc->gc_count = 0;
    proc->pending_kill = false;

    return 0;
}


// 删除运行时定时器链表中所有属于指定 pid 的定时器。
static void runtime_kill_timers_for_pid(am_runtime_t *rt, am_pid_t pid) {
    if (!rt) return;
    am_timer_t **cur = &rt->timer_list;
    while (*cur) {
        if ((*cur)->pid == pid) {
            am_timer_t *to_free = *cur;
            *cur = (*cur)->next;
            am_free(rt->vm_alloc, to_free);
        } else {
            cur = &(*cur)->next;
        }
    }
}


// 删除所有 IPC 队列中属于指定 pid 的等待者节点。
static void runtime_kill_queue_waiters_for_pid(am_runtime_t *rt, am_pid_t pid) {
    if (!rt || !rt->queue_list) return;
    for (size_t i = 0; i < rt->queue_list->length; i++) {
        am_value_t qv = am_list_get(rt->vm_alloc, rt->queue_list, i);
        if (!am_value_is_ptr(qv)) continue;
        am_queue_t *q = (am_queue_t *)am_value_to_ptr(qv);
        if (!q) continue;

        am_queue_waiter_t **cur = &q->send_waiters;
        while (*cur) {
            if ((*cur)->pid == pid) {
                am_queue_waiter_t *w = *cur;
                *cur = w->next;
                am_free(rt->vm_alloc, w);
            } else {
                cur = &(*cur)->next;
            }
        }

        cur = &q->recv_waiters;
        while (*cur) {
            if ((*cur)->pid == pid) {
                am_queue_waiter_t *w = *cur;
                *cur = w->next;
                am_free(rt->vm_alloc, w);
            } else {
                cur = &(*cur)->next;
            }
        }
    }
}


// 从调度队列中移除指定 pid 的所有待调度条目。
static void runtime_process_queue_remove_pid(am_runtime_t *rt, am_pid_t pid) {
    if (!rt || !rt->process_queue) return;
    size_t write = 0;
    for (size_t i = 0; i < rt->process_queue->length; i++) {
        am_value_t v = am_list_get(rt->vm_alloc, rt->process_queue, i);
        if (am_value_is_uint(v) && (am_pid_t)am_value_to_uint(v) == pid) {
            continue;
        }
        if (write != i) {
            am_list_set(rt->vm_alloc, rt->process_queue, write, v);
        }
        write++;
    }
    rt->process_queue->length = write;
}


// ===============================================================================
// 模块与进程管理
// ===============================================================================

am_pid_t am_runtime_load_module(am_runtime_t *rt, am_module_t *mod) {
    if (!rt || !mod) return (am_pid_t)-1;

    am_process_t *proc = am_process_load_from_module(rt->vm_alloc, rt->heap_alloc, mod);
    if (!proc) return (am_pid_t)-1;

    am_pid_t pid = rt->process_poll_counter;
    proc->pid = pid;
    proc->parent_pid = 0;

    if (pid >= rt->process_pool_capacity) {
        size_t new_cap = rt->process_pool_capacity * 2;
        am_process_t **new_pool = (am_process_t **)am_realloc(
            rt->vm_alloc, rt->process_pool, new_cap * sizeof(am_process_t *));
        if (!new_pool) {
            am_process_destroy(proc);
            return (am_pid_t)-1;
        }
        rt->process_pool = new_pool;
        rt->process_pool_capacity = new_cap;
    }

    rt->process_pool[pid] = proc;
    rt->process_poll_counter++;

    am_value_t pid_val = am_make_value_of_uint((am_uint_t)pid);
    am_list_t *new_queue = am_list_push(rt->vm_alloc, rt->process_queue, pid_val);
    if (!new_queue) {
        rt->process_pool[pid] = NULL;
        rt->process_poll_counter--;
        am_process_destroy(proc);
        return (am_pid_t)-1;
    }
    rt->process_queue = new_queue;

    return pid;
}


am_process_t *am_runtime_get_process(am_runtime_t *rt, am_pid_t pid) {
    if (!rt || pid >= rt->process_poll_counter) return NULL;
    return rt->process_pool[pid];
}


int32_t am_runtime_kill_process(am_runtime_t *rt, am_pid_t pid) {
    if (!rt || pid >= rt->process_poll_counter) return -1;

    am_process_t *proc = rt->process_pool[pid];
    if (!proc || proc->state == AM_PROCESS_STATE_KILLED) return -1;

    int32_t old_state = proc->state;
    am_process_set_state(proc, AM_PROCESS_STATE_KILLED);

    // 立即清理异步任务与调度队列，避免被后续事件触发
    runtime_kill_timers_for_pid(rt, pid);
    runtime_kill_queue_waiters_for_pid(rt, pid);
    runtime_process_queue_remove_pid(rt, pid);

    if (old_state == AM_PROCESS_STATE_RUNNING) {
        // 目标进程正在执行本 native：延迟到调度器安全点再销毁资源
        proc->pending_kill = true;
    } else {
        runtime_process_gut(proc);
    }

    return 0;
}


void am_runtime_set_default_timeslice(am_runtime_t *rt, uint32_t ticks) {
    if (!rt) return;
    rt->timeslice = ticks;
}


am_process_t *am_rumtime_get_process_by_pid(am_runtime_t *rt, am_pid_t pid) {
    return am_runtime_get_process(rt, pid);
}


int32_t am_set_runtime_host_context(am_runtime_t *rt, void *ctx) {
    if (!rt) return -1;
    rt->host_context = ctx;
    return 0;
}


void *am_get_runtime_host_context(am_runtime_t *rt) {
    if (!rt) return NULL;
    return rt->host_context;
}


int32_t am_set_process_host_context(am_runtime_t *rt, am_process_t *proc, void *ctx) {
    (void)rt;
    if (!proc) return -1;
    proc->host_context = ctx;
    return 0;
}


void *am_get_process_host_context(am_runtime_t *rt, am_process_t *proc) {
    (void)rt;
    if (!proc) return NULL;
    return proc->host_context;
}


// ===============================================================================
// 调度器
// ===============================================================================


int32_t am_runtime_op_dispatch(am_runtime_t *rt, am_process_t *proc, uint32_t opcode, am_value_t operand) {
    switch (opcode) {
        case AM_VM_OP_nop:         return op_nop(rt, proc, operand);
        case AM_VM_OP_store:       return op_store(rt, proc, operand);
        case AM_VM_OP_load:        return op_load(rt, proc, operand);
        case AM_VM_OP_loadclosure: return op_loadclosure(rt, proc, operand);
        case AM_VM_OP_push:        return op_push(rt, proc, operand);
        case AM_VM_OP_pop:         return op_pop(rt, proc, operand);
        case AM_VM_OP_swap:        return op_swap(rt, proc, operand);
        case AM_VM_OP_set:         return op_set(rt, proc, operand);
        case AM_VM_OP_call:        return op_call(rt, proc, operand);
        case AM_VM_OP_callnative:  return op_callnative(rt, proc, operand);
        case AM_VM_OP_tailcall:    return op_tailcall(rt, proc, operand);
        case AM_VM_OP_return:      return op_return(rt, proc, operand);
        case AM_VM_OP_capturecc:   return op_capturecc(rt, proc, operand);
        case AM_VM_OP_iftrue:      return op_iftrue(rt, proc, operand);
        case AM_VM_OP_iffalse:     return op_iffalse(rt, proc, operand);
        case AM_VM_OP_goto:        return op_goto(rt, proc, operand);
        case AM_VM_OP_read:        return op_read(rt, proc, operand);
        case AM_VM_OP_write:       return op_write(rt, proc, operand);
        case AM_VM_OP_pause:       return op_pause(rt, proc, operand);
        case AM_VM_OP_halt:        return op_halt(rt, proc, operand);
        case AM_VM_OP_fork:        return op_fork(rt, proc, operand);
        case AM_VM_OP_display:     return op_display(rt, proc, operand);
        case AM_VM_OP_newline:     return op_newline(rt, proc, operand);
        case AM_VM_OP_add:         return op_add(rt, proc, operand);
        case AM_VM_OP_sub:         return op_sub(rt, proc, operand);
        case AM_VM_OP_mul:         return op_mul(rt, proc, operand);
        case AM_VM_OP_div:         return op_div(rt, proc, operand);
        case AM_VM_OP_mod:         return op_mod(rt, proc, operand);
        case AM_VM_OP_pow:         return op_pow(rt, proc, operand);
        case AM_VM_OP_eq:          return op_eq(rt, proc, operand);
        case AM_VM_OP_eqv:         return op_eqv(rt, proc, operand);
        case AM_VM_OP_equal:       return op_equal(rt, proc, operand);
        case AM_VM_OP_ge:          return op_ge(rt, proc, operand);
        case AM_VM_OP_le:          return op_le(rt, proc, operand);
        case AM_VM_OP_gt:          return op_gt(rt, proc, operand);
        case AM_VM_OP_lt:          return op_lt(rt, proc, operand);
        case AM_VM_OP_not:         return op_not(rt, proc, operand);
        case AM_VM_OP_and:         return op_and(rt, proc, operand);
        case AM_VM_OP_or:          return op_or(rt, proc, operand);
        case AM_VM_OP_isnull:      return op_isnull(rt, proc, operand);
        case AM_VM_OP_isundef:     return op_isundef(rt, proc, operand);
        case AM_VM_OP_isatom:      return op_isatom(rt, proc, operand);
        case AM_VM_OP_islist:      return op_islist(rt, proc, operand);
        case AM_VM_OP_isnumber:    return op_isnumber(rt, proc, operand);
        case AM_VM_OP_isnan:       return op_isnan(rt, proc, operand);
        case AM_VM_OP_typeof:      return op_typeof(rt, proc, operand);
        case AM_VM_OP_car:         return op_car(rt, proc, operand);
        case AM_VM_OP_cdr:         return op_cdr(rt, proc, operand);
        case AM_VM_OP_cons:        return op_cons(rt, proc, operand);
        case AM_VM_OP_get_item:    return op_get_item(rt, proc, operand);
        case AM_VM_OP_set_item:    return op_set_item(rt, proc, operand);
        case AM_VM_OP_list_push:   return op_list_push(rt, proc, operand);
        case AM_VM_OP_list_pop:    return op_list_pop(rt, proc, operand);
        case AM_VM_OP_length:      return op_length(rt, proc, operand);
        case AM_VM_OP_concat:      return op_concat(rt, proc, operand);
        case AM_VM_OP_duplicate:   return op_duplicate(rt, proc, operand);
        case AM_VM_OP_evalcleanup: return op_evalcleanup(rt, proc, operand);
        case AM_VM_OP_dynamicwind:              return op_dynamicwind(rt, proc, operand);
        case AM_VM_OP_dynamicwind_after_before: return op_dynamicwind_after_before(rt, proc, operand);
        case AM_VM_OP_dynamicwind_before_after: return op_dynamicwind_before_after(rt, proc, operand);
        case AM_VM_OP_dynamicwind_done:         return op_dynamicwind_done(rt, proc, operand);
        case AM_VM_OP_wind:                     return op_wind(rt, proc, operand);
        default: {
            wchar_t errmsg[256];
            swprintf(errmsg, 256, L"[Runtime] 未知指令: %u\n", opcode);
            am_runtime_error(rt, errmsg);
            return -1;
        }
    }
}


int32_t am_runtime_execute(am_runtime_t *rt, am_process_t *proc) {
    if (!rt || !proc) return -1;

    uint32_t opcode;
    am_value_t operand;
    if (am_process_current_instruction(proc, &opcode, &operand) != 0) {
        return -1;
    }

    // printf("Exec: PC=%zu | OpCode=%u | Oprand=%zu(varid=%zu)\n", proc->PC, opcode, operand, am_value_to_varid(operand));

    return am_runtime_op_dispatch(rt, proc, opcode, operand);
}


/* 根据堆区压力决定是否执行 GC+压缩。
 * 在指令执行间隙（安全点）调用，避免在指令执行过程中压缩导致局部指针失效。
 * 阈值：堆已用超过堆容量的 50% 时触发。 */
#ifndef AM_HEAP_GC_PRESSURE_THRESHOLD
#define AM_HEAP_GC_PRESSURE_THRESHOLD (0.50)
#endif

static void runtime_gc_compact_if_needed(am_runtime_t *rt) {
    if (!rt) return;

    am_allocator_pool_t *pool = am_allocator_pool_current();
    if (!pool) return;

    size_t heap_used = am_allocator_pool_heap_used(pool);
    size_t heap_cap = am_allocator_pool_heap_capacity(pool);
    if (heap_cap == 0) return;

    double ratio = (double)heap_used / (double)heap_cap;
    if (ratio < AM_HEAP_GC_PRESSURE_THRESHOLD) return;

    /* 标记-清除：对所有非停止进程执行 GC。 */
    size_t heap_count = 0;
    for (size_t i = 0; i < rt->process_poll_counter; i++) {
        am_process_t *proc = rt->process_pool[i];
        if (!proc || proc->state == AM_PROCESS_STATE_STOPPED) continue;
        if (am_process_gc(proc) == 0 && proc->heap) {
            heap_count++;
        }
    }

    /* 标记-压缩：一次性压缩所有相关进程堆。 */
    if (heap_count > 0) {
        am_heap_t **heaps = (am_heap_t **)malloc(heap_count * sizeof(am_heap_t *));
        if (heaps) {
            size_t idx = 0;
            for (size_t i = 0; i < rt->process_poll_counter; i++) {
                am_process_t *proc = rt->process_pool[i];
                if (proc && proc->heap) {
                    heaps[idx++] = proc->heap;
                }
            }
            if (am_allocator_heap_compact_global(rt->heap_alloc, heaps, idx) == 0) {
                (void)am_allocator_pool_auto_adjust(pool);
            }
            free(heaps);
        }
    }
}


int32_t am_runtime_tick(am_runtime_t *rt, uint32_t timeslice) {
    if (!rt || !rt->process_queue) return AM_VM_STATE_IDLE;
    if (rt->process_queue->length == 0) return AM_VM_STATE_IDLE;

    am_value_t pid_val = am_list_shift(rt->vm_alloc, rt->process_queue);
    if (!am_value_is_uint(pid_val)) return AM_VM_STATE_IDLE;

    am_pid_t pid = (am_pid_t)am_value_to_uint(pid_val);
    if (pid >= rt->process_poll_counter || !rt->process_pool[pid]) {
        return AM_VM_STATE_IDLE;
    }

    am_process_t *proc = rt->process_pool[pid];
    proc->state = AM_PROCESS_STATE_RUNNING;

    while (timeslice > 0 && proc->state == AM_PROCESS_STATE_RUNNING) {
        if (am_runtime_execute(rt, proc) != 0) {
            proc->state = AM_PROCESS_STATE_STOPPED;
            if (rt->callback_on_error) rt->callback_on_error(rt);
            wchar_t errmsg[256];
            swprintf(errmsg, 256, L"[Runtime] 指令执行异常: PID=%zu PC=%zu\n", (size_t)pid, (size_t)proc->PC);
            am_runtime_error(rt, errmsg);
            break;
        }
        timeslice--;
    }

    if (proc->state == AM_PROCESS_STATE_RUNNING) {
        proc->state = AM_PROCESS_STATE_READY;
        am_list_t *new_queue = am_list_push(rt->vm_alloc, rt->process_queue, pid_val);
        if (!new_queue) {
            // 入队失败，停止进程以避免丢失
            proc->state = AM_PROCESS_STATE_STOPPED;
            return AM_VM_STATE_IDLE;
        }
        rt->process_queue = new_queue;
    }

    // 在 tick 结束的安全点完成延迟 kill
    if (proc->state == AM_PROCESS_STATE_KILLED && proc->pending_kill) {
        runtime_process_gut(proc);
    }

    rt->tick_counter++;
    if (rt->callback_on_tick) rt->callback_on_tick(rt);

    /* 在 tick 结束的安全点检查堆压力，必要时 GC+压缩 */
    // runtime_gc_compact_if_needed(rt);

    return (rt->process_queue->length > 0) ? AM_VM_STATE_RUNNING : AM_VM_STATE_IDLE;
}


/* 获取运行时内存统计快照。
 * 通过 allocator 提供的抽象查询接口获取数据，与 allocator 内部实现策略无关。 */
int32_t am_runtime_get_memory_stats(am_runtime_t *rt, am_runtime_memory_stats_t *out) {
    (void)rt;
    if (!out) return -1;

    am_allocator_pool_t *pool = am_allocator_pool_current();
    if (!pool) return -1;

    size_t total_size = am_allocator_pool_total_size(pool);
    size_t heap_cap   = am_allocator_pool_heap_capacity(pool);

    out->vm_capacity   = (total_size > heap_cap) ? (total_size - heap_cap) : 0;
    out->vm_used       = am_allocator_pool_vm_used(pool);
    out->heap_capacity = heap_cap;
    out->heap_used     = am_allocator_pool_heap_used(pool);
    return 0;
}


/* 打印运行时内存总体使用状况（VM 工作区 + 用户堆区）。
 * 通过 allocator 提供的抽象查询接口获取数据，与 allocator 内部实现策略无关。 */
void am_runtime_print_memory_stats(am_runtime_t *rt) {
    am_runtime_memory_stats_t stats;
    if (am_runtime_get_memory_stats(rt, &stats) != 0) {
        fprintf(stderr, "[MemoryStats] 当前内存池信息不可用\n");
        return;
    }

    size_t total_size = stats.vm_capacity + stats.heap_capacity;

    fprintf(stderr, "\n========== 运行时内存使用状况 ==========\n");
    fprintf(stderr, "  内存池总容量: %zu bytes (%.2f MB)\n",
            total_size, (double)total_size / (1024.0 * 1024.0));
    fprintf(stderr, "\n");
    fprintf(stderr, "  VM 工作区:\n");
    fprintf(stderr, "    容量=%zu bytes\n", stats.vm_capacity);
    fprintf(stderr, "    已用=%zu bytes\n", stats.vm_used);
    fprintf(stderr, "    空闲=%zu bytes\n", stats.vm_capacity - stats.vm_used);
    if (stats.vm_capacity > 0) {
        fprintf(stderr, "    使用率=%.2f%%\n",
                100.0 * (double)stats.vm_used / (double)stats.vm_capacity);
    }
    fprintf(stderr, "\n");
    fprintf(stderr, "  用户堆区:\n");
    fprintf(stderr, "    容量=%zu bytes\n", stats.heap_capacity);
    fprintf(stderr, "    已用=%zu bytes\n", stats.heap_used);
    fprintf(stderr, "    空闲=%zu bytes\n", stats.heap_capacity - stats.heap_used);
    if (stats.heap_capacity > 0) {
        fprintf(stderr, "    使用率=%.2f%%\n",
                100.0 * (double)stats.heap_used / (double)stats.heap_capacity);
    }
    fprintf(stderr, "========================================\n\n");
}


int32_t am_runtime_event_handler(am_runtime_t *rt) {
    if (!rt) return AM_VM_STATE_IDLE;

    // NOTE 此处时间片的长度，决定了GC的时间粒度。若GC间隔过长，可能导致峰值内存需求较大时，内存分配失败，即使空闲够用。
    int32_t vm_state = AM_VM_STATE_IDLE;
    for (int i = 0; i < AM_COMPUTATION_PHASE_LENGTH; i++) {
        vm_state = am_runtime_tick(rt, rt->timeslice);
        if (vm_state == AM_VM_STATE_IDLE) break;
    }

#if AM_ENABLE_GC
    // time_t now = time(NULL);
    // if (now - rt->gc_timestamp >= AM_GC_INTERVAL) {
    //     rt->gc_timestamp = now;

        /* 标记-清除：对所有现存进程执行 GC。 */
        size_t heap_count = 0;
        for (size_t i = 0; i < rt->process_poll_counter; i++) {
            am_process_t *proc = rt->process_pool[i];
            if (!proc) continue;
            if (am_process_gc(proc) == 0 && proc->heap) {
                heap_count++;
            }
        }

        rt->gc_count++;

#if AM_HEAP_COMPACT_INTERVAL > 0
        /* 标记-压缩：在 GC 安全点一次性压缩所有进程的存活对象。
         * 所有进程共享同一个底层 heap_alloc，全局压缩避免互相覆盖。 */
        if ((rt->gc_count % AM_HEAP_COMPACT_INTERVAL) == 0 && heap_count > 0) {
            am_heap_t **heaps = (am_heap_t **)malloc(heap_count * sizeof(am_heap_t *));
            if (heaps) {
                size_t idx = 0;
                for (size_t i = 0; i < rt->process_poll_counter; i++) {
                    am_process_t *proc = rt->process_pool[i];
                    if (proc && proc->heap) {
                        heaps[idx++] = proc->heap;
                    }
                }
                if (am_allocator_heap_compact_global(rt->heap_alloc, heaps, idx) == 0) {
                    am_allocator_pool_t *pool = am_allocator_pool_current();
                    if (pool) {
                        (void)am_allocator_pool_auto_adjust(pool);
                    }
                }
                free(heaps);
            }
        }
#endif
    // }
#endif

    // 检查队列阻塞等待者：唤醒超时的发送者/接收者
    runtime_queue_check_waiters(rt);

    runtime_fire_expired_timers(rt);

    // 若触发定时器或队列唤醒后有进程入队，继续保持 RUNNING 状态
    if (rt->process_queue && rt->process_queue->length > 0) {
        vm_state = AM_VM_STATE_RUNNING;
    }
    // 即使暂无就绪进程，只要还有未到期定时器（且其关联进程未阻塞）
    // 或阻塞中的队列等待者，事件循环也应继续运转，等待它们到期或被唤醒。
    if (vm_state == AM_VM_STATE_IDLE &&
        (runtime_has_nonblocked_timer(rt, NULL) || runtime_queue_has_waiters(rt, NULL))) {
        vm_state = AM_VM_STATE_RUNNING;
    }

    if (rt->callback_on_event) rt->callback_on_event(rt);
    return vm_state;
}


void am_runtime_start(am_runtime_t *rt) {
    if (!rt) return;

    while (1) {
        int32_t vm_state = am_runtime_event_handler(rt);
        if (vm_state == AM_VM_STATE_IDLE) {
            if (rt->callback_on_halt) rt->callback_on_halt(rt);
            break;
        }

        // 若当前无就绪进程但仍有未到期定时器（关联进程未阻塞）
        // 或队列阻塞等待者，则睡眠到最近的到期时间。
        if (rt->process_queue && rt->process_queue->length == 0 &&
            (runtime_has_nonblocked_timer(rt, NULL) || runtime_queue_has_waiters(rt, NULL))) {
            am_timestamp_t now = am_runtime_now_ms();
            am_timestamp_t next = 0;
            am_timestamp_t tnext;
            if (runtime_has_nonblocked_timer(rt, &tnext)) {
                next = tnext;
            }
            am_timestamp_t qnext;
            if (runtime_queue_has_waiters(rt, &qnext)) {
                if (next == 0 || qnext < next) next = qnext;
            }
            if (next > now) {
                runtime_sleep_ms(next - now);
            }
        }
    }
}


void am_start(am_runtime_t *rt) {
    am_runtime_start(rt);
}


// ===============================================================================
// 控制台输入输出
// ===============================================================================

// 将宽字符串中的 "\\n"、"\\r"、"\\t"、"\\b"、"\\\\"、"\\\"" 等字符序列
// 替换为对应的 ASCII 控制字符。返回新分配的宽字符串，调用者负责释放。
static wchar_t *runtime_unescape_output_string(am_allocator_t *alloc, const wchar_t *str, size_t *out_len) {
    if (!alloc || !str) return NULL;

    size_t len = wcslen(str);
    wchar_t *result = (wchar_t *)am_malloc(alloc, (len + 1) * sizeof(wchar_t));
    if (!result) return NULL;

    size_t j = 0;
    for (size_t i = 0; i < len; i++) {
        if (str[i] == L'\\' && i + 1 < len) {
            bool replaced = true;
            wchar_t replacement = L'\\';
            switch (str[i + 1]) {
                case L'n': replacement = L'\n'; break;
                case L'r': replacement = L'\r'; break;
                case L't': replacement = L'\t'; break;
                case L'b': replacement = L'\b'; break;
                case L'\\': replacement = L'\\'; break;
                case L'"': replacement = L'"'; break;
                default: replaced = false; break;
            }
            if (replaced) {
                result[j++] = replacement;
                i++;
                continue;
            }
        }
        result[j++] = str[i];
    }
    result[j] = L'\0';
    if (out_len) *out_len = j;
    return result;
}


void am_runtime_output(am_runtime_t *rt, const wchar_t *str) {
    if (!rt || !str) return;

    size_t output_len = wcslen(str);
    wchar_t *unescaped = runtime_unescape_output_string(rt->vm_alloc, str, &output_len);
    const wchar_t *output_str = unescaped ? unescaped : str;

    if (rt->output_fifo) {
        for (size_t i = 0; i < output_len; i++) {
            am_value_t ch = am_make_value_of_wchar((am_wchar_t)output_str[i]);
            am_list_t *new_fifo = am_list_push(rt->vm_alloc, rt->output_fifo, ch);
            if (new_fifo) rt->output_fifo = new_fifo;
        }
    }

    if (unescaped) am_free(rt->vm_alloc, unescaped);
}


void am_runtime_error(am_runtime_t *rt, const wchar_t *str) {
    if (!rt || !str) return;

    if (rt->error_fifo) {
        size_t len = wcslen(str);
        for (size_t i = 0; i < len; i++) {
            am_value_t ch = am_make_value_of_wchar((am_wchar_t)str[i]);
            am_list_t *new_fifo = am_list_push(rt->vm_alloc, rt->error_fifo, ch);
            if (new_fifo) rt->error_fifo = new_fifo;
        }
    }

    if (rt->callback_on_error) rt->callback_on_error(rt);
}
