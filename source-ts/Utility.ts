
// Utility.ts
// 工具函数

// 状态常量
const SUCCEED = 0;

// 取数组/栈的栈顶
function Top(arr: Array<any>): any {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str: string): string {
    if(str[0] === '"' && str[str.length-1] === '"') {
        return str.substring(1, str.length-1);
    }
    else {
        return str;
    }
}