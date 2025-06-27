
// Memory.ts
// 内存管理

// TODO 完善所有对象的深拷贝

type Handle = string;

class HashMap<DummyHandle, V> extends Object{
    public set(handle: Handle, value: any): void {
        this[handle] = value;
    }
    public get(handle: Handle): any{
        return this[handle];
    }
    public has(handle: Handle): boolean {
        return (handle in this);
    }
    public Copy(): HashMap<DummyHandle, any> {
        let copy: HashMap<DummyHandle, any> = new HashMap();
        for(let addr in this) {
            let value = this.get(addr);
            if(value === undefined) continue;
            if(value instanceof SchemeObject) {
                copy.set(addr, value.Copy());
            }
            else {
                let newValue = JSON.parse(JSON.stringify(value));
                copy.set(addr, newValue);
            }
        }
        return copy;
    }
}

// 基于HashMap的对象存储区，用于实现pool、heap等
class Memory {
    // 数据Map
    public data: HashMap<Handle, any>;
    // 元数据Map（[静态标记,只读标记,使用状态标记,[主引对象把柄]]）
    public metadata: HashMap<Handle, string>;
    // 自增的计数器，用于生成把柄
    public handleCounter: number;

    constructor() {
        this.data = new HashMap();
        this.metadata = new HashMap();
        this.handleCounter = 0;
    }

    // 生成元数据字符串
    // NOTE 增加新字段时，需要修改所有波及的硬编码下标
    private MetaString(isStatic: boolean, isReadOnly: boolean, status: string, isKeepalive: boolean): string {
        let str = "";
        str +=   (isStatic) ? "S" : "_";
        str += (isReadOnly) ? "R" : "_";
        switch(status) {
            case "allocated":
                str += "A"; break;
            case "modified":
                str += "M"; break;
            case "free":
                str += "F"; break;
            default:
                str += "_"; break;
        }
        str += (isKeepalive === true) ? "A" : "_"; // 声明为保持存活的对象，保证不会被GC清理，一般用于涉及尾调用的闭包对象
        return str;
    }

    // 把柄存在性判断
    public HasHandle(handle: Handle): boolean {
        return this.data.has(handle);
    }

    // 新建任意把柄
    public NewHandle(handle: Handle, isStatic: boolean | void): void {
        isStatic = isStatic || false;
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated", false));
    }

    // 动态分配堆对象把柄
    public AllocateHandle(typeTag: string, isStatic: boolean | void): Handle {
        isStatic = isStatic || false;
        typeTag = typeTag || "OBJECT";
        let handle = `&${typeTag}_${this.handleCounter}`;
        if (ANIMAC_CONFIG.is_debug !== true) {
            handle = "&" + HashString([handle, String(Math.random())]);
        }
        this.data.set(handle, null);
        this.metadata.set(handle, this.MetaString(isStatic, false, "allocated", false));
        this.handleCounter++;
        return handle;
    }

    // 动态回收堆对象把柄：删除堆中相应位置
    public DeleteHandle (handle: Handle): void {
        if (this.metadata[handle][3] === "A") { // metadata的keepalive标记
            console.warn(`[Memory.DeleteHandle] 把柄 ${handle} 声明为keepalive，不可删除`);
            return;
        }
        delete this.data[handle];
        delete this.metadata[handle];
        // this.data.set(handle, undefined);
        // this.metadata.set(handle, this.MetaString(false, false, "free"));
    }

    public SetKeepalive(handle: Handle, isKeepalive: boolean): any {
        if(this.metadata.has(handle)) {
            let meta = this.metadata[handle];
            let new_meta = [meta[0], meta[1], meta[2], ((isKeepalive === true) ? "A" : "_")].join("");
            this.metadata[handle] = new_meta;
        }
        else {
            throw `[Memory.SetKeepalive] 空把柄:${handle}`;
        }
    }

    // 根据把柄获取对象
    public Get(handle: Handle): any {
        if(this.data.has(handle)) {
            return this.data.get(handle);
        }
        else {
            throw `[Memory.Get] 空把柄:${handle}`;
        }
    }

    // 设置把柄的对象值
    public Set(handle: Handle, value: any): void {
        let metadata = this.metadata.get(handle);
        if(this.data.has(handle) === false) {
            throw `[Error] 未分配的把柄:${handle}`;
        }
        else if(metadata[1] === "R") {
            throw `[Error] 不允许修改只读对象:${handle}`;
        }
        else if(metadata[0] === "S") {
            // console.warn(`[Warn] 修改了静态对象:${handle}`);
        }
        this.metadata.set(handle, this.MetaString((metadata[0] === "S"), false, "modified", false));
        this.data.set(handle, value);
    }

    // 是否静态
    public IsStatic(handle: Handle): boolean {
        return ((this.metadata.get(handle))[0] === "S");
    }

    // 遍历
    // 注意：输入函数通过返回"break"来结束循环，通过返回其他任意值来中止一轮循环（continue）。
    public ForEach(f: (handle: Handle)=>any): void {
        for(let handle in this.data) {
            let ctrl = f(handle);
            if(ctrl === "break") break;
        }
    }

    // 深拷贝
    public Copy(): Memory {
        let copy = new Memory();
        copy.data = this.data.Copy();
        copy.metadata = this.metadata.Copy();
        copy.handleCounter = this.handleCounter;
        return copy;
    }
}
