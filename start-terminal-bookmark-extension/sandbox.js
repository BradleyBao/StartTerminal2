//
// === sandbox.js ===
// (这个脚本在沙盒中运行，无法访问 chrome.* API)
//

window.addEventListener('message', (event) => {
    // 1. 安全检查：只接受来自拓展本身的 event
    // if (event.origin !== `chrome-extension://${chrome.runtime.id}`) {
    //     return;
    // }

    const { scriptString, args, pipeInput } = event.data;

    // 2. 构建一个 "Bridge API" (st_api)
    // 这是沙盒中的脚本唯一能与外界通信的方式
    const st_api = {
        _source: event.source,
        _origin: event.origin,

        // 发送消息回 terminal.js
        _post: function(type, payload) {
            this._source.postMessage({ type, payload }, this._origin);
        },

        // API: 打印一行
        writeLine: function(msg) {
            this._post('writeLine', String(msg));
        },
        
        // API: 打印 HTML
        writeHtml: function(html) {
            this._post('writeHtml', html);
        }
    };

    try {
        // 3. [!!] 在沙盒中安全执行 [!!]
        // 我们将用户的脚本字符串转换为一个函数
        const userFunction = new Function('st_api', 'args', 'pipedInput', scriptString);
        
        // 4. 执行函数并传入 API 和参数
        const result = userFunction(st_api, args, pipeInput);

        // 5. 将最终的 "return" 值发回
        st_api._post('result', result);

    } catch (e) {
        // 6. 将错误发回
        st_api._post('error', e.message);
    }
});