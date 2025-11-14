//
// === sandbox.js (已修复) ===
// (这个脚本在沙盒中运行，无法访问 chrome.* API)
//

window.addEventListener('message', (event) => {
    // 1. 安全检查 (保持注释)
    // if (event.origin !== `chrome-extension://${chrome.runtime.id}`) {
    //     return;
    // }

    const { scriptString, args, pipeInput } = event.data;

    // 2. 构建 "Bridge API" (st_api)
    const st_api = {
        _source: event.source,
        _origin: event.origin,

        _post: function(type, payload) {
            this._source.postMessage({ type, payload }, this._origin);
        },
        writeLine: function(msg) {
            this._post('writeLine', String(msg));
        },
        writeHtml: function(html) {
            this._post('writeHtml', html);
        }
    };

    try {
        // 3. [!!] 在沙盒中安全执行 [!!]
        // [!! 核心修复：添加 'return' !!]
        // 我们必须 explicitly 'return' 脚本的结果,
        // 这样 'result' 才能捕获到 async IIFE 返回的 Promise
        const userFunction = new Function('st_api', 'args', 'pipedInput', `return ${scriptString}`);
        
        // 4. 执行函数
        const result = userFunction(st_api, args, pipeInput);

        // 5. 检查返回的是否是一个 Promise
        if (result && typeof result.then === 'function') {
            // 它是一个 Promise，等待它
            result.then(asyncResult => {
                // 6a. Promise 成功
                st_api._post('result', asyncResult);
            }).catch(e => {
                // 6b. Promise 失败 (e.g., fetch 失败)
                st_api._post('error', e.message);
            });
        } else {
            // 5b. 这是一个同步脚本 (e.g., base64)，立即发送结果
            st_api._post('result', result);
        }

    } catch (e) {
        // 6c. 这是一个语法错误 (e.g., await 不在 async 中)
        st_api._post('error', e.message);
    }
});