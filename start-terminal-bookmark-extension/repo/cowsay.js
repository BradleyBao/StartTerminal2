//
// === cowsay.js (沙盒代码) [已修复] ===
//

// 修复：使用 \n (单反斜杠) 代替 \\n (双反斜杠)
const cow = "\n" +
"        \\   ^__^\n" +
"         \\  (oo)\\_______\n" +
"            (__)\\       )\\/\\\n" +
"                ||----w |\n" +
"                ||     ||\n";

let msg = (args[0] || "Moo!");
if (pipedInput) { msg = pipedInput.join(' '); }

// --- 1. 自动换行辅助函数 ---
function wordWrap(str, maxWidth) {
    const words = str.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        if (currentLine.length + 1 + word.length <= maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

// 设置最大宽度 (例如 40 字符)
const MAX_WIDTH = 40;
const lines = wordWrap(msg, MAX_WIDTH);

// --- 2. 计算气泡最大宽度 ---
let maxLen = 0;
for (const line of lines) {
    if (line.length > maxLen) maxLen = line.length;
}

// --- 3. 绘制气泡 ---
// 顶盖
st_api.writeLine(" " + "_".repeat(maxLen + 2));

// 内容行
if (lines.length === 1) {
    // 单行模式: < msg >
    st_api.writeLine("< " + lines[0] + " >");
} else {
    // 多行模式
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const padding = " ".repeat(maxLen - line.length);
        let border = "|";
        
        if (i === 0) border = "/";        // 第一行左边
        else if (i === lines.length - 1) border = "\\"; // 最后一行左边
        
        let rightBorder = "|";
        if (i === 0) rightBorder = "\\";  // 第一行右边
        else if (i === lines.length - 1) rightBorder = "/"; // 最后一行右边
        
        // 如果是中间行，使用 | ... |
        if (i > 0 && i < lines.length - 1) {
            border = "|";
            rightBorder = "|";
        }

        st_api.writeLine(`${border} ${line}${padding} ${rightBorder}`);
    }
}

// 底盖
st_api.writeLine(" " + "-".repeat(maxLen + 2));

// --- 4. 绘制奶牛 ---
st_api.writeHtml(cow);

return "Cow delivered.";
