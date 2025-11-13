//
// === cowsay.js (Sandbox) ===
//
const cow = "\\n" +
"        \\   ^__^ \\n" +
"         \\  (oo)\\_______ \\n" +
"            (__)\\       )\\/\\ \\n" +
"                ||----w | \\n" +
"                ||     || \\n";

let msg = (args[0] || "Moo!");
if (pipedInput) { msg = pipedInput.join(' '); }

st_api.writeLine(" " + "_".repeat(msg.length + 2));
st_api.writeLine("< " + msg + " >");
st_api.writeLine(" " + "-".repeat(msg.length + 2));
st_api.writeHtml(cow); // use writeHtml

return "Cow delivered."; 
