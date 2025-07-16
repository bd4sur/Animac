
// config.ts
// 全局配置

const ANIMAC_CONFIG = {
    "version": "2025.7",
    "env_type": "web",     // 运行环境："cli" or "web"
    "is_debug": false,
    "is_gc_enabled": true, // 是否启用GC
    "gc_interval": 1000,   // GC时间间隔（ms）
};

let ANIMAC_STDOUT_CALLBACK = (x)=>{};
let ANIMAC_STDERR_CALLBACK = (x)=>{};
