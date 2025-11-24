try {
    const isDecode = args.includes('-d') || args.includes('--decode');
    let input;
    
    // 过滤掉选项参数
    const contentArgs = args.filter(arg => arg !== '-d' && arg !== '--decode');
    
    // 1. 获取输入
    if (pipedInput) {
        // 如果来自管道，通常是数组，连接成字符串
        input = Array.isArray(pipedInput) ? pipedInput.join('\n') : String(pipedInput);
    } else if (contentArgs.length > 0) {
        input = contentArgs.join(' ');
    } else {
        st_api.writeHtml('<span class="term-error">Usage: echo "text" | base64</span>');
        st_api.writeHtml('<span class="term-error">       base64 "text"</span>');
        st_api.writeHtml('<span class="term-error">       base64 -d "dGV4dA=="</span>');
        return;
    }

    // 2. 去除首尾引号 (虽然 terminal.js 可能已经处理过，但这层保险是个好习惯)
    if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
        input = input.slice(1, -1);
    }

    let output = "";

    if (isDecode) {
        // --- 解码 (Base64 -> UTF-8) ---
        try {
            output = decodeURIComponent(escape(atob(input.trim()))); // trim 去除可能存在的换行符
        } catch (err) {
            throw new Error("Invalid Base64 input");
        }
        st_api.writeLine(output);
    } else {
        // --- 编码 (UTF-8 -> Base64) ---
        output = btoa(unescape(encodeURIComponent(input)));
        st_api.writeLine(output);
    }

    // 可以继续通过管道传给下一个命令
    return output; 

} catch (e) {
    st_api.writeHtml(`<span class="term-error">base64 error: ${e.message}</span>`);
}