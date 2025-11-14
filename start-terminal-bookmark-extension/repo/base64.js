// base64.js
try {
    const isDecode = args.includes('-d') || args.includes('--decode');
    let input;
    
    if (pipedInput) {
        input = pipedInput.join('\n');
    } else if (args[0] && args[0] !== '-d' && args[0] !== '--decode') {
        input = args.join(' ');
    } else {
        st_api.writeHtml('<span class="term-error">Usage: echo "text" | base64</span>');
        st_api.writeHtml('<span class="term-error">       base64 "text"</span>');
        st_api.writeHtml('<span class="term-error">       base64 -d "dGV4dA=="</span>');
        return;
    }

    if (isDecode) {
        st_api.writeLine(atob(input));
    } else {
        st_api.writeLine(btoa(input));
    }
} catch (e) {
    st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
}
