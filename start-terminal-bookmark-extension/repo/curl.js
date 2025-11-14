(async () => {
    const url = args[0];
    if (!url) {
        st_api.writeHtml('<span class="term-error">Usage: curl <url></span>');
        return;
    }
    
    try {
        st_api.writeLine(`Fetching ${url}...`);
        const response = await fetch(url, { cache: 'no-store' });
        const text = await response.text();
        st_api.writeLine(text); // 打印纯文本响应
    } catch(e) {
        st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
        st_api.writeHtml(`<span class="term-error">Did you 'sudo apt install curl' to grant host permissions?</span>`);
    }
})();
