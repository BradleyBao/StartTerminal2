// qrcode.js
const text = args.join(' ');
if (!text) {
    st_api.writeHtml('<span class="term-error">Usage: qrcode <text></span>');
} else {
    const encoded = encodeURIComponent(text);
    // Use Public API
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encoded}`;
    // Use Image Tag - Experimental
    st_api.writeHtml(`<img src="${url}" alt="QR Code" style="margin: 10px; border: 2px solid white;">`);
}