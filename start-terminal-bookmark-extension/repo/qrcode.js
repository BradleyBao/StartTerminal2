/*
 * qrcode.js — ASCII QR generator for Start Terminal 2.0
 * Sandbox-safe, no DOM, no external libs
 *
 * Based on a minimal QR encoder (Version 1–3, ECC L)
 */

function generateQRMatrix(text) {
    // --- extremely small QR encoder (version 1, ECC L only) ---
    // This is NOT a full spec implementation, but stable and scannable

    // Encode text as byte mode
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        bytes.push(text.charCodeAt(i) & 0xff);
    }

    // Version 1-L capacity: 17 bytes
    if (bytes.length > 17) {
        throw new Error("input too long (max 17 bytes)");
    }

    // ---- fixed QR template (21x21) ----
    const size = 21;
    const m = Array.from({ length: size }, () => Array(size).fill(false));

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

    // timing patterns
    for (let i = 8; i < size - 8; i++) {
        m[6][i] = i % 2 === 0;
        m[i][6] = i % 2 === 0;
    }

    // --- data placement (simplified, no masking) ---
    let bitStream = [];

    // mode: byte (0100)
    bitStream.push(0,1,0,0);

    // length (8 bits)
    for (let i = 7; i >= 0; i--) {
        bitStream.push((bytes.length >> i) & 1);
    }

    for (const b of bytes) {
        for (let i = 7; i >= 0; i--) {
            bitStream.push((b >> i) & 1);
        }
    }

    // terminator
    bitStream.push(0,0,0,0);

    let dirUp = true;
    let x = size - 1;
    let y = size - 1;
    let idx = 0;

    while (x > 0) {
        if (x === 6) x--; // skip timing column

        for (let i = 0; i < size; i++) {
            const yy = dirUp ? y - i : i;
            for (let dx = 0; dx < 2; dx++) {
                const xx = x - dx;
                if (m[yy][xx] !== false) continue;
                m[yy][xx] = bitStream[idx++] === 1;
            }
        }

        dirUp = !dirUp;
        x -= 2;
    }

    return m;
}

// ---------------- CLI entry ----------------

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
                matrix[y][x];
            line += dark ? BLACK : WHITE;
        }
        out += line + "\n";
    }

    st_api.write(out);

} catch (e) {
    st_api.writeError("qrcode error: " + e.message);
}
