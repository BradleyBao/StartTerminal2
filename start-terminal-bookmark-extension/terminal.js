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

// Initial Global Variables
const Environment = {
    'LANG': 'en', // 默认语言
    'USER': 'user',
    'HOST': 'ST2.0',
    "PS1": '\\u@\\h:\\w\\$ ',
    // More will load by .startrc
}

// International Help Function 
function t(key) {
    const lang = Environment.LANG || 'en';
    if (messages[lang] && messages[lang][key]) {
        return messages[lang][key];
    } 
    // roll back to English 
    return messages['en'][key] || key;
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
        this.onTab = null; 

        this.fullScreenApp = null;

        // I/O 状态
        this.isReading = false;
        this.readResolve = null;

        this.history = [];
        this.historyIndex = 0;
        this.tempLine = "";

        // 沙盒支持
        this.sandboxFrame = null;
        this.sandboxResolve = null;
        this._createSandbox();

        // 3. 初始化
        this._calculateDimensions();
        this._initBuffer();
        this._attachListeners();
        this.focus();
    }

    _createSandbox() {
        this.sandboxFrame = document.createElement('iframe');
        this.sandboxFrame.src = 'sandbox.html';
        this.sandboxFrame.style.display = 'none';
        document.body.appendChild(this.sandboxFrame);

        // 监听来自 sandbox.js 的消息
        window.addEventListener('message', (event) => {
            // 1. 安全检查：只接受来自沙盒的消息
            if (event.source !== this.sandboxFrame.contentWindow) {
                return;
            }

            const { type, payload } = event.data;

            // 2. 处理来自 st_api 的消息
            switch (type) {
                case 'writeLine':
                    this.writeLine(payload);
                    break;
                case 'writeHtml':
                    this.writeHtml(payload);
                    break;
                case 'error':
                    this.writeHtml(`<span class="term-error">Script Error: ${payload}</span>`);
                    this.sandboxResolve(null); // 发生错误，结束命令
                    break;
                case 'result':
                    this.sandboxResolve(payload); // 成功，返回结果
                    break;
            }
        });
    }

    /**
     * 在沙盒中执行一个脚本字符串
     */
    executeInSandbox(scriptString, args, pipeInput) {
        return new Promise((resolve) => {
            this.sandboxResolve = resolve; // 存储 resolve
            // 向 sandbox.js 发送消息
            this.sandboxFrame.contentWindow.postMessage({
                scriptString,
                args,
                pipeInput
            }, `*`);
        });
    }

    async initialize() {
        await this._calculateDimensions();
        this._initBuffer();
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
        // this.inputHandler.addEventListener('keydown', (e) => this._handleKeydown(e));
        this.inputHandler.addEventListener('keydown', (e) => this._masterKeydownHandler(e));
        // 捕获中文输入法 (IME) 或粘贴
        this.inputHandler.addEventListener('input', (e) => this._handleInput(e));
        // 点击终端时，始终聚焦到隐藏的输入框
        // this.container.addEventListener('click', () => this.focus());
        
        this.container.addEventListener('mouseup', (e) => {
            const selection = window.getSelection();
            
            // 仅当 selection "collapsed" (即用户是点击，而不是拖拽)
            // 或者 selection 不在 terminal 内部时，才重新聚焦。
            if (selection.isCollapsed || !this.container.contains(selection.anchorNode)) {
                this.focus();
            }
            // 如果用户拖拽选择了文本 (selection.isCollapsed 为 false)，
            // 我们什么也不做，以保留他们的选中内容。
        });
        
        // 窗口大小调整时，重新计算
        window.addEventListener('resize', () => this._handleResize());

        // IME Listen 
        this.inputHandler.addEventListener('compositionstart', (e) => this._handleCompositionStart(e));
        this.inputHandler.addEventListener('compositionend', (e) => this._handleCompositionEnd(e));
    }

    _masterKeydownHandler(e) {
        if (this.fullScreenApp) {
            // 如果全屏应用正在运行，将按键交给它处理
            this.fullScreenApp.handleKeydown(e);
        } else if (this.isReading) {
            // 如果在 [Y/n] 模式下
            e.preventDefault();
            // console.log(this.cursorX);

            if (e.key === 'Enter') {
                // ... (Enter 逻辑保持不变) ...
                const answer = this.currentLine;
                this.isReading = false;
                this._handleNewline(); // 换行
                this.readResolve(answer.trim().toLowerCase()); // Resolve Promise
                this.readResolve = null;
                this.disableInput(); // 交还控制权

            // --- [!! 核心修复 !!] ---
            // (从 _handleKeydown 复制 Backspace 逻辑)
            } else if (e.key === 'Backspace') {
                const pos = this.cursorX - this.prompt.length;
                if (pos > 0) {
                    this.currentLine = this.currentLine.substring(0, pos - 1) + this.currentLine.substring(pos);
                    this.cursorX--;
                }
            // (从 _handleKeydown 复制字符输入逻辑)
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                const pos = this.cursorX - this.prompt.length;
                const char = e.key;
                this.currentLine = this.currentLine.substring(0, pos) + char + this.currentLine.substring(pos);
                this.cursorX++;
            }
            // --- [!! 结束修复 !!] ---
            
            this._render(); // 渲染 Y/n 的输入
        
        } else {
            // 否则，使用我们常规的命令行处理器
            this._handleKeydown(e);
        }
    }

    enterFullScreenApp(app) {
        this.fullScreenApp = app;
        this.disableInput(); // 隐藏常规的命令行光标
    }

    exitFullScreenApp() {
        this.fullScreenApp = null;
        this._initBuffer(); // 清空屏幕
        this.enableInput();  // 恢复命令行
        // 'done()' 将在 executeLine 中被调用，以重绘提示符
    }

    /**
     * 交互式 I/O：暂停命令执行并等待一行输入
     * @param {string} prompt - 要显示的提示 (例如 "[Y/n]")
     */
    readInput(prompt) {
        return new Promise((resolve) => {
            const fullPrompt = prompt + " ";
            
            // --- [!! 核心修复 !!] ---
            // 1. 不使用 writeLine，而是将提示符 "烘焙" 到当前缓冲区行
            this.buffer[this.cursorY] = this._overwriteHtml(this.buffer[this.cursorY], 0, this.escapeHtml(fullPrompt));
            
            // 2. 将 I/O 提示符设置为 "逻辑" 提示符
            this.prompt = fullPrompt;
            this.currentLine = ""; // 清空输入
            
            // 3. 将光标移动到提示符末尾
            this.cursorX = fullPrompt.length;

            this.isReading = true; // 进入“读取模式”
            this.readResolve = resolve; // 存储 resolve 函数
            // (我们仍然需要 enableInput 来确保 _render 生效)
            this.enableInput();
            this._render(); // 渲染 [Y/n] 提示和光标
        });
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
                // --- [重写] 输入/光标渲染逻辑 ---
                const fullLineText = this.prompt + this.currentLine;

                // 1. [新] 先将行用空格填充到正确的总宽度
                const paddedLine = fullLineText + ' '.repeat(Math.max(0, this.cols - fullLineText.length));

                // 2. [新] 从已填充的行中获取光标下的字符
                //    (这确保了光标在行尾时，我们能正确获取到一个空格)
                const charAtCursor = paddedLine[this.cursorX] || ' '; 
                
                // 3. [新] 替换光标位置的字符，而不是在行尾添加
                line = this.escapeHtml(paddedLine.substring(0, this.cursorX)) +
                        `<span class="term-cursor">${this.escapeHtml(charAtCursor)}</span>` +
                        this.escapeHtml(paddedLine.substring(this.cursorX + 1));
                // --- [结束重写] ---
                        
                html += line + '\n';
            
            } else {
                html += line + '\n'; 
            }
        }
        this.domBuffer.innerHTML = html;
    }

    /**
     * [新增] 处理输入法开始
     */
    _handleCompositionStart(e) {
        this.isComposing = true;
    }

    /**
     * [新增] 处理输入法结束 (选择或确认)
     */
    _handleCompositionEnd(e) {
        this.isComposing = false;
        
        // --- 关键：
        // 在 `compositionend` 时，`e.data` 包含最终的字符（如 "l" 或 "你"）
        // 此时 `input` 事件可能不会再触发，或者我们不应该依赖它。
        // 我们需要在这里手动处理输入。
        
        if (this.inputDisabled) return; 

        const text = e.data; // 获取输入法确认的文本
        
        if (text) {
            const pos = this.cursorX - this.prompt.length;
            this.currentLine = this.currentLine.substring(0, pos) + text + this.currentLine.substring(pos);
            this.cursorX += text.length; // 移动光标
            this._render(); // 重新渲染
        }

        // 清空隐藏的 input，防止它干扰下一次按键
        this.inputHandler.value = '';
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
        // this.cursorX = 0;
        this.currentLine = '';
        this.cursorX = this.prompt.length;
        // this._writeSingleLine(this.prompt);
        this._render();
    }

    setCommand(newLine, newCursorPos) {
        this.currentLine = newLine;
        if (newCursorPos !== undefined) {
            this.cursorX = this.prompt.length + newCursorPos;
        } else {
            this.cursorX = this.prompt.length + newLine.length;
        }
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
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return doc.body.textContent || "";
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
        let visibleCount = 0;
        let captureCount = 0;
        let startIndex = 0;
        let endIndex = 0;
        let inTag = false;
        let foundStart = (start === 0);

        if (length <= 0) return "";

        for (let i = 0; i < html.length; i++) {
            const char = html[i];
            if (char === '<') {
                inTag = true;
            } else if (char === '>') {
                inTag = false;
            }

            if (!inTag) {
                if (!foundStart) {
                    // --- 1. 跳过阶段 ---
                    visibleCount++;
                    if (visibleCount >= start) {
                        foundStart = true;
                        startIndex = i; // 从这个 HTML 索引开始捕获
                    }
                }
                
                if (foundStart) {
                    // --- 2. 捕获阶段 ---
                    captureCount++;
                    if (captureCount >= length) {
                        // 我们已捕获足够的字符。
                        endIndex = i + 1; // 结束索引是当前字符之后
                        break;
                    }
                }
            }

            // 如果我们还没 break，则 endIndex 必须至少跟上 i
            endIndex = i + 1;
        }

        if (!foundStart) return ""; // 从未找到起始点
        return html.substring(startIndex, endIndex);
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
        // this._render();
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
    /**
     * 处理按键（非 IME）
     * [调整] 将 _render() 移动到每个分支内部，确保成功处理后才重绘
     */
    _handleKeydown(e) {
        // 如果正在输入法组合中，则忽略 keydown，等待 compositionend
        if (this.isComposing) return;

        // --- 1. 处理 Ctrl 组合键 (Emacs 绑定) ---
        if (e.ctrlKey) {
            let handled = true; 
            switch (e.key.toLowerCase()) {
                // ... (Ctrl+A, E, B, F, U, K, D, L 的 case... 保持不变) ...
                case 'a': 
                    this.cursorX = this.prompt.length;
                    break;
                case 'e': 
                    this.cursorX = this.prompt.length + this.currentLine.length;
                    break;
                case 'b': 
                    if (this.cursorX > this.prompt.length) this.cursorX--;
                    break;
                case 'f': 
                    if (this.cursorX < this.prompt.length + this.currentLine.length) this.cursorX++;
                    break;
                case 'u': 
                    {
                        const pos = this.cursorX - this.prompt.length;
                        if (pos > 0) {
                            this.currentLine = this.currentLine.substring(pos);
                            this.cursorX = this.prompt.length;
                        }
                    }
                    break;
                case 'k': 
                    {
                        const pos = this.cursorX - this.prompt.length;
                        this.currentLine = this.currentLine.substring(0, pos);
                    }
                    break;
                case 'd': 
                    {
                        const pos = this.cursorX - this.prompt.length;
                        if (pos < this.currentLine.length) {
                            this.currentLine = this.currentLine.substring(0, pos) + this.currentLine.substring(pos + 1);
                        }
                    }
                    break;
                case 'l': 
                    this._initBuffer();
                    this.cursorY = 0;
                    this.cursorX = this.prompt.length;
                    break;
                // ... (case 'c' 保持不变) ...
                case 'c': 
                    this._handleNewline();
                    this.currentLine = ''; 
                    this.cursorX = 0;
                    if (this.onCommand) {
                        this.onCommand(""); 
                    }
                    break;

                case 'arrowleft': 
                    {
                        const line = this.currentLine;
                        let i = this.cursorX - this.prompt.length - 1; // start from char before cursor
                        // Skip whitespace
                        while (i >= 0 && /\s/.test(line[i])) { i--; }
                        // Skip word
                        while (i >= 0 && !/\s/.test(line[i])) { i--; }
                        this.cursorX = this.prompt.length + i + 1;
                    }
                    break;
                case 'arrowright':
                    {
                        const line = this.currentLine;
                        let i = this.cursorX - this.prompt.length; // start at cursor
                        // Skip word
                        while (i < line.length && !/\s/.test(line[i])) { i++; }
                        // Skip whitespace
                        while (i < line.length && /\s/.test(line[i])) { i++; }
                        this.cursorX = this.prompt.length + i;
                    }
                    break;

                default:
                    handled = false; 
            }

            if (handled) {
                e.preventDefault();
                this._render(); // [!] 在
                return;
            }
        }

        // --- 2. 处理功能键 (Enter, Backspace, Arrows) ---
        
        if (e.key === "Tab") {
            e.preventDefault();
            // --- [新增] Tab 补全 ---
            if (this.onTab) {
                // 计算光标在 this.currentLine 中的位置
                const pos = this.cursorX - this.prompt.length;
                this.onTab(this.currentLine, pos);
            }
            // --- [结束新增] ---
            return; // Tab 不应触发末尾的 _render
        }
        
        if (e.key === 'Enter') {
            e.preventDefault();
            const command = this.currentLine;

            if (command.trim().length > 0 && command !== this.history[this.history.length - 1]) {
                this.history.push(command);
            }
            this.historyIndex = this.history.length; // 重置索引到“新行”
            this.tempLine = ""; // 清空临时行

            // --- 在换行前，将当前行“固化”到缓冲区 ---
            const fullLineText = this.prompt + this.currentLine;
            // (我们使用 escapeHtml 来匹配 _render 中的逻辑，确保安全)
            const escapedLine = this.escapeHtml(fullLineText);
            // (我们填充行尾的空格，就像 _render 那样)
            const padding = ' '.repeat(Math.max(0, this.cols - fullLineText.length));
            this.buffer[this.cursorY] = escapedLine + padding;
            

            this._handleNewline(); // 现在换行 (cursorY++)
            
            if (this.onCommand) {
                this.onCommand(command); // 命令将在新行上打印输出
            }
            
            this.currentLine = ''; 
            this.cursorX = 0; 
            return; // `done()` 会调用 setPrompt -> _render
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            const pos = this.cursorX - this.prompt.length;
            if (pos > 0) {
                this.currentLine = this.currentLine.substring(0, pos - 1) + this.currentLine.substring(pos);
                this.cursorX--; 
                this._render(); // [!] 移动到内部
            }
            return; // 结束

        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            if (this.cursorX > this.prompt.length) {
                this.cursorX--;
                this._render(); // [!] 移动到内部
            }
            return; // 结束

        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            if (this.cursorX < this.prompt.length + this.currentLine.length) {
                this.cursorX++;
                this._render(); // [!] 移动到内部
            }
            return; // 结束

        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            
            if (this.history.length === 0) return; // 没有历史

            if (e.key === 'ArrowUp') {
                if (this.historyIndex === this.history.length) {
                    // 如果在“新行”上，保存它
                    this.tempLine = this.currentLine;
                }
                if (this.historyIndex > 0) {
                    this.historyIndex--;
                    this.currentLine = this.history[this.historyIndex];
                }
            } else { // ArrowDown
                if (this.historyIndex < this.history.length) {
                    this.historyIndex++;
                    if (this.historyIndex === this.history.length) {
                        // 恢复到“新行”
                        this.currentLine = this.tempLine;
                    } else {
                        this.currentLine = this.history[this.historyIndex];
                    }
                }
            }
            // 移动光标到行尾
            this.cursorX = this.prompt.length + this.currentLine.length;
            this._render();
            return; // [修改] 确保返回
        }

        // --- 3. 处理普通字符输入 ---
        else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const pos = this.cursorX - this.prompt.length;
            const char = e.key;
            
            this.currentLine = this.currentLine.substring(0, pos) + char + this.currentLine.substring(pos);
            this.cursorX++; 
            this._render(); // [!] 移动到内部
            return; // 结束
        }
        
        // (原先在函数末尾的 _render() 已被移除或分配到各个分支)
    }

    /**
     * 处理 IME 输入或粘贴
     */
    _handleInput(e) {
        // 如果正在输入法组合中，忽略所有 `input` 事件
        // 我们将只在 `compositionend` 事件中处理最终结果
        if (this.isComposing) return; 
        if (this.inputDisabled) return; 
        
        // (这个逻辑现在主要用于处理粘贴)
        const text = e.target.value;
        if (text) {
            // const pos = this.cursorX - this.promptLength;
            const pos = this.cursorX - this.prompt.length;
            this.currentLine = this.currentLine.substring(0, pos) + text + this.currentLine.substring(pos);
            this.cursorX += text.length;
            this._render();
        }
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

// ===============================================
// =          NANO EDITOR
// ===============================================

class NanoEditor {
    constructor(term, filePath, initialContent, onSave, onExit) {
        this.term = term;
        this.filePath = filePath;
        this.onSave = onSave;
        this.onExit = onExit;

        this.lines = initialContent.split('\n'); // 文件内容（字符串数组）
        this.cursorY = 0;   // 光标在文件中的行号
        this.cursorX = 0;   // 光标在文件中的列号
        this.topRow = 0;    // 屏幕上显示的第一行文件
        this.status = "Press ^X to Exit, ^O to Save";
        this.dirty = false; // 是否有未保存的修改
        this.termRows = term.rows;
        this.termCols = term.cols;
    }

    open() {
        this.term.enterFullScreenApp(this);
        this._render();
    }

    // --- 核心辅助函数 ---

    _padLine(line, inverse = false) {
        const escaped = this.term.escapeHtml(line);
        const padding = ' '.repeat(Math.max(0, this.termCols - line.length));
        if (inverse) {
            // "反色" 菜单栏
            return `<span style="background-color: var(--terminal-foreground-color); color: var(--terminal-background-color);">${escaped}${padding}</span>`;
        }
        return escaped + padding;
    }

    _validateCursor() {
        // 确保光标 Y 在文件范围内
        this.cursorY = Math.max(0, Math.min(this.lines.length - 1, this.cursorY));
        // 确保光标 X 在当前行范围内
        const lineLength = this.lines[this.cursorY].length;
        this.cursorX = Math.max(0, Math.min(lineLength, this.cursorX));
    }

    _handleScrolling() {
        // 屏幕上的文本区域
        const editorHeight = this.termRows - 3; // 减去顶栏和两行底栏
        
        // 向上滚动
        if (this.cursorY < this.topRow) {
            this.topRow = this.cursorY;
        }
        // 向下滚动
        if (this.cursorY >= this.topRow + editorHeight) {
            this.topRow = this.cursorY - editorHeight + 1;
        }
    }

    // --- 核心渲染和事件 ---

    _render() {
        this.term._initBuffer(); // 清空 term.buffer

        // 1. 绘制顶栏
        const topBar = `Nano 1.0 | File: ${this.filePath} ${this.dirty ? '*' : ''}`;
        this.term.buffer[0] = this._padLine(topBar, true);

        // 2. 绘制文本区域
        const editorHeight = this.termRows - 3;
        for (let y = 0; y < editorHeight; y++) {
            const lineIndex = this.topRow + y;

            // [!! 核心修复 2.B !!]
            // 仅当*不是*光标行时，才使用 _padLine (它会转义HTML)
            // 我们将在第 4 步专门处理光标行。
            if (lineIndex === this.cursorY) {
                continue;
            }
            // [!! 修复结束 !!]

            if (lineIndex < this.lines.length) {
                this.term.buffer[y + 1] = this._padLine(this.lines[lineIndex]);
            } else {
                this.term.buffer[y + 1] = this._padLine("~");
            }
        }

        // 3. 绘制底栏
        this.term.buffer[this.termRows - 2] = this._padLine("^X Exit   ^O Save", true);
        this.term.buffer[this.termRows - 1] = this._padLine(this.status, true);

        // 4. 绘制光标 (手动插入 <span>)
        const bufferY = (this.cursorY - this.topRow) + 1; // +1 因为顶栏
        if (bufferY > 0 && bufferY < this.termRows - 2) { // 确保在文本区域内
            
            // 1. 从 this.lines (原始) 而不是 this.term.buffer (已转义) 获取
            let line = this.lines[this.cursorY] || ""; 
            
            // 2. 获取光标下的原始字符
            const char = line[this.cursorX] || ' ';
            // 3. 转义光标字符
            const escapedChar = this.term.escapeHtml(char);
            const cursorSpan = `<span class="term-cursor">${escapedChar}</span>`;
            
            // 4. 转义光标前后的部分
            const lineBefore = this.term.escapeHtml(line.substring(0, this.cursorX));
            const lineAfter = this.term.escapeHtml(line.substring(this.cursorX + 1));

            // 5. 组合，然后填充 (padding)
            const combinedLine = lineBefore + cursorSpan + lineAfter;
            const visibleLength = line.length; // 原始长度
            const padding = ' '.repeat(Math.max(0, this.termCols - visibleLength));

            // 6. 将最终构建的行放入缓冲区
            this.term.buffer[bufferY] = combinedLine + padding;
        }

        // 5. 渲染到 DOM
        this.term._render();
    }

    handleKeydown(e) {
        e.preventDefault();
        e.stopPropagation();
        this.status = ""; // 清除状态

        if (e.ctrlKey) {
            // --- Ctrl 命令 ---
            switch (e.key.toLowerCase()) {
                case 'x':
                    if (this.dirty) {
                        this.status = "File is modified. Save? (Y/N)";
                        // (简易版：我们直接退出)
                        this.term.exitFullScreenApp();
                        this.onExit();
                    } else {
                        this.term.exitFullScreenApp();
                        this.onExit();
                    }
                    return; // 退出，不重绘
                case 'o':
                    this._save();
                    break;
            }
        } else {
            // --- 常规编辑 ---
            switch (e.key) {
                case 'ArrowUp':
                    if (this.cursorY > 0) this.cursorY--;
                    break;
                case 'ArrowDown':
                    if (this.cursorY < this.lines.length - 1) this.cursorY++;
                    break;
                case 'ArrowLeft':
                    if (this.cursorX > 0) {
                        this.cursorX--;
                    } else if (this.cursorY > 0) {
                        // 换到上一行行尾
                        this.cursorY--;
                        this.cursorX = this.lines[this.cursorY].length;
                    }
                    break;
                case 'ArrowRight':
                    if (this.cursorX < this.lines[this.cursorY].length) {
                        this.cursorX++;
                    } else if (this.cursorY < this.lines.length - 1) {
                        // 换到下一行行首
                        this.cursorY++;
                        this.cursorX = 0;
                    }
                    break;
                case 'Backspace':
                    this.dirty = true;
                    if (this.cursorX > 0) {
                        // 在行内删除
                        const line = this.lines[this.cursorY];
                        this.lines[this.cursorY] = line.substring(0, this.cursorX - 1) + line.substring(this.cursorX);
                        this.cursorX--;
                    } else if (this.cursorY > 0) {
                        // 在行首删除（合并行）
                        const line = this.lines[this.cursorY];
                        const prevLine = this.lines[this.cursorY - 1];
                        this.cursorX = prevLine.length;
                        this.lines[this.cursorY - 1] = prevLine + line;
                        this.lines.splice(this.cursorY, 1);
                        this.cursorY--;
                    }
                    break;
                case 'Enter':
                    this.dirty = true;
                    // 分割行
                    const line = this.lines[this.cursorY];
                    const lineBefore = line.substring(0, this.cursorX);
                    const lineAfter = line.substring(this.cursorX);
                    this.lines[this.cursorY] = lineBefore;
                    this.lines.splice(this.cursorY + 1, 0, lineAfter);
                    this.cursorY++;
                    this.cursorX = 0;
                    break;
                case 'Tab':
                    // (暂不支持)
                    break;
                default:
                    // 插入字符
                    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                        this.dirty = true;
                        const line = this.lines[this.cursorY];
                        this.lines[this.cursorY] = line.substring(0, this.cursorX) + e.key + line.substring(this.cursorX);
                        this.cursorX++;
                    }
                    break;
            }
        }

        this._validateCursor(); // 确保光标位置有效
        this._handleScrolling();  // 确保光标在屏幕上
        this._render();           // 重新渲染
    }

    _save() {
        this.status = "Saving...";
        try {
            const content = this.lines.join('\n');
            this.onSave(this.filePath, content);
            this.dirty = false;
            this.status = `File saved! (${content.length} bytes)`;
        } catch (e) {
            this.status = `Error saving: ${e.message}`;
        }
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

        // VFS 
        this.vfsEtc = {
            id: 'vfs-etc',
            title: 'etc',
            children: [
                {
                    id: 'vfs-startrc',
                    title: '.startrc',
                    url: `data:text/plain;base64,${btoa(encodeURIComponent(loadVirtualStartrc()))}`, // 编码前先 URI 编码
                    children: null
                }
            ],
            parentId: 'vfs-root'
        };

        this.vfsBin = {
            id: 'vfs-bin',
            title: 'bin',
            children: [], // 将在 initialize() 中被填充
            parentId: 'vfs-root'
        };

        // Virtual Root Directory 
        this.virtualRoot = {
            id: 'vfs-root',
            title: '', // 根目录没有标题
            children: [ this.vfsEtc ], // 默认包含 /etc
            parentId: null
        };

        // --- 将命令实现移入此类 ---
        this.commands = {
            'cd': (args, options) => {
                const targetPath = args[0] || '~'; // 默认 'cd' 等同于 'cd ~'

                // --- 新增：显式处理 'cd ~' ---
                if (targetPath === '~') {
                    if (this.homeDirNode) {
                        this.current = this.homeDirNode;
                        this.path = [this.virtualRoot, this.homeDirNode];
                    } else {
                        // 如果 home 目录不存在，则转到根目录
                        this.current = this.virtualRoot;
                        this.path = [this.virtualRoot];
                    }
                // --- 结束新增 ---
                } else if (targetPath === '..') {
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
                        this.term.writeHtml(`<span class="term-error">${t('notADir')}: ${targetPath}</span>`);
                    } else {
                        this.term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${targetPath}</span>`);
                    }
                }
                this.update_user_path(); // cd 后更新路径
            },

            'ls': (args, options) => {
                let targetNode = this.current;
                let targetPath = ".";
                
                if (args[0]) {
                    targetPath = args[0];
                }
                // (如果 -l 在 args[0]，则 targetPath 还是 '.')
                if (targetPath.startsWith('-')) {
                    targetPath = "."; // 'ls -l' 意味着 ls '.'
                }

                const result = this._findNodeByPath(targetPath);
                if (result && result.node && result.node.children) {
                    targetNode = result.node;
                } else if (result && result.node) {
                        this.term.writeHtml(`<span class="term-error">ls: ${targetPath}: Not a directory</span>`);
                        return;
                } else {
                    this.term.writeHtml(`<span class="term-error">ls: ${targetPath}: No such directory</span>`);
                    return;
                }

                let children = targetNode.children || [];
                if (!options.a) { 
                    children = children.filter(child => !child.title.startsWith('.'));
                }
                
                // [!! 新增 'ls -l' 逻辑 !!]
                if (options.l) {
                    // 长列表格式
                    for (const child of children) {
                        const meta = getMetadata(child);
                        const isDir = !!child.children;
                        const modeStr = formatMode(meta.mode, isDir);
                        const links = 1;
                        const owner = "user";
                        const group = "user";
                        const size = 0; // (大小对书签没有意义)
                        const date = new Date(child.dateAdded || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

                        const name = isDir ? `<span class="term-folder">${child.title}/</span>` : child.title;
                        
                        this.term.writeHtml(`${modeStr} ${links} ${owner} ${group} ${String(size).padStart(6)} ${date} ${name}`);
                    }
                } else {
                    // 默认短列表格式
                    for (const child of children) {
                        if (child.children) {
                            this.term.writeHtml(`<span class="term-folder">${child.title}/</span>`);
                        } else {
                            this.term.writeLine(child.title); 
                        }
                    }
                }
            },
            
            'mkdir': async (args, options) => {
                if (!args[0]) {
                    this.term.writeHtml(`<span class="term-error">mkdir: missing operand</span>`);
                    return;
                }
                const currentMeta = getMetadata(this.current);
                if (!(currentMeta.mode & 0o200)) { // 0o200 = U_WRITE
                    term.writeHtml(`<span class="term-error">mkdir: cannot create directory: Permission denied</span>`);
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
                    term.writeHtml(`<span class="term-error">rm: missing operand</span>`);
                    return;
                }
                const path = args[0];
                let target;
                if (!path.startsWith('/') && !path.startsWith('~/')) {
                    // 'rm' 查找当前目录
                    target = this._findChildByTitle(this.current.children, path);
                } else {
                    const result = this._findNodeByPath(path);
                    target = result ? result.node : null;
                }
                if (!target) {
                    term.writeHtml(`<span class="term-error">rm: ${args[0]}: No such file or directory</span>`);
                    return;
                }

                const meta = getMetadata(target);
                if (!(meta.mode & 0o200)) { // 0o200 = U_WRITE
                    term.writeHtml(`<span class="term-error">rm: cannot remove '${args[0]}': Permission denied</span>`);
                    return;
                }
                
                // [VFS 'rm' 逻辑]
                if (target.id.startsWith('vfs-bin-')) {
                    if (this.current.id === 'vfs-bin') {
                        // 1. 从 localStorage 删除
                        deleteVfsScript(target.title);
                        // 2. 从 VFS (内存中) 删除
                        this.vfsBin.children = this.vfsBin.children.filter(c => c.id !== target.id);
                        term.writeLine(`Removed VFS script: ${target.title}`);
                        return;
                    } else {
                        term.writeHtml(`<span class="term-error">rm: Cannot remove VFS files from here.</span>`);
                        return;
                    }
                }

                const recursive = options.r || options.recurse;
                
                if (target.children && !recursive) {
                    // ... (is a directory)
                } else if (target.children && recursive) {
                    await this._removeRecursive(target.id);
                } else {
                    await new Promise(resolve => chrome.bookmarks.remove(target.id, resolve));
                }
            },
            'pwd': (args, options) => {
                let displayPath;
                // --- 核心修复：pwd 始终显示绝对路径，从不显示 ~ ---
                if (!this.root) {
                    displayPath = "/"; // 容错
                } else if (this.path.length <= 1) {
                    displayPath = "/"; // 根目录
                } else {
                    // 从 path 数组的第二个元素（根目录之后）开始
                    // 获取所有节点的 title 并用 '/' 连接
                    displayPath = "/" + this.path.slice(1).map(node => node.title).join("/");
                }
                // --- 结束修复 ---
                this.term.writeLine(displayPath); // 使用 writeLine 输出纯文本
            },
        };
    }

    // --- 将书签相关的辅助函数移入此类 ---

    async initialize() {
            this.vfsBin.children = loadVfsScripts();
            await this._refreshBookmarks(); // 加载并合并 VFS
            
            try {
                const startrcNode = this._findNodeByPath('/etc/.startrc');
                if (startrcNode && startrcNode.node && startrcNode.node.url) {
                    const base64Content = startrcNode.node.url.split(',')[1] || '';
                    const rcContent = decodeURIComponent(atob(base64Content));
                    parseStartrc(rcContent);
                } else {
                    console.warn(".startrc not found, using default environment.");
                    parseStartrc(defaultStartrcContent); 
                }
            } catch (e) {
                console.error("Error loading .startrc:", e);
            }

            // --- 关键修复：在 _refreshBookmarks 之后设置初始路径 ---
            this.current = this.homeDirNode || this.virtualRoot; // 默认启动目录 (Home 或 Root)
            this.path = this.homeDirNode ? [this.virtualRoot, this.homeDirNode] : [this.virtualRoot];
            // --- 结束 ---
            this.update_user_path();
    }

    async _refreshBookmarks() {
            if (typeof chrome === 'undefined' || !chrome.bookmarks) {
                console.warn("chrome.bookmarks API not available. Using mock data.");
                if (!this.root) {
                    this.root = { id: '0', title: 'Root', children: [ { id: '1', title: 'Bookmarks Bar', children: [ { id: '3', title: 'Work', children: [] }, { id: '4', title: 'Personal', url: 'https://google.com' } ] }, { id: '2', title: 'Other Bookmarks', children: [] }]};
                }
            } else {
                const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
                this.root = tree[0];
            }

            // --- 核心 VFS ---
            // 1. 设置 homeDirNode (可能为 null)
            this.homeDirNode = (this.root.children && this.root.children.length > 0) ? this.root.children[0] : null;

            // 2. 无条件合并 vfsEtc 和 真实书签
            // 确保 this.root.children 存在
            const bookmarkChildren = this.root.children || []; 
            this.virtualRoot.children = [ this.vfsEtc, this.vfsBin, ...bookmarkChildren ];

            // 3. 为已合并的真实书签设置正确的 parentId (用于 'cd ..' 等)
            bookmarkChildren.forEach(child => {
                child.parentId = 'vfs-root';
            });
            if (this.homeDirNode) {
                 this.homeDirNode.parentId = 'vfs-root'; // 确保 homeDirNode 的 parentId 也被设置
            }
            // --- 结束 VFS ---
            

            // --- 路径验证逻辑 (使用 virtualRoot) ---
            if (this.path.length === 0) { // 首次初始化
                 // 移到 initialize 函数中
            } else {
                // 验证当前路径
                let tempCurrent = this.virtualRoot; // 从 VFS 根开始验证
                let tempPath = [this.virtualRoot];
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
                    // 路径无效, 重置回 Home (如果存在) 或 VFS 根
                    this.current = this.homeDirNode || this.virtualRoot;
                    this.path = this.homeDirNode ? [this.virtualRoot, this.homeDirNode] : [this.virtualRoot];
                }
            }
    }

    update_user_path() {
        let displayPath;
        
        if (!this.root || !this.homeDirNode) { 
                displayPath = "/"; // 回退
        } else if (this.path.length >= 2 && this.path[0] === this.virtualRoot && this.path[1] === this.homeDirNode) {
            // 如果我们在 home 目录或其子目录中
            displayPath = this.path.length === 2 ? "~" : "~/" + this.path.slice(2).map(p => p.title).join("/");
        } else if (this.path.length > 0) {
            // 否则，显示从 VFS 根开始的完整路径
            displayPath = "/" + this.path.slice(1).map(p => p.title).join("/");
        } else {
                displayPath = "/"; 
        }
        // --- 结束修复 ---
        
        let promptString = Environment.PS1 || '\\$ '; // 回退
        promptString = promptString.replace(/\\u/g, Environment.USER || 'user');
        promptString = promptString.replace(/\\h/g, Environment.HOST || 'host');
        promptString = promptString.replace(/\\w/g, displayPath); // \w 现在会是 ~ 或 /path
        promptString = promptString.replace(/\\\$/g, '$');

        this.full_path = promptString;
        
        if (!this.term.inputDisabled) {
            this.term.setPrompt(this.full_path);
        }
    }

    getPWD() {
        if (!this.root) return "/";
        if (this.path.length <= 1) return "/"; // 根目录
        // 从 VFS 根之后开始
        return "/" + this.path.slice(1).map(node => node.title).join("/");
    }

    _findNodeByPath(pathStr) {
        if (!pathStr || !this.root || !this.homeDirNode) return null;

        if (pathStr === '.') {
            return { node: this.current, newPathArray: [...this.path] };
        }

        let startNode;
        let newPathArray;
        let pathSegments;

        if (pathStr.startsWith('~/')) {
            if (!this.homeDirNode) return null; // Home 目录不存在
            startNode = this.homeDirNode;
            newPathArray = [this.virtualRoot, this.homeDirNode];
            pathSegments = pathStr.substring(2).split('/').filter(s => s.length > 0);
        } else if (pathStr.startsWith('/')) {
            // startNode = this.root;
            startNode = this.virtualRoot; // 从虚拟根开始
            // newPathArray = [this.root];
            newPathArray = [this.virtualRoot]; // 从虚拟根开始
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
                currentNode = newPathArray[newPathArray.length - 1] || this.virtualRoot;
                continue;
            }

            if (segment === '.') {
                continue;
            }
            
            // const foundNode = (currentNode.children || []).find(child => child.title === segment); // 添加保护
            const foundNode = (currentNode.children || []).find(child => child.title.trim() === segment);
            if (foundNode) {
                currentNode = foundNode;
                // --- 确保只有当找到的是目录时才更新路径 ---
                // if (foundNode.children) {
                //         // 检查 newPathArray 是否已经包含此节点，避免重复添加
                //         if (!newPathArray.find(p => p.id === foundNode.id)) {
                //             newPathArray.push(currentNode);
                //         }
                // } else if (i < pathSegments.length - 1) {
                //         // 如果路径中间部分不是目录，则路径无效
                //         return null;
                // }
                newPathArray.push(currentNode);
                if (!foundNode.children && i < pathSegments.length - 1) {
                    return null;
                }

            } else {
                return null;
            }
        }
        return { node: currentNode, newPathArray: newPathArray };
    }

    _findChildByTitle(children, title) {
        const trimmedTitle = title ? title.trim() : '';
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
// =       3. 虚拟文件系统 (VFS)           =
// ===============================================

const defaultStartrcContent = `
# Start-Terminal 2.0 Config File 
#
# Set Environment Variables 
# use export KEY=VALUE

# --- Prompt String ---
# \\u = user (user)
# \\h = host (ST2.0)
# \\w = working directory (~ or /Bookmarks Bar)
# \\$ = prompt symbol ($)
export PS1="\\u@\\h:\\w\\$ "

# --- Language ---
# 'en' for English
# 'zh' for 简体中文
export LANG="en"
`

/**
 * 解析 .startrc 内容并更新 Environment 对象
 * @param {string} content - .startrc 文件内容
 */
function parseStartrc(content) {
    const lines = content.split('\n');
    const exportRegex = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

    for (const line of lines) {
        const match = line.match(exportRegex);
        if (match) {
            const key = match[1];
            let value = match[2];

            // 去除值两端的引号（"value" or 'value')
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }
            
            Environment[key] = value;
            console.log(`[Env] Set ${key} = "${value}"`);
        }
    }
}

/**
 * [新增] 查找一组匹配项的最长公共前缀 (LCP)
 */
function findLCP(matches) {
    let lcp = matches[0].title.trim();
    for (let i = 1; i < matches.length; i++) {
        const title = matches[i].title.trim();
        while (!title.startsWith(lcp)) {
            lcp = lcp.substring(0, lcp.length - 1);
            if (lcp === "") break;
        }
    }
    return lcp;
}

/**
 * [新增] 比较两个匹配数组是否相同
 */
function arraysAreEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i].id !== arr2[i].id) return false; // 按书签 ID 比较
    }
    return true;
}

/**
 * [新增] Tab 补全的核心逻辑
 * (需要全局的 term 和 bookmarkSystem 实例)
 */
/**
 * [重构] Tab 补全核心逻辑
 * - 支持双击列出选项
 * - 支持带空格的文件名（自动加引号）
 */
function handleTabCompletion(line, pos) {
    const currentTime = Date.now();
    
    // 1. 找出要补全的 "token" (逻辑不变)
    const lineUpToCursor = line.substring(0, pos);
    const lastSpace = lineUpToCursor.lastIndexOf(' ');
    const tokenToComplete = lineUpToCursor.substring(lastSpace + 1);
    const tokenStartIndex = lastSpace + 1; 

    // 2. 确定搜索目录和 "partial" (逻辑不变)
    let searchDirNode;
    let partial;
    let pathPrefix = ''; 

    const lastSlash = tokenToComplete.lastIndexOf('/');
    if (lastSlash > -1) {
        pathPrefix = tokenToComplete.substring(0, lastSlash + 1);
        partial = tokenToComplete.substring(lastSlash + 1);
        const result = bookmarkSystem._findNodeByPath(pathPrefix);
        if (result && result.node && result.node.children) {
            searchDirNode = result.node;
        } else {
            return; 
        }
    } else {
        searchDirNode = bookmarkSystem.current;
        partial = tokenToComplete;
    }

    if (!searchDirNode || !searchDirNode.children) {
        return; 
    }

    // 3. 查找所有匹配项 (逻辑不变)
    const matches = searchDirNode.children.filter(child => 
        child.title.trim().startsWith(partial)
    );

    // --- 4. [新] 补全逻辑 ---

    if (matches.length === 0) {
        lastTabMatches = []; // 重置
        return; // 没有匹配项
    }

    if (matches.length === 1) {
        // 4a. 只有一个匹配项：直接补全
        lastTabMatches = []; // 重置
        const match = matches[0];
        let matchName = match.title.trim(); // e.g., "UPDF Account Center"
        
        let completion = pathPrefix + matchName;
        if (match.children) {
            completion += '/'; // e.g., "My Documents/"
        }

        // [!! 修复空格 Bug !!]
        // 如果补全包含空格，并且原始 token 不带引号，则添加引号
        if (completion.includes(' ') && !tokenToComplete.startsWith('"')) {
            completion = `"${completion}"`; // e.g., '"UPDF Account Center"'
        }
        
        const textBeforeToken = line.substring(0, tokenStartIndex);
        const textAfterCursor = line.substring(pos); // 光标后的文本
        
        const newLine = textBeforeToken + completion + textAfterCursor;
        const newCursorPos = (textBeforeToken + completion).length;
        
        term.setCommand(newLine, newCursorPos);

    } else {
        // 4b. 多个匹配项：
        const lcp = findLCP(matches);

        if (lcp.length > partial.length) {
            // 我们可以补全更多 (LCP)
            lastTabMatches = []; // 重置
            
            const completion = pathPrefix + lcp;
            // (注意：LCP 补全暂未处理空格转义，这更复杂)
            
            const textBeforeToken = line.substring(0, tokenStartIndex);
            const textAfterCursor = line.substring(pos);
            const newLine = textBeforeToken + completion + textAfterCursor;
            const newCursorPos = (textBeforeToken + completion).length;
            term.setCommand(newLine, newCursorPos);

        } else {
            // 4c. 无法进一步补全 (LCP === partial)。检查双击。
            const isDoubleTap = (currentTime - lastTabTime < 500); // 500ms 阈值
            
            if (isDoubleTap && arraysAreEqual(matches, lastTabMatches)) {
                // 这是第二次 Tab，列出所有选项
                term._handleNewline(); 
                const output = matches.map(m => {
                    const title = m.title.trim();
                    return m.children ? `${title}/` : title;
                }).join('   ');
                
                term.writeHtml(output); 
                
                bookmarkSystem.update_user_path(); 
                term.setCommand(line, pos); // 恢复当前行
                
                lastTabMatches = []; // 重置
            } else {
                // 这是第一次 Tab。只存储状态
                lastTabMatches = matches;
            }
        }
    }
    
    lastTabTime = currentTime; // 记录本次 Tab 时间
}

/**
 * 从 localStorage 加载虚拟 .startrc 文件内容
 * @returns {string}
 */
function loadVirtualStartrc() {
    // 我们用 localStorage 来模拟持久化
    const content = localStorage.getItem('.startrc');
    if (content === null) {
        // 如果不存在，创建默认的
        localStorage.setItem('.startrc', defaultStartrcContent);
        return defaultStartrcContent;
    }
    return content;
}

/**
 * 从 localStorage 加载所有 VFS 脚本
 * @returns {Array} VFS 节点对象数组
 */
function loadVfsScripts() {
    const scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
    const children = [];
    for (const name in scripts) {
        children.push({
            id: `vfs-bin-${name}`,
            title: name,
            url: `data:text/plain;base64,${btoa(encodeURIComponent(scripts[name].content))}`,
            mode: scripts[name].mode, // [!!] 附带权限 [!!]
            children: null,
            parentId: 'vfs-bin'
        });
    }
    return children;
}

/**
 * 获取节点的元数据 (权限)
 * @param {Object} node - VFS 节点
 * @returns {Object} - { mode: 0o755 }
 */
function getMetadata(node) {
    if (!node) return { mode: 0 }; // 安全回退
    
    // 1. VFS 内部节点 (权限是硬编码的)
    if (node.mode) {
        return { mode: node.mode };
    }
    if (node.id === 'vfs-etc') return { mode: 0o755 }; // drwxr-xr-x
    if (node.id === 'vfs-bin') return { mode: 0o755 }; // drwxr-xr-x
    if (node.id === 'vfs-startrc') return { mode: 0o644 }; // -rw-r--r--
    if (node.id.startsWith('vfs-bin-')) {
        // (这个应该在 loadVfsScripts 中被设置，但作为回退)
        return { mode: 0o755 };
    }

    // 2. 真实书签 (从 localStorage 读取)
    const metadataStore = JSON.parse(localStorage.getItem('vfs_metadata') || '{}');
    if (metadataStore[node.id]) {
        return metadataStore[node.id];
    }
    
    // 3. 默认书签权限
    if (node.children) {
        return { mode: 0o777 }; // 目录 (drwxrwxrwx)
    } else {
        return { mode: 0o666 }; // 文件 (-rw-rw-rw-)
    }
}

/**
 * 设置节点的元数据 (权限)
 * @param {Object} node - VFS 节点
 * @param {number} newMode - 八进制权限 (e.g., 0o755)
 */
function setMetadata(node, newMode) {
    if (!node) return;

    // 1. VFS /bin/ 脚本 (可写)
    if (node.id.startsWith('vfs-bin-')) {
        updateVfsScriptMode(node.title, newMode);
        return;
    }
    
    // 2. VFS /etc/ 目录 (只读)
    if (node.id.startsWith('vfs-etc') || node.id === 'vfs-startrc') {
        term.writeHtml(`<span class="term-error">chmod: ${node.title}: Read-only file system.</span>`);
        return;
    }

    // 3. 真实书签 (可写)
    let metadataStore = JSON.parse(localStorage.getItem('vfs_metadata') || '{}');
    // 获取当前元数据 (以防有其他设置)
    let currentMeta = metadataStore[node.id] || getMetadata(node); 
    currentMeta.mode = newMode;
    metadataStore[node.id] = currentMeta;
    localStorage.setItem('vfs_metadata', JSON.stringify(metadataStore));
}

/**
 * 将八进制 mode 格式化为 -rwxrwxrwx
 * @param {number} mode - e.g., 0o755
 * @param {boolean} isDir - 是否是目录
 */
function formatMode(mode, isDir) {
    const r = (mode & 0o400) ? 'r' : '-';
    const w = (mode & 0o200) ? 'w' : '-';
    const x = (mode & 0o100) ? 'x' : '-';
    
    const g_r = (mode & 0o040) ? 'r' : '-';
    const g_w = (mode & 0o020) ? 'w' : '-';
    const g_x = (mode & 0o010) ? 'x' : '-';

    const o_r = (mode & 0o004) ? 'r' : '-';
    const o_w = (mode & 0o002) ? 'w' : '-';
    const o_x = (mode & 0o001) ? 'x' : '-';

    return (isDir ? 'd' : '-') + r + w + x + g_r + g_w + g_x + o_r + o_w + o_x;
}

/**
 * 将脚本保存到 localStorage
 */
function saveVfsScript(name, content, mode = 0o755) { // 默认 755 (rwxr-xr-x)
    let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
    // 如果已有脚本，只更新内容并保留旧 mode
    const oldMode = scripts[name] ? scripts[name].mode : mode;
    
    scripts[name] = {
        content: content,
        mode: oldMode // 保留旧权限，或使用默认权限
    };
    localStorage.setItem('vfs_bin_scripts', JSON.stringify(scripts));
}

function updateVfsScriptMode(name, newMode) {
    let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
    if (scripts[name]) {
        scripts[name].mode = newMode;
        localStorage.setItem('vfs_bin_scripts', JSON.stringify(scripts));
        return true;
    }
    return false;
}

/**
 * 从 localStorage 删除脚本
 */
function deleteVfsScript(name) {
    let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
    if (scripts[name]) {
        delete scripts[name];
        localStorage.setItem('vfs_bin_scripts', JSON.stringify(scripts));
    }
}


// ===============================================
// =           初始化和使用 Terminal         =
// ===============================================

// Helper Function 
function loadStyleSettings() {
    const savedFont = localStorage.getItem('terminalFontFamily');
    const savedSize = localStorage.getItem('terminalFontSize');
    const rootStyle = getComputedStyle(document.documentElement);
    const defaultFont = rootStyle.getPropertyValue('--terminal-font-family').trim() || "'Consolas', 'Courier New', monospace";
    const defaultSize = rootStyle.getPropertyValue('--terminal-font-size').trim() || '14px';
    const fontFamily = savedFont || defaultFont;
    const fontSize = savedSize || defaultSize;
    document.documentElement.style.setProperty('--terminal-font-family', fontFamily);
    document.documentElement.style.setProperty('--terminal-font-size', fontSize);
}
function saveStyleSettings() {
    const currentFont = getComputedStyle(document.documentElement).getPropertyValue('--terminal-font-family').trim();
    const currentSize = getComputedStyle(document.documentElement).getPropertyValue('--terminal-font-size').trim();
    localStorage.setItem('terminalFontFamily', currentFont);
    localStorage.setItem('terminalFontSize', currentSize);
}



let isPiping = false;
let pipeBuffer = [];

let executeNestLevel = 0;

// Tab 
let lastTabMatches = [];
let lastTabTime = 0;

const term = new Terminal('terminal-container', 'input-handler');
const bookmarkSystem = new BookmarkSystem(term); // 将 term 传给 BookmarkSystem

// --- 将非书签命令移到这里 ---
// (替换) 你现有的 globalCommands 对象
const globalCommands = {
    'sh': async (args, options, pipedInput) => {
        if (!args[0]) {
            term.writeHtml(`<span class="term-error">sh: missing file operand</span>`);
            return;
        }
        if (pipedInput) {
            term.writeHtml(`<span class="term-error">sh: does not support piped input.</span>`);
            return;
        }

        const path = args[0];
        const result = bookmarkSystem._findNodeByPath(path);

        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">sh: ${path}: ${t('noSuchFileOrDir')}</span>`);
            return;
        }
        if (result.node.children) {
            term.writeHtml(`<span class="term-error">sh: ${path}: ${t('isADir')}</span>`);
            return;
        }

        const meta = getMetadata(result.node);
        if (!(meta.mode & 0o100)) { // 0o100 = U_EXEC
             term.writeHtml(`<span class="term-error">startsh: permission denied: ${path}</span>`);
             return;
        }

        let scriptContent = "";
        const url = result.node.url;
        if (!url) {
             term.writeLine(""); // 空文件
             return;
        }

        // 检查是否是我们的 VFS 文件
        if (result.node.id.startsWith('vfs-')) {
            try {
                const base64Content = url.split(',')[1] || '';
                scriptContent = decodeURIComponent(atob(base64Content));
            } catch (e) {
                term.writeHtml(`<span class="term-error">${path}: Error reading file: ${e.message}</span>`);
                return;
            }
        } else {
            // 不执行普通书签 URL
            term.writeHtml(`<span class="term-error">sh: ${path}: Not an executable script.</span>`);
            return;
        }

        // --- 核心执行 ---
        // 我们只需递归调用 executeLine，它现在可以处理 \n
        // await/return 链和 executeNestLevel 会处理好一切。
        return executeLine(scriptContent);
     },
     'chmod': (args, options) => {
        if (args.length < 2) {
            term.writeHtml(`<span class="term-error">chmod: missing operand</span>`);
            return;
        }
        const modeStr = args[0];
        const path = args[1];

        const newMode = parseInt(modeStr, 8); // 解析八进制
        if (isNaN(newMode)) {
            term.writeHtml(`<span class="term-error">chmod: invalid mode: '${modeStr}'</span>`);
            return;
        }

        const result = bookmarkSystem._findNodeByPath(path);
        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }

        setMetadata(result.node, newMode);
     },
     'grep': (args, options, pipedInput) => {
        if (!args[0]) { term.writeHtml(`<span class="term-error">${t('grepMissingPattern')}</span>`); return; }
        if (!pipedInput) { term.writeHtml(`<span class="term-error">${t('grepRequiresPipe')}</span>`); return; }
        const pattern = new RegExp(args[0], 'i');
        const matches = pipedInput.filter(line => pattern.test(line));
        matches.forEach(line => term.writeLine(line));
        return matches;
     },
     'wc': (args, options, pipedInput) => {
        if (!pipedInput) { term.writeHtml(`<span class="term-error">${t('wcRequiresPipe')}</span>`); return; }
        const lines = pipedInput.length;
        const words = pipedInput.join(' ').split(/\s+/).filter(Boolean).length;
        const chars = pipedInput.join('\n').length;
        term.writeLine(` ${lines}  ${words}  ${chars}`);
     },
     'clear': (args, options) => { term._initBuffer(); },
     'help': (args, options) => {
         term.writeLine(t('welcome'));
         term.writeLine(t('features'));
     },
     'echo': (args, options) => { term.writeLine(args.join(' ')); },
     'greet': (args, options) => {
         const name = args[0];
         if (name) {
             term.writeLine(`你好, ${name}!`); // Greet 保持中文
             if (options.v || options.verbose) { term.writeLine(" (Verbose mode enabled!)"); }
         } else { term.writeHtml(`<span class="term-error">${t('greetUsage')}</span>`); }
     },
     'style': async (args, options) => {
        // ... (你现有的 style 命令代码保持不变) ...
        const subCommand = args[0];
        const value = args.slice(1).join(' ');
        const rootStyle = getComputedStyle(document.documentElement);
        const currentFont = rootStyle.getPropertyValue('--terminal-font-family').trim();
        const currentSize = rootStyle.getPropertyValue('--terminal-font-size').trim();
        if (!subCommand) {
            term.writeLine(`${t('styleCurrent')}:`);
            term.writeLine(`  font: ${currentFont}`);
            term.writeLine(`  size: ${currentSize}`);
            return;
        }
        let needsResize = false;
        switch (subCommand.toLowerCase()) {
            case 'font':
                if (!value) { term.writeHtml(`<span class="term-error">${t('styleUsageFont')}</span>`); return; }
                if (value.length < 3) { term.writeHtml(`<span class="term-error">${t('styleInvalidFont')} "${value}"</span>`); return; }
                document.documentElement.style.setProperty('--terminal-font-family', value);
                term.writeLine(`${t('fontSet')} ${value}`);
                needsResize = true;
                break;
            case 'size':
                if (!value) { term.writeHtml(`<span class="term-error">${t('styleUsageSize')}</span>`); return; }
                if (!/^\d+(\.\d+)?(px|em|rem|pt)$/i.test(value)) { term.writeHtml(`<span class="term-error">${t('styleInvalidSize')} "${value}"</span>`); return; }
                document.documentElement.style.setProperty('--terminal-font-size', value);
                term.writeLine(`${t('sizeSet')} ${value}`);
                needsResize = true;
                break;
            case 'reset':
                 const defaultFont = "'Fira Code', 'Consolas', 'Courier New', monospace";
                 const defaultSize = "14px";
                 document.documentElement.style.setProperty('--terminal-font-family', defaultFont);
                 document.documentElement.style.setProperty('--terminal-font-size', defaultSize);
                 term.writeLine(t('styleReset'));
                 needsResize = true;
                 break;
            default:
                term.writeHtml(`<span class="term-error">${t('styleUnknownCmd')} ${subCommand}.</span>`);
                return;
        }
        if (needsResize) {
            saveStyleSettings();
            await new Promise(resolve => setTimeout(resolve, 50));
            await term._handleResize();
        }
     },

     // --- cat 命令 ---
     'cat': (args, options) => {
        if (!args[0]) {
            term.writeHtml(`<span class="term-error">${t('missingOperand')}</span>`);
            return;
        }
        const path = args[0];
        const result = bookmarkSystem._findNodeByPath(path);

        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }
        if (result.node.children) {
            term.writeHtml(`<span class="term-error">${t('isADir')}: ${path}</span>`);
            return;
        }

        const url = result.node.url;
        if (!url) {
            term.writeLine(""); // 空文件
            return;
        }

        // 检查是否是 VFS 文件 (startrc 或 bin 脚本)
        if (result.node.id.startsWith('vfs-')) {
            try {
                const base64Content = url.split(',')[1] || '';
                const content = decodeURIComponent(atob(base64Content));
                term.writeLine(content); // 打印解码后的文件内容
            } catch (e) {
                term.writeHtml(`<span class="term-error">${path}: Error reading file: ${e.message}</span>`);
            }
        } else {
            // 对于普通书签，只打印 URL
            term.writeLine(url);
        }
     },

     'nano': (args, options) => {
        let path = args[0];
        if (!path) {
            term.writeLine("nano: File name not specified.");
            return;
        }

        if (!path.startsWith('/') && !path.startsWith('~/')) {
            const pwd = bookmarkSystem.getPWD();
            path = (pwd === '/') ? ('/' + path) : (pwd + '/' + path);
        }

        return new Promise(async (resolve) => {
            let content = "";
            let node = null;
            let resolvedPath = path;

            const result = bookmarkSystem._findNodeByPath(path);

            if (result && result.node) {
                node = result.node;
                resolvedPath = "/" + result.newPathArray.slice(1).map(p => p.title).join("/");

                // [加载 VFS]
                if (node.id.startsWith('vfs-')) {
                    // 适用于 /etc/.startrc AND /bin/hello.sh
                    try {
                        const base64Content = (node.url || '').split(',')[1] || '';
                        content = decodeURIComponent(atob(base64Content));
                    } catch (e) {
                        content = ""; // 文件已损坏
                    }
                } else if (node.url) {
                    // 这是普通书签
                    content = node.url; 
                } else if (node.children) {
                    term.writeLine(`nano: ${resolvedPath} is a directory.`);
                    resolve();
                    return;
                }
            }
            // (如果是新文件, 'content' 保持为 "")

            const onSave = (savedPath, savedContent) => {
                try {
                    // (权限检查保持不变)
                    if (node) { 
                        const meta = getMetadata(node);
                        if (!(meta.mode & 0o200)) {
                            term.writeHtml(`<span class="term-error">Error: Permission denied.</span>`); return;
                        }
                    } else {
                        const parentPath = savedPath.substring(0, savedPath.lastIndexOf('/')) || '/';
                        const parentResult = bookmarkSystem._findNodeByPath(parentPath);
                        if (!parentResult || !parentResult.node || !(getMetadata(parentResult.node).mode & 0o200)) {
                            term.writeHtml(`<span class="term-error">Error: Parent directory not writable.</span>`); return;
                        }
                    }

                    // [!! 核心修复 2：保存 VFS !!]
                    if (resolvedPath === '/etc/.startrc') {
                        localStorage.setItem('.startrc', savedContent);
                        parseStartrc(savedContent);
                        bookmarkSystem.update_user_path();
                    
                    } else if (node && node.id.startsWith('vfs-bin-')) {
                        // A. 正在更新一个*已存在的* /bin/ 脚本
                        saveVfsScript(node.title, savedContent);
                        // 更新内存中的 VFS 节点 URL
                        node.url = `data:text/plain;base64,${btoa(encodeURIComponent(savedContent))}`;

                    } else if (node) {
                        // B. 正在更新一个*已存在的*书签 (非 VFS)
                        chrome.bookmarks.update(node.id, { url: savedContent });

                    } else if (!node && savedPath.startsWith('/bin/')) {
                        // C. 正在创建*新的* /bin/ 脚本
                        const scriptName = savedPath.substring(5);
                        if (scriptName && !scriptName.includes('/')) {
                            saveVfsScript(scriptName, savedContent);
                            // 更新 VFS (内存中)
                            const newNode = {
                                id: `vfs-bin-${scriptName}`,
                                title: scriptName,
                                url: `data:text/plain;base64,${btoa(encodeURIComponent(savedContent))}`,
                                mode: 0o755, // 默认权限
                                children: null,
                                parentId: 'vfs-bin'
                            };
                            bookmarkSystem.vfsBin.children.push(newNode);
                            term.writeLine(`Saved to VFS: ${savedPath}`);
                        } else {
                            term.writeHtml(`<span class="term-error">nano: Invalid path.</span>`);
                        }
                    } else if (!node) {
                        // D. 正在创建*新的*书签 (不支持)
                         term.writeHtml(`<span class="term-error">nano: Error: Cannot save new file to '${savedPath}'. Only /bin/ is supported.</span>`);
                    }
                } catch (e) {
                    console.error("Nano save error:", e);
                }
            };

            const onExit = () => {
                resolve();
            };

            const editor = new NanoEditor(term, resolvedPath, content, onSave, onExit);
            editor.open();
        });
     },

     'open': (args, options) => {
        if (!args[0]) {
            term.writeHtml(`<span class="term-error">${t('missingOperand')}</span>`);
            return;
        }
        const path = args[0];
        const result = bookmarkSystem._findNodeByPath(path);

        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }
        if (result.node.children) {
            term.writeHtml(`<span class="term-error">open: ${path}: ${t('isADir')}</span>`);
            return;
        }
        const url = result.node.url;
        if (!url || url.startsWith('data:text/plain')) {
            term.writeHtml(`<span class="term-error">open: '${path}': invalid or internal URL.</span>`);
            return;
        }

        if (typeof chrome !== 'undefined' && chrome.tabs) {
            // [!! 逻辑修复 !!]
            // 默认在当前标签页打开。
            // options.n (new tab) 会在新标签页中打开。
            if (options.n) {
                // 在新标签页打开
                chrome.tabs.create({ url: url });
            } else {
                // 在当前标签页打开 (默认)
                chrome.tabs.update({ url: url });
            }
        } else {
            term.writeHtml(`<span class="term-error">open: cannot access chrome.tabs API.</span>`);
        }
    },

    'search': (args, options) => {
        if (args.length === 0) {
            term.writeHtml(`<span class="term-error">Usage: search [-n] <query...></span>`);
            return;
        }
        const queryText = args.join(' ');

        if (typeof chrome !== 'undefined' && chrome.search) {
            // [!! 逻辑修复 !!]
            // 默认在当前标签页打开。
            // options.n (new tab) 会在新标签页中打开。
            const disposition = options.n ? "NEW_TAB" : "CURRENT_TAB";

            chrome.search.query({ 
                text: queryText,
                disposition: disposition
            });
        } else {
            term.writeHtml(`<span class="term-error">search: API not available.</span>`);
        }
    },

    'date': (args, options) => {
        const now = new Date();
        // 使用 i18n 友好的方式显示
        const lang = Environment.LANG || 'en';
        const option = {
            weekday: 'short', year: 'numeric', month: 'short',
            day: 'numeric', hour: '2-digit', minute: '2-digit',
            second: '2-digit', timeZoneName: 'short'
        };
        try {
            term.writeLine(new Intl.DateTimeFormat(lang, option).format(now));
        } catch (e) {
            // 回退到简单模式 (如果 lang code 不标准)
            term.writeLine(now.toString());
        }
    },

    'cal': (args, options) => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-11
        const lang = Environment.LANG || 'en';
        
        const firstDay = new Date(year, month, 1).getDay(); // 0-6 (Sun-Sat)
        const daysInMonth = new Date(year, month + 1, 0).getDate(); // 0 是上个月的最后一天

        // 打印月份和年份
        const monthName = now.toLocaleString(lang, { month: 'long' });
        const header = `${monthName} ${year}`;
        term.writeLine(header.padStart(Math.floor((20 - header.length) / 2) + header.length)); // 居中
        term.writeLine("Su Mo Tu We Th Fr Sa");

        let line = "   ".repeat(firstDay); // 用空格填充第一天之前
        
        for (let day = 1; day <= daysInMonth; day++) {
            line += (day < 10 ? " " : "") + day + " ";
            
            // 如果是周六 (firstDay + day - 1) % 7 === 6
            // 或者到了最后一天
            if ((day + firstDay) % 7 === 0 || day === daysInMonth) {
                term.writeLine(line.trimEnd()); // 打印一行
                line = ""; // 重置
            }
        }
    },
    
    'uptime': (args, options) => {
        // 读取我们在 main() 中设置的全局变量
        const startTime = window.st2_startTime || Date.now();
        const durationMs = Date.now() - startTime;
        
        const seconds = Math.floor((durationMs / 1000) % 60);
        const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
        const hours = Math.floor((durationMs / (1000 * 60 * 60)) % 24);
        const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
        
        term.writeLine(`Terminal up for: ${days}d ${hours}h ${minutes}m ${seconds}s.`);
    },

     // --- export 命令 ---
     'export': (args, options) => {
        if (args.length === 0) {
            // 如果没有参数，打印所有环境变量
            for (const key in Environment) {
                term.writeLine(`${key}="${Environment[key]}"`);
            }
            return;
        }

        const assignment = args.join(' '); // e.g., "LANG=zh" or "MY_VAR='hello world'"
        const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);

        if (match) {
            const key = match[1];
            let value = match[2];

            // 去除值两端的引号
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }

            // 在当前会话中设置环境变量
            Environment[key] = value;
            console.log(`[Env] Set (runtime) ${key} = "${value}"`);

            // 特殊处理：如果更改了 LANG 或 PS1，立即更新提示符
            if (key === 'LANG' || key === 'PS1') {
                bookmarkSystem.update_user_path();
            }
        } else {
            term.writeLine(`export: invalid format. Use KEY=VALUE`);
        }
     },
     // --- sudo 命令 (实现我上一个回复中的 Step C) ---
    'sudo': async (args, options, pipedInput) => {
        // "sudo" 只是一个装饰器，用于触发 "apt" 内部的权限检查
        if (!args[0]) {
            term.writeLine("sudo: a command is required");
            return;
        }
        const command = args[0];
        const commandArgs = args.slice(1);

        let commandFunc = null;
        if (bookmarkSystem.commands[command]) {
            commandFunc = bookmarkSystem.commands[command];
        } else if (globalCommands[command]) {
            commandFunc = globalCommands[command];
        }

        if (commandFunc) {
            // 传递 "sudo: true" 选项
            options.sudo = true;
            // Await the command, in case it's async (like apt)
            return await commandFunc(commandArgs, options, pipedInput);
        } else {
            term.writeHtml(`<span class="term-error">sudo: ${t('cmdNotFound')}: ${command}</span>`);
        }
    },

    // --- `apt` 命令 (使用 fetch) ---
    'apt': async (args, options) => {
        const REPO_URL = "https://raw.githubusercontent.com/BradleyBao/StartTerminal2/main/start-terminal-bookmark-extension/repo/";
        const subCommand = args[0];
        const pkgName = args[1];

        // 检查 sudo 权限
        if (!options.sudo && (subCommand === 'install' || subCommand === 'update' || subCommand === 'remove')) {
            term.writeLine(`apt: This command requires superuser privileges (try 'sudo apt ...')`);
            return;
        }

        try {
            switch (subCommand) {
                case 'update':
                    term.writeLine("Updating package lists from GitHub...");
                    const response = await fetch(REPO_URL + "index.json");
                    if (!response.ok) {
                        throw new Error(`Failed to fetch index: ${response.statusText}`);
                    }
                    const index = await response.json();
                    localStorage.setItem('apt_repo_index', JSON.stringify(index));
                    term.writeLine("... Done.");
                    break;

                case 'list':
                    {
                        const index = JSON.parse(localStorage.getItem('apt_repo_index') || '{}');
                        const installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        term.writeLine("Available packages:");
                        for (const key in index) {
                            const installedMark = installed[key] ? "[installed]" : "";
                            term.writeLine(`  ${key} - ${index[key].desc} ${installedMark}`);
                        }
                    }
                    break;
                
                case 'install':
                    if (!pkgName) { term.writeLine("Usage: sudo apt install <package>"); return; }
                    
                    const repoIndex = JSON.parse(localStorage.getItem('apt_repo_index') || '{}');
                    const pkg = repoIndex[pkgName];

                    if (!pkg) {
                        term.writeLine(`E: Unable to locate package ${pkgName}`);
                        return;
                    }

                    // [!!] 交互式 I/O [!!]
                    term.writeLine(`Package '${pkgName}' will be installed.`);
                    term.writeLine(pkg.desc);
                    if (pkg.permissions && pkg.permissions.length > 0) {
                        term.writeLine(`[!] This package requires new permissions: ${pkg.permissions.join(', ')}`);
                    }
                    const answer = await term.readInput("Do you want to continue? [Y/n]");

                    if (answer !== 'y' && answer !== '') {
                        term.writeLine("Install aborted.");
                        return;
                    }

                    // [!!] Chrome 权限请求 [!!]
                    if (pkg.permissions && pkg.permissions.length > 0) {
                        const granted = await new Promise((resolve) => {
                            chrome.permissions.request({ permissions: pkg.permissions }, resolve);
                        });
                        if (!granted) {
                            term.writeLine("Permissions not granted. Install failed.");
                            return;
                        }
                    }
                    
                    // [!!] Fetch 和安装代码 [!!]
                    term.writeLine(`Fetching ${pkgName} from ${pkg.file}...`);
                    const codeResponse = await fetch(REPO_URL + pkg.file);
                    if (!codeResponse.ok) {
                        throw new Error(`Failed to fetch package code: ${codeResponse.statusText}`);
                    }
                    const codeString = await codeResponse.text();

                    let installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                    installed[pkgName] = { code: codeString };
                    localStorage.setItem('installed_packages', JSON.stringify(installed));
                    term.writeLine(`Successfully installed ${pkgName}.`);
                    break;

                case 'remove':
                     if (!pkgName) { term.writeLine("Usage: sudo apt remove <package>"); return; }
                     {
                        let installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        if (!installed[pkgName]) {
                            term.writeLine(`${pkgName} is not installed.`);
                            return;
                        }
                        delete installed[pkgName];
                        localStorage.setItem('installed_packages', JSON.stringify(installed));
                        term.writeLine(`Successfully removed ${pkgName}.`);
                     }
                    break;

                default:
                    term.writeLine("Usage: sudo apt [update|list|install|remove] <package>");
            }
        } catch (e) {
            term.writeHtml(`<span class="term-error">apt error: ${e.message}</span>`);
        }
    }
};
// --- 结束替换 ---


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
    if (executeNestLevel === 0) {
        term.disableInput();
    }
    executeNestLevel++;
}

function done() {
    executeNestLevel--;
    if (executeNestLevel === 0) {
        term.enableInput();
        bookmarkSystem.update_user_path();
    }
     // 使用 BookmarkSystem 的方法
}

/**
 * 命令执行引擎
 * - 正确处理分号 (;) [顺序执行]
 * - 正确处理管道 (|) [流式执行]
 */
async function executeLine(line) {
    awaiting();
    
    // 1. 按分号 (;) 拆分，得到顺序命令
    // const sequentialCommands = line.split(';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
    
    const sequentialCommands = line.replace(/\n/g, ';')
                                   .split(';')
                                   .map(cmd => cmd.trim())
                                   .filter(cmd => cmd.length > 0 && !cmd.startsWith('#')); // 顺便支持注释

    if (sequentialCommands.length === 0) {
        done();
        return;
    }

    // 依次执行每个顺序命令
    for (const commandSequence of sequentialCommands) {
        
        // 2. 按管道 (|) 拆分，得到管道命令
        const pipelineStrings = commandSequence.split('|').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
        
        let lastOutput = null; // 用于存储上一个命令的输出

        // 依次执行管道中的每个命令
        for (let i = 0; i < pipelineStrings.length; i++) {
            const commandStr = pipelineStrings[i];
            
            // 3. 解析单个命令 (例如 "ls" 或 "grep How")
            const parsed = parseSingleCommand(commandStr);
            if (!parsed) continue;

            const { command, args, options } = parsed;
            
            let commandFunc = null;

            if (command.startsWith('./') || command.startsWith('/') || command.startsWith('~/')) {
                const result = bookmarkSystem._findNodeByPath(command);
                if (!result || !result.node) {
                    term.writeHtml(`<span class="term-error">startsh: ${t('noSuchFileOrDir')}: ${command}</span>`);
                    isPiping = false; break;
                }
                
                const meta = getMetadata(result.node);
                // 检查用户执行权限 (0o100 = --x------)
                if (meta.mode & 0o100) {
                    // 是可执行文件，将其交给 'sh'
                    commandFunc = globalCommands.sh;
                    args.unshift(command); // 将路径作为第一个参数
                } else {
                    term.writeHtml(`<span class="term-error">startsh: permission denied: ${command}</span>`);
                    isPiping = false; break;
                }
            }
            else if (bookmarkSystem.commands[command]) {
                commandFunc = bookmarkSystem.commands[command];
            } else if (globalCommands[command]) {
                commandFunc = globalCommands[command];
            }

            // 4. [!!] 设置管道状态 [!!]
            // 检查*这*是不是管道中的最后一个命令
            isPiping = (i < pipelineStrings.length - 1);
            if (isPiping) {
                pipeBuffer = []; // 如果是，准备好缓冲区
            }

            const installedPkgs = JSON.parse(localStorage.getItem('installed_packages') || '{}');
            const sandboxPkg = installedPkgs[command];

            if (commandFunc) {
                // --- A. 执行原生命令 ---
                const result = commandFunc(args, options, lastOutput);
                if (result instanceof Promise) {
                    lastOutput = await result;
                } else {
                    lastOutput = result;
                }
            } else if (sandboxPkg) {
                // --- B. 执行沙盒命令 ---
                term.writeHtml(`<span style="color:gray;">[Executing sandboxed script: ${command}]</span>`);
                // lastOutput (pipedInput) 会被传递
                const result = await term.executeInSandbox(sandboxPkg.code, args, lastOutput);
                lastOutput = result; // "result" 是从 sandbox.js 返回的
            
            } else if (command.trim() !== '') {
                // --- C. 命令未找到 ---
                term.writeHtml(`<span class="term-error">startsh: ${t('cmdNotFound')}: ${command}</span>`);
                isPiping = false; 
                break; 
            }

            // 5. 如果正在管道中，将缓冲区设为 "lastOutput" 供下一个命令使用
            if (isPiping) {
                lastOutput = pipeBuffer;
            }
        }
    }
    
    // 所有命令执行完毕
    await bookmarkSystem._refreshBookmarks();
    done();
}


async function main() {

    // Uptime 
    window.st2_startTime = Date.now();

    // Load Settings 
    loadStyleSettings();

    // --- 修改：将初始化移到 load 事件内部 ---
    term.writeLine("ST 2.0 Booting..."); // 这可能在尺寸计算前显示

    // 1. 初始化 Bookmark System
    await bookmarkSystem.initialize();

    // 2. 异步计算尺寸 (等待字体)
    // await term._calculateDimensions();
    await term.initialize();

    // 3. 使用正确尺寸初始化缓冲区
    // term._initBuffer();

    // 4. 设置命令处理器
    term.onCommand = executeLine;
    term.onTab = handleTabCompletion;

    // 5. 打印欢迎信息 (现在缓冲区尺寸正确)
    // term.writeLine("Welcome to Start-Terminal 2.0!");
    term.writeLine(t('welcome'));
    term.writeLine(t('features'));

    // 6. 显示第一个提示符
    // done();

    bookmarkSystem.update_user_path(); // 1. 显示提示符
    term.enableInput(); // 2. 启用光标和输入
}

// --- 修改：使用 load 事件 ---
window.addEventListener('load', main);

// main();

