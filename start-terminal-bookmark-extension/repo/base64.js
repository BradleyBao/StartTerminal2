try {
    // 直接从 options 对象读取，不再解析 args
    // terminal.js 已经帮你把 -d 解析成 options.d = true 了
    const isDecode = options.d || options.decode;
    
    let input;
    
    // args 已经被 terminal.js 清理过了，里面只剩下非选项参数 (例如 "hi")
    // 所以我们不需要再过滤 -d
    const contentArgs = args; 
    
    if (pipedInput) {
        input = Array.isArray(pipedInput) ? pipedInput.join('\n') : String(pipedInput);
    } else if (contentArgs.length > 0) {
        input = contentArgs.join(' ');
    } else {
        st_api.writeHtml('<span class="term-error">Usage: echo "text" | base64</span>');
        st_api.writeHtml('<span class="term-error">       base64 "text"</span>');
        st_api.writeHtml('<span class="term-error">       base64 -d "dGV4dA=="</span>');
        return;
    }

    // 去除引号
    if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
        input = input.slice(1, -1);
    }

    let output = "";

    if (isDecode) {
        // 解码
        try {
            output = decodeURIComponent(escape(atob(input.trim())));
        } catch (err) {
            throw new Error("Invalid Base64 input");
        }
        st_api.writeLine(output);
    } else {
        // 编码
        output = btoa(unescape(encodeURIComponent(input)));
        st_api.writeLine(output);
    }

    return output;

} catch (e) {
    st_api.writeHtml(`<span class="term-error">base64 error: ${e.message}</span>`);
}