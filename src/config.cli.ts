
// config.ts
// 全局配置

const ANIMAC_CONFIG = {
    "version": "2025.6",
    "env_type": "cli", // 运行环境："cli" or "web"
    "is_debug": false,
    "is_gc_enabled": true, // 是否启用GC
};

let ANIMAC_STDOUT_CALLBACK = console.log;
let ANIMAC_STDERR_CALLBACK = console.error;
