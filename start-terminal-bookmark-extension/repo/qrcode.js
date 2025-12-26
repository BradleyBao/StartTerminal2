/*
 * qrcode.js — ASCII QR generator for Start Terminal 2.0
 * FIXED: proper 3-state matrix (null / true / false)
 */

function generateQRMatrix(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i) & 0xff);
    }

    if (bytes.length > 17) {
        throw new Error("input too long (max 17 bytes)");
    }

    const size = 21;

    // ✅ 三态矩阵：null = empty
    const m = Array.from({ length: size }, () => Array(size).fill(null));

    function placeFinder(x, y) {
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

    placeFinder(0, 0);
    placeFinder(size - 7, 0);
    placeFinder(0, size - 7);

    // timing pattern
    for (let i = 8; i < size - 8; i++) {
        m[6][i] = i % 2 === 0;
        m[i][6] = i % 2 === 0;
    }

    // ---- data bits ----
    let bits = [];

    // byte mode
    bits.push(0, 1, 0, 0);

    for (let i = 7; i >= 0; i--) {
        bits.push((bytes.length >> i) & 1);
    }

    for (const b of bytes) {
        for (let i = 7; i >= 0; i--) {
            bits.push((b >> i) & 1);
        }
    }

    bits.push(0, 0, 0, 0); // terminator

    let x = size - 1;
    let y = size - 1;
    let dirUp = true;
    let idx = 0;

    while (x > 0) {
        if (x === 6) x--; // skip timing col

        for (let i = 0; i < size; i++) {
            const yy = dirUp ? y - i : i;

            for (let dx = 0; dx < 2; dx++) {
                const xx = x - dx;
                if (m[yy][xx] !== null) continue;

                m[yy][xx] = bits[idx++] === 1;
            }
        }

        dirUp = !dirUp;
        x -= 2;
    }

    return m;
}

// ---------- CLI ----------

try {
    const text = args.join(" ");
    if (!text) {
        st_api.writeLine("Usage: qrcode <text>");
        return;
    }

    const matrix = generateQRMatrix(text);
    const size = matrix.length;
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
                matrix[y][x] === true;
            line += dark ? BLACK : WHITE;
        }
        out += line + "\n";
    }

    st_api.write(out);

} catch (e) {
    st_api.writeError("qrcode error: " + e.message);
}
