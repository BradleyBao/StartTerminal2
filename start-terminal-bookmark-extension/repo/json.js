//
// === json.js ===
// (同步沙盒脚本)
//

try {
    if (!pipedInput || pipedInput.length === 0) {
        st_api.writeHtml('<span class="term-error">Usage: curl ... | json</span>');
        return;
    }

    // 将所有管道输入行连接成一个单独的字符串
    const rawJson = pipedInput.join('\n');
    
    // 解析并重新格式化
    const parsed = JSON.parse(rawJson);
    const pretty = JSON.stringify(parsed, null, 2); // 2 个空格缩进
    
    st_api.writeLine(pretty);

} catch (e) {
    st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
}
