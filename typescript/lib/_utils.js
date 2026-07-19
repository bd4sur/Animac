// 取数组/栈的栈顶
function Top(arr) {
    return arr[arr.length - 1];
}

// 去掉生字符串两端的双引号
function TrimQuotes(str) {
    if(str === undefined) return "";
    if(str[0] === '"' && str[str.length-1] === '"') {
        str = str.substring(1, str.length-1);
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t').replace(/\\b/gi, '\b');
        return str;
    }
    else {
        str = str.replace(/\\n/gi, "\n").replace(/\\r/gi, "\r").replace(/\\"/gi, '"').replace(/\\t/gi, '\t').replace(/\\b/gi, '\b');
        return str;
    }
}

module.exports.Top = Top;
module.exports.TrimQuotes = TrimQuotes;

