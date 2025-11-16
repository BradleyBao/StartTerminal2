//
// === sha256.js ===
// (异步沙盒脚本)
//

// 必须返回 async IIFE 才能被 sandbox.js (L42) 正确 await
return (async () => {
    try {
        let input;
        if (pipedInput) {
            input = pipedInput.join('\n');
        } else if (args[0]) {
            input = args.join(' ');
        } else {
            st_api.writeHtml('<span class="term-error">Usage: echo "text" | sha256</span>');
            st_api.writeHtml('<span class="term-error">       sha256 "text"</span>');
            return;
        }

        // 1. 编码
        const encoder = new TextEncoder();
        const data = encoder.encode(input);

        // 2. [await] Web Crypto API 是异步的
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        
        // 3. 转换为 Hex 字符串
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        st_api.writeLine(hashHex);

    } catch (e) {
        st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
    }
})();
