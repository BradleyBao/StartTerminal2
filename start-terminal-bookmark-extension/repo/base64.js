// base64.js
try {
    const isDecode = args.includes('-d') || args.includes('--decode');
    let input;
    
    const contentArgs = args.filter(arg => arg !== '-d' && arg !== '--decode');
    
    if (pipedInput) {
        input = pipedInput.join('\n');
    } else if (contentArgs.length > 0) {
        input = contentArgs.join(' ');
    } else {
        st_api.writeHtml('<span class="term-error">Usage: echo "text" | base64</span>');
        st_api.writeHtml('<span class="term-error">       base64 "text"</span>');
        st_api.writeHtml('<span class="term-error">       base64 -d "dGV4dA=="</span>');
        return;
    }

    if ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))) {
        input = input.slice(1, -1);
    }

    if (isDecode) {
        st_api.writeLine(atob(input));
    } else {
        st_api.writeLine(btoa(input));
    }
} catch (e) {
    st_api.writeHtml(`<span class="term-error">${e.message}</span>`);
}
