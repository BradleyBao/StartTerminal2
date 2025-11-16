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

/**
 * 加载指定用户的环境
 * @param {string} username - "user" 或 "bradley" 等
 */
async function loadEnvironment(username) {
    // 1. 清空别名
    AliasEnvironment = {};
    
    // 2. 重置环境变量 (硬重置)
    Object.keys(Environment).forEach(key => delete Environment[key]);
    
    // 3. 设置新会话的基础
    Environment.USER = username;
    Environment.HOST = 'ST2.0';
    // (不再保留 oldPS1/oldLANG)

    // 4. 从 .startrc 加载配置
    //    这会为新会话设置 PS1, LANG, 和所有别名
    try {
        // 首先加载默认值
        // await parseStartrc(defaultStartrcContent);
        // 然后加载用户的 .startrc (这会覆盖默认值)
        await parseStartrc(loadVirtualStartrc());
    } catch (e) {
        console.warn("Error parsing .startrc during loadEnvironment", e);
        // 如果 .startrc 损坏，确保我们至少有一个 PS1
        if (!Environment.PS1) {
            Environment.PS1 = '\\u@\\h:\\w % ';
        }
    }
    
    // 5. 更新提示符 (它现在将使用新的 USER 和 .startrc 中的 PS1)
    if (bookmarkSystem) {
        bookmarkSystem.update_user_path();
    }
}

let AliasEnvironment = {}; // 存储别名的对象（临时）

// International Help Function 
function t(key) {
    const lang = Environment.LANG || 'en';
    if (messages[lang] && messages[lang][key]) {
        return messages[lang][key];
    } 
    // roll back to English 
    return messages['en'][key] || key;
}

function getVisualLength(str) {
    let length = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        
        // 基于 Unicode 范围的、更精确的全角/半角判断
        if (
            (code >= 0x1100 && code <= 0x115f) || // 韩文 Jamo
            (code >= 0x2e80 && code <= 0xa4cf) || // CJK 偏旁、符号、兼容表意文字
            (code >= 0xac00 && code <= 0xd7af) || // 韩文音节
            (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容表意文字
            (code >= 0xfe10 && code <= 0xfe19) || // 垂直标点
            (code >= 0xfe30 && code <= 0xfe6f) || // CJK 兼容形式
            (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII、标点
            (code >= 0xffe0 && code <= 0xffe6)    // 全角符号
        ) {
            length += 2; // 这是一个宽字符
        } else {
            length += 1; // 这是一个窄字符
        }
    }
    return length;
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
        const bufferStyle = window.getComputedStyle(this.domBuffer);
        const computedLineHeight = bufferStyle.lineHeight;
        const computedFontSize = bufferStyle.fontSize;

        if (computedLineHeight && computedFontSize) {
            // 2. 将 line-height 转换为像素
            if (computedLineHeight.endsWith('px')) {
                // '18px' -> 18
                this.cellHeight = parseFloat(computedLineHeight);
            } else if (computedLineHeight === 'normal') {
                // "normal" 是一个常见的默认值，通常是 1.2
                this.cellHeight = parseFloat(computedFontSize) * 1.2;
            } else {
                // 它是相对单位 (e.g., '1.2' or '1.5em')
                // 创建一个临时元素来计算它
                const tempLine = document.createElement('div');
                tempLine.style.padding = '0';
                tempLine.style.margin = '0';
                tempLine.style.lineHeight = computedLineHeight;
                tempLine.textContent = ' '; // 需要内容
                this.domBuffer.appendChild(tempLine);
                this.cellHeight = tempLine.getBoundingClientRect().height;
                this.domBuffer.removeChild(tempLine);
            }
        } else {
            // 回退
            this.cellHeight = parseFloat(computedFontSize || '14') * 1.2;
        }

        // 测量 cellWidth (这个方法仍然是正确的)
        const tempChar = document.createElement('span');
        tempChar.style.fontFamily = bufferStyle.fontFamily;
        tempChar.style.fontSize = bufferStyle.fontSize;
        tempChar.style.lineHeight = bufferStyle.lineHeight;
        tempChar.style.whiteSpace = 'pre';
        tempChar.textContent = 'W';
        this.domBuffer.appendChild(tempChar);
        this.cellWidth = tempChar.getBoundingClientRect().width;
        this.domBuffer.removeChild(tempChar);

        // 使用准确的 cellHeight 计算行数
        const containerHeight = this.container.clientHeight;
        const containerWidth = this.container.clientWidth;

        this.rows = Math.floor(containerHeight / this.cellHeight);
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

        this.container.addEventListener('dragstart', (e) => {
            e.preventDefault();
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
                const answer = this.currentLine;
                this.isReading = false;
                this._handleNewline(); // 换行
                this.readResolve(answer.trim().toLowerCase()); // Resolve Promise
                this.readResolve = null;
                this.disableInput(); // 交还控制权

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
                    // --- 确保正确获取 part2 ---
                    // 我们需要从原始 htmlFragment 中截取，而不是从 textContent
                    // start 参数应为 spaceLeft (跳过已写入的部分)
                    const part2 = this._truncateHtml(htmlFragment, remainingVisibleLength, spaceLeft);


                    // 如果剩余部分有实际内容，则递归写入
                    if (this._stripHtml(part2).length > 0) {
                        this._writeSingleLine(part2); // 递归调用
                    }
            }
        } else {
            // --- 不需要换行，片段完全适合当前行 ---
            // --- 关键调用点 2 ---
            this.buffer[this.cursorY] = this._overwriteHtml(this.buffer[this.cursorY], this.cursorX, htmlFragment);

            // this.cursorX += visibleLength; // 更新光标位置
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

        if (this.cursorX > 0) {
            // this._handleNewline();
            this.cursorX = 0;
            
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
            } else {
                // 手动更新 cursorX，因为 _writeSingleLine (L420) 是错误的
                const textContent = this._stripHtml(lines[i]);
                this.cursorX += textContent.length;
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
                
                case 'c': 
                    const lineContent = this.prompt + this.currentLine;
                    const lineWithMarker = lineContent + '^C';
                    const escapedLine = this.escapeHtml(lineWithMarker);
                    const padding = ' '.repeat(Math.max(0, this.cols - lineWithMarker.length));
                    this.buffer[this.cursorY] = escapedLine + padding;
                    this._handleNewline();
                    this.currentLine = '';
                    bookmarkSystem.update_user_path();
                    this.enableInput();
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
            
            // this.currentLine = ''; 
            // this.cursorX = 0; 
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
            // e.preventDefault();
            // const pos = this.cursorX - this.prompt.length;
            // const char = e.key;
            
            // this.currentLine = this.currentLine.substring(0, pos) + char + this.currentLine.substring(pos);
            // this.cursorX++; 
            // this._render(); // [!] 移动到内部
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
        if (this.isReading) {
            e.target.value = ''; // 清空 <textarea>
            return;
        }
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
        // 1. 保存旧的行数
        const oldRows = this.rows;

        // 2. 重新计算新尺寸
        await this._calculateDimensions();
        const newRows = this.rows;
        const newCols = this.cols;

        // 3. 调整 buffer 数组以匹配 newRows (在顶部添加/删除行)
        if (newRows > oldRows) {
            // 窗口变高了，在顶部添加新行（模拟内容向上滚动）
            const diff = newRows - oldRows;
            const newLines = Array(diff).fill(' '.repeat(newCols));
            this.buffer.splice(0, 0, ...newLines); // 在 buffer 顶部插入
        } else if (newRows < oldRows) {
            // 窗口变矮了，从顶部删除行（模拟内容滚出屏幕）
            const diff = oldRows - newRows;
            this.buffer.splice(0, diff); // 从 buffer 顶部删除
        }
        
        // 4. 调整 buffer 中*每行*的宽度 (天真的重排：截断或填充)
        //    用户接受这种 "被打乱" 的布局
        this.buffer = this.buffer.map(line => {
            const textContent = this._stripHtml(line); // 获取纯文本
            if (textContent.length > newCols) {
                // 截断
                return this.escapeHtml(textContent.substring(0, newCols)); 
            } else {
                // 填充
                return this.escapeHtml(textContent) + ' '.repeat(newCols - textContent.length);
            }
        });

        // 5. 确保光标在调整后的最后一行
        //    (在我们的设计中，光标总是在缓冲区之外的“当前行”)
        //    我们只需要确保 cursorY 是最后一行，_render 会处理的
        this.cursorY = this.rows - 1;

        // 6. 重新渲染 (将显示 reflowed 缓冲区和新提示符)
        //    setPrompt 会被 _render 隐式调用
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
    constructor(term, filePath, initialContent, onSave, onExit, isReadOnly = false) {
        this.term = term;
        this.filePath = filePath;
        this.onSave = onSave;
        this.onExit = onExit;
        this.isReadOnly = isReadOnly;

        this.lines = initialContent.split('\n'); // 文件内容（字符串数组）
        this.cursorY = 0;   // 光标在文件中的行号
        this.cursorX = 0;   // 光标在文件中的列号
        this.topRow = 0;    // 屏幕上显示的第一行文件
        this.status = "Press ^X to Exit" + (this.isReadOnly ? "" : ", ^O to Save")
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
        const roText = this.isReadOnly ? ' [ Read Only ]' : '';
        const topBar = `Nano 1.0 | File: ${this.filePath} ${this.dirty ? '*' : ''}${roText}`;
        this.term.buffer[0] = this._padLine(topBar, true);

        // 2. 绘制文本区域
        const editorHeight = this.termRows - 3;
        for (let y = 0; y < editorHeight; y++) {
            const lineIndex = this.topRow + y;

            // 仅当*不是*光标行时，才使用 _padLine (它会转义HTML)
            // 我们将在第 4 步专门处理光标行。
            if (lineIndex === this.cursorY) {
                continue;
            }

            if (lineIndex < this.lines.length) {
                this.term.buffer[y + 1] = this._padLine(this.lines[lineIndex]);
            } else {
                this.term.buffer[y + 1] = this._padLine("~");
            }
        }

        // 3. 绘制底栏
        const saveText = this.isReadOnly ? "" : "  ^O Save";
        this.term.buffer[this.termRows - 2] = this._padLine(`^X Exit${saveText}`, true);
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
                    if (this.isReadOnly) {
                        this.status = "File is read-only";
                        this._render(); // 重新渲染以显示状态
                        return; // 阻止调用 _save()
                    }
                    this._save();
                    break;
            }
        } else {
            const isEditKey = ['Backspace', 'Enter'].includes(e.key) || 
                              (e.key.length === 1 && !e.ctrlKey && !e.metaKey);
            if (this.isReadOnly && isEditKey) {
                this.status = "File is read-only"; // (可选) 再次提醒
                this._render(); // 重新渲染以显示状态
                return; // 阻止所有编辑键
            }
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

    async _save() {
        this.status = "Saving...";
        
        try {
            const content = this.lines.join('\n');
            const success = this.onSave(this.filePath, content);
            if (success) {
                this.dirty = false;
                this.status = `File saved! (${content.length} bytes)`;
            } else {
                if (this.status === "Saving...") {
                    this.status = "Error: Could not save file.";
                }
            }
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
                
                // 'ls -l' 长列表格式化函数
                if (options.l) {
                    // 长列表格式
                    for (const child of children) {
                        const meta = getMetadata(child);
                        const isDir = !!child.children;
                        const modeStr = formatMode(meta.mode, isDir);
                        const links = 1;
                        const owner = meta.owner || "user";
                        const group = meta.group || "user";
                        const size = 0; // (大小对书签没有意义)
                        const date = new Date(child.dateAdded || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

                        const name = isDir ? `<span class="term-folder">${child.title}/</span>` : child.title;
                        
                        this.term.writeHtml(`${modeStr} ${links} ${owner} ${group} ${String(size).padStart(6)} ${date} ${name}`);
                    }
                } else {
                    if (children.length === 0) return;

                    // 1. 格式化所有名称并找到最大宽度 (保持不变)
                    let maxNameWidth = 0;
                    const formattedNames = children.map(child => {
                        const title = child.title.trim();
                        const isDir = !!child.children;
                        const visualLen = getVisualLength(title) + (isDir ? 1 : 0);
                        let html;
                        if (isDir) {
                            html = `<span class="term-folder">${this.term.escapeHtml(title)}/</span>`;
                        } else {
                            html = this.term.escapeHtml(title);
                        }
                        if (visualLen > maxNameWidth) {
                            maxNameWidth = visualLen;
                        }
                        return { html: html, visualLen: visualLen }; 
                    });

                    // 2. 计算列 (保持不变)
                    const colPadding = 2; 
                    const colWidth = maxNameWidth + colPadding;
                    const termWidth = this.term.cols;
                    let numCols = Math.floor(termWidth / colWidth);
                    if (numCols === 0) numCols = 1;

                    // 3. [!!] 计算行数 (新)
                    const numRows = Math.ceil(formattedNames.length / numCols);

                    // 4. [!!] 按“列优先”顺序构建和打印 (新)
                    for (let y = 0; y < numRows; y++) {
                        let currentLine = "";
                        for (let x = 0; x < numCols; x++) {
                            // (y, x) -> (0,0), (0,1), (0,2)
                            // (1,0), (1,1), (1,2)
                            const index = y + (x * numRows); // 列优先索引
                            
                            if (index < formattedNames.length) {
                                const name = formattedNames[index];
                                const padding = ' '.repeat(Math.max(0, colWidth - name.visualLen));
                                currentLine += name.html + padding;
                            }
                        }
                        this.term.writeHtml(currentLine); // 打印一行
                    }
                }
            },
            
            'mkdir': async (args, options) => {
                if (args.length === 0) {
                    this.term.writeHtml(`<span class="term-error">mkdir: missing operand</span>`);
                    return;
                }

                for (const path of args) {
                    // 1. 检查它是否已存在
                    const existing = this._findNodeByPath(path);
                    if (existing && existing.node) {
                        this.term.writeHtml(`<span class="term-error">mkdir: ${path}: File exists</span>`);
                        continue; // 继续下一个参数
                    }

                    // 2. 解析父路径和新目录名
                    let parentPath, dirName;
                    if (path.includes('/')) {
                        parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
                        dirName = path.split('/').pop();
                    } else {
                        parentPath = '.'; // 相对当前目录
                        dirName = path;
                    }
                    
                    if (!dirName) {
                        this.term.writeHtml(`<span class="term-error">mkdir: invalid path: ${path}</span>`);
                        continue;
                    }

                    // 3. 查找父节点并检查权限
                    const parentResult = this._findNodeByPath(parentPath);
                    if (!parentResult || !parentResult.node || !parentResult.node.children) {
                        this.term.writeHtml(`<span class="term-error">mkdir: ${parentPath}: ${t('noSuchFileOrDir')}</span>`);
                        continue;
                    }
                    
                    if (!hasPermission(parentResult.node, 'w')) {
                        this.term.writeHtml(`<span class="term-error">mkdir: ${parentPath}: Permission denied</span>`);
                        continue;
                    }

                    // 4. 创建书签文件夹
                    const newNode = await new Promise(r => chrome.bookmarks.create({ parentId: parentResult.node.id, title: dirName }, r));
                    
                    // 5. 设置新目录的元数据
                    if (newNode) {
                        setMetadata(newNode, 0o777, Environment.USER, Environment.USER);
                    }
                }
            },
            
            'rmdir': async (args, options) => {
                if (args.length === 0) {
                    this.term.writeHtml(`<span class="term-error">rmdir: missing operand</span>`);
                    return;
                }

                for (const path of args) {
                    // 修剪末尾的 '/'
                    const cleanPath = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
                    
                    const result = this._findNodeByPath(cleanPath);
                    
                    if (!result || !result.node) {
                        this.term.writeHtml(`<span class="term-error">rmdir: ${path}: ${t('noSuchFileOrDir')}</span>`);
                        continue;
                    }
                    
                    const target = result.node;

                    // 添加权限检查
                    if (!hasPermission(target, 'w')) {
                        this.term.writeHtml(`<span class="term-error">rmdir: ${path}: Permission denied</span>`);
                        continue;
                    }
                    if (!target.children) {
                        this.term.writeHtml(`<span class="term-error">rmdir: ${path}: ${t('notADir')}</span>`);
                        continue;
                    }
                    if (target.children.length > 0) {
                        this.term.writeHtml(`<span class="term-error">rmdir: ${path}: ${t('dirNotEmpty')}</span>`);
                        continue;
                    } 
                    
                    await new Promise(resolve => chrome.bookmarks.remove(target.id, resolve));
                }
            },
            
            'rm': async (args, options) => {
                if (args.length === 0) {
                    term.writeHtml(`<span class="term-error">rm: missing operand</span>`);
                    return;
                }
                
                const recursive = options.r || options.recurse;
                
                for (const pathArg of args) {
                    
                    // 修剪末尾的 '/' ('rm "dir/"')
                    let pathPattern = pathArg;
                    if (pathPattern.endsWith('/') && pathPattern.length > 1) {
                        pathPattern = pathPattern.slice(0, -1);
                    }

                    // 使用 Glob 解析器 
                    let targets = [];
                    if (pathPattern.includes('*')) {
                        // 这是一个通配符路径
                        targets = this._globResolver(pathPattern, this.current); //
                        if (targets.length === 0) {
                            term.writeHtml(`<span class="term-error">${t('rmNoMatch')} '${pathPattern}'</span>`);
                            continue; // 跳到下一个参数
                        }
                    } else {
                        // 这是一个常规路径
                        // 始终使用 _findNodeByPath (L1195)
                        const result = this._findNodeByPath(pathPattern);
                        if (!result || !result.node) {
                            term.writeHtml(`<span class="term-error">rm: ${pathPattern}: ${t('noSuchFileOrDir')}</span>`);
                            continue; // 跳到下一个参数
                        }
                        targets = [result.node];
                    }
                    
                    // 在循环内部处理 targets 
                    for (const target of targets) {
                        // 权限检查
                        if (!hasPermission(target, 'w')) {
                            term.writeHtml(`<span class="term-error">rm: cannot remove '${target.title}': Permission denied</span>`);
                            continue; // 跳过这个文件
                        }
                        
                        // VFS 'rm' 逻辑
                        if (target.id.startsWith('vfs-bin-')) {
                            deleteVfsScript(target.title);
                            this.vfsBin.children = this.vfsBin.children.filter(c => c.id !== target.id);
                            term.writeLine(`Removed VFS script: ${target.title}`);
                            continue; // 跳过 VFS 文件
                        }

                        // 书签 'rm' 逻辑
                        if (target.children && !recursive) {
                            term.writeHtml(`<span class="term-error">rm: ${target.title}: ${t('isADir')}</span>`);
                        } else if (target.children && recursive) {
                            await this._removeRecursive(target.id);
                        } else if (!target.children) {
                            await new Promise(resolve => chrome.bookmarks.remove(target.id, resolve));
                        }
                    }
                }
            },
            'pwd': (args, options) => {
                let displayPath;
                // --- pwd 始终显示绝对路径，从不显示 ~ ---
                if (!this.root) {
                    displayPath = "/"; // 容错
                } else if (this.path.length <= 1) {
                    displayPath = "/"; // 根目录
                } else {
                    // 从 path 数组的第二个元素（根目录之后）开始
                    // 获取所有节点的 title 并用 '/' 连接
                    displayPath = "/" + this.path.slice(1).map(node => node.title).join("/");
                }
                this.term.writeLine(displayPath); // 使用 writeLine 输出纯文本
            },
            'mv': async (args, options) => {
                if (args.length < 2) {
                    term.writeHtml(`<span class="term-error">mv: missing destination</span>`); return;
                }
                const sourcePath = args[0];
                const destPath = args[1];

                const sourceResult = this._findNodeByPath(sourcePath); //
                if (!sourceResult || !sourceResult.node) {
                    term.writeHtml(`<span class="term-error">mv: ${t('noSuchFileOrDir')}: ${sourcePath}</span>`); return;
                }
                const sourceNode = sourceResult.node;

                // 1. 检查源权限
                if (!hasPermission(sourceNode, 'w')) { //
                    term.writeHtml(`<span class="term-error">mv: cannot move '${sourcePath}': Permission denied</span>`); return;
                }

                // 2. 查找目标
                const destResult = this._findNodeByPath(destPath);
                let destNode = destResult ? destResult.node : null;
                
                // --- Case A: VFS 脚本重命名 (仅 /bin) ---
                if (sourceNode.id.startsWith('vfs-bin-')) {
                    const newName = destPath.split('/').pop();
                    if (destPath.startsWith('/bin/') && !destNode) {
                        // VFS 重命名
                        let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
                        const scriptData = scripts[sourceNode.title];
                        if (scriptData) {
                            delete scripts[sourceNode.title];
                            scripts[newName] = scriptData;
                            localStorage.setItem('vfs_bin_scripts', JSON.stringify(scripts));
                            await this._refreshBookmarks(); // 重载 VFS
                        }
                    } else {
                        term.writeHtml(`<span class="term-error">mv: VFS scripts can only be renamed within /bin.</span>`);
                    }
                    return;
                }
                if (sourceNode.id.startsWith('vfs-etc')) {
                    term.writeHtml(`<span class="term-error">mv: VFS core files (like /etc) cannot be moved.</span>`); return;
                }

                // --- Case B: 书签移动/重命名 ---
                let destParentNode = null;
                let destTitle = null;

                if (destNode && destNode.children) {
                    // 1. 目标是目录: 移入
                    destParentNode = destNode;
                    destTitle = sourceNode.title; // 保持原名
                } else if (!destNode) {
                    // 2. 目标不存在: 移动并重命名
                    const lastSlash = destPath.lastIndexOf('/');
                    // 使用 '.' (当前目录) 作为相对路径的父级
                    const parentPath = (lastSlash > -1) ? destPath.substring(0, lastSlash) : '.'; 
                    const newTitle = (lastSlash > -1) ? destPath.substring(lastSlash + 1) : destPath;
                    
                    const parentResult = this._findNodeByPath(parentPath);
                    if (parentResult && parentResult.node && parentResult.node.children) {
                        destParentNode = parentResult.node;
                        destTitle = newTitle;
                    } else {
                        term.writeHtml(`<span class="term-error">mv: destination path not found: ${parentPath}</span>`); return;
                    }
                } else {
                    term.writeHtml(`<span class="term-error">mv: destination is not a directory: ${destPath}</span>`); return;
                }
                
                if (destParentNode) {
                    // 检查目标父目录权限
                    if (!hasPermission(destParentNode, 'w')) {
                         term.writeHtml(`<span class="term-error">mv: cannot write to destination: Permission denied</span>`); return;
                    }
                    
                    const needsMove = sourceNode.parentId !== destParentNode.id;
                    const needsRename = destTitle && sourceNode.title !== destTitle;

                    try {
                        if (needsMove) {
                            // 1. 执行移动
                            await new Promise((resolve, reject) => {
                                chrome.bookmarks.move(sourceNode.id, { parentId: destParentNode.id }, (node) => {
                                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                    else resolve(node);
                                });
                            });
                        }
                        if (needsRename) {
                            // 2. 执行重命名 (使用同一个 ID)
                            await new Promise((resolve, reject) => {
                                chrome.bookmarks.update(sourceNode.id, { title: destTitle }, (node) => {
                                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                    else resolve(node);
                                });
                            });
                        }
                    } catch (e) {
                         term.writeHtml(`<span class="term-error">mv: API Error: ${e.message}</span>`);
                    }
                }
            },

            'touch': async (args, options) => {
                if (args.length === 0) {
                    term.writeHtml(`<span class="term-error">touch: missing file operand</span>`);
                    return;
                }

                for (const path of args) {
                    const result = this._findNodeByPath(path);

                    if (result && result.node) {
                        // 文件已存在，暂时什么都不做 (更新时间戳)
                        continue;
                    }

                    // 文件不存在，创建它
                    let parentPath, fileName;
                    if (path.includes('/')) {
                        parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
                        fileName = path.split('/').pop();
                    } else {
                        parentPath = '.';
                        fileName = path;
                    }

                    const parentResult = this._findNodeByPath(parentPath);
                    if (!parentResult || !parentResult.node || !parentResult.node.children) {
                        term.writeHtml(`<span class="term-error">touch: cannot touch '${path}': ${t('noSuchFileOrDir')}</span>`);
                        continue;
                    }
                    
                    if (!hasPermission(parentResult.node, 'w')) {
                        term.writeHtml(`<span class="term-error">touch: cannot touch '${path}': Permission denied</span>`);
                        continue;
                    }

                    // Case A: VFS /bin
                    if (parentResult.node.id === 'vfs-bin') {
                        saveVfsScript(fileName, "", 0o755, Environment.USER);
                        const newNode = {
                            id: `vfs-bin-${fileName}`, title: fileName, url: `data:text/plain;base64,`,
                            mode: 0o755, owner: Environment.USER, group: Environment.USER, children: null, parentId: 'vfs-bin'
                        };
                        this.vfsBin.children.push(newNode);
                        continue;
                    }
                    
                    // Case B: 普通书签
                    const newNode = await new Promise(resolve => {
                        chrome.bookmarks.create({
                            parentId: parentResult.node.id,
                            title: fileName,
                            url: 'data:text/plain,' // 空文本文件
                        }, resolve);
                    });
                    
                    // 为新文件设置元数据
                    if (newNode) {
                        setMetadata(newNode, 0o666, Environment.USER, Environment.USER);
                    }
                }
            },

            // [!! 新增 'cp' !!]
            'cp': async (args, options) => {
                if (args.length < 2) {
                    term.writeHtml(`<span class="term-error">cp: missing destination</span>`); return;
                }
                const sourcePath = args[0];
                const destPath = args[1];

                const sourceResult = this._findNodeByPath(sourcePath); //
                if (!sourceResult || !sourceResult.node) {
                    term.writeHtml(`<span class="term-error">cp: ${t('noSuchFileOrDir')}: ${sourcePath}</span>`); return;
                }
                const sourceNode = sourceResult.node;
                
                // 1. 检查源 'r' 权限
                if (!hasPermission(sourceNode, 'r')) { //
                    term.writeHtml(`<span class="term-error">cp: cannot read '${sourcePath}': Permission denied</span>`); return;
                }
                
                // 2. 查找目标
                const destResult = this._findNodeByPath(destPath);
                let destNode = destResult ? destResult.node : null;
                let destParentNode = null;
                let newName = null;
                
                if (destNode && destNode.children) {
                    // Case 1: cp file dir (目标是目录)
                    destParentNode = destNode;
                    // newName 保持 null, _copyRecursive 将使用原名
                } else if (!destNode) {
                    // Case 2: cp file newfile (目标是新路径)
                    const lastSlash = destPath.lastIndexOf('/');
                    const parentPath = (lastSlash > -1) ? destPath.substring(0, lastSlash) : '.'; // 使用 '.' (当前)
                    newName = (lastSlash > -1) ? destPath.substring(lastSlash + 1) : destPath;
                    
                    const parentResult = this._findNodeByPath(parentPath);
                    if (parentResult && parentResult.node && parentResult.node.children) {
                        destParentNode = parentResult.node; // [!!] 直接存储找到的父节点
                    }
                }
                
                if (!destParentNode) {
                    term.writeHtml(`<span class="term-error">cp: invalid destination: ${destPath}</span>`); return;
                }
                
                // 3. 检查目标 'w' 权限 (直接使用节点)
                if (!hasPermission(destParentNode, 'w')) {
                    term.writeHtml(`<span class="term-error">cp: cannot write to '${destPath}': Permission denied</span>`); return;
                }

                // --- Case A: VFS 脚本复制 (仅 /bin) ---
                if (sourceNode.id.startsWith('vfs-bin-')) {
                    if (destParentNode.id === 'vfs-bin') {
                        const scriptName = newName || sourceNode.title;
                        const base64Content = (sourceNode.url || '').split(',')[1] || '';
                        const content = decodeURIComponent(atob(base64Content));
                        //
                        saveVfsScript(scriptName, content, 0o755, Environment.USER); 
                        await this._refreshBookmarks(); // 重载 VFS
                    } else {
                        term.writeHtml(`<span class="term-error">cp: VFS scripts can only be copied to /bin.</span>`);
                    }
                    return;
                }
                if (sourceNode.id.startsWith('vfs-etc')) {
                    term.writeHtml(`<span class="term-error">cp: cannot copy core VFS files.</span>`); return;
                }

                // --- Case B: 书签/文件夹递归复制 ---
                await this._copyRecursive(sourceNode, destParentNode.id, newName);
            },
        };
    }

    // --- 将书签相关的辅助函数移入此类 ---

    async initialize() {
            this.vfsBin.children = loadVfsScripts();
            await this._refreshBookmarks(); // 加载并合并 VFS
            
            // try {
            //     const startrcNode = this._findNodeByPath('/etc/.startrc');
            //     if (startrcNode && startrcNode.node && startrcNode.node.url) {
            //         const base64Content = startrcNode.node.url.split(',')[1] || '';
            //         const rcContent = decodeURIComponent(atob(base64Content));
            //         await parseStartrc(rcContent);
            //     } else {
            //         console.warn(".startrc not found, using default environment.");
            //         await parseStartrc(defaultStartrcContent); 
            //     }
            // } catch (e) {
            //     console.error("Error loading .startrc:", e);
            // }

            // --- 在 _refreshBookmarks 之后设置初始路径 ---
            this.current = this.homeDirNode || this.virtualRoot; // 默认启动目录 (Home 或 Root)
            this.path = this.homeDirNode ? [this.virtualRoot, this.homeDirNode] : [this.virtualRoot];
            // --- 结束 ---
            // this.update_user_path();
    }

    async _copyRecursive(node, destParentId, newName = null) {
        if (!node) return;
        const newOwner = Environment.USER; //
        const newGroup = Environment.USER; // 默认为 user group

        const title = newName || node.title; // 允许在复制时重命名

        if (node.children) {
            // 这是一个目录
            const newFolder = await new Promise(r => chrome.bookmarks.create({
                parentId: destParentId,
                title: title
            }, r));
            
            // 为新文件夹设置元数据 (所有者是当前用户)
            setMetadata(newFolder, 0o777, newOwner, newGroup); //
            
            // 递归复制子项
            if (node.children.length > 0) {
                // 必须使用 Promise.all 来等待所有子项完成
                await Promise.all(node.children.map(child => 
                    this._copyRecursive(child, newFolder.id)
                ));
            }
        } else {
            // 这是一个文件 (书签)
            const newBookmark = await new Promise(r => chrome.bookmarks.create({
                parentId: destParentId,
                title: title,
                url: node.url
            }, r));
            // 为新书签设置元数据
            setMetadata(newBookmark, 0o666, newOwner, newGroup); //
        }
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
        
        let promptString = Environment.PS1 || '\\$ '; // 回退
        promptString = promptString.replace(/\\u/g, Environment.USER || 'user');
        promptString = promptString.replace(/\\h/g, Environment.HOST || 'host');
        promptString = promptString.replace(/\\w/g, displayPath); // \w 现在会是 ~ 或 /path
        promptString = promptString.replace(/\\\$/g, '$');

        this.full_path = promptString;
        
        // if (!this.term.inputDisabled) {
        //     this.term.setPrompt(this.full_path);
        // }
        this.term.setPrompt(this.full_path);
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

    /**
     * @param {string} pathPattern - e.g., "测试*" or "/bin/test*"
     * @param {Object} contextNode - 运行 'rm' 时的 this.current
     * @returns {Array<Object>} - 匹配到的节点数组
     */
    _globResolver(pathPattern, contextNode) {
        let baseNode = contextNode;
        let pattern = pathPattern;

        // 1. 检查是否是绝对路径 (e.g., /bin/test*)
        if (pathPattern.includes('/')) {
            const lastSlash = pathPattern.lastIndexOf('/');
            const basePath = pathPattern.substring(0, lastSlash) || '/';
            pattern = pathPattern.substring(lastSlash + 1);
            
            const result = this._findNodeByPath(basePath);
            if (!result || !result.node || !result.node.children) {
                return []; // 基础路径无效
            }
            baseNode = result.node;
        }

        // 2. 将通配符 '*' 转换为 RegExp
        // (转义 . ? + $ ^ [ ] ( ) { } | \ 等特殊字符)
        const regexPattern = pattern
            .replace(/[.+?$^()[\]{}|\\]/g, '\\$&')
            .replace(/\*/g, '.*'); // 将 * 替换为 .*
        
        const regex = new RegExp('^' + regexPattern + '$');

        // 3. 过滤子节点
        return (baseNode.children || []).filter(child => 
            regex.test(child.title.trim())
        );
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

# --- Aliases ---
alias ll='ls -l -a'
alias la='ls -a'
welcome
`

/**
 * 解析 .startrc 内容并更新 Environment 对象
 * @param {string} content - .startrc 文件内容
 */
async function parseStartrc(content) {
    const lines = content.split('\n');
    const exportRegex = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;
    const aliasRegex = /^\s*alias\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]?(.*?)['"]?\s*$/;

    for (const line of lines) {
        let match = line.match(exportRegex);
        if (match) {
            const key = match[1];
            let value = match[2];

            // 去除值两端的引号（"value" or 'value')
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }
            
            Environment[key] = value;
            console.log(`[Env] Set ${key} = "${value}"`);
        } else if (match = line.match(aliasRegex)) {
            const key = match[1];
            let value = match[2];
            // 清理可能被捕获的引号
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }
            AliasEnvironment[key] = value;
            console.log(`[Alias] Set ${key} = "${value}"`);
        } else if (line.trim().length > 0 && !line.trim().startsWith('#')) {
            // 既不是 export 也不是 alias，也不是注释
            // 尝试将其作为常规命令执行 (例如 'welcome')
            await executeLine(line); // [!!] 3. await executeLine
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
    
    // 1. 找出光标前的所有 token
    const lineUpToCursor = line.substring(0, pos);
    const tokens = lineUpToCursor.split(' ').filter(Boolean);
    const tokenCount = tokens.length;
    
    let isCompletingFirstWord = false;
    let isCompletingSubCommand = false;
    let isCompletingPath = false;

    let tokenToComplete = "";
    let tokenStartIndex = 0;
    
    if (line.endsWith(' ')) {
        // 光标在空格后 -> 准备补全下一个 token
        tokenToComplete = "";
        tokenStartIndex = pos;
    } else {
        // 光标在一个 token 中间
        tokenToComplete = tokens[tokens.length - 1] || "";
        tokenStartIndex = lineUpToCursor.lastIndexOf(tokenToComplete);
    }

    const command = tokens[0] || "";

    // 2. 决定要补全什么
    if (tokenCount === 0 || (tokenCount === 1 && !line.endsWith(' '))) {
        isCompletingFirstWord = true;
    } else if (subCommandCompletions.hasOwnProperty(command) && (tokenCount === 1 || (tokenCount === 2 && !line.endsWith(' ')))) {
        // 如果命令在我们的 map 中，并且我们在补全第二个词
        if (subCommandCompletions[command].length > 0) {
            isCompletingSubCommand = true;
        } else {
            isCompletingPath = true; // e.g., 'cd ' (map 为 [])
        }
    } else {
        isCompletingPath = true; // 默认补全路径
    }

    // 3. 查找匹配项
    let matches = [];
    let completionPrefix = ''; // 用于路径 (e.g., /bin/)

    let partial = "";
    
    if (isCompletingFirstWord) {
        const allCommands = getAllCommandNames();
        matches = allCommands.filter(cmd => cmd.startsWith(tokenToComplete)).map(cmd => ({ title: cmd }));
        partial = tokenToComplete; // [!! 2. 赋值 (而不是声明) !!]
        
    } else if (isCompletingSubCommand) {
        matches = subCommandCompletions[command].filter(cmd => cmd.startsWith(tokenToComplete)).map(cmd => ({ title: cmd }));
        partial = tokenToComplete; // [!! 3. 赋值 (而不是声明) !!]
    
    } else if (isCompletingPath) {
        // --- 使用现有的文件补全逻辑 ---
        let isQuoted = false;
        let searchToken = tokenToComplete;
        if (searchToken.startsWith('"')) {
            isQuoted = true;
            searchToken = searchToken.substring(1);
        }

        const lastSlash = searchToken.lastIndexOf('/');
        if (lastSlash > -1) {
            completionPrefix = searchToken.substring(0, lastSlash + 1);
            partial = searchToken.substring(lastSlash + 1); // [!!] (L1362: 赋值, 保持不变)
            const result = bookmarkSystem._findNodeByPath(completionPrefix);
            if (result && result.node && result.node.children) {
                matches = result.node.children.filter(child => child.title.trim().startsWith(partial));
            }
        } else {
            partial = searchToken; // [!!] (L1370: 赋值, 保持不变)
            if (bookmarkSystem.current && bookmarkSystem.current.children) {
                matches = bookmarkSystem.current.children.filter(child => child.title.trim().startsWith(partial));
            }
        }
        // (文件补全逻辑现在嵌套在这里)
    }

    // --- 4. [新] 补全逻辑 (通用) ---
    if (matches.length === 0) {
        lastTabMatches = []; return;
    }

    const textBeforeToken = line.substring(0, tokenStartIndex);
    const textAfterCursor = line.substring(pos);
    
    if (matches.length === 1) {
        // 4a. 只有一个匹配项
        lastTabMatches = [];
        const match = matches[0];
        let matchName = match.title.trim();
        let completion = completionPrefix + matchName;
        
        if (match.children) completion += '/'; // 目录

        // [!!] 处理空格和引号 [!!]
        if (completion.includes(' ') && (isCompletingPath && !tokenToComplete.startsWith('"'))) {
            if (match.children) {
                completion = `"${completion.slice(0, -1)}"\/`; // "My Dir"/
            } else {
                completion = `"${completion}"`; // "My File"
            }
        }
        
        // 如果不是目录，在末尾添加一个空格
        if (!match.children) {
            completion += ' ';
        }
        
        const newLine = textBeforeToken + completion + textAfterCursor;
        const newCursorPos = (textBeforeToken + completion).length;
        term.setCommand(newLine, newCursorPos);

    } else {
        // 4b. 多个匹配项：
        const lcp = findLCP(matches);

        if (lcp.length > partial.length) {
            // 我们可以补全更多 (LCP)
            lastTabMatches = [];
            let completion = completionPrefix + lcp;
            
            if (completion.includes(' ') && (isCompletingPath && !tokenToComplete.startsWith('"'))) {
                completion = `"${completion}`;
            }
            
            const newLine = textBeforeToken + completion + textAfterCursor;
            const newCursorPos = (textBeforeToken + completion).length;
            term.setCommand(newLine, newCursorPos);

        } else {
            // 4c. 无法进一步补全 (LCP === partial)。检查双击。
            const isDoubleTap = (currentTime - lastTabTime < 500);
            
            // (注意: 'arraysAreEqual' 依赖 'id'，
            // 我们的新 'matches' 数组 (用于命令) 没有 'id'，所以这个检查可能会失败)
            // (为了简单起见，我们暂时忽略 'arraysAreEqual' 检查)

            if (isDoubleTap) {
                // 列出所有选项
                term._handleNewline(); 
                const output = matches.map(m => {
                    let title = m.title.trim();
                    if (title.includes(' ')) title = `"${title}"`;
                    return m.children ? `${title}/` : title;
                }).join('   ');
                
                term.writeHtml(output); 
                
                bookmarkSystem.update_user_path(); 
                term.setCommand(line, pos); // 恢复当前行
                
                lastTabMatches = [];
            } else {
                lastTabMatches = matches.map(m => ({ id: m.title, title: m.title })); // 存储一个可比较的格式
            }
        }
    }
    
    lastTabTime = currentTime;
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
            mode: scripts[name].mode,
            owner: scripts[name].owner || 'user', // [!!] 加载 owner
            group: scripts[name].group || 'user', // [!!] 加载 group
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
    if (!node) return { mode: 0, owner: 'root', group: 'root' };
    
    // 1. VFS 内部节点
    if (node.owner) { // /bin/ 脚本有 'owner' 属性
        return { mode: node.mode, owner: node.owner, group: node.group || 'user' };
    }
    // 硬编码的 VFS 目录/文件
    if (node.id === 'vfs-etc') return { mode: 0o755, owner: 'root', group: 'root' };
    if (node.id === 'vfs-bin') return { mode: 0o777, owner: 'root', group: 'root' };
    if (node.id === 'vfs-startrc') return { mode: 0o666, owner: 'root', group: 'root' };

    // 2. 真实书签 (从 localStorage 读取)
    const metadataStore = JSON.parse(localStorage.getItem('vfs_metadata') || '{}');
    const meta = metadataStore[node.id];
    if (meta) {
        return {
            mode: meta.mode || (node.children ? 0o777 : 0o666),
            owner: meta.owner || 'user', // [!!] 加载 owner
            group: meta.group || 'user'
        };
    }
    
    // 3. 默认书签权限 (未被追踪的)
    if (node.children) {
        return { mode: 0o777, owner: 'user', group: 'user' }; // 目录
    } else {
        return { mode: 0o666, owner: 'user', group: 'user' }; // 文件
    }
}

/**
 * 设置节点的元数据 (权限)
 * @param {Object} node - VFS 节点
 * @param {number} newMode - 八进制权限 (e.g., 0o755)
 */
function setMetadata(node, newMode, newOwner, newGroup) { // [!! 修改：添加 owner/group !!]
    if (!node) return;

    // 1. VFS /bin/ 脚本
    if (node.id.startsWith('vfs-bin-')) {
        let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
        if (scripts[node.title]) {
            if (newMode) scripts[node.title].mode = newMode;
            if (newOwner) scripts[node.title].owner = newOwner;
            if (newGroup) scripts[node.title].group = newGroup;
            localStorage.setItem('vfs_bin_scripts', JSON.stringify(scripts));
            if (newMode) node.mode = newMode;
            if (newOwner) node.owner = newOwner;
            if (newGroup) node.group = newGroup;
        }
        return;
    }
    
    // 2. VFS /etc/ 目录 (只读)
    if (node.id.startsWith('vfs-etc') || node.id === 'vfs-startrc') {
        term.writeHtml(`<span class="term-error">chmod: ${node.title}: Read-only file system.</span>`);
        return;
    }

    // 3. 真实书签
    let metadataStore = JSON.parse(localStorage.getItem('vfs_metadata') || '{}');
    let currentMeta = metadataStore[node.id] || getMetadata(node); 
    
    if (newMode) currentMeta.mode = newMode;
    if (newOwner) currentMeta.owner = newOwner;
    if (newGroup) currentMeta.group = newGroup;

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
 * 解析符号权限 (e.g., "u+x", "go=rw")
 * @param {string} modeStr - e.g., "o-x"
 * @param {number} currentMode - e.g., 0o755
 * @returns {number|null} - The new mode, or null if invalid
 */
function parseSymbolicMode(modeStr, currentMode) {
    const parts = modeStr.split(','); // e.g., "u+x,g-w"
    let newMode = currentMode;

    for (const part of parts) {
        // Regex: 1=who, 2=op, 3=perms
        const match = part.match(/^([ugoa]*)([+-=])([rwx]*)$/);
        if (!match) return null; // 格式无效

        let [, who, op, perms] = match;

        if (who === '') who = 'a'; // 默认为 "all" (e.g., "+x")

        // 1. 确定要操作的权限位
        let permMask = 0;
        if (perms.includes('r')) permMask |= 0o4;
        if (perms.includes('w')) permMask |= 0o2;
        if (perms.includes('x')) permMask |= 0o1;

        // 2. 确定这些位应用到谁身上 (user, group, other)
        let finalMask = 0;
        if (who.includes('u') || who.includes('a')) finalMask |= (permMask << 6); // 0o400, 0o200, 0o100
        if (who.includes('g') || who.includes('a')) finalMask |= (permMask << 3); // 0o040, 0o020, 0o010
        if (who.includes('o') || who.includes('a')) finalMask |= permMask;         // 0o004, 0o002, 0o001

        // 3. 应用操作
        if (op === '+') {
            newMode |= finalMask; // 添加权限
        } else if (op === '-') {
            newMode &= ~finalMask; // 移除权限
        } else if (op === '=') {
            // 'set' 操作: 必须先清除 'who' 的所有位，再设置新位
            let clearMask = 0;
            if (who.includes('u') || who.includes('a')) clearMask |= 0o700;
            if (who.includes('g') || who.includes('a')) clearMask |= 0o070;
            if (who.includes('o') || who.includes('a')) clearMask |= 0o007;

            newMode &= ~clearMask; // 清除
            newMode |= finalMask; // 设置
        }
    }
    return newMode;
}

/**
 * 检查活动用户是否有权对节点执行操作
 * @param {Object} node - VFS 节点
 * @param {'r'|'w'|'x'} permissionType - 'r', 'w', or 'x'
 * @returns {boolean}
 */
function hasPermission(node, permissionType) {
    const meta = getMetadata(node);
    const activeUser = Environment.USER;

    if (activeUser === 'root') return true; // (未来的 'sudo' 可以利用这个)

    if (meta.owner === activeUser) {
        // --- 我是所有者 ---
        if (permissionType === 'r') return (meta.mode & 0o400); // 检查 U_READ
        if (permissionType === 'w') return (meta.mode & 0o200); // 检查 U_WRITE
        if (permissionType === 'x') return (meta.mode & 0o100); // 检查 U_EXEC
    } 
    // (此处可以添加 group 检查)
    else {
        // --- 我是 "other" ---
        if (permissionType === 'r') return (meta.mode & 0o004); // 检查 O_READ
        if (permissionType === 'w') return (meta.mode & 0o002); // 检查 O_WRITE
        if (permissionType === 'x') return (meta.mode & 0o001); // 检查 O_EXEC
    }
    return false; // 默认拒绝
}

/**
 * 将脚本保存到 localStorage
 */
function saveVfsScript(name, content, mode = 0o755, owner = 'user') { // [!! 修改：添加 owner !!]
    let scripts = JSON.parse(localStorage.getItem('vfs_bin_scripts') || '{}');
    
    const oldData = scripts[name] || {};
    
    scripts[name] = {
        content: content,
        mode: oldData.mode || mode, // 保留旧权限
        owner: oldData.owner || owner, // [!!] 保留旧所有者或设置新所有者
        group: oldData.group || 'user' // (暂不支持 group)
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

function formatHelp(cmd, key) {
    const padding = ' '.repeat(Math.max(0, 12 - cmd.length));
    // 你可以在 CSS 中定义 --color-accent-green，或者使用一个明亮的颜色
    return `  <span style="color: var(--color-accent-green, #4CAF50);">${cmd}</span>${padding}${t(key)}`;
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

        if (!hasPermission(result.node, 'x')) {
             term.writeHtml(`<span class="term-error">startsh: permission denied: ${path}</span>`);
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

        const result = bookmarkSystem._findNodeByPath(path);
        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }

        if (getMetadata(result.node).owner !== Environment.USER) {
            term.writeHtml(`<span class="term-error">chmod: changing permissions of '${path}': Operation not permitted</span>`);
            return;
        }

        // 支持 Octal 和 Symbolic
        let newMode;
        const octalMode = parseInt(modeStr, 8); // 尝试解析八进制

        if (!isNaN(octalMode)) {
            // 1. 它是八进制 (e.g., 755)
            newMode = octalMode;
        } else {
            // 2. 它不是八进制，尝试解析符号 (e.g., "o-x")
            const currentMode = getMetadata(result.node).mode;
            newMode = parseSymbolicMode(modeStr, currentMode);
            
            if (newMode === null) {
                term.writeHtml(`<span class="term-error">chmod: invalid mode: '${modeStr}'</span>`);
                return;
            }
        }

        setMetadata(result.node, newMode, null, null);
     },
     'chown': (args, options) => {
        // (这是一个简化的 chown，只更改 owner)
        if (args.length < 2) {
            term.writeHtml(`<span class="term-error">chown: missing operand</span>`);
            return;
        }
        const newOwner = args[0];
        const path = args[1];

        const result = bookmarkSystem._findNodeByPath(path);
        if (!result || !result.node) {
            term.writeHtml(`<span class="term-error">${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }

        // 权限检查 (只有 root 或 owner 可以 chown)
        if (getMetadata(result.node).owner !== Environment.USER) {
            term.writeHtml(`<span class="term-error">chown: changing ownership of '${path}': Operation not permitted</span>`);
            return;
        }
        setMetadata(result.node, null, newOwner, null);
     },
     'whoami': (args, options) => {
        term.writeLine(Environment.USER);
        },

    'login': async (args, options) => {
        const provider = args[0];
        if (provider !== 'google') {
            term.writeHtml(`<span class="term-error">Usage: login google</span>`);
            return;
        }

        term.writeLine("Logging in with Google...");
        
        // --- ST1.0 loginWithGoogle 逻辑 (已适配 ST2.0) ---
        const token = await new Promise((resolve) => {
            chrome.identity.getAuthToken({ interactive: true }, (token) => {
                if (chrome.runtime.lastError || !token) {
                    term.writeHtml(`<span class="term-error">Google Auth Failed: ${chrome.runtime.lastError?.message || "User cancelled."}</span>`);
                    resolve(null);
                } else {
                    resolve(token);
                }
            });
        });

        if (!token) return; // 登录失败

        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const userInfo = await response.json();
            if (userInfo.error) throw new Error(userInfo.error.message);

            // 1. 获取一个简单的用户名 (例如 "bradley")
            const username = (userInfo.email || userInfo.name).split('@')[0].replace(/[^a-z0-9]/gi, '');
            if (!username) throw new Error("Could not determine username.");

            // 2. 将此用户添加到 "密钥链"
            let keychain = JSON.parse(localStorage.getItem('st2_user_keychain') || '{}');
            keychain[username] = {
                type: 'google',
                token: token,
                email: userInfo.email,
                name: userInfo.name
            };
            localStorage.setItem('st2_user_keychain', JSON.stringify(keychain));

            term.writeLine(`Successfully added user: ${username} (${userInfo.name})`);
            term.writeLine(`To switch to this user, run: su ${username}`);

        } catch (error) {
            term.writeHtml(`<span class="term-error">Failed to get user info: ${error.message}</span>`);
        }
    },

    'su':  async (args, options) => {
        const username = args[0] || 'user'; // 'su' 默认切换回 "user"

        if (username === Environment.USER) {
            term.writeLine(`Already user ${username}.`);
            return;
        }

        // 检查用户是否在密钥链中 (或是否是 "user")
        let keychain = JSON.parse(localStorage.getItem('st2_user_keychain') || '{}');
        if (username !== 'user' && !keychain[username]) {
            term.writeHtml(`<span class="term-error">su: user ${username} does not exist. (Try 'login google')</span>`);
            return;
        }

        // 1. 设置活动用户
        localStorage.setItem('st2_active_user', username);
        
        // 2. 重新加载环境
        term.writeLine(`Switching to user ${username}...`);
        await loadEnvironment(username);
        // (loadEnvironment 已经调用了 update_user_path)
    },

    'tabs': async (args, options) => {
        const subCommand = args[0] || 'ls';

        if (typeof chrome === 'undefined' || !chrome.tabs) {
            term.writeHtml(`<span class="term-error">tabs: 'chrome.tabs' API not available.</span>`);
            return;
        }

        switch (subCommand) {
            case 'ls':
                const allTabs = await new Promise(resolve => chrome.tabs.query({}, resolve));
                if (allTabs.length === 0) {
                    term.writeLine("No open tabs.");
                    return;
                }
                allTabs.forEach(tab => {
                    const activeMark = tab.active ? '*' : ' ';
                    const title = tab.title || "No Title";
                    const url = tab.url || "no-url";
                    // 格式化：[ID] * 标题... (URL...)
                    term.writeLine(`[${tab.id}] ${activeMark} ${title.substring(0, 50)}... (${url.substring(0, 40)}...)`);
                });
                break;

            case 'switch':
            case 'close':
                const tabIdStr = args[1];
                if (!tabIdStr) {
                    term.writeHtml(`<span class="term-error">Usage: tabs ${subCommand} <tabId></span>`);
                    return;
                }
                const tabId = parseInt(tabIdStr);
                if (isNaN(tabId)) {
                    term.writeHtml(`<span class="term-error">Error: Invalid tabId '${tabIdStr}'.</span>`);
                    return;
                }

                try {
                    if (subCommand === 'switch') {
                        // 切换到标签页
                        await new Promise((resolve, reject) => {
                            chrome.tabs.update(tabId, { active: true }, (tab) => {
                                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                // 还需更新标签页所在的窗口
                                if (tab) chrome.windows.update(tab.windowId, { focused: true }, () => resolve(tab));
                                else resolve(tab);
                            });
                        });
                    } else {
                        // 关闭标签页
                        await new Promise((resolve, reject) => {
                            chrome.tabs.remove(tabId, () => {
                                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                                else resolve();
                            });
                        });
                    }
                } catch (e) {
                    term.writeHtml(`<span class="term-error">Error: Tab with id ${tabId} not found or protected.</span>`);
                }
                break;

            default:
                term.writeHtml(`<span class="term-error">Unknown command: 'tabs ${subCommand}'. Try 'tabs ls'.</span>`);
        }
    },

    'whatsnew': async (args, options) => {
        const API_URL = "https://api.tianyibrad.com/api/collections/ST2_0/records?sort=-created&perPage=1"; 
        
        term.writeLine("Fetching latest updates from api.tianyibrad.com...");
        
        try {
            const response = await fetch(API_URL);
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}`);
            }
            
            const data = await response.json(); 

            if (data.items && data.items.length > 0) {
                const latestPost = data.items[0];
                const version = latestPost.version || "N/A";
                const title = latestPost.title || "Latest Update";
                const contentHtml = latestPost.content || "<p>No content found.</p>"; 

                term.writeHtml(`\n<b>What's New in v${term.escapeHtml(version)}: ${term.escapeHtml(title)}</b>`);
                term.writeLine("---");
                
                // 1. 使用 DOMParser (L515) 来解析 HTML
                const doc = new DOMParser().parseFromString(contentHtml, 'text/html');
                
                // 2. 遍历所有段落（或其他元素）并打印其 *text content*
                doc.body.childNodes.forEach(node => {
                    if (node.textContent) {
                        term.writeLine(node.textContent.trim()); // 打印纯文本
                    }
                });
                
            } else {
                term.writeHtml(`<span class="term-error">No update records found.</span>`);
            }
            
        } catch (e) {
            term.writeHtml(`<span class="term-error">Failed to fetch updates: ${e.message}</span>`);
        }
    },

    'welcome': async (args, options) => {
        // --- 1. 系统版本 ---
        term.writeLine(t('welcomeTitle'));
        term.writeLine("");
        
        // --- 2. 链接 (使用 VFS 文件夹样式) ---
        // (你可以用 CSS 在 .term-folder 中定义一个亮色)
        term.writeHtml(`${t('welcomeDoc')} <span class='term-folder'>https://github.com/BradleyBao/StartTerminal2</span>`);
        term.writeHtml(`${t('welcomeMgmt')} <span class='term-folder'>chrome://extensions</span>`);
        term.writeHtml(`${t('welcomeSupport')} <span class='term-folder'>https://www.tianyibrad.com</span>`);
        term.writeLine("");

        // --- 3. 系统信息 (真实 + 模拟) ---
        const lang = Environment.LANG || 'en';
        const now = new Date().toLocaleString(lang, { dateStyle: 'long', timeStyle: 'medium' });
        term.writeLine(`  ${t('welcomeSysInfo')} ${now}`);
        term.writeLine("");

        // --- 4. 获取动态数据 ---
        const tabs = await new Promise(r => chrome.tabs.query({}, r));
        const tabCount = tabs.length;
        const storageSize = JSON.stringify(localStorage).length;
        const storageMB = (storageSize / (1024 * 1024)).toFixed(2);
        const activeUser = Environment.USER || 'user';
        

        // --- 5. 格式化并打印统计数据 ---
        const stat_tabs = `  ${t('welcomeTabCount')}`;
        const val_tabs = `${tabCount}`;
        const stat_user = `${t('welcomeUser')}`;
        const val_user = `${activeUser}`;
        
        const stat_vfs = `  ${t('welcomeVFS')}`;
        const val_vfs = `${storageMB} / 5.00 MB`;

        const col1Width = 18; // 统一第一列的宽度
        const pad_tabs = ' '.repeat(col1Width - stat_tabs.length);
        const pad_vfs = ' '.repeat(col1Width - stat_vfs.length);

        // 打印两列
        term.writeLine(`${stat_tabs}${pad_tabs}${val_tabs}        ${stat_user} ${val_user}`);
        term.writeLine(`${stat_vfs}${pad_vfs}${val_vfs}`);
        term.writeLine("");

        // --- 6. "广告" / 功能高亮 (模拟) ---
        term.writeHtml(t('welcomeNew'));
        term.writeHtml(t('welcomeTry'));
        term.writeLine("");

        // --- 7. 'apt' 状态 (模拟) ---
        term.writeLine(t('welcomeApt'));
        term.writeLine("");

        // --- 8. 上次登录 (来自 L1804 的新 localStorage 条目) ---
        const lastLogin = localStorage.getItem('st2_last_login');
        if (lastLogin) {
            const lastLoginDate = new Date(lastLogin).toLocaleString(lang);
            term.writeLine(`${t('welcomeLastLogin')} ${lastLoginDate}`);
            term.writeLine(""); // 最后的空行
        }
    },

    'logout': (args, options) => {
        const username = args[0];
        if (!username) {
            term.writeHtml(`<span class="term-error">Usage: logout <username></span>`);
            return;
        }

        let keychain = JSON.parse(localStorage.getItem('st2_user_keychain') || '{}');
        const userData = keychain[username];
        if (!userData) {
            term.writeHtml(`<span class="term-error">logout: user ${username} not found in keychain.</span>`);
            return;
        }

        // --- ST1.0 logoutWithGoogle 逻辑 (已适配 ST2.0) ---
        try {
            if (userData.type === 'google' && userData.token) {
                const token = userData.token;
                // 1. 撤销 Google 端的 token
                fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
                // 2. 从 Chrome 缓存中移除
                chrome.identity.removeCachedAuthToken({ token: token });
            }
        } catch (e) {
            console.warn("Error during token revocation:", e);
        }

        // 3. 从我们的密钥链中移除
        delete keychain[username];
        localStorage.setItem('st2_user_keychain', JSON.stringify(keychain));
        term.writeLine(`User ${username} removed from keychain.`);

        // 4. 如果登出的是*活动*用户，则切换回 "user"
        if (Environment.USER === username) {
            term.writeLine("Active user logged out. Switching to default user.");
            localStorage.setItem('st2_active_user', 'user');
            loadEnvironment('user');
        }
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
     'history': async (args, options) => {
        if (typeof chrome === 'undefined' || !chrome.history) {
            term.writeHtml(`<span class="term-error">history: 'chrome.history' API not available.</span>`);
            term.writeHtml(`<span class="term-error">Did you add 'history' to manifest.json?</span>`);
            return;
        }

        const query = args.join(' ');
        const results = await new Promise(resolve => {
            chrome.history.search({ text: query, maxResults: 50 }, resolve);
        });
        results.forEach(item => {
            term.writeLine(`[${new Date(item.lastVisitTime).toLocaleString()}] ${item.title.substring(0, 50)}...`);
        });
    },

    'history': async (args, options) => {
        if (typeof chrome === 'undefined' || !chrome.history) {
            term.writeHtml(`<span class="term-error">'chrome.history' API not available.</span>`);
            term.writeHtml(`<span class="term-error">Try: sudo apt install history</span>`);
            return;
        }

        const query = args.join(' ');
        term.writeLine(`Searching history for: "${query || '...'}"...`);
        
        const results = await new Promise(resolve => {
            chrome.history.search({
                text: query,
                maxResults: 50 // 限制为 50 条
            }, resolve);
        });

        if (results.length === 0) {
            term.writeLine("No history items found.");
            return;
        }

        // 准备一个数组用于管道
        const outputLines = [];
        results.forEach(item => {
            const dt = new Date(item.lastVisitTime).toLocaleString(Environment.LANG || 'en');
            const title = item.title || "No Title";
            const url = item.url || "no-url";
            const line = `[${dt}] ${title.substring(0, 50)}... (${url.substring(0, 40)}...)`;
            term.writeLine(line);
            outputLines.push(line);
        });
        return outputLines; // 返回给管道
    },

    'downloads': async (args, options) => {
        const subCommand = args[0] || 'ls';
        
        if (typeof chrome === 'undefined' || !chrome.downloads) {
            term.writeHtml(`<span class="term-error">'chrome.downloads' API not available.</span>`);
            // 'downloads' 权限是默认安装的，所以我们不需要提示 apt install
            return;
        }

        switch (subCommand) {
            case 'ls':
                const items = await new Promise(resolve => {
                    chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, resolve);
                });
                if (items.length === 0) { term.writeLine("No downloads found."); return; }
                
                const outputLines = [];
                items.forEach(item => {
                    const state = item.state === 'complete' ? ' ' : `[${item.state}]`;
                    const line = `[${item.id}] ${state} ${item.filename.split(/[\\\/]/).pop()}`;
                    term.writeLine(line);
                    outputLines.push(line);
                });
                return outputLines; // 返回给管道
            
            case 'open':
                const id = parseInt(args[1]);
                if (isNaN(id)) { term.writeHtml(`<span class="term-error">Usage: downloads open <id></span>`); return; }
                
                try {
                    await new Promise((resolve, reject) => {
                        chrome.downloads.open(id, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                } catch(e) {
                     term.writeHtml(`<span class="term-error">Error: ${e.message}. (File may not exist)</span>`);
                }
                break;
            
            default:
                 term.writeHtml(`<span class="term-error">Usage: downloads [ls|open]</span>`);
        }
    },

    'wget': async (args, options) => {
        const url = args[0];
        if (!url) { term.writeHtml('<span class="term-error">Usage: wget <url></span>'); return; }
        
        if (typeof chrome === 'undefined' || !chrome.downloads) {
            term.writeHtml(`<span class="term-error">'chrome.downloads' API not available.</span>`);
            // 'downloads' 权限是默认安装的
            return;
        }

        try {
            term.writeLine(`Starting download: ${url}`);
            const downloadId = await new Promise((resolve, reject) => {
                chrome.downloads.download({ url: url }, (id) => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(id);
                });
            });
            term.writeLine(`Download started (ID: ${downloadId}).`);
        } catch(e) {
            term.writeHtml(`<span class="term-error">Download failed: ${e.message}</span>`);
        }
    },
    'curl': async (args, options, pipedInput) => {
        const url = args[0];
        if (!url) {
            term.writeHtml('<span class="term-error">Usage: curl <url></span>');
            return;
        }

        // 权限检查
        const hasPermission = await new Promise(resolve => {
            chrome.permissions.contains({ origins: ["<all_urls>"] }, resolve);
        });

        if (!hasPermission) {
            term.writeHtml(`<span class="term-error">Permission to access all URLs denied.</span>`);
            term.writeHtml(`<span class="term-error">Try: sudo apt install curl</span>`);
            return;
        }

        try {
            term.writeLine(`Fetching ${url}...`);
            const response = await fetch(url, { cache: 'no-store', mode: 'cors' });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const text = await response.text();
            term.writeLine(text); // 打印纯文本响应
            return text.split('\n'); // 返回给管道
            
        } catch(e) {
            term.writeHtml(`<span class="term-error">${e.message}</span>`);
        }
    },

    'tree': async (args, options) => {
        if (typeof chrome === 'undefined' || !chrome.bookmarks) {
            term.writeHtml(`<span class="term-error">'chrome.bookmarks' API not available.</span>`);
            return;
        }
        
        // 'tree' 只显示真实的书签，不显示 VFS
        const tree = await new Promise(resolve => chrome.bookmarks.getTree(resolve));
        const root = tree[0];
        
        term.writeLine("."); // 根
        
        // 递归辅助函数
        function printNode(node, indent) {
            if (!node || !node.children) return;
            
            node.children.forEach((child, i) => {
                const isLast = i === node.children.length - 1;
                const prefix = indent + (isLast ? "└── " : "├── ");
                
                if (child.children) {
                    // 目录
                    term.writeHtml(`${prefix}<span class="term-folder">${term.escapeHtml(child.title)}/</span>`);
                    printNode(child, indent + (isLast ? "    " : "│   "));
                } else {
                    // 文件
                    term.writeLine(`${prefix}${term.escapeHtml(child.title)}`);
                }
            });
        }
        
        printNode(root, ""); // 从根开始
    },

    'downloads': async (args, options) => {
        const subCommand = args[0] || 'ls';
        
        if (typeof chrome === 'undefined' || !chrome.downloads) {
            term.writeHtml(`<span class="term-error">downloads: 'chrome.downloads' API not available.</span>`);
            return;
        }

        switch (subCommand) {
            case 'ls':
                const items = await new Promise(resolve => {
                    chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, resolve);
                });
                if (items.length === 0) { term.writeLine("No downloads found."); return; }
                
                items.forEach(item => {
                    const state = item.state === 'complete' ? ' ' : `[${item.state}]`;
                    term.writeLine(`[${item.id}] ${state} ${item.filename.split(/[\\\/]/).pop()}`);
                });
                break;

            case 'open':
                const id = parseInt(args[1]);
                if (isNaN(id)) { term.writeHtml(`<span class="term-error">Usage: downloads open <id></span>`); return; }
                
                try {
                    await new Promise((resolve, reject) => {
                        chrome.downloads.open(id, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                } catch(e) {
                     term.writeHtml(`<span class="term-error">Error: ${e.message}. (File may not exist)</span>`);
                }
                break;
            
            // 还可以添加 'rm' (chrome.downloads.removeFile), 'pause', 'resume' 等
            default:
                 term.writeHtml(`<span class="term-error">Usage: downloads [ls|open]</span>`);
        }
    },
     'help': (args, options) => {
        term.writeLine(t('helpTitle'));
        term.writeLine("---");
        
        term.writeHtml(`<b>${t('helpFS')}</b>`);
        term.writeHtml(formatHelp('ls', 'help_ls'));
        term.writeHtml(formatHelp('cd', 'help_cd'));
        term.writeHtml(formatHelp('cat', 'help_cat'));
        term.writeHtml(formatHelp('nano', 'help_nano'));
        term.writeHtml(formatHelp('mkdir', 'help_mkdir'));
        term.writeHtml(formatHelp('rm', 'help_rm'));
        term.writeHtml(formatHelp('sh, ./', 'help_sh'));
        term.writeHtml(formatHelp('chmod', 'help_chmod'));
        term.writeHtml(formatHelp('chown', 'help_chown'));
        
        term.writeHtml(`\n<b>${t('helpEnv')}</b>`);
        term.writeHtml(formatHelp('login', 'help_login'));
        term.writeHtml(formatHelp('logout', 'help_logout'));
        term.writeHtml(formatHelp('su', 'help_su'));
        term.writeHtml(formatHelp('whoami', 'help_whoami'));
        term.writeHtml(formatHelp('export', 'help_export'));
        term.writeHtml(formatHelp('alias', 'help_alias'));
        term.writeHtml(formatHelp('unalias', 'help_unalias'));
        term.writeHtml(formatHelp('source, .', 'help_source'));
        
        term.writeHtml(`\n<b>${t('helpUtil')}</b>`);
        term.writeHtml(formatHelp('apt', 'help_apt'));
        term.writeHtml(formatHelp('open', 'help_open'));
        term.writeHtml(formatHelp('search', 'help_search'));
        term.writeHtml(formatHelp('style', 'help_style'));
        term.writeHtml(formatHelp('date', 'help_date'));
        term.writeHtml(formatHelp('cal', 'help_cal'));
        term.writeHtml(formatHelp('uptime', 'help_uptime'));
        term.writeHtml(formatHelp('clear', 'help_clear'));
        term.writeHtml(formatHelp('whatsnew', 'help_whatsnew'));
        term.writeHtml(formatHelp('help', 'help_help'));
        
        term.writeLine("\n" + t('helpMore'));
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
                if (!value) { 
                    // 如果用户只输入 "style font"，则显示帮助
                    term.writeLine("Usage: style font \"<font-name>\"");
                    term.writeLine("\nRecommended monospace fonts (must be installed on your system):");
                    // (使用与 'help' (L1538) 命令相同的颜色 (L1453))
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'Fira Code'</span> (Default, supports ligatures)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'SF Mono'</span> (macOS, user favorite)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'Menlo'</span> (macOS)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'Consolas'</span> (Windows)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'JetBrains Mono'</span> (Popular, free)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>'Courier New'</span> (Universal fallback)");
                    term.writeHtml("  - <span style='color: var(--color-accent-green, #4CAF50);'>monospace</span> (Generic)");
                    term.writeLine("\nExample: style font \"Fira Code\"");
                    return; // 退出，不执行后续代码
                }

                if (value.length < 3) { term.writeHtml(`<span class="term-error">${t('styleInvalidSize')} "${value}"</span>`); return; }
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

            let isReadOnly = false;

            const result = bookmarkSystem._findNodeByPath(path);

            if (result && result.node) {
                node = result.node;
                resolvedPath = "/" + result.newPathArray.slice(1).map(p => p.title).join("/");

                if (!hasPermission(node, 'w')) {
                    isReadOnly = true;
                }

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
            } else {
                // 这是一个新文件，检查父目录的 'w' 权限
                const parentPath = resolvedPath.substring(0, resolvedPath.lastIndexOf('/')) || '/';
                const parentResult = bookmarkSystem._findNodeByPath(parentPath);
                if (!parentResult || !parentResult.node || !hasPermission(parentResult.node, 'w')) {
                    isReadOnly = true;
                }
            }
            // (如果是新文件, 'content' 保持为 "")

            const onSave = async (savedPath, savedContent) => {
                try {
                    // (权限检查保持不变)
                    if (node) { 
                        if (!hasPermission(node, 'w')) {
                            term.writeHtml(`<span class="term-error">Error: Permission denied.</span>`); 
                            return false; // [!!] 1. 返回 false
                        }
                    } else {
                        const parentPath = savedPath.substring(0, savedPath.lastIndexOf('/')) || '/';
                        const parentResult = bookmarkSystem._findNodeByPath(parentPath);
                        if (!parentResult || !parentResult.node || !hasPermission(parentResult.node, 'w')) {
                            term.writeHtml(`<span class="term-error">Error: Parent directory not writable.</span>`); 
                            return false; // [!!] 2. 返回 false
                        }
                    }

                    // 保存 VFS
                    if (resolvedPath === '/etc/.startrc') {
                        localStorage.setItem('.startrc', savedContent);
                        // parseStartrc(savedContent);
                        // bookmarkSystem.update_user_path();
                        const startrcNode = bookmarkSystem._findNodeByPath('/etc/.startrc').node;
                        if (startrcNode) {
                            startrcNode.url = `data:text/plain;base64,${btoa(encodeURIComponent(savedContent))}`;
                        }

                    
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
                            saveVfsScript(scriptName, savedContent, 0o755, Environment.USER);
                            // 更新 VFS (内存中)
                            const newNode = {
                                id: `vfs-bin-${scriptName}`,
                                title: scriptName,
                                url: `data:text/plain;base64,${btoa(encodeURIComponent(savedContent))}`,
                                mode: 0o755, // 默认权限
                                owner: Environment.USER, // 设置 owner
                                group: Environment.USER,
                                children: null,
                                parentId: 'vfs-bin'
                            };
                            bookmarkSystem.vfsBin.children.push(newNode);
                            term.writeLine(`Saved to VFS: ${savedPath}`);
                        } else {
                            term.writeHtml(`<span class="term-error">nano: Invalid path.</span>`);
                            return false; // [!!] 3. 返回 false
                        }
                    } else if (!node) {
                        // --- C. 创建新文件 ---
                        
                        // Case C1: VFS /bin/ 脚本
                        if (savedPath.startsWith('/bin/')) {
                            const scriptName = savedPath.substring(5);
                            if (scriptName && !scriptName.includes('/')) {
                                saveVfsScript(scriptName, savedContent, 0o755, Environment.USER);
                                const newNode = {
                                    id: `vfs-bin-${scriptName}`,
                                    title: scriptName,
                                    url: `data:text/plain;base64,${btoa(encodeURIComponent(savedContent))}`,
                                    mode: 0o755, owner: Environment.USER, group: Environment.USER,
                                    children: null, parentId: 'vfs-bin'
                                };
                                bookmarkSystem.vfsBin.children.push(newNode);
                                term.writeLine(`Saved to VFS: ${savedPath}`);
                            } else {
                                term.writeHtml(`<span class="term-error">nano: Invalid path.</span>`);
                                return false;
                            }
                        } 
                        // 普通书签文件
                        else {
                            // 1. 找到父目录
                            const parentPath = savedPath.substring(0, savedPath.lastIndexOf('/')) || '/';
                            const parentResult = bookmarkSystem._findNodeByPath(parentPath);
                            
                            if (parentResult && parentResult.node && parentResult.node.children) {
                                // 2. 获取文件名
                                const newFileName = savedPath.split('/').pop();
                                // 3. 检查父目录写权限
                                if (!hasPermission(parentResult.node, 'w')) {
                                     term.writeHtml(`<span class="term-error">nano: Parent directory not writable.</span>`);
                                     return false;
                                }
                                // 4. 创建书签
                                await new Promise(resolve => {
                                    chrome.bookmarks.create({
                                        parentId: parentResult.node.id,
                                        title: newFileName,
                                        url: savedContent // 内容作为 URL 保存
                                    }, resolve);
                                });
                            } else {
                                term.writeHtml(`<span class="term-error">nano: Directory not found: ${parentPath}</span>`);
                                return false;
                            }
                        }
                    }
                    return true;
                } catch (e) {
                    console.error("Nano save error:", e);
                    return false; // [!!] 5. 返回 false
                }
            };

            const onExit = () => {
                resolve();
            };

            const editor = new NanoEditor(term, resolvedPath, content, onSave, onExit, isReadOnly);
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

    'source': async (args, options) => {
        if (!args[0]) {
            term.writeHtml(`<span class="term-error">source: filename argument required</span>`);
            return;
        }
        const path = args[0];
        
        // 1. 使用类似 'cat' 的逻辑读取文件
        const result = bookmarkSystem._findNodeByPath(path);
        if (!result || !result.node || result.node.children) {
            term.writeHtml(`<span class="term-error">source: ${t('noSuchFileOrDir')}: ${path}</span>`);
            return;
        }

        const url = result.node.url;
        let fileContent = "";
        if (result.node.id.startsWith('vfs-')) {
            try {
                const base64Content = (url || '').split(',')[1] || '';
                fileContent = decodeURIComponent(atob(base64Content));
            } catch (e) {
                term.writeHtml(`<span class="term-error">source: error reading file: ${e.message}</span>`);
                return;
            }
        } else {
            term.writeHtml(`<span class="term-error">source: cannot execute bookmark: ${path}</span>`);
            return;
        }
        
        // 2. [!!] 解析内容 [!!]
        await parseStartrc(fileContent);

        // 3. [!!] 刷新提示符 [!!]
        bookmarkSystem.update_user_path();
    },

    '.': (args, options) => {
        // 'source' 的别名
        return globalCommands.source(args, options);
    },

    'search': (args, options) => {
        if (args.length === 0) {
            term.writeHtml(`<span class="term-error">Usage: search [-n] <query...></span>`);
            return;
        }
        const queryText = args.join(' ');

        if (typeof chrome !== 'undefined' && chrome.search) {
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

    'env': (args, options) => {
        // 打印所有环境变量
        for (const key in Environment) {
            // 匹配 'export' (L1694) 命令的输出格式
            term.writeLine(`${key}="${Environment[key]}"`);
        }
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
     'alias': (args, options) => {
        if (args.length === 0) {
            // 0. 没有参数：打印所有别名
            for (const key in AliasEnvironment) {
                term.writeLine(`alias ${key}='${AliasEnvironment[key]}'`);
            }
            return;
        }

        const assignment = args.join(' '); // e.g., "ll='ls -l'"
        const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]?(.*?)['"]?\s*$/);

        if (match) {
            // 1. 设置别名：alias ll='ls -l'
            const key = match[1];
            let value = match[2];
            // 清理可能残留的引号
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length - 1);
            }
            AliasEnvironment[key] = value;
            console.log(`[Alias] Set (runtime) ${key} = "${value}"`);
        } else if (AliasEnvironment[args[0]]) {
            // 2. 打印单个别名：alias ll
            term.writeLine(`alias ${args[0]}='${AliasEnvironment[args[0]]}'`);
        } else {
            term.writeHtml(`<span class="term-error">alias: ${args[0]}: not found</span>`);
        }
    },

    'unalias': (args, options) => {
        if (args.length === 0) {
            term.writeHtml(`<span class="term-error">unalias: usage: unalias [-a] name [...]</span>`);
            return;
        }

        for (const key of args) {
            if (AliasEnvironment[key]) {
                delete AliasEnvironment[key];
                console.log(`[Alias] Unset (runtime) ${key}`);
            } else {
                term.writeHtml(`<span class="term-error">unalias: ${key}: not found</span>`);
            }
        }
    },
     // --- sudo 命令 ---
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
                    term.writeLine(`Hit:1 ${REPO_URL}index.json`);
                    
                    const response = await fetch(REPO_URL + "index.json");
                    if (!response.ok) {
                        throw new Error(`Failed to fetch index: ${response.statusText}`);
                    }
                    const index = await response.json();
                    localStorage.setItem('apt_repo_index', JSON.stringify(index));

                    // --- 模拟 Ubuntu 输出 ---
                    const installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                    
                    const allPkgsCount = Object.keys(index).length;
                    const installedCount = Object.keys(installed).length;

                    term.writeLine(`Fetched ${allPkgsCount} packages in 1s (mock data)`);
                    term.writeLine("Reading package lists... Done");
                    term.writeLine("Building dependency tree... Done");
                    term.writeLine("Reading state information... Done");

                    const upgradableCount = 0; // (我们尚未实现版本控制)

                    if (upgradableCount > 0) {
                        term.writeLine(`${upgradableCount} packages can be upgraded. Run 'apt list --upgradable' to see them.`);
                    } else {
                        term.writeLine("All packages are up to date.");
                    }
                    
                    // 总是显示仓库状态，并引导用户
                    term.writeLine(`\nFound ${allPkgsCount} available packages. ${installedCount} are installed.`);
                    term.writeLine("Run 'apt list' to see all available packages.");
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

                    // [!! 1. 组合所有需要的权限 !!]
                    const reqPermissions = pkg.permissions || [];
                    const reqHostPermissions = pkg.host_permissions || [];
                    const allPermissions = {
                        permissions: reqPermissions,
                        origins: reqHostPermissions // host_permissions 在 API 中被称为 'origins'
                    };

                    term.writeLine(`Package '${pkgName}' will be installed.`);
                    term.writeLine(pkg.desc);
                    
                    // [!! 2. 检查并询问 !!]
                    let needsPerms = false;
                    if (reqPermissions.length > 0) {
                        term.writeLine(`[!] This package requires new API permissions: ${reqPermissions.join(', ')}`);
                        needsPerms = true;
                    }
                    if (reqHostPermissions.length > 0) {
                        term.writeLine(`[!] This package needs to access new hosts: ${reqHostPermissions.join(', ')}`);
                        needsPerms = true;
                    }

                    if (needsPerms) {
                        const answer = await term.readInput("Do you want to continue? [Y/n]");
                        if (answer !== 'y' && answer !== '') {
                            term.writeLine("Install aborted.");
                            return;
                        }
                        
                        // [!! 3. 请求权限 !!]
                        const granted = await new Promise((resolve) => {
                            chrome.permissions.request(allPermissions, resolve);
                        });
                        if (!granted) {
                            term.writeLine("Permissions not granted. Install failed.");
                            return;
                        }
                    }
                    
                    // [!! 4. 安装 (如果 file 存在) !!]
                    if (pkg.file) {
                        term.writeLine(`Fetching ${pkgName} from ${pkg.file}...`);
                        const codeResponse = await fetch(REPO_URL + pkg.file);
                        if (!codeResponse.ok) {
                            throw new Error(`Failed to fetch package code: ${codeResponse.statusText}`);
                        }
                        const codeString = await codeResponse.text();
                        
                        let installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        installed[pkgName] = { code: codeString };
                        localStorage.setItem('installed_packages', JSON.stringify(installed));
                    } else {
                        // 这是一个“虚拟”包 (如 history, tree, wget)，只用于授权
                        term.writeLine(`Permissions for built-in command ${pkgName} are now active.`);
                    }
                    
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
        let token = tokens[i]; //

        // 让 'executeLine' 来处理引号和扩展
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
            args.push(token); // (例如 "Hello $USER")
            continue;
        }

        // 处理选项
        if (token.startsWith('--')) { //
            const optName = token.substring(2);
            if (optName) { options[optName] = true; } //
        } else if (token.startsWith('-')) { //
            const optString = token.substring(1);
            if (optString.length > 0) {
                for (const char of optString) { options[char] = true; } //
            }
        } else {
            args.push(token); 
        }
    }
    return { command: commandName, args: args, options: options };
}

/**
 * Tab 补全：获取所有可执行命令的列表
 */
function getAllCommandNames() {
    const builtins = Object.keys(globalCommands); //
    const fsCmds = Object.keys(bookmarkSystem.commands); //
    const vfsScripts = bookmarkSystem.vfsBin.children.map(node => node.title.trim()); //
    const aptPkgs = Object.keys(JSON.parse(localStorage.getItem('installed_packages') || '{}')); //
    
    // 使用 Set 确保唯一性
    const allNames = new Set([...builtins, ...fsCmds, ...vfsScripts, ...aptPkgs]);
    return Array.from(allNames);
}

/**
 * Tab 补全：子命令的定义
 */
const subCommandCompletions = {
    'downloads': ['ls', 'open'],
    'tabs': ['ls', 'switch', 'close'],
    'apt': ['update', 'list', 'install', 'remove'],
    'style': ['font', 'size', 'reset'],
    'mv': [], // 标记为 'path'
    'cp': [], // 标记为 'path'
    'cd': [], // 标记为 'path'
    'ls': [], // 标记为 'path'
    'cat': [], // 标记为 'path'
    'nano': [], // 标记为 'path'
    'rm': [], // 标记为 'path'
    'mkdir': [], // 标记为 'path'
    'sh': [], // 标记为 'path'
};

function awaiting() {
    if (executeNestLevel === 0) {
        term.disableInput();
    }
    executeNestLevel++;
}

function done() {
    executeNestLevel--;
    if (executeNestLevel === 0) {
        
        bookmarkSystem.update_user_path();
        term.enableInput();
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

            let { command, args, options } = parsed;

            // 变量替换
            const varRegex = /\$([A-Za-z_][A-Za-z0-9_]*)/g; // 查找 $VAR
            const varRegexBrace = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g; // 查找 ${VAR}

            const expandVars = (str) => {
                let expanded = str.replace(varRegex, (match, varName) => {
                    return Environment[varName] || ""; //
                });
                expanded = expanded.replace(varRegexBrace, (match, varName) => {
                    return Environment[varName] || ""; //
                });
                return expanded;
            };

            // 处理 args 数组：扩展变量并剥离引号
            args = args.map(arg => {
                let trailingChars = ''; // e.g., '/'

                // 1. 剥离引号
                if (arg.startsWith('"') && arg.endsWith('"')) {
                    // --- Case 1: 完美的双引号 "file" ---
                    arg = arg.slice(1, -1);
                    return expandVars(arg); // 扩展 + 剥离
                
                } else if (arg.startsWith("'") && arg.endsWith("'")) {
                    // --- Case 2: 完美的单引号 'file' ---
                    return arg.slice(1, -1); // 只剥离
                
                } else if (arg.startsWith('"')) {
                    // --- Case 3: "脏"的双引号, e.g., "file"/ ---
                    const lastQuote = arg.lastIndexOf('"');
                    if (lastQuote > 0) {
                        trailingChars = arg.substring(lastQuote + 1); // e.g., "/"
                        arg = arg.substring(1, lastQuote); // e.g., "file"
                        return expandVars(arg) + trailingChars; // 扩展 + 剥离 + 重新附加
                    }
                } else if (arg.startsWith("'")) {
                    // --- Case 4: "脏"的单引号, e.g., 'file'/ ---
                    const lastQuote = arg.lastIndexOf("'");
                    if (lastQuote > 0) {
                        trailingChars = arg.substring(lastQuote + 1); // e.g., "/"
                        arg = arg.substring(1, lastQuote); // e.g., "file"
                        return arg + trailingChars; // 不扩展 + 剥离 + 重新附加
                    }
                }
                
                // --- Case 5: 未加引号的参数 (e.g., $LANG or file)
                return expandVars(arg);
            });

            command = expandVars(command);

            // Check alias
            if (AliasEnvironment[command]) {
                const aliasContent = AliasEnvironment[command];
                
                // 将别名内容 (e.g., 'ls -l') 和
                // 用户输入的多余参数 (e.g., '/bin') 重新组合
                const reCombinedArgs = args.map(a => a.includes(' ') ? `"${a}"` : a).join(' '); // 确保带空格的参数被引用
                const aliasParsed = parseSingleCommand(aliasContent + " " + reCombinedArgs);

                // 替换原始命令
                command = aliasParsed.command;
                args = aliasParsed.args;
                options = { ...aliasParsed.options, ...options }; // 合并选项
            }
            
            let commandFunc = null;

            if (command.startsWith('./') || command.startsWith('/') || command.startsWith('~/')) {
                const result = bookmarkSystem._findNodeByPath(command);
                if (!result || !result.node) {
                    term.writeHtml(`<span class="term-error">startsh: ${t('noSuchFileOrDir')}: ${command}</span>`);
                    isPiping = false; break;
                }
                
                const meta = getMetadata(result.node);
                // 检查用户执行权限 (0o100 = --x------)
                if (hasPermission(result.node, 'x')) {
                    commandFunc = globalCommands.sh;
                    args.unshift(command);
                } else {
                    term.writeHtml(`<span class="term-error">startsh: permission denied: ${command}</span>`);
                    isPiping = false; break;
                }
            }
            else if (bookmarkSystem.commands[command]) {
                commandFunc = bookmarkSystem.commands[command];
            } else if (globalCommands[command]) {
                commandFunc = globalCommands[command];
            } else {
                // 如果在内置命令中找不到，检查 /bin/ VFS
                const vfsPath = '/bin/' + command;
                const result = bookmarkSystem._findNodeByPath(vfsPath);
                
                if (result && result.node && !result.node.children) {
                    // 找到了一个 /bin/ 中的 VFS 脚本
                    const meta = getMetadata(result.node);
                    if (hasPermission(result.node, 'x')) {
                        commandFunc = globalCommands.sh;
                        // 将其作为 sh /bin/welcome arg1 arg2 ... 执行
                        args.unshift(vfsPath); 
                    } else {
                        term.writeHtml(`<span class="term-error">startsh: permission denied: ${vfsPath}</span>`);
                        isPiping = false; 
                        break;
                    }
                }
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

    term.writeLine("ST 2.0 Booting..."); // 1.

    // 2. [!!] 初始化终端 (清空缓冲区) [!!]
    // 必须在任何 .startrc 打印之前运行
    await term.initialize();

    // 3. [!!] 初始化文件系统 (现在不运行 .startrc) [!!]
    await bookmarkSystem.initialize();

    // 4. [!!] 加载用户环境 (这将运行 .startrc 并打印 'welcome' 命令) [!!]
    const activeUser = localStorage.getItem('st2_active_user') || 'user';
    await loadEnvironment(activeUser); // 'welcome' 在这里被打印

    // 5. 设置处理器
    term.onCommand = executeLine;
    term.onTab = handleTabCompletion;

    // 6. 打印静态欢迎信息
    // term.writeLine(t('welcome'));
    // term.writeLine(t('features'));
    localStorage.setItem('st2_last_login', new Date().toISOString());

    // 7. [!!] 启用输入 [!!]
    // 我们不需要 update_user_path()，因为 loadEnvironment() (L77) 已经调用了它。
    term.enableInput(); 
}

// --- 修改：使用 load 事件 ---
window.addEventListener('load', main);

// main();

