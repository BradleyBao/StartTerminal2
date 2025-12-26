/*
 * qrcode.js — Terminal-grade ASCII QR
 * Uses Nayuki QR algorithm (logic only)
 */

function makeQR(text) {
    // ---- encode to UTF-8 bytes ----
    const bytes = [];
    for (const ch of new TextEncoder().encode(text)) {
        bytes.push(ch);
    }

    // ---- choose smallest version (1–4) ----
    let version = null;
    let size = null;

    const CAPACITY = {
        1: 17,
        2: 32,
        3: 53,
        4: 78
    };

    for (let v = 1; v <= 4; v++) {
        if (bytes.length <= CAPACITY[v]) {
            version = v;
            size = 21 + (v - 1) * 4;
            break;
        }
    }

    if (!version) {
        throw new Error("input too long for terminal QR (max ~78 bytes)");
    }

    // ---- create empty matrix ----
    const m = Array.from({ length: size }, () => Array(size).fill(null));

    // ---- finder patterns ----
    function finder(x, y) {
        for (let dy = -1; dy <= 7; dy++) {
            for (let dx = -1; dx <= 7; dx++) {
                const xx = x + dx;
                const yy = y + dy;
                if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
                const on =
                    dx >= 0 && dx <= 6 &&
                    dy >= 0 && dy <= 6 &&
                    (dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
                     (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
                m[yy][xx] = on;
            }
        }
    }

    finder(0, 0);
    finder(size - 7, 0);
    finder(0, size - 7);

    // ---- timing ----
    for (let i = 8; i < size - 8; i++) {
        m[6][i] = i % 2 === 0;
        m[i][6] = i % 2 === 0;
    }

    // ---- build bitstream (byte mode) ----
    const bits = [];

    bits.push(0, 1, 0, 0); // byte mode
    for (let i = 7; i >= 0; i--) bits.push((bytes.length >> i) & 1);

    for (const b of bytes) {
        for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
    }

    bits.push(0, 0, 0, 0);

    // ---- place data (zigzag) ----
    let x = size - 1;
    let dirUp = true;
    let bi = 0;

    while (x > 0) {
        if (x === 6) x--;
        for (let i = 0; i < size; i++) {
            const y = dirUp ? size - 1 - i : i;
            for (let dx = 0; dx < 2; dx++) {
                const xx = x - dx;
                if (m[y][xx] !== null) continue;
                m[y][xx] = bits[bi++] === 1;
            }
        }
        dirUp = !dirUp;
        x -= 2;
    }

    return m;
}

// ---- CLI ----
try {
    const text = args.join(" ");
    if (!text) {
        st_api.writeLine("Usage: qrcode <text>");
        return;
    }

    const qr = makeQR(text);
    const size = qr.length;
    const margin = 2;

    const BLACK = "██";
    const WHITE = "  ";

    let out = "";

    for (let y = -margin; y < size + margin; y++) {
        let line = "";
        for (let x = -margin; x < size + margin; x++) {
            const dark =
                x >= 0 && y >= 0 &&
                x < size && y < size &&
                qr[y][x] === true;
            line += dark ? BLACK : WHITE;
        }
        out += line + "\n";
    }

    st_api.write(out);

} catch (e) {
    st_api.writeError("qrcode: " + e.message);
}
