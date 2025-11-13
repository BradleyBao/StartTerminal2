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

// 气泡部分 (这部分本来就是对的)
st_api.writeLine(" " + "_".repeat(msg.length + 2));
st_api.writeLine("< " + msg + " >");
st_api.writeLine(" " + "-".repeat(msg.length + 2));

// 奶牛部分 (现在会正确换行)
st_api.writeHtml(cow);

return "Cow delivered.";
