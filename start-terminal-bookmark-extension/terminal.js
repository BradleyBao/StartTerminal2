// Helper Function 
function loadStyleSettings() {
    const savedFont = localStorage.getItem('terminalFontFamily');
    const savedSize = localStorage.getItem('terminalFontSize');

    // 获取 CSS 中定义的默认值作为回退
    const rootStyle = getComputedStyle(document.documentElement);
    const defaultFont = rootStyle.getPropertyValue('--terminal-font-family').trim() || "'Consolas', 'Courier New', monospace";
    const defaultSize = rootStyle.getPropertyValue('--terminal-font-size').trim() || '14px';

    const fontFamily = savedFont || defaultFont;
    const fontSize = savedSize || defaultSize;

    console.log("Loading styles - Font:", fontFamily, "Size:", fontSize); // Debug

    document.documentElement.style.setProperty('--terminal-font-family', fontFamily);
    document.documentElement.style.setProperty('--terminal-font-size', fontSize);

     // 返回加载的值，以便 main 函数可以传递给 term
     return { fontFamily, fontSize };
}

/**
 * 将当前样式设置保存到 localStorage
 */
function saveStyleSettings() {
    const currentFont = getComputedStyle(document.documentElement).getPropertyValue('--terminal-font-family').trim();
    const currentSize = getComputedStyle(document.documentElement).getPropertyValue('--terminal-font-size').trim();

    localStorage.setItem('terminalFontFamily', currentFont);
    localStorage.setItem('terminalFontSize', currentSize);
    console.log("Saved styles - Font:", currentFont, "Size:", currentSize); // Debug
}

/**
 * 核心终端模拟器类
 */
class Terminal {

    constructor(containerId, inputHandlerId) {
        this.container = document.getElementById(containerId);
        this.inputHandler = document.getElementById(inputHandlerId);

        // 0. Global Var 
        this.startTimes = 0;    // 记录启动次数

        // 1. 缓冲区和尺寸
        this.rows = 0;
        this.cols = 0;
        this.cellWidth = 0;
        this.cellHeight = 0;
        this.buffer = []; // 核心：屏幕缓冲区 (string[])
        this.domBuffer = document.createElement('pre');
        this.domBuffer.id = 'terminal-buffer';
        this.container.appendChild(this.domBuffer);

        // 2. 光标和输入状态
        this.cursorX = 0;
        this.cursorY = 0;
        this.prompt = '';
        this.currentLine = ''; // 用户当前输入的命令
        this.onCommand = null; // 用户按回车键的回调

        // 3. 初始化
        this._calculateDimensions();
        this._initBuffer();
        this._attachListeners();
        this.focus();
    }

    /**
     * 测量单个字符的尺寸，并计算行列数
     */
    async _calculateDimensions() {
        const tempChar = document.createElement('span');
        tempChar.textContent = 'W'; // 使用一个标准字符进行测量

        // --- 核心修复：确保测量时使用正确的字体样式 ---
        // 1. 获取 buffer 最终应用的样式
        const bufferStyle = window.getComputedStyle(this.domBuffer);
        // 2. 将这些样式应用到临时 span
        tempChar.style.fontFamily = bufferStyle.fontFamily;
        tempChar.style.fontSize = bufferStyle.fontSize; // 也最好同步字号
        tempChar.style.lineHeight = bufferStyle.lineHeight; // 关键：同步行高
        tempChar.style.whiteSpace = 'pre'; // 确保与 pre 行为一致
        // --- 结束修复 ---

        // 将带有正确样式的 span 添加到 DOM 以进行测量
        // 最好添加到 buffer 内部，以确保继承环境最相似
        this.domBuffer.appendChild(tempChar);
        this.cellWidth = tempChar.getBoundingClientRect().width;
        this.cellHeight = tempChar.getBoundingClientRect().height; // 现在这个高度应该更准确
        this.domBuffer.removeChild(tempChar);

        // 使用准确的 cellHeight 计算行数
        const containerHeight = this.container.clientHeight;
        const containerWidth = this.container.clientWidth;

        this.rows = Math.floor(containerHeight / this.cellHeight);
        // 考虑行高可能不完全等于字体高度，留一点余地可能更好
        // this.rows = Math.max(1, Math.floor(containerHeight / this.cellHeight) -1); // 减1行试试？

        this.cols = Math.floor(containerWidth / this.cellWidth);

        // Optional : 进行微调，确保缓冲区宽度与容器宽度匹配
        const testLine = document.createElement('span');
        testLine.textContent = ' '.repeat(this.cols);
        this.domBuffer.appendChild(testLine);
        const actualWidth = testLine.getBoundingClientRect().width;
        this.domBuffer.removeChild(testLine);

        if (actualWidth > containerWidth) {
            this.cols -= 1; // buffer 太宽，减少一列
        } else if (actualWidth < containerWidth - this.cellWidth) {
            this.cols += 1; // buffer 太窄，增加一列
        }
    }

    /**
     * 用空格初始化缓冲区（这就是你说的“填满屏幕的空格”）
     */
    _initBuffer() {
        this.buffer = [];
        for (let i = 0; i < this.rows; i++) {
            this.buffer.push(' '.repeat(this.cols));
        }
        this.cursorX = 0;
        this.cursorY = 0;
    }

    /**
     * 绑定所有事件监听器
     */
    _attachListeners() {
        // 捕获所有键盘输入
        this.inputHandler.addEventListener('keydown', (e) => this._handleKeydown(e));
        // 捕获中文输入法 (IME) 或粘贴
        this.inputHandler.addEventListener('input', (e) => this._handleInput(e));
        // 点击终端时，始终聚焦到隐藏的输入框
        this.container.addEventListener('click', () => this.focus());
        // 窗口大小调整时，重新计算
        window.addEventListener('resize', () => this._handleResize());
    }

    /**
     * 聚焦到隐藏的 textarea
     */
    focus() {
        this.inputHandler.focus();
    }

    /**
     * 核心渲染函数：将 JS 缓冲区 "绘制" 到 DOM
     */
    _render() {
        let html = '';
        for (let y = 0; y < this.rows; y++) {
            let line = this.buffer[y]; // Line from buffer (might contain HTML)
            
            if (y === this.cursorY && !this.inputDisabled) {
                // --- Input/Output Separation Logic (No Change Here) ---
                const promptHtml = this.escapeHtml(this.prompt);
                const inputHtml = this.escapeHtml(this.currentLine);
                const fullLineText = this.prompt + this.currentLine;
                const padding = ' '.repeat(Math.max(0, this.cols - fullLineText.length));
                
                const charAtCursor = fullLineText[this.cursorX] || ' ';
                line = this.escapeHtml(fullLineText.substring(0, this.cursorX)) +
                        `<span class="term-cursor">${this.escapeHtml(charAtCursor)}</span>` +
                        this.escapeHtml(fullLineText.substring(this.cursorX + 1)) +
                        padding; 
                        
                html += line + '\n';
                // --- End Input/Output Separation ---
            
            } else {
                // --- FIX: Do NOT escape the buffer content here! ---
                // It should already contain the intended HTML or escaped text.
                html += line + '\n'; 
                // --- END FIX ---
            }
        }
        this.domBuffer.innerHTML = html;
    }

    /**
     * 缓冲区向上滚动一行
     */
    _scrollUp() {
        this.buffer.shift(); // 移除第一行
        this.buffer.push(' '.repeat(this.cols)); // 在末尾添加一个新空行
    }

    /**
     * 处理换行符（光标移到下一行开头）
     */
    _handleNewline() {
        this.cursorY++;
        this.cursorX = 0;
        if (this.cursorY >= this.rows) {
            this._scrollUp();
            this.cursorY = this.rows - 1; // 光标保持在最后一行
        }
    }

    /**
     * 在当前光标位置写入单个字符串（无换行）
     * @param {string} text 要写入的文本
     */
    _writeSingleLine(htmlFragment) { // 重命名参数以清晰表明它可能包含 HTML
        // 首先计算可见内容的长度，用于换行判断
        const textContent = this._stripHtml(htmlFragment);
        const visibleLength = textContent.length;

        if (visibleLength === 0) return; // 如果片段为空，则无需处理

        if (this.cursorX + visibleLength > this.cols) {
            // --- 需要自动换行 ---
            const spaceLeft = this.cols - this.cursorX;

            if (spaceLeft <= 0) {
                    // 当前行已满或光标已超出，先换行
                    this._handleNewline();
                    // 然后尝试在下一行写入整个片段（可能再次触发换行）
                    this._writeSingleLine(htmlFragment); // 递归调用
            } else {
                    // 当前行还有空间，先写入能容纳的部分
                    const part1 = this._truncateHtml(htmlFragment, spaceLeft);
                    // --- 关键调用点 1 ---
                    this.buffer[this.cursorY] = this._overwriteHtml(this.buffer[this.cursorY], this.cursorX, part1);

                    // 换到下一行
                    this._handleNewline();

                    // 获取剩余部分
                    const remainingVisibleLength = visibleLength - spaceLeft;
                    // --- 修复：确保正确获取 part2 ---
                    // 我们需要从原始 htmlFragment 中截取，而不是从 textContent
                    // start 参数应为 spaceLeft (跳过已写入的部分)
                    const part2 = this._truncateHtml(htmlFragment, remainingVisibleLength, spaceLeft);
                    // --- 结束修复 ---

                    // 如果剩余部分有实际内容，则递归写入
                    if (this._stripHtml(part2).length > 0) {
                        this._writeSingleLine(part2); // 递归调用
                    }
            }
        } else {
            // --- 不需要换行，片段完全适合当前行 ---
            // --- 关键调用点 2 ---
            this.buffer[this.cursorY] = this._overwriteHtml(this.buffer[this.cursorY], this.cursorX, htmlFragment);
            this.cursorX += visibleLength; // 更新光标位置
        }
    }

    /**
     * [公共] 打印一行文本（这是你的新 "print" 函数）
     * @param {string} text
     */
    writeLine(text) {
        const textString = String(text);
        
        // 功能 1：管道支持
        if (isPiping) {
            pipeBuffer.push(textString);
            return;
        }

        this.writeHtml(this.escapeHtml(textString));
    }

    /**
     * [公共] 设置并显示提示符
     * @param {string} promptText
     */
    setPrompt(promptText) {
        this.prompt = promptText;
        this.cursorX = 0;
        this.currentLine = '';
        this._writeSingleLine(this.prompt);
        this._render();
    }

    parseLine(line) {
        const commandStrings = line.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
        const parsedCommands = [];

        for (const commandStr of commandStrings) {
            const parsed = this.parseSingleCommand(commandStr);
            if (parsed) {
                parsedCommands.push(parsed);
            } else {
                // If any part fails to parse, you might want to stop or log an error
                // For now, we'll just skip the invalid part
                console.error(`Failed to parse command segment: "${commandStr}"`);
            }
        }
        
        return parsedCommands;
    } 

    parseSingleCommand(commandStr) {
        const tokens = commandStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);

        if (!tokens || tokens.length === 0) {
            return null; // Empty or invalid command string
        }

        const commandName = tokens[0];
        const args = [];
        const options = {};

        for (let i = 1; i < tokens.length; i++) {
            let token = tokens[i];

            // Handle quoted arguments - remove the quotes
            if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
                token = token.slice(1, -1);
                args.push(token); // Quoted strings are always arguments
                continue;
            }

            // Handle options
            if (token.startsWith('--')) { // Long option (e.g., --all)
                const optName = token.substring(2);
                if (optName) {
                    options[optName] = true; 
                }
            } else if (token.startsWith('-')) { // Short option(s) (e.g., -a, -l, -al)
                const optString = token.substring(1);
                if (optString.length > 0) {
                    for (const char of optString) {
                        options[char] = true; // Set each char as an option
                    }
                }
            } else {
                // It's an argument
                args.push(token);
            }
        }
        

        return { command: commandName, args: args, options: options };
    }

    _stripHtml(html) {
        // const doc = new DOMParser().parseFromString(html, 'text/html');
        // return doc.body.textContent || "";
        return html.replace(/<[^>]*>/g, '');
    }

    _overwriteHtml(originalLine, atIndex, newHtmlFragment) {
        // Calculate the visible length of the fragment to insert
        const fragmentVisibleLength = this._stripHtml(newHtmlFragment).length;

        // Take the part of the original line before the insertion point
        let before = originalLine.substring(0, atIndex);
        // Ensure 'before' has enough padding if inserting beyond current content
        if (before.length < atIndex) {
            before += ' '.repeat(atIndex - before.length);
        }

        // Combine the 'before' part and the new fragment
        let combined = before + newHtmlFragment;

        // Calculate the visible length of the combined string so far
        let visibleLength = this._stripHtml(combined).length;

        // Calculate padding needed to fill the rest of the line up to this.cols
        let paddingNeeded = Math.max(0, this.cols - visibleLength);
        let padding = ' '.repeat(paddingNeeded);

        // Return the combined string plus padding
        let result = combined + padding;

        // Final safety check: ensure the visible length doesn't exceed cols.
        let finalVisibleLength = this._stripHtml(result).length;
        if (finalVisibleLength > this.cols) {
            // Use the _truncateHtml helper to cut based on visible length
            // Ensure truncation happens correctly even if combined itself was already too long
            if (visibleLength > this.cols) {
                result = this._truncateHtml(combined, this.cols); // Truncate combined first
            } else {
                // If combined was okay, but padding made it too long (unlikely with spaces), just truncate result
                result = this._truncateHtml(result, this.cols);
            }
        }

        return result;
    }

    _truncateHtml(html, length, start = 0) {
        const text = this._stripHtml(html);
        // Simplified truncation, might break mid-tag in complex HTML
        let count = 0;
        let endIndex = start;
        for (let i = start; i < html.length && count < length; i++) {
            if (html[i] === '<') {
                while (i < html.length && html[i] !== '>') {
                    endIndex++; i++;
                }
                if(i < html.length) endIndex++;
            } else {
                count++; endIndex++;
            }
        }
        return html.substring(start, endIndex);
    }

    writeHtml(html) {
        // 功能 1：管道支持
        if (isPiping) {
            pipeBuffer.push(this._stripHtml(html)); // 管道中只应传递纯文本
            return;
        }
        
        const lines = html.split('\n');
        for (let i = 0; i < lines.length; i++) {
            this._writeSingleLine(lines[i]);
            if (i < lines.length - 1) { // 显式处理换行符
                this._handleNewline();
            }
        }
        this._handleNewline(); // 默认在每次打印后换行
        this._render();
    }

    disableInput() {
        this.inputDisabled = true;
        this._render(); // 重绘以隐藏光标
    }

    enableInput() {
        this.inputDisabled = false;
        this.focus();
        this._render(); // 重绘以显示光标
    }

    /**
     * 处理按键（非 IME）
     */
    _handleKeydown(e) {
        // 阻止 F5, Tab 等默认行为，但允许 Ctrl+C/V/R 等
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
        } else if (e.key === "Backspace" || e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
        }

        if (e.key === 'Enter') {
            const command = this.currentLine;
            this._handleNewline(); // 换行
            
            // 触发命令执行
            if (this.onCommand) {
                this.onCommand(command);
            }
            
            this.currentLine = ''; // 清空当前行
            // (注意：这里我们不立即显示提示符，我们等待命令执行完毕后)
            // (在我们的例子中，命令会立即在回调中显示提示符)

        } else if (e.key === 'Backspace') {
            if (this.currentLine.length > 0) {
                this.currentLine = this.currentLine.slice(0, -1);
                // "擦除" 屏幕上的最后一个字符
                this.cursorX--;
                this.buffer[this.cursorY] = this.buffer[this.cursorY].substring(0, this.cursorX) + 
                                            ' ' + 
                                            this.buffer[this.cursorY].substring(this.cursorX + 1);
            }
        } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            // 普通字符输入
            this.currentLine += e.key;
            this._writeSingleLine(e.key); // 将字符写入缓冲区

        }
        
        this._render(); // 每次按键后都重绘
    }

    /**
     * 处理 IME 输入或粘贴
     */
    _handleInput(e) {
        const text = e.target.value;
        if (text) {
            this.currentLine += text;
            this._writeSingleLine(text);
            this._render();
        }
        // 立即清空 textarea，为下一次输入做准备
        e.target.value = '';
    }

    /**
     * 处理窗口大小调整
     */
    async _handleResize() {
        // 这是一个简化的重绘，它会清空屏幕
        await this._calculateDimensions();
        this._initBuffer();
        this.writeLine("--- Terminal resized. Buffer cleared. ---");
        this.setPrompt(this.prompt);
        this._render();
    }

    escapeHtml(unsafe) {
        return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
    }
}

class BookmarkSystem {
    constructor(termInstance) {
        this.term = termInstance; // 接收 Terminal 实例用于输出
        this.current = null;
        this.root = null;
        this.path = [];
        this.homeDirNode = null;
        this.full_path = "~ $"; // 默认提示符

        // --- 将命令实现移入此类 ---
        this.commands = {
            'cd': (args, options) => {
                const targetPath = args[0] || '~';
                if (targetPath === '..') {
                    if (this.path.length > 1) {
                        this.path.pop();
                        this.current = this.path[this.path.length - 1];
                    }
                } else {
                    const result = this._findNodeByPath(targetPath);
                    if (result && result.node && result.node.children) {
                        this.current = result.node;
                        this.path = result.newPathArray;
                    } else if (result && result.node) {
                        this.term.writeHtml(`<span class="term-error">cd: ${targetPath}: Not a directory</span>`);
                    } else {
                        this.term.writeHtml(`<span class="term-error">cd: ${targetPath}: No such file or directory</span>`);
                    }
                }
                this.update_user_path(); // cd 后更新路径
            },

            'ls': (args, options) => {
                let targetNode = this.current;
                if (args[0]) {
                    const result = this._findNodeByPath(args[0]);
                    if (result && result.node && result.node.children) {
                        targetNode = result.node;
                    } else if (result && result.node) {
                            this.term.writeHtml(`<span class="term-error">ls: ${args[0]}: Not a directory</span>`);
                            return;
                    } else {
                        this.term.writeHtml(`<span class="term-error">ls: ${args[0]}: No such directory</span>`);
                        return;
                    }
                }

                let children = targetNode.children || [];
                if (!options.a) { 
                    children = children.filter(child => !child.title.startsWith('.'));
                }
                
                for (const child of children) {
                    if (child.children) {
                        this.term.writeHtml(`<span class="term-folder">${child.title}/</span>`);
                    } else {
                        this.term.writeLine(child.title); 
                    }
                }
            },
            
            'mkdir': async (args, options) => {
                if (!args[0]) {
                    this.term.writeHtml(`<span class="term-error">mkdir: missing operand</span>`);
                    return;
                }
                const dirName = args[0];
                if (this._findChildByTitle(this.current.children, dirName)) {
                    this.term.writeHtml(`<span class="term-error">mkdir: ${dirName}: File exists</span>`);
                    return;
                }
                await new Promise(resolve => {
                    chrome.bookmarks.create({ parentId: this.current.id, title: dirName }, resolve);
                });
            },
            
            'rmdir': async (args, options) => {
                if (!args[0]) {
                    this.term.writeHtml(`<span class="term-error">rmdir: missing operand</span>`);
                    return;
                }
                const target = this._findChildByTitle(this.current.children, args[0]);
                if (!target) {
                    this.term.writeHtml(`<span class="term-error">rmdir: ${args[0]}: No such file or directory</span>`);
                } else if (!target.children) {
                    this.term.writeHtml(`<span class="term-error">rmdir: ${args[0]}: Not a directory</span>`);
                } else if (target.children.length > 0) {
                    this.term.writeHtml(`<span class="term-error">rmdir: ${args[0]}: Directory not empty</span>`);
                } else {
                    await new Promise(resolve => chrome.bookmarks.remove(target.id, resolve));
                }
            },
            
            'rm': async (args, options) => {
                if (!args[0]) {
                    this.term.writeHtml(`<span class="term-error">rm: missing operand</span>`);
                    return;
                }
                const target = this._findChildByTitle(this.current.children, args[0]);
                if (!target) {
                    this.term.writeHtml(`<span class="term-error">rm: ${args[0]}: No such file or directory</span>`);
                    return;
                }
                
                const recursive = options.r || options.recurse;
                
                if (target.children && !recursive) {
                    this.term.writeHtml(`<span class="term-error">rm: ${args[0]}: Is a directory (use -r)</span>`);
                } else if (target.children && recursive) {
                    await this._removeRecursive(target.id);
                } else {
                    await new Promise(resolve => chrome.bookmarks.remove(target.id, resolve));
                }
            },
            'pwd': (args, options) => {
                let displayPath;
                // 核心修复：移除所有对 '~' 的特殊处理
                // 始终从根目录开始构建路径
                if (!this.root) {
                        displayPath = "/"; // 容错处理
                } else if (this.path.length <= 1) {
                        displayPath = "/"; // 根目录本身
                } else {
                        // 从 path 数组的第二个元素（根目录之后）开始
                        // 获取所有节点的 title 并用 '/' 连接
                        displayPath = "/" + this.path.slice(1).map(node => node.title).join("/");
                }
                this.term.writeLine(displayPath); // 使用 writeLine 输出纯文本
            }
        };
    }

    // --- 将书签相关的辅助函数移入此类 ---

    async initialize() {
            await this._refreshBookmarks();
    }

    async _refreshBookmarks() {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.warn("chrome.bookmarks API not available. Using mock data.");
            if (!this.root) {
                this.root = { id: '0', title: 'Root', children: [
                    { id: '1', title: 'Bookmarks Bar', children: [
                        { id: '3', title: 'Work', children: [] },
                        { id: '4', title: 'Personal', url: 'https://google.com' }
                    ] },
                    { id: '2', title: 'Other Bookmarks', children: [] }
                ]};
                this.homeDirNode = this.root.children[0];
                this.current = this.homeDirNode;
                this.path = [this.root, this.homeDirNode];
            }
            return; 
        }

        const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
        this.root = tree[0];
        this.homeDirNode = (this.root.children && this.root.children.length > 0) ? this.root.children[0] : this.root;
        
        if (this.path.length === 0) { 
                this.current = this.homeDirNode;
                this.path = [this.root, this.homeDirNode];
                return;
        }

        let tempCurrent = this.root;
        let tempPath = [this.root];
        let pathIsValid = true;
        
        for (let i = 1; i < this.path.length; i++) {
            const nodeId = this.path[i].id;
            const foundNode = (tempCurrent.children || []).find(c => c.id === nodeId);
            if (foundNode) {
                tempCurrent = foundNode;
                tempPath.push(foundNode);
            } else {
                pathIsValid = false;
                break;
            }
        }
        
        if (pathIsValid) {
            this.current = tempCurrent;
            this.path = tempPath;
        } else {
            this.current = this.homeDirNode;
            this.path = [this.root, this.homeDirNode];
        }
    }

    update_user_path() {
        let displayPath;
        if (!this.root || !this.homeDirNode) { 
                displayPath = "~";
        } else if (this.path.length >= 2 && this.path[0] === this.root && this.path[1] === this.homeDirNode) {
            displayPath = this.path.length === 2 ? "~" : "~/" + this.path.slice(2).map(p => p.title).join("/");
        } else if (this.path.length > 0) {
            const pathString = this.path.slice(1).map(p => p.title).join("/");
            displayPath = "/" + pathString;
        } else {
                displayPath = "/"; 
        }
        
        this.full_path = `user@ST2.0:${displayPath}$`;
        
        if (!this.term.inputDisabled) {
            this.term.setPrompt(this.full_path + " ");
        }
    }

    _findNodeByPath(pathStr) {
        if (!pathStr || !this.root || !this.homeDirNode) return null;

        let startNode;
        let newPathArray;
        let pathSegments;

        if (pathStr.startsWith('~/')) {
            startNode = this.homeDirNode;
            newPathArray = [this.root, this.homeDirNode];
            pathSegments = pathStr.substring(2).split('/').filter(s => s.length > 0);
        } else if (pathStr.startsWith('/')) {
            startNode = this.root;
            newPathArray = [this.root];
            pathSegments = pathStr.substring(1).split('/').filter(s => s.length > 0);
        } else {
            startNode = this.current;
            newPathArray = [...this.path];
            pathSegments = pathStr.split('/').filter(s => s.length > 0);
        }

        if (pathSegments.length === 0) {
            return { node: startNode, newPathArray: newPathArray };
        }

        let currentNode = startNode;
        for (let i = 0; i < pathSegments.length; i++) {
            const segment = pathSegments[i];
            if (!currentNode || !currentNode.children) return null; // 检查 currentNode 是否有效

            if (segment === '..') {
                if (newPathArray.length > 1) newPathArray.pop();
                currentNode = newPathArray[newPathArray.length - 1] || this.root;
                continue;
            }
            
            const foundNode = (currentNode.children || []).find(child => child.title === segment); // 添加保护
            if (foundNode) {
                currentNode = foundNode;
                // --- 修复：确保只有当找到的是目录时才更新路径 ---
                if (foundNode.children) {
                        // 检查 newPathArray 是否已经包含此节点，避免重复添加
                        if (!newPathArray.find(p => p.id === foundNode.id)) {
                            newPathArray.push(currentNode);
                        }
                } else if (i < pathSegments.length - 1) {
                        // 如果路径中间部分不是目录，则路径无效
                        return null;
                }
                // --- 结束修复 ---
            } else {
                return null;
            }
        }
        return { node: currentNode, newPathArray: newPathArray };
    }

    _findChildByTitle(children, title) {
        return (children || []).find(child => child.title === title);
    }
    
    _removeRecursive(nodeId) {
            if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            console.warn("chrome.bookmarks API not available. Skipping recursive remove.");
            return Promise.resolve(); // 返回一个 resolved Promise
        }
        return new Promise((resolve, reject) => {
            chrome.bookmarks.removeTree(nodeId, resolve);
        });
    }
}

// ===============================================
// =           初始化和使用 Terminal         =
// ===============================================

let isPiping = false;
let pipeBuffer = [];

const term = new Terminal('terminal-container', 'input-handler');
const bookmarkSystem = new BookmarkSystem(term); // 将 term 传给 BookmarkSystem

// --- 将非书签命令移到这里 ---
const globalCommands = {
        'grep': (args, options, pipedInput) => {
        if (!args[0]) {
            term.writeHtml(`<span class="term-error">grep: missing pattern</span>`);
            return;
        }
        if (!pipedInput) {
            term.writeHtml(`<span class="term-error">grep: requires piped input</span>`);
            return;
        }
        const pattern = new RegExp(args[0], 'i');
        const matches = pipedInput.filter(line => pattern.test(line));
        matches.forEach(line => term.writeLine(line));
        return matches;
    },
    
    'wc': (args, options, pipedInput) => {
        if (!pipedInput) {
            term.writeHtml(`<span class="term-error">wc: requires piped input</span>`);
            return;
        }
        const lines = pipedInput.length;
        const words = pipedInput.join(' ').split(/\s+/).filter(Boolean).length;
        const chars = pipedInput.join('\n').length;
        term.writeLine(` ${lines}  ${words}  ${chars}`);
    },
    'clear': (args, options) => {
        term._initBuffer();
    },
    'help': (args, options) => {
            term.writeLine("Welcome to Start Terminal 2");
            term.writeLine("Bookmark commands moved to BookmarkSystem.");
    },
        'echo': (args, options) => {
        term.writeLine(args.join(' ')); 
    },
    'greet': (args, options) => {
            const name = args[0]; 
        if (name) {
            term.writeLine(`你好, ${name}! 欢迎来到终端。`); 
            if (options.v || options.verbose) { 
                term.writeLine(" (Verbose mode enabled!)");
            }
        } else {
            term.writeLine("用法: greet [你的名字] [-v or --verbose]");
        }
    },
    'style': async (args, options) => { // 注意：设为 async 以便 await _handleResize
        const subCommand = args[0];
        const value = args.slice(1).join(' '); // 获取子命令之后的所有内容作为值

        const rootStyle = getComputedStyle(document.documentElement);
        const currentFont = rootStyle.getPropertyValue('--terminal-font-family').trim();
        const currentSize = rootStyle.getPropertyValue('--terminal-font-size').trim();

        if (!subCommand) {
            // 显示当前设置
            term.writeLine(`Current font: ${currentFont}`);
            term.writeLine(`Current size: ${currentSize}`);
            term.writeLine(`Usage:`);
            term.writeLine(`  style font <font-family>`);
            term.writeLine(`  style size <css-size>`);
            term.writeLine(`  style reset`);
            return; // 不需要返回 Promise
        }

        let needsResize = false;

        switch (subCommand.toLowerCase()) {
            case 'font':
                if (!value) {
                    term.writeHtml(`<span class="term-error">Usage: style font &lt;font-family&gt;</span>`);
                    return;
                }
                // 基本验证 (可以更复杂，例如检查字体是否可用)
                if (value.length < 3) {
                     term.writeHtml(`<span class="term-error">Invalid font family: "${value}"</span>`);
                     return;
                }
                document.documentElement.style.setProperty('--terminal-font-family', value);
                term.writeLine(`Font set to: ${value}`);
                needsResize = true;
                break;
            case 'size':
                if (!value) {
                    term.writeHtml(`<span class="term-error">Usage: style size &lt;css-size&gt; (e.g., 14px, 1rem)</span>`);
                    return;
                }
                // 基本验证 CSS 尺寸单位 (px, em, rem, pt)
                if (!/^\d+(\.\d+)?(px|em|rem|pt)$/i.test(value)) {
                    term.writeHtml(`<span class="term-error">Invalid size format: "${value}". Use units like px, em, rem, pt.</span>`);
                    return;
                }
                document.documentElement.style.setProperty('--terminal-font-size', value);
                term.writeLine(`Size set to: ${value}`);
                needsResize = true;
                break;
            case 'reset':
                // 从 :root 获取默认值 (需要 CSS 中有定义)
                 const defaultFont = "'Fira Code', 'Consolas', 'Courier New', monospace"; // 硬编码或尝试从 CSS :root 原始规则读取
                 const defaultSize = "14px";
                 document.documentElement.style.setProperty('--terminal-font-family', defaultFont);
                 document.documentElement.style.setProperty('--terminal-font-size', defaultSize);
                 term.writeLine(`Font and size reset to defaults.`);
                 needsResize = true;
                 break;

            default:
                term.writeHtml(`<span class="term-error">Unknown style command: ${subCommand}. Use 'font', 'size', or 'reset'.</span>`);
                return;
        }

        if (needsResize) {
            saveStyleSettings(); // 保存新设置
            // 触发重新计算尺寸和重绘
            // 使用 setTimeout 确保样式先生效再计算
            await new Promise(resolve => setTimeout(resolve, 50)); // 短暂延迟
            await term._handleResize(); // 调用异步 resize 处理器
        }
        // 不需要 return true 或 false，await 已经处理了异步
    },
    // ... 你未来可以添加更多非书签命令 ...
};


function parseLine(line) {
    const commandStrings = line.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
    const parsedCommands = [];
    for (const commandStr of commandStrings) {
        const parsed = parseSingleCommand(commandStr);
        if (parsed) { parsedCommands.push(parsed); } 
        else { console.error(`Failed to parse: "${commandStr}"`); }
    }
    return parsedCommands;
}

function parseSingleCommand(commandStr) {
    const tokens = commandStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
    if (!tokens || tokens.length === 0) { return null; }
    const commandName = tokens[0];
    const args = [];
    const options = {};
    for (let i = 1; i < tokens.length; i++) {
        let token = tokens[i];
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
            token = token.slice(1, -1); args.push(token); continue;
        }
        if (token.startsWith('--')) { 
            const optName = token.substring(2); if (optName) { options[optName] = true; }
        } else if (token.startsWith('-')) { 
            const optString = token.substring(1); if (optString.length > 0) { for (const char of optString) { options[char] = true; } }
        } else { args.push(token); }
    }
    return { command: commandName, args: args, options: options };
}

function awaiting() {
    term.disableInput();
}

function done() {
    term.enableInput();
    bookmarkSystem.update_user_path(); // 使用 BookmarkSystem 的方法
}

async function executeLine(line) {
    awaiting(); 
    
    const parsedCommands = parseLine(line);
    if (!parsedCommands || parsedCommands.length === 0) {
            done(); // 如果没有有效命令，直接结束
            return;
    }

    let lastOutput = null; 

    for (let i = 0; i < parsedCommands.length; i++) {
            const parsed = parsedCommands[i];
            if (!parsed) continue;

        const { command, args, options } = parsed;
        
        let commandFunc = null;

        // --- 修改：优先检查 BookmarkSystem ---
        if (bookmarkSystem.commands[command]) {
            commandFunc = bookmarkSystem.commands[command];
        } 
        // --- 修改：然后检查全局命令 ---
        else if (globalCommands[command]) {
                commandFunc = globalCommands[command];
        }

        // --- 管道逻辑不变 ---
        if (i > 0) { isPiping = false; }
        if (i < parsedCommands.length - 1) { isPiping = true; pipeBuffer = []; }
        
        if (commandFunc) {
            // 如果是 clear，它会自己处理缓冲区，不需要 await
                if (command === 'clear') {
                    commandFunc(args, options);
                    lastOutput = null; // 清除后没有输出
                } else {
                lastOutput = await commandFunc(args, options, lastOutput);
                }
        } else if (command.trim() !== '') {
            term.writeHtml(`<span class="term-error">startsh: command not found: ${command}</span>`);
        }
        
        if (isPiping) { lastOutput = pipeBuffer; }
        isPiping = false; 
    }
    
    // --- 修改：使用 BookmarkSystem 的方法 ---
    await bookmarkSystem._refreshBookmarks(); 
    done(); 
}


async function main() {

    // Load Settings 
    loadStyleSettings();

    // --- 修改：将初始化移到 load 事件内部 ---
    term.writeLine("ST 2.0 Booting..."); // 这可能在尺寸计算前显示

    // 1. 初始化 Bookmark System
    await bookmarkSystem.initialize();

    // 2. 异步计算尺寸 (等待字体)
    await term._calculateDimensions();

    // 3. 使用正确尺寸初始化缓冲区
    term._initBuffer();

    // 4. 设置命令处理器
    term.onCommand = executeLine;

    // 5. 打印欢迎信息 (现在缓冲区尺寸正确)
    term.writeLine("欢迎来到 Start-Terminal 2.0！");
    term.writeLine("Bookmark commands refactored.");

    // 6. 显示第一个提示符
    done();
}

// --- 修改：使用 load 事件 ---
window.addEventListener('load', main);

main();

