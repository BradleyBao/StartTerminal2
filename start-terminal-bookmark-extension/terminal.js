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
    "COMPLETION_STYLE": "bash",
    // More will load by .startrc
}


/**
 * [工具函数] 预加载并平滑切换壁纸
 * @param {string} url - 图片 URL，如果为 'none' 则移除
 */
function setWallpaper(url) {
    const root = document.documentElement;
    const wallpaperEl = document.getElementById('terminal-wallpaper');

    // 情况 1: 清除壁纸
    if (!url || url === 'none') {
        // 先淡出
        root.style.setProperty('--bg-load-opacity', '0');

        // 等待动画结束后真正移除图片 (与 CSS transition 时间匹配)
        setTimeout(() => {
            root.style.setProperty('--terminal-background-image', 'none');
            if (wallpaperEl) wallpaperEl.removeAttribute('src');
        }, 700);
        return;
    }

    // 情况 2: 设置新壁纸
    // 1. 先把透明度设为 0 (如果当前有壁纸，会先淡出；如果没有，则保持隐藏)
    //    注意：如果你希望新旧壁纸直接交叉淡入淡出，逻辑会更复杂，
    //    这里的逻辑是：旧图淡出/变黑 -> 新图加载 -> 新图淡入。
    root.style.setProperty('--bg-load-opacity', '0');

    // 2. JS 预加载图片
    const preloadImg = new Image();
    preloadImg.src = url;

    preloadImg.onload = () => {
        // 图片加载完毕！

        // A. 切换 CSS 变量中的图片 URL（供 style/loadStyleSettings 持久化读取）
        root.style.setProperty('--terminal-background-image', `url('${url}')`);

        // A2. 用真实的 <img> 元素渲染壁纸（object-fit: cover 避免了 background-size: cover 的模糊问题）
        if (wallpaperEl) wallpaperEl.src = url;

        // B. 强制浏览器重绘 (可选，防止 CSS 变量更新延迟)
        // void root.offsetWidth;

        // C. 开始淡入 (将透明度设为 1)
        // 使用 requestAnimationFrame 确保 CSS 更新已被应用，从而触发 transition
        requestAnimationFrame(() => {
            root.style.setProperty('--bg-load-opacity', '1');
        });
    };

    preloadImg.onerror = () => {
        term.writeError(`Failed to load wallpaper: ${url}`);
        // 加载失败，保持 0 或恢复旧的? 这里我们保持黑屏或保持原样
    };
}


/**
 * [全局工具] 将颜色转换为 RGBA 格式
 * @param {string} color - Hex (#fff, #ffffff), rgb(), or rgba()
 * @param {number} alpha - 透明度 (0.0 - 1.0)
 * @returns {string} rgba(...) 字符串
 */
function toRgba(color, alpha) {
    // 1. 处理 Hex (#FFF 或 #FFFFFF)
    if (color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join(''); // FFF -> FFFFFF
        }
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    // 2. 处理 rgb(r, g, b)
    if (color.startsWith('rgb(')) {
        const parts = color.match(/\d+/g);
        if (parts && parts.length >= 3) {
            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
        }
    }
    
    // 3. 处理 rgba(r, g, b, a) -> 替换 a
    if (color.startsWith('rgba(')) {
        const parts = color.match(/[\d.]+/g);
        if (parts && parts.length >= 3) {
            return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
        }
    }
    
    return color; // 如果无法解析，返回原值
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

// 判断字符串中是否包含"宽字符"（与 getVisualLength 使用同一套 Unicode 范围）
const WIDE_CHAR_REGEX = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/;

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

function escapePath(str) {
    // 只转义空格，因为这是 parseSingleCommand (L1740) 所关心的
    return str.replace(/([ \\|;"'<>])/g, '\\$1');
}

function unescapePath(str) {
    return str.replace(/\\(.)/g, '$1');
}

/**
 * [辅助函数] 检测字体是否可用
 * 原理：比较目标字体与回退字体(monospace)的渲染宽度
 */
function isFontAvailable(fontName) {
    // 1. 处理通用字体族名，直接放行
    const generics = ['monospace', 'sans-serif', 'serif', 'cursive', 'fantasy', 'system-ui'];
    if (generics.includes(fontName.toLowerCase().trim())) return true;

    // 2. 创建画布上下文
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    
    // 使用足够长的字符串和足够大的字号以放大差异
    const text = "abcdefghijklmnopqrstuvwxyz0123456789-=[];',./!@#$%^&*()_+{}|:<>?";
    const fontSize = "72px";
    
    // 3. 测量基准字体 (monospace) 的宽度
    context.font = `${fontSize} monospace`;
    const baselineWidth = context.measureText(text).width;
    
    // 4. 测量 目标字体 + 回退字体 的宽度
    // 注意：如果 fontName 包含空格但没加引号，这里最好补上引号
    const cleanName = fontName.replace(/['"]/g, ''); // 去掉可能存在的引号
    context.font = `${fontSize} "${cleanName}", monospace`;
    const targetWidth = context.measureText(text).width;

    // 5. 如果宽度不同，说明目标字体生效了；如果完全相同，说明回退到了 monospace
    return baselineWidth !== targetWidth;
}

/**
 * [工具] 写入文件 (处理重定向)
 */
async function writeFile(path, contentLines, append = false) {
    if (path === '/dev/null') return; // 黑洞

    const content = contentLines.join('\n');
    
    // 1. 查找文件节点
    const result = bookmarkSystem._findNodeByPath(path);
    let node = result ? result.node : null;

    // 2. 如果文件不存在，创建它
    if (!node) {
        // 解析路径 (类似 touch)
        const parentPath = path.substring(0, path.lastIndexOf('/')) || (path.includes('/') ? '/' : '.');
        const fileName = path.split('/').pop();
        
        const parentResult = bookmarkSystem._findNodeByPath(parentPath);
        if (!parentResult || !parentResult.node) throw new Error(`Directory not found: ${parentPath}`);
        
        // 创建逻辑 (区分 VFS /bin 和普通书签)
        if (parentResult.node.id === 'vfs-bin') {
             // VFS script
             saveVfsScript(fileName, content, 0o644, Environment.USER);
             await bookmarkSystem._refreshBookmarks(); // 刷新
             return;
        } else {
             // 书签
             await new Promise(r => chrome.bookmarks.create({
                 parentId: parentResult.node.id,
                 title: fileName,
                 url: 'data:text/plain,' + encodeURIComponent(content)
             }, r));
             return;
        }
    }

    // 3. 文件存在，执行覆盖或追加
    let newContent = content;
    if (append) {
        // 读取旧内容
        let oldContent = "";
        if (node.id.startsWith('vfs-')) {
             const b64 = (node.url||'').split(',')[1]||'';
             oldContent = decodeURIComponent(atob(b64));
        } else {
             oldContent = decodeURIComponent(node.url.replace('data:text/plain,', ''));
        }
        newContent = oldContent + '\n' + content;
    }

    // 保存
    if (node.id.startsWith('vfs-bin-')) {
        saveVfsScript(node.title, newContent);
    } else if (node.id === 'vfs-startrc') {
        localStorage.setItem('.startrc', newContent);
    } else {
        chrome.bookmarks.update(node.id, { url: 'data:text/plain,' + encodeURIComponent(newContent) });
    }
}

/**
 * [工具] 读取文件 (用于 < 输入重定向)
 */
function readFileContent(path) {
    const result = bookmarkSystem._findNodeByPath(path);
    if (!result || !result.node) throw new Error(`No such file: ${path}`);
    
    const node = result.node;
    if (node.children) throw new Error(`Is a directory: ${path}`);

    if (node.id.startsWith('vfs-')) {
        const b64 = (node.url||'').split(',')[1]||'';
        return decodeURIComponent(atob(b64));
    } else {
        // 假设是 data:text/plain
        const raw = node.url || "";
        if (raw.startsWith('data:text/plain')) {
             return decodeURIComponent(raw.substring(raw.indexOf(',') + 1));
        }
        return raw; // 普通 URL
    }
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

        // 静默模式开关
        this.isSilent = false;

        try {
            const savedHistory = localStorage.getItem('st2_cmd_history');
            this.history = savedHistory ? JSON.parse(savedHistory) : [];
        } catch (e) {
            console.warn("Failed to load history:", e);
            this.history = [];
        }
        this.historyIndex = this.history.length; // 确保索引指向最新的空行
        this.tempLine = "";

        // Zsh 风格菜单状态
        this.tabMenu = {
            active: false,    // 是否处于菜单选择模式
            items: [],        // 候选项列表
            selected: -1,     // 当前选中的索引 (-1 表示未选中)
            originalLine: "", // 进入菜单前的原始命令行内容
            originalPos: 0,   // 进入菜单前的光标位置
            renderedLines: 0  // 菜单占用了多少行 (用于清除)
        };

        // 沙盒支持
        this.sandboxFrame = null;
        this.sandboxResolve = null;
        this._createSandbox();

        // 3. 初始化
        this._calculateDimensions();
        this._initBuffer();
        this._attachListeners();
        this.focus();

        // I/O 重定向状态
        this.ioState = {
            stdout: null, // null = 屏幕, { type: 'overwrite'|'append', path: '...' } = 文件
            stderr: null,
            buffer: { stdout: [], stderr: [] }
        };
    }

    /**
     * 重置重定向状态 (每次命令前调用)
     */
    resetIO() {
        this.ioState = { stdout: null, stderr: null, buffer: { stdout: [], stderr: [] } };
    }

    /**
     * 设置重定向
     * @param {number} fd - 1 (stdout) or 2 (stderr)
     * @param {string} type - '>' (overwrite) or '>>' (append)
     * @param {string} path - 目标文件路径
     */
    setRedirect(fd, type, path) {
        if (fd === 1) this.ioState.stdout = { type, path };
        if (fd === 2) this.ioState.stderr = { type, path };
    }

    clearLastLines(count) {
        if (count <= 0) return;
        // 从 buffer 末尾移除 count 行
        this.buffer.splice(this.buffer.length - count, count);
        // 修正光标 Y
        this.cursorY = Math.max(0, this.cursorY - count);
        this._render();
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
                case 'write':
                    this.writeLine(payload); // Temp using writeLine
                    break;
                case 'writeHtml':
                    this.writeHtml(payload);
                    break;
                case 'writeError':
                    this.writeError(payload);
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
    executeInSandbox(scriptString, args, options, pipeInput) {
        return new Promise((resolve) => {
            this.sandboxResolve = resolve;
            // 向 sandbox.js 发送消息
            this.sandboxFrame.contentWindow.postMessage({
                scriptString,
                args,
                options,
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
        this.maxLines = 2000;
    }

    /**
     * 绑定所有事件监听器
     */
    _attachListeners() {
        // 捕获所有键盘输入
        // this.inputHandler.addEventListener('keydown', (e) => this._handleKeydown(e));
        window.addEventListener('keydown', (e) => this._masterKeydownHandler(e));
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

        this.container.addEventListener('mousedown', () => {
            this.focus();
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
        // 获取当前选区
        const selection = window.getSelection();
        
        // 定义修饰键（单独按下这些键不应取消划词）
        const isModifier = ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key);

        // 如果屏幕上有选中文本 (isCollapsed 为 false 表示有选区)
        // 并且用户按下的不是修饰键
        if (!selection.isCollapsed && !isModifier) {
            
            // 特殊例外：如果是复制操作 (Ctrl+C, Cmd+C, Ctrl+Insert)，不要取消选中，否则无法复制
            // 注意：原本的 Ctrl+Shift+C 逻辑在后面，但这里我们要防止"普通复制"操作意外清除选区
            const isCopy = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'c' || e.key === 'Insert');
            
            if (!isCopy) {
                selection.removeAllRanges(); // 1. 清除视觉上的高亮
                this.focus();                // 2. 强制聚焦回隐藏输入框，确保字符能被捕获
            }
        }

        // --- Zsh 菜单模式拦截逻辑 ---
        if (this.tabMenu.active) {
            if (e.key === 'Tab') {
                e.preventDefault();
                // 循环切换选项
                if (e.shiftKey) {
                    this._cycleMenu(-1); // Shift+Tab 上一个
                } else {
                    this._cycleMenu(1);  // Tab 下一个
                }
                return;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // 确认选择
                this._closeMenu(true); // true = 保留当前选择
                // this._handleNewline(); // 执行命令
                // if (this.onCommand) this.onCommand(this.currentLine);
                this.cursorX = this.prompt.length + this.currentLine.length;
                this._render();
                return;
            } else if (e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) {
                e.preventDefault();
                // 取消选择，恢复原始输入
                this._closeMenu(false); // false = 还原
                return;
            } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                // 方向键也可以用来导航菜单 (可选，这里为了简单先关闭菜单)
                // 或者你可以实现 grid 导航。这里我们选择：方向键确认当前选择，并执行方向键原义
                this._closeMenu(true); 
                // 继续向下执行，让 _handleKeydown 处理方向键
            } else {
                // 输入其他字符 (例如 'a')，意味着确认当前选择，并追加字符
                if (!isModifier) {
                    this._closeMenu(true);
                }
                // 继续向下执行
            }
        }

        if (this.fullScreenApp) {
            // 如果全屏应用正在运行，将按键交给它处理
            this.fullScreenApp.handleKeydown(e);
        } else if (this.isReading) {
            // 如果在 [Y/n] 模式下
            // e.preventDefault(); // 非禁止所有按键
            // console.log(this.cursorX);

            if (e.key === 'Enter') {
                e.preventDefault();
                const answer = this.currentLine;
                this.isReading = false;
                this._handleNewline(); // 换行
                this.readResolve(answer.trim().toLowerCase()); // Resolve Promise
                this.readResolve = null;
                this.disableInput(); // 交还控制权

            } else if (e.key === 'Backspace') {
                e.preventDefault();
                const pos = this.cursorX - this.prompt.length;
                if (pos > 0) {
                    this.currentLine = this.currentLine.substring(0, pos - 1) + this.currentLine.substring(pos);
                    this.cursorX--;
                }
                this._render();
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const pos = this.cursorX - this.prompt.length;
                const char = e.key;
                this.currentLine = this.currentLine.substring(0, pos) + char + this.currentLine.substring(pos);
                this.cursorX++;
                this.focus();
                this._render();
                return;
            }
            
            // this._render(); // 渲染 Y/n 的输入
        
        } else {
            // 否则，使用我们常规的命令行处理器
            this._handleKeydown(e);
        }
    }

    // 菜单循环辅助方法
    _cycleMenu(direction) {
        const total = this.tabMenu.items.length;
        if (total === 0) return;

        // 更新索引
        this.tabMenu.selected += direction;
        
        // [核心修改] 循环逻辑包含 -1 (原始输入)
        // 范围: -1 到 total - 1
        if (this.tabMenu.selected >= total) this.tabMenu.selected = -1; // 超过最后一个 -> 回到原始
        if (this.tabMenu.selected < -1) this.tabMenu.selected = total - 1; // 小于原始 -> 去到最后一个

        if (this.tabMenu.selected === -1) {
            // --- 回到原始输入状态 ---
            this.currentLine = this.tabMenu.originalLine;
            this.cursorX = this.prompt.length + this.tabMenu.originalLine.length;
        } else {
            // --- 选中某个选项 ---
            const item = this.tabMenu.items[this.tabMenu.selected];
            
            const originalText = this.tabMenu.originalLine;
            const tokenStart = this.tabMenu.tokenStart;
            
            // 获取新值 (URL 或 Title)
            let newValue = item.value || item.title;
            // 如果是路径且包含空格，转义之；如果是 URL (通常无空格)，不转义或根据需要转义
            newValue = this.escapePath(newValue);

            // 拼接： 原文本前半部分 + 补全前缀 + 新值
            const prefix = this.tabMenu.completionPrefix || "";
            
            // 此时不仅替换 token，还要注意如果 originalLine 后半部分还有内容（光标不在行尾），
            // Zsh 通常是替换光标处的词。为了简化，我们假设是在补全当前的词。
            const newLine = originalText.substring(0, tokenStart) + prefix + newValue;
            
            this.currentLine = newLine;
            this.cursorX = this.prompt.length + newLine.length;
        }

        // 重绘菜单
        this._renderMenu();
    }

    // [修复版] 关闭菜单
    _closeMenu(saveSelection) {
        // 1. 核心修复：确保只在有渲染行时才清理
        if (this.tabMenu.renderedLines > 0) {
            // 保护性检查：防止删除超过 buffer 范围
            const removeIndex = this.cursorY + 1;
            if (removeIndex < this.buffer.length) {
                 // 仅仅删除我们之前插入的那几行
                 this.buffer.splice(removeIndex, this.tabMenu.renderedLines);
            }
            this.tabMenu.renderedLines = 0;
        }

        if (!saveSelection) {
            // 如果取消，恢复原始输入
            this.currentLine = this.tabMenu.originalLine;
            this.cursorX = this.prompt.length + this.tabMenu.originalLine.length;
        }

        // 2. 重置状态
        this.tabMenu.active = false;
        this.tabMenu.items = [];
        this.tabMenu.selected = -1;
        
        this._render(); // 强制重绘
    }

    // 渲染菜单
    _renderMenu() {
        // 1. 清理旧菜单 (保持不变)
        if (this.tabMenu.renderedLines > 0) {
            const removeIndex = this.cursorY + 1;
            if (this.buffer.length > removeIndex) {
                 this.buffer.splice(removeIndex, this.tabMenu.renderedLines);
            }
            this.tabMenu.renderedLines = 0;
        }

        const matches = this.tabMenu.items;
        const selectedIdx = this.tabMenu.selected;
        if (!matches || matches.length === 0) return;

        // 2. 预计算布局 (保持不变)
        const displayItems = matches.map((m, idx) => {
            let title = m.title.trim();
            if (title.length > 30) title = title.substring(0, 27) + "..."; 
            const isDir = !!m.children;
            let displayText = title;
            if (isDir) displayText += '/';
            return {
                text: displayText,
                isDir: isDir,
                isHistory: m.type === 'history',
                isBookmark: m.type === 'bookmark',
                isSelected: (idx === selectedIdx),
                visualLen: getVisualLength(displayText)
            };
        });

        let maxNameWidth = 0;
        displayItems.forEach(item => { if (item.visualLen > maxNameWidth) maxNameWidth = item.visualLen; });
        
        // 每个单元格的总宽 (文字 + 间距)
        const colPadding = 2;
        const colWidth = maxNameWidth + colPadding;
        
        const termWidth = this.cols > 0 ? this.cols : 80;
        let numCols = Math.floor(termWidth / colWidth);
        if (numCols < 1) numCols = 1;
        const numRows = Math.ceil(displayItems.length / numCols);

        // 3. 生成 Buffer 行 (核心修改)
        const menuLines = [];
        
        for (let y = 0; y < numRows; y++) {
            let currentLineStr = "";
            let currentVisualPos = 0; // 追踪当前行光标的逻辑位置

            for (let x = 0; x < numCols; x++) {
                const index = y + (x * numRows);
                
                // 计算这一列结束时的目标位置
                // 如果是最后一列，强制目标位置为行尾 (termWidth)，以确保填满
                const isLastCol = (x === numCols - 1);
                const targetPos = isLastCol ? termWidth : (x + 1) * colWidth;

                if (index < displayItems.length) {
                    const item = displayItems[index];
                    
                    // 计算需要填充的空格数： 目标位置 - (当前位置 + 文字长度)
                    let paddingLen = Math.max(0, targetPos - (currentVisualPos + item.visualLen));
                    
                    // 如果不是最后一列，保留一部分 padding 给下一列的起始（为了视觉美观，通常留1-2格空隙）
                    // 但在这里为了严格对齐，我们把所有剩余空间都算作这个单元格的 padding
                    const padding = ' '.repeat(paddingLen);

                    let contentHtml = this.escapeHtml(item.text);

                    // --- 关键修改：将 padding 包含在样式 span 内部 ---
                    // 这样选中时，背景色会铺满整个单元格，而不仅仅是文字下方
                    if (item.isSelected) {
                        currentLineStr += `<span style="background-color: #ddd; color: #000;">${contentHtml}${padding}</span>`;
                    } else {
                        // 未选中项：分别着色
                        if (item.isDir) {
                            currentLineStr += `<span class="term-folder">${contentHtml}</span>${padding}`;
                        } else if (item.isBookmark) {
                            currentLineStr += `<span style="color: #FFD700;">${contentHtml}</span>${padding}`;
                        } else if (item.isHistory) {
                            currentLineStr += `<span style="color: #87CEEB;">${contentHtml}</span>${padding}`;
                        } else {
                            currentLineStr += contentHtml + padding;
                        }
                    }
                } else {
                    // 这一列没有项目 (比如最后一行的空白处)，直接填充空格
                    const paddingLen = Math.max(0, targetPos - currentVisualPos);
                    currentLineStr += ' '.repeat(paddingLen);
                }

                // 更新位置
                currentVisualPos = targetPos;
            }

            // 再次确保：如果因为计算误差导致没填满，补齐剩余部分
            if (currentVisualPos < termWidth) {
                currentLineStr += ' '.repeat(termWidth - currentVisualPos);
            }

            menuLines.push(currentLineStr);
        }

        // 4. 插入 Buffer
        if (menuLines.length > 0) {
            this.buffer.splice(this.cursorY + 1, 0, ...menuLines);
            this.tabMenu.renderedLines = menuLines.length;
        }
        
        this._render();
        this.scrollToBottom(); 
    }

    // 辅助: 在 Class 内部访问 helper
    escapePath(str) { return escapePath(str); }

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
        const renderRows = this.buffer.length;
        for (let y = 0; y < renderRows; y++) {
            let line = this.buffer[y]; // Line from buffer (might contain HTML)
            
            if (y === this.cursorY && !this.inputDisabled) {
                // --- 输入/光标渲染逻辑 ---
                const fullLineText = this.prompt + this.currentLine;

                // 先将行用空格填充到正确的总宽度
                const paddedLine = fullLineText + ' '.repeat(Math.max(0, this.cols - fullLineText.length));

                // 从已填充的行中获取光标下的字符
                //    (这确保了光标在行尾时，我们能正确获取到一个空格)
                const charAtCursor = paddedLine[this.cursorX] || ' '; 
                
                // 替换光标位置的字符，而不是在行尾添加
                // Keep the editable prompt line independent from preceding styled output.
                // Without an explicit foreground reset, a colored announcement can leak into
                // the prompt when the buffer is re-rendered.
                line = `<span class="term-input-line">${this.escapeHtml(paddedLine.substring(0, this.cursorX))}` +
                        `<span class="term-cursor">${this.escapeHtml(charAtCursor)}</span>` +
                        `${this.escapeHtml(paddedLine.substring(this.cursorX + 1))}</span>`;
                        
                html += line + '\n';
            
            } else {
                // 如果行是空的，渲染一个空格（或不间断空格）以保持高度
                if (line === '') {
                    html += ' \n'; 
                } else {
                    html += line + '\n'; 
                }
            }
        }
        this.domBuffer.innerHTML = html;
        this.scrollToCursor();
    }

    // Deprecated 
    scrollToBottom() {
        requestAnimationFrame(() => {
            this.container.scrollTop = this.container.scrollHeight;
        });
    }

    /**
     * 智能滚动：始终确保光标在视口内可见
     * 替代原来的 scrollToBottom，避免缩放时跳到大量空白处
     */
    scrollToCursor() {
        requestAnimationFrame(() => {
            if (!this.cellHeight) return;

            // 1. 计算光标当前行的像素位置 (Top 和 Bottom)
            const cursorTop = this.cursorY * this.cellHeight;
            const cursorBottom = cursorTop + this.cellHeight;

            // 2. 获取当前视口状态
            const viewportHeight = this.container.clientHeight;
            const currentScrollTop = this.container.scrollTop;

            // 3. 判断与滚动
            // 情况 A: 光标跑到了视口上方 -> 向上滚动，直到光标出现在顶部
            if (cursorTop < currentScrollTop) {
                this.container.scrollTop = cursorTop;
            }
            // 情况 B: 光标跑到了视口下方 -> 向下滚动，直到光标出现在底部
            else if (cursorBottom > currentScrollTop + viewportHeight) {
                this.container.scrollTop = cursorBottom - viewportHeight;
            }
            
            // 情况 C: 光标在视口中间 -> 什么都不做 (这是防止画面抖动的关键)
        });
    }

    /**
     * 处理输入法开始
     */
    _handleCompositionStart(e) {
        this.isComposing = true;
    }

    /**
     * 处理输入法结束 (选择或确认)
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
    // _handleNewline() {
    //     this.cursorY++;
    //     this.cursorX = 0;
    //     if (this.cursorY >= this.rows) {
    //         this._scrollUp();
    //         this.cursorY = this.rows - 1; // 光标保持在最后一行
    //     }
    // }

    _handleNewline() {
        this.cursorY++;
        
        // 如果光标超出了当前缓冲区长度，添加新行
        if (this.cursorY >= this.buffer.length) {
            this.buffer.push(' '.repeat(this.cols));
        }
        
        this.cursorX = 0;

        // 限制缓冲区大小 (History Limit)
        if (this.buffer.length > this.maxLines) {
            this.buffer.shift(); // 移除最上面的一行
            this.cursorY--;      // 光标上移
        }

        this.scrollToCursor(); // 自动滚动到底部
    }

    /**
     * 在当前光标位置写入单个字符串（无换行）
     * @param {string} text 要写入的文本
     */
    _writeSingleLine(htmlFragment) { // 重命名参数以清晰表明它可能包含 HTML
        // 首先计算可见内容的长度，用于换行判断
        const textContent = this._stripHtml(htmlFragment);
        const visibleLength = textContent.length;

        // if (visibleLength === 0) return; // 优化，但是出现 buffer 未覆盖错误

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
     * 标准输出 (stdout)
     */
    writeLine(text) {
        if (this.isSilent) return; // $(...) 静默模式优先级最高

        // 检查是否重定向
        if (this.ioState.stdout) {
            // 如果是 /dev/null，直接丢弃
            if (this.ioState.stdout.path === '/dev/null') return;
            // 否则存入缓冲区
            this.ioState.buffer.stdout.push(text);
        } else {
            // 正常写屏
            if (isPiping) {
                pipeBuffer.push(String(text));
            } else {
                this._prepareOutput();
                // 用 --terminal-stdout-color 包裹纯文本输出；未设置时回退到继承色 (与之前行为一致)。
                // 命令自己输出的带色 HTML (走 writeHtml) 不受影响：子元素的显式颜色总是覆盖祖先的继承色。
                this.writeHtml(`<span style="color: var(--terminal-stdout-color, inherit);">${this.escapeHtml(String(text))}</span>`);
            }
        }
    }

    /**
     * 标准错误输出 (stderr)
     * 所有之前的 term.writeHtml(`<span class="term-error">...</span>`) 都应该改用这个
     */
    writeError(text) {
        if (this.ioState.stderr) {
            if (this.ioState.stderr.path === '/dev/null') return;
            this.ioState.buffer.stderr.push(text);
        } else {
            // 正常写屏 (红色)
            this._prepareOutput();
            // 注意：这里手动加 span，或者你也可以封装进去
            const html = `<span class="term-error">${text}</span>`;
            
            // 为了复用 writeHtml 的逻辑 (自动换行等)，我们直接调用它
            // 但 writeHtml 会受 ioState.stdout 影响吗？
            // 这是一个设计点。为了简单，我们让 writeHtml 总是写屏(除非 isSilent)，
            // 而 writeLine 负责 stdout。
            // 更好的做法是直接操作 DOM 或调用底层 _writeSingleLine
            
            // 临时方案：直接写 buffer
            const lines = html.split('\n');
            for(let l of lines) {
                this.buffer[this.cursorY] = this._overwriteHtml(this.buffer[this.cursorY], this.cursorX, l);
                this._handleNewline();
            }
            this._restoreCursorAfterOutput();
            this._render();
        }
    }

    

    /**
     * 准备输出：确保当前行是干净的
     * 如果光标不在行首，或者当前行已经有内容，则强制换行
     */
    _prepareOutput() {
        // 1. 获取当前行的缓冲内容
        const currentBufferLine = this.buffer[this.cursorY] || "";
        
        // 2. 检查是否有内容 (忽略 HTML 标签后的纯文本是否为空)
        //    注意：trim() 是为了忽略纯空格的行，防止无限换行
        const hasContent = this._stripHtml(currentBufferLine).trim().length > 0;

        // 3. 核心判断：如果光标不在 0，或者行内已有内容 -> 换行
        if (this.cursorX > 0 || hasContent) {
            this._handleNewline();
            this.cursorX = 0;
        }
    }

    /**
     * 异步/带外输出（writeError、writeHtml）结束后，把光标恢复到当前 prompt+输入内容之后，
     * 避免正常同步执行路径之外（例如 setWallpaper 的 img.onerror）触发的输出把光标留在行首。
     *
     * 注意：命令执行期间 (inputDisabled === true) 不能在这里改动 cursorX ——
     * this.currentLine 此时仍是刚执行完的旧命令文本（要等 done() -> setPrompt() 才会清空），
     * 强行按它计算 cursorX 会让下一次 _prepareOutput() 误判"当前行有内容"，
     * 从而在同一条命令的多行输出之间插入多余的空行。
     */
    _restoreCursorAfterOutput() {
        if (this.inputDisabled) return;
        this.cursorX = this.prompt.length + this.currentLine.length;
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
        const commandStrings = splitByUnquotedChar(line, ';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
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
        const tokens = tokenizeCommand(commandStr);

        if (!tokens || tokens.length === 0) {
            return null; // Empty or invalid command string
        }

        const commandName = tokens[0];
        const args = [];
        const options = {};

        for (let i = 1; i < tokens.length; i++) {
            const token = tokens[i];

            if (token.startsWith('--')) { // Long option (e.g., --all)
                const optName = token.substring(2);
                if (optName) {
                    options[optName] = true;
                }
            } else if (token.startsWith('-')) { // Short option(s) (e.g., -a, -l, -al)
                const optString = token.substring(1);
                if (optString.length > 0) {
                    for (const char of optString) {
                        options[char] = true;
                    }
                }
            } else {
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

    // 测量一段纯文本在当前字体下的真实像素宽度。
    // getVisualLength() 假定宽字符恰好是 2 * cellWidth，但宽字符走的是系统回退字体
    // （因为字体栈里没有 CJK 字体），实际宽度与该假定并不一致，需要用真实渲染宽度替代。
    _measureLineWidth(text) {
        // _render() 会整体重写 domBuffer.innerHTML，这会把之前缓存的测量用 span 从
        // 文档中摘掉（引用还在，但已不在文档树里，getBoundingClientRect 会返回 0），
        // 所以每次使用前都要确认它仍连接在文档中，否则重新创建并挂载。
        if (!this._measureSpan || !this._measureSpan.isConnected) {
            const bufferStyle = window.getComputedStyle(this.domBuffer);
            const span = document.createElement('span');
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            span.style.whiteSpace = 'pre';
            span.style.fontFamily = bufferStyle.fontFamily;
            span.style.fontSize = bufferStyle.fontSize;
            span.style.lineHeight = bufferStyle.lineHeight;
            this.domBuffer.appendChild(span);
            this._measureSpan = span;
        }
        this._measureSpan.textContent = text;
        return this._measureSpan.getBoundingClientRect().width;
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

    /**
     * [修复版] 截取 HTML 字符串，感知 HTML 实体 (如 &quot;) 为单个字符
     * 防止在实体中间截断导致显示乱码
     */
    _truncateHtml(html, length, start = 0) {
        let visibleCount = 0;
        let captureCount = 0;
        let startIndex = 0;
        let endIndex = html.length; // 默认为末尾
        let inTag = false;
        let foundStart = (start === 0);

        if (length <= 0) return "";

        for (let i = 0; i < html.length; i++) {
            const char = html[i];
            
            if (char === '<') inTag = true;

            // --- 核心修复：检测 HTML 实体 ---
            let isEntity = false;
            let entityLen = 0;
            // 如果不在标签内，且遇到 &，尝试向后查找 ;
            if (!inTag && char === '&') {
                const nextSemi = html.indexOf(';', i);
                // 限制查找范围（比如 12 字符内），防止误判普通文本中的 &
                if (nextSemi !== -1 && nextSemi - i < 12) {
                     isEntity = true;
                     entityLen = nextSemi - i + 1; // 实体总长度 (例如 &quot; 是 6)
                }
            }
            // -----------------------------

            if (!inTag) {
                if (!foundStart) {
                    // --- 1. 跳过阶段 (Skipping) ---
                    visibleCount++; // 实体算作 1 个可见宽度
                    
                    // 如果是实体，跳过整个实体长度
                    if (isEntity) i += (entityLen - 1);
                    
                    if (visibleCount >= start) {
                        foundStart = true;
                        startIndex = i + 1; // 下一个字符开始捕获
                    }
                } else {
                    // --- 2. 捕获阶段 (Capturing) ---
                    captureCount++;
                    
                    // 如果是实体，跳过整个实体长度（保证不切断）
                    if (isEntity) i += (entityLen - 1);
                    
                    if (captureCount >= length) {
                        endIndex = i + 1;
                        break; // 完成
                    }
                }
            } else if (char === '>') {
                inTag = false;
            }
        }

        if (!foundStart) return "";
        return html.substring(startIndex, endIndex);
    }

    writeHtml(html) {
        if (this.isSilent) return;
        // 功能 1：管道支持
        if (isPiping) {
            pipeBuffer.push(this._stripHtml(html)); // 管道中只应传递纯文本
            return;
        }

        if (this.ioState.stderr && html.includes('class="term-error"')) {
             if (this.ioState.stderr.path === '/dev/null') return; // 丢弃
             // 剥离 HTML 标签，只存纯文本错误信息
             this.ioState.buffer.stderr.push(this._stripHtml(html));
             return;
        }

        // 标准输出流拦截 (Stdout Redirection >)
        if (this.ioState.stdout) {
            if (this.ioState.stdout.path === '/dev/null') return; // 丢弃
            // 将 HTML 转换为纯文本保存 (文件通常只存纯文本)
            this.ioState.buffer.stdout.push(this._stripHtml(html));
            return;
        }

        // 管道支持 (Pipe |)
        if (isPiping) {
            pipeBuffer.push(this._stripHtml(html)); // 管道传递纯文本
            return;
        }

        this._prepareOutput();
        
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
        this._restoreCursorAfterOutput();
        this._render();
    }

    _writeLogLine(text) {
            const oldPiping = isPiping;
            isPiping = false; // 暂时禁用管道
            this.writeLine(text); // 调用常规的 writeLine (L432)
            isPiping = oldPiping; // 恢复管道状态
    }

    _writeLogHtml(html) {
            const oldPiping = isPiping;
            isPiping = false; // 暂时禁用管道
            this.writeHtml(html); // 调用常规的 writeHtml (L602)
            // this._handleNewline(); // writeHtml (L602) 不再自动换行，我们补上
            isPiping = oldPiping; // 恢复管道状态
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
                    if (e.shiftKey) {
                        // --- 这是 Ctrl+Shift+C (复制) ---
                        e.preventDefault();
                        const selection = window.getSelection();
                        const selectedText = selection.toString();
                        if (selectedText) {
                            navigator.clipboard.writeText(selectedText).catch(err => {
                                this._reportClipboardError('Copy', err);
                            });
                        }
                        // 不中断，也不清除选区
                        // 复制完成后，强制聚焦回输入框，以便用户可以立即打字
                        this.focus();
                    } else {
                        // --- 这是 Ctrl+C (中断) ---
                        e.preventDefault();

                        const lineContent = this.prompt + this.currentLine;
                        const lineWithMarker = lineContent + '^C';
                        const escapedLine = this.escapeHtml(lineWithMarker);
                        const padding = ' '.repeat(Math.max(0, this.cols - lineWithMarker.length));
                        this.buffer[this.cursorY] = escapedLine + padding;
                        this._handleNewline();
                        this.currentLine = '';
                        bookmarkSystem.update_user_path();
                        this.enableInput();
                    }
                    break;

                case 'v':
                    if (e.shiftKey) {
                        // --- 这是 Ctrl+Shift+V (现代终端惯例的粘贴快捷键) ---
                        e.preventDefault();
                        this._pasteFromSystemClipboard();
                    } else {
                        // --- 普通 Ctrl+V：交给浏览器原生粘贴写入隐藏 textarea，触发 input 事件 ---
                        handled = false;
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
                
                // 限制历史记录数量 (例如 500 条)，防止 localStorage 溢出
                if (this.history.length > 500) {
                    this.history.shift();
                }
                
                // 保存
                localStorage.setItem('st2_cmd_history', JSON.stringify(this.history));
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

        } else if (e.key === 'Delete') {
            e.preventDefault();
            const pos = this.cursorX - this.prompt.length;
            // 只有当光标不在行尾时才删除
            if (pos < this.currentLine.length) {
                this.currentLine = this.currentLine.substring(0, pos) + this.currentLine.substring(pos + 1);
                // 光标位置不变，但文字变短了
                this._render();
            }
            return;

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

        // (这个逻辑现在主要用于处理原生粘贴：浏览器已经把系统剪贴板内容写进了 <textarea>)
        const rawText = e.target.value;
        e.target.value = '';
        if (!rawText) return;

        this._insertPastedText(rawText.replace(/\r\n?/g, '\n'));
    }

    /**
     * 在光标处插入一段（可能多行的）粘贴文本，供原生粘贴 (_handleInput)
     * 和 Ctrl+Shift+V (_pasteFromSystemClipboard) 共用。
     * @param {string} text - 已统一换行符 (\n) 的文本
     */
    _insertPastedText(text) {
        if (!text) return;
        const pos = this.cursorX - this.prompt.length;

        if (!text.includes('\n')) {
            // 单行粘贴：原有逻辑
            this.currentLine = this.currentLine.substring(0, pos) + text + this.currentLine.substring(pos);
            this.cursorX += text.length;
            this._render();
            return;
        }

        // 多行粘贴：把光标处已有内容与粘贴文本合并后按行拆分，
        // 除最后一段外的每一行都作为独立命令依次执行（类似 bash 粘贴行为），
        // 避免整块文本被塞进单个 buffer 行导致行尾填充不完整 (white-space: pre 会真的换行)。
        const merged = this.currentLine.substring(0, pos) + text + this.currentLine.substring(pos);
        const segments = merged.split('\n');
        const trailing = segments.pop();
        this._runPastedLines(segments, trailing);
    }

    /**
     * Ctrl+Shift+V（现代终端惯例）：主动从系统剪贴板读取并粘贴。
     * 与原生 Ctrl+V（通过隐藏 textarea 的 input 事件）互不干扰，共用同一套插入逻辑。
     */
    async _pasteFromSystemClipboard() {
        if (this.inputDisabled || this.isReading) return;
        try {
            const text = await navigator.clipboard.readText();
            if (text) this._insertPastedText(text.replace(/\r\n?/g, '\n'));
        } catch (err) {
            this._reportClipboardError('Paste', err);
        }
    }

    /**
     * 剪贴板读写失败时，向终端输出一条可见的提示（而不是静默失败），
     * 尤其是 Chrome 在用户多次忽略权限弹窗后会直接静默拒绝该权限的情况。
     */
    _reportClipboardError(action, err) {
        const reason = err && err.message ? err.message : String(err);
        this.writeError(`${action} failed: clipboard access is blocked (${reason})`);
        this.writeLine('Click the site/tune icon next to the address bar, allow Clipboard under Site settings, then reload this page.');
    }

    /**
     * 依次“固化”并执行粘贴内容中的每一整行（除最后一段不完整的行外），
     * 逻辑镜像 Enter 键处理与 parseStartrc 的顺序 await 执行模式，避免与嵌套命令执行计数器竞争。
     */
    async _runPastedLines(lines, trailing) {
        for (const line of lines) {
            this.currentLine = line;
            this.cursorX = this.prompt.length + line.length;

            if (line.trim().length > 0 && line !== this.history[this.history.length - 1]) {
                this.history.push(line);
                if (this.history.length > 500) {
                    this.history.shift();
                }
                localStorage.setItem('st2_cmd_history', JSON.stringify(this.history));
            }
            this.historyIndex = this.history.length;
            this.tempLine = "";

            const fullLineText = this.prompt + this.currentLine;
            const escapedLine = this.escapeHtml(fullLineText);
            const padding = ' '.repeat(Math.max(0, this.cols - fullLineText.length));
            this.buffer[this.cursorY] = escapedLine + padding;

            this._handleNewline();

            if (this.onCommand) {
                await this.onCommand(line);
            }
        }
        this.currentLine = trailing;
        this.cursorX = this.prompt.length + trailing.length;
        this._render();
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

        // 3. 调整 buffer 数组 (保持原有逻辑)
        if (newRows > oldRows) {
            // 窗口变高了，可选：在顶部填充空行
        } else if (newRows < oldRows) {
            // 窗口变矮了，不做处理，_render 会自动截取
        }
        
        // 4. [核心修复] 智能调整每行宽度
        const containerWidth = this.container.clientWidth;
        this.buffer = this.buffer.map(line => {
            // A. 获取去除 HTML 标签后的纯文本
            const plainText = this._stripHtml(line);

            // B. 获取去除尾部空格后的“实际内容”
            //    (用于判断这些内容是否真的比新窗口宽)
            const trimmedPlainText = plainText.trimEnd();

            // 含宽字符（CJK 等）的行走真实像素测量，因为宽字符渲染用的是系统回退字体，
            // 其实际宽度并不严格等于 2 * cellWidth；纯 ASCII 行沿用原来的按字符数计算（更快，且已验证正确）。
            if (!WIDE_CHAR_REGEX.test(trimmedPlainText)) {
                const contentLen = getVisualLength(trimmedPlainText);

                if (contentLen > newCols) {
                    // [情况 1]: 实际内容（不含空格）比新窗口还宽
                    // 必须截断。为了防止切断 HTML 标签导致渲染崩溃，只能忍痛剥离颜色。
                    // 这是唯一会丢失颜色的情况（通常只在窗口缩得非常小时发生）。
                    return this.escapeHtml(plainText.substring(0, newCols));

                } else {
                    // [情况 2]: 实际内容能放得下 (即使之前有很长的填充空格)
                    // 这是一个能够保留颜色的安全操作。

                    // 1. 移除旧的 HTML 字符串末尾的空格
                    //    (注意：这可能会移除一部分带有背景色的空格，但在 Resize 场景下通常是可以接受的)
                    const trimmedLine = line.trimEnd();

                    // 2. 计算剩余部分的视觉长度
                    //    (注意：必须重新 stripHtml 计算，因为 trimEnd 后长度变了)
                    const currentVisualLen = getVisualLength(this._stripHtml(trimmedLine));

                    // 3. 计算需要补多少空格才能填满新窗口
                    const paddingNeeded = Math.max(0, newCols - currentVisualLen);

                    // 4. 返回：原始带色内容 + 新的填充空格
                    return trimmedLine + ' '.repeat(paddingNeeded);
                }
            }

            // [宽字符慢路径] 用真实像素宽度替代 getVisualLength() 的估算
            const contentWidthPx = this._measureLineWidth(trimmedPlainText);

            if (contentWidthPx > containerWidth) {
                // 逐字符收缩直到真实宽度能放进容器（行数很少，且仅宽字符行才会走到这里）
                let truncated = trimmedPlainText;
                while (truncated.length > 0 && this._measureLineWidth(truncated) > containerWidth) {
                    truncated = truncated.substring(0, truncated.length - 1);
                }
                return this.escapeHtml(truncated);
            } else {
                const trimmedLine = line.trimEnd();
                const paddingPx = Math.max(0, containerWidth - contentWidthPx);
                const paddingNeeded = Math.round(paddingPx / this.cellWidth);
                return trimmedLine + ' '.repeat(paddingNeeded);
            }
        });

        // 5. 确保光标位置合法
        if (this.cursorX >= newCols) this.cursorX = newCols - 1;
        if (this.cursorY >= newRows) this.cursorY = newRows - 1;

        // 6. 重新渲染
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

// 供 NanoEditor 与 VimEditor 共享的内部剪贴板，使得 Vim 里 yank 的内容可以在 Nano 里粘贴，反之亦然。
let editorClipboard = null; // { type: 'char'|'line', text: string } | null

/**
 * 渲染一行文本，其中 [selStartCol, selEndCol) 区间使用选区高亮样式。
 * 供 NanoEditor 的 Shift+方向键 选区渲染复用。
 */
function renderRowWithSelection(term, text, selStartCol, selEndCol) {
    if (selStartCol == null || selEndCol == null || selEndCol <= selStartCol) {
        return term.escapeHtml(text);
    }
    const before = term.escapeHtml(text.substring(0, selStartCol));
    const mid = term.escapeHtml(text.substring(selStartCol, selEndCol));
    const after = term.escapeHtml(text.substring(selEndCol));
    return `${before}<span style="background-color: var(--terminal-selection-background); color: var(--terminal-selection-foreground);">${mid}</span>${after}`;
}

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
        this.status = t('nanoExit') + (this.isReadOnly ? "" : `, ${t('nanoSave')}`);
        this.dirty = false; // 是否有未保存的修改
        this.termRows = term.rows;
        this.termCols = term.cols;
        this.selectionAnchor = null; // Shift+方向键 选区起点 {y, x} | null
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

    // --- 选区 / 剪贴板辅助函数 ---

    // 返回归一化的选区范围 {start:{y,x}, end:{y,x}}（start 总是先于 end），无选区时返回 null
    _selectionRange() {
        if (!this.selectionAnchor) return null;
        const a = this.selectionAnchor;
        const b = { y: this.cursorY, x: this.cursorX };
        const [start, end] = (a.y < b.y || (a.y === b.y && a.x <= b.x)) ? [a, b] : [b, a];
        if (start.y === end.y && start.x === end.x) return null; // 空选区
        return { start, end };
    }

    // 返回给定行在选区内的 [start, end) 列范围，该行不在选区内时返回 null
    _selectionColsForLine(lineIndex) {
        const range = this._selectionRange();
        if (!range) return null;
        const { start, end } = range;
        if (lineIndex < start.y || lineIndex > end.y) return null;
        const line = this.lines[lineIndex] || '';
        const colStart = (lineIndex === start.y) ? start.x : 0;
        const colEnd = (lineIndex === end.y) ? end.x : line.length;
        return { start: colStart, end: colEnd };
    }

    _extractSelectionText(range) {
        const { start, end } = range;
        if (start.y === end.y) {
            return this.lines[start.y].substring(start.x, end.x);
        }
        const parts = [this.lines[start.y].substring(start.x)];
        for (let y = start.y + 1; y < end.y; y++) {
            parts.push(this.lines[y]);
        }
        parts.push(this.lines[end.y].substring(0, end.x));
        return parts.join('\n');
    }

    _deleteSelectionRange(range) {
        const { start, end } = range;
        const merged = this.lines[start.y].substring(0, start.x) + this.lines[end.y].substring(end.x);
        this.lines.splice(start.y, end.y - start.y + 1, merged);
        this.cursorY = start.y;
        this.cursorX = start.x;
    }

    // 在光标处插入文本（支持多行），供 Ctrl+V（系统剪贴板）与 Ctrl+U（内部剪贴板）共用
    _pasteText(text) {
        if (!text) return;
        this.dirty = true;

        const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const parts = cleanText.split('\n');

        const currentLine = this.lines[this.cursorY];
        const pre = currentLine.substring(0, this.cursorX);
        const post = currentLine.substring(this.cursorX);

        if (parts.length === 1) {
            this.lines[this.cursorY] = pre + parts[0] + post;
            this.cursorX += parts[0].length;
        } else {
            this.lines[this.cursorY] = pre + parts[0];

            const middleLines = parts.slice(1, -1);
            if (middleLines.length > 0) {
                this.lines.splice(this.cursorY + 1, 0, ...middleLines);
            }

            const lastPart = parts[parts.length - 1];
            const insertionIndex = this.cursorY + parts.length - 1;
            this.lines.splice(insertionIndex, 0, lastPart + post);

            this.cursorY = insertionIndex;
            this.cursorX = lastPart.length;
        }

        this._validateCursor();
        this._handleScrolling();
    }

    // --- 核心渲染和事件 ---

    _render() {
        this.term._initBuffer(); // 清空 term.buffer

        // 1. 绘制顶栏
        const roText = this.isReadOnly ? ` ${t('nanoReadOnly')}` : '';
        const topBar = `${t('nanoTitle')} ${this.filePath} ${this.dirty ? '*' : ''}${roText}`;
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
                const rawLine = this.lines[lineIndex];
                const sel = this._selectionColsForLine(lineIndex);
                const html = (sel && sel.end > sel.start)
                    ? renderRowWithSelection(this.term, rawLine, sel.start, sel.end)
                    : this.term.escapeHtml(rawLine);
                const padding = ' '.repeat(Math.max(0, this.termCols - rawLine.length));
                this.term.buffer[y + 1] = html + padding;
            } else {
                this.term.buffer[y + 1] = this._padLine("~");
            }
        }

        // 3. 绘制底栏
        const saveText = this.isReadOnly ? "" : "  ^O Save";
        const clipHint = "  ^K Cut  ^Shift+K Copy  ^U Paste";
        this.term.buffer[this.termRows - 2] = this._padLine(`^X Exit${saveText}${clipHint}`, true);
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

            // 4. 转义光标前后的部分（若与选区重叠则局部套用选区高亮）
            const beforeText = line.substring(0, this.cursorX);
            const afterText = line.substring(this.cursorX + 1);
            const sel = this._selectionColsForLine(this.cursorY);

            let lineBefore, lineAfter;
            if (sel && sel.end > sel.start) {
                lineBefore = renderRowWithSelection(this.term, beforeText, sel.start, Math.min(sel.end, beforeText.length));
                const afterSelStart = Math.max(0, sel.start - (this.cursorX + 1));
                const afterSelEnd = Math.max(0, sel.end - (this.cursorX + 1));
                lineAfter = renderRowWithSelection(this.term, afterText, afterSelStart, afterSelEnd);
            } else {
                lineBefore = this.term.escapeHtml(beforeText);
                lineAfter = this.term.escapeHtml(afterText);
            }

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

    async handleKeydown(e) {
        e.preventDefault();
        e.stopPropagation();
        this.status = ""; // 清除状态

        if (e.ctrlKey) {
            // --- Ctrl 命令 ---
            switch (e.key.toLowerCase()) {
                case 'x':
                    if (this.dirty) {
                        this.status = t('nanoStatusModified');
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
                        this.status = t('nanoStatusReadOnly');
                        this._render(); // 重新渲染以显示状态
                        return; // 阻止调用 _save()
                    }
                    this._save();
                    break;

                case 's':
                    if (this.isReadOnly) {
                        this.status = t('nanoStatusReadOnly');
                        this._render(); // 重新渲染以显示状态
                        return; // 阻止调用 _save()
                    }
                    this._save();
                    break;

                case 'v':
                    try {
                        const text = await navigator.clipboard.readText();
                        this._pasteText(text);
                        this._render();
                    } catch (err) {
                        this.status = "Paste failed: " + err.message;
                        this._render();
                    }
                    break;

                case 'k': {
                    const range = this._selectionRange();
                    if (e.shiftKey) {
                        // Ctrl+Shift+K：复制选区到内部剪贴板，不删除
                        if (range) {
                            editorClipboard = { type: 'char', text: this._extractSelectionText(range) };
                            this.status = t('nanoCopy');
                        }
                        this._render();
                        return; // 阻止调用后续渲染以外的逻辑
                    }

                    this.dirty = true;
                    if (range) {
                        // 有选区：剪切选区
                        editorClipboard = { type: 'char', text: this._extractSelectionText(range) };
                        this._deleteSelectionRange(range);
                        this.selectionAnchor = null;
                        this.status = t('nanoCut');
                    } else if (this.lines.length > 0) {
                        // 无选区：退回到整行剪切（沿用原有行为）
                        editorClipboard = { type: 'line', text: this.lines[this.cursorY] };

                        // 删除当前行
                        this.lines.splice(this.cursorY, 1);

                        // 如果删完了，至少保留一行空行
                        if (this.lines.length === 0) {
                            this.lines.push("");
                        }

                        // 如果光标在最后一行被删后，上移一行
                        if (this.cursorY >= this.lines.length) {
                            this.cursorY = this.lines.length - 1;
                        }
                        // 确保 X 不越界
                        this.cursorX = Math.min(this.cursorX, this.lines[this.cursorY].length);
                    }
                    this._handleScrolling();
                    this._render();
                    break;
                }

                case 'u':
                    if (editorClipboard && editorClipboard.text) {
                        this._pasteText(editorClipboard.text);
                        this.status = t('nanoPaste');
                        this._render();
                    }
                    break;
            }
        } else {
            const isEditKey = ['Backspace', 'Enter'].includes(e.key) || 
                              (e.key.length === 1 && !e.ctrlKey && !e.metaKey);
            if (this.isReadOnly && isEditKey) {
                this.status = t('nanoStatusReadOnly'); // (可选) 再次提醒
                this._render(); // 重新渲染以显示状态
                return; // 阻止所有编辑键
            }
            // --- 常规编辑 ---
            const isArrowKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
            if (isArrowKey) {
                if (e.shiftKey) {
                    // 首次按下 Shift+方向键时记录选区起点，随后仅移动光标以扩展选区
                    this.selectionAnchor = this.selectionAnchor || { y: this.cursorY, x: this.cursorX };
                } else {
                    this.selectionAnchor = null;
                }
            } else if (e.key !== 'Shift') {
                this.selectionAnchor = null;
            }

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
                this.status = t('nanoStatusSaved').replace('{0}', content.length);
            } else {
                if (this.status === "Saving...") {
                    this.status = t('nanoStatusSaveError');
                }
            }
        } catch (e) {
            this.status = `Error saving: ${e.message}`;
        }
    }
}

// VimEditor 支持的动作字符集（charwise 动作，可配合 d/c/y 使用，也可单独移动光标）
const VIM_CHARWISE_MOTIONS = {
    'h': (ed) => ({ y: ed.cursorY, x: Math.max(0, ed.cursorX - 1) }),
    'l': (ed) => {
        const maxX = Math.max(0, ed.lines[ed.cursorY].length - 1);
        return { y: ed.cursorY, x: Math.min(maxX, ed.cursorX + 1) };
    },
    '0': (ed) => ({ y: ed.cursorY, x: 0 }),
    '$': (ed) => ({ y: ed.cursorY, x: Math.max(0, ed.lines[ed.cursorY].length - 1) }),
    'w': (ed) => ed._motionWordForward(),
    'e': (ed) => ed._motionWordEnd(),
    'b': (ed) => ed._motionWordBackward(),
};

/**
 * 精简版 Vim 编辑器：支持 Normal/Insert/Visual/Command/Search 模式，
 * 动作 h j k l w b e 0 $ gg G，操作符 d c y（含 dd yy cc x D C Y），
 * p/P 粘贴，i I a A o O 进入插入模式，u/Ctrl+R 撤销重做，
 * v/V 可视模式，/ 搜索 + n/N，: 命令模式（w q wq q! x <N>）。
 * 明确不实现：宏、标记、:s 替换、具名寄存器、计数前缀、f/t/F/T、{ }、窗口分割、:g/ex 范围。
 */
class VimEditor {
    constructor(term, filePath, initialContent, onSave, onExit, isReadOnly = false) {
        this.term = term;
        this.filePath = filePath;
        this.onSave = onSave;
        this.onExit = onExit;
        this.isReadOnly = isReadOnly;

        this.lines = initialContent.split('\n');
        if (this.lines.length === 0) this.lines = [''];

        this.cursorY = 0;
        this.cursorX = 0;
        this.desiredCol = 0;
        this.topRow = 0;
        this.dirty = false;

        this.termRows = term.rows;
        this.termCols = term.cols;

        this.mode = 'normal';
        this.pendingOperator = null;
        this.pendingKey = null;
        this.visualAnchor = null;
        this.commandBuffer = '';
        this.searchTerm = '';
        this.searchDirection = 1;
        this.undoStack = [];
        this.redoStack = [];
        this.status = this.isReadOnly ? t('nanoReadOnly') : '';
        this._quit = false;
    }

    open() {
        this.term.enterFullScreenApp(this);
        this._render();
    }

    _padLine(line, inverse = false) {
        const escaped = this.term.escapeHtml(line);
        const padding = ' '.repeat(Math.max(0, this.termCols - line.length));
        if (inverse) {
            return `<span style="background-color: var(--terminal-foreground-color); color: var(--terminal-background-color);">${escaped}${padding}</span>`;
        }
        return escaped + padding;
    }

    _handleScrolling() {
        const editorHeight = this.termRows - 3;
        if (this.cursorY < this.topRow) this.topRow = this.cursorY;
        if (this.cursorY >= this.topRow + editorHeight) this.topRow = this.cursorY - editorHeight + 1;
    }

    _validateCursor() {
        this.cursorY = Math.max(0, Math.min(this.lines.length - 1, this.cursorY));
        const lineLength = this.lines[this.cursorY].length;
        const allowEnd = (this.mode === 'insert' || this.mode === 'command' || this.mode === 'search');
        const maxX = allowEnd ? lineLength : Math.max(0, lineLength - 1);
        this.cursorX = Math.max(0, Math.min(maxX, this.cursorX));
    }

    _guardReadOnly() {
        if (this.isReadOnly) {
            this.status = t('nanoStatusReadOnly');
            return true;
        }
        return false;
    }

    // --- 扁平化辅助：把多行文本视为以 \n 连接的一整段，方便做跨行的 word 动作 ---
    _flatten() {
        let text = '';
        const lineStarts = [];
        for (let i = 0; i < this.lines.length; i++) {
            lineStarts.push(text.length);
            text += this.lines[i];
            if (i < this.lines.length - 1) text += '\n';
        }
        return { text, lineStarts };
    }

    _posToFlat(y, x, lineStarts) {
        return lineStarts[y] + x;
    }

    _flatToPos(flat, lineStarts) {
        let y = 0;
        for (let i = 0; i < lineStarts.length; i++) {
            if (lineStarts[i] <= flat) y = i; else break;
        }
        return { y, x: flat - lineStarts[y] };
    }

    _charClass(ch) {
        if (ch === undefined) return 'edge';
        if (ch === '\n' || /\s/.test(ch)) return 'space';
        if (/[A-Za-z0-9_]/.test(ch)) return 'word';
        return 'punct';
    }

    _motionWordForward() {
        const { text, lineStarts } = this._flatten();
        const n = text.length;
        let i = this._posToFlat(this.cursorY, this.cursorX, lineStarts);
        if (i >= n) return { y: this.cursorY, x: this.cursorX };
        const startCls = this._charClass(text[i]);
        if (startCls !== 'space') {
            while (i < n && this._charClass(text[i]) === startCls) i++;
        }
        while (i < n && this._charClass(text[i]) === 'space') i++;
        i = Math.min(i, Math.max(0, n - 1));
        return this._flatToPos(i, lineStarts);
    }

    _motionWordEnd() {
        const { text, lineStarts } = this._flatten();
        const n = text.length;
        let i = this._posToFlat(this.cursorY, this.cursorX, lineStarts);
        i++;
        while (i < n && this._charClass(text[i]) === 'space') i++;
        if (i >= n) return this._flatToPos(Math.max(0, n - 1), lineStarts);
        const cls = this._charClass(text[i]);
        while (i + 1 < n && this._charClass(text[i + 1]) === cls) i++;
        return this._flatToPos(i, lineStarts);
    }

    _motionWordBackward() {
        const { text, lineStarts } = this._flatten();
        let i = this._posToFlat(this.cursorY, this.cursorX, lineStarts);
        i--;
        while (i >= 0 && this._charClass(text[i]) === 'space') i--;
        if (i < 0) return { y: 0, x: 0 };
        const cls = this._charClass(text[i]);
        while (i - 1 >= 0 && this._charClass(text[i - 1]) === cls) i--;
        return this._flatToPos(Math.max(0, i), lineStarts);
    }

    _moveCursor(key) {
        switch (key) {
            case 'h': case 'l': case '0': case '$': case 'w': case 'e': case 'b': {
                const target = VIM_CHARWISE_MOTIONS[key](this);
                this.cursorY = target.y;
                this.cursorX = target.x;
                this.desiredCol = this.cursorX;
                break;
            }
            case 'j': {
                this.cursorY = Math.min(this.lines.length - 1, this.cursorY + 1);
                this.cursorX = Math.min(this.desiredCol, Math.max(0, this.lines[this.cursorY].length - 1));
                break;
            }
            case 'k': {
                this.cursorY = Math.max(0, this.cursorY - 1);
                this.cursorX = Math.min(this.desiredCol, Math.max(0, this.lines[this.cursorY].length - 1));
                break;
            }
            case 'G': {
                this.cursorY = this.lines.length - 1;
                this.cursorX = 0;
                this.desiredCol = 0;
                break;
            }
            case 'gg': {
                this.cursorY = 0;
                this.cursorX = 0;
                this.desiredCol = 0;
                break;
            }
        }
    }

    _snapshotUndo() {
        this.undoStack.push({ lines: this.lines.slice(), cursorY: this.cursorY, cursorX: this.cursorX });
        if (this.undoStack.length > 200) this.undoStack.shift();
        this.redoStack = [];
    }

    _undo() {
        if (this.undoStack.length === 0) { this.status = 'Already at oldest change'; return; }
        this.redoStack.push({ lines: this.lines.slice(), cursorY: this.cursorY, cursorX: this.cursorX });
        const snap = this.undoStack.pop();
        this.lines = snap.lines;
        this.cursorY = snap.cursorY;
        this.cursorX = snap.cursorX;
        this.dirty = true;
    }

    _redo() {
        if (this.redoStack.length === 0) { this.status = 'Already at newest change'; return; }
        this.undoStack.push({ lines: this.lines.slice(), cursorY: this.cursorY, cursorX: this.cursorX });
        const snap = this.redoStack.pop();
        this.lines = snap.lines;
        this.cursorY = snap.cursorY;
        this.cursorX = snap.cursorX;
        this.dirty = true;
    }

    _applyOperatorMotion(op, motionKey, sameLine = false) {
        const startY = this.cursorY, startX = this.cursorX;
        const linewise = sameLine || motionKey === 'j' || motionKey === 'k' || motionKey === 'G' || motionKey === 'gg';

        if (linewise) {
            let targetY = startY;
            if (sameLine) targetY = startY;
            else if (motionKey === 'j') targetY = Math.min(this.lines.length - 1, startY + 1);
            else if (motionKey === 'k') targetY = Math.max(0, startY - 1);
            else if (motionKey === 'G') targetY = this.lines.length - 1;
            else targetY = 0; // gg

            const y1 = Math.min(startY, targetY), y2 = Math.max(startY, targetY);

            if (op === 'y') {
                editorClipboard = { type: 'line', text: this.lines.slice(y1, y2 + 1).join('\n') + '\n' };
                this.cursorY = y1;
                this.cursorX = 0;
            } else {
                this._snapshotUndo();
                const removed = this.lines.splice(y1, y2 - y1 + 1);
                editorClipboard = { type: 'line', text: removed.join('\n') + '\n' };
                if (this.lines.length === 0) this.lines.push('');
                this.cursorY = Math.min(y1, this.lines.length - 1);
                this.cursorX = 0;
                this.dirty = true;
                if (op === 'c') {
                    this.lines.splice(this.cursorY, 0, '');
                    this.mode = 'insert';
                } else {
                    this.mode = 'normal';
                }
            }
            this.pendingOperator = null;
            return;
        }

        const motionFn = VIM_CHARWISE_MOTIONS[motionKey];
        if (!motionFn) { this.pendingOperator = null; return; }
        const target = motionFn(this);

        const { text, lineStarts } = this._flatten();
        const a = this._posToFlat(startY, startX, lineStarts);
        const b = this._posToFlat(target.y, target.x, lineStarts);
        const inclusive = (motionKey === '$' || motionKey === 'e');
        let lo = Math.min(a, b), hi = Math.max(a, b);
        if (inclusive) hi = Math.min(text.length, hi + 1);

        if (hi <= lo) { this.pendingOperator = null; return; }

        const slice = text.slice(lo, hi);
        const pos = this._flatToPos(lo, lineStarts);

        if (op === 'y') {
            editorClipboard = { type: 'char', text: slice };
            this.cursorY = pos.y;
            this.cursorX = pos.x;
        } else {
            this._snapshotUndo();
            editorClipboard = { type: 'char', text: slice };
            const newText = text.slice(0, lo) + text.slice(hi);
            this.lines = newText.split('\n');
            this.cursorY = pos.y;
            this.cursorX = pos.x;
            this.dirty = true;
            this.mode = (op === 'c') ? 'insert' : 'normal';
        }
        this.pendingOperator = null;
    }

    _deleteCharUnderCursor() {
        const line = this.lines[this.cursorY];
        if (line.length === 0) return;
        this._snapshotUndo();
        editorClipboard = { type: 'char', text: line[this.cursorX] || '' };
        this.lines[this.cursorY] = line.substring(0, this.cursorX) + line.substring(this.cursorX + 1);
        this.cursorX = Math.min(this.cursorX, Math.max(0, this.lines[this.cursorY].length - 1));
        this.dirty = true;
    }

    _deleteToEndOfLine() {
        const line = this.lines[this.cursorY];
        editorClipboard = { type: 'char', text: line.substring(this.cursorX) };
        this.lines[this.cursorY] = line.substring(0, this.cursorX);
        this.cursorX = this.lines[this.cursorY].length;
        this.dirty = true;
    }

    _enterInsert(key) {
        this._snapshotUndo();
        switch (key) {
            case 'i': break;
            case 'I': this.cursorX = 0; break;
            case 'a': this.cursorX = Math.min(this.lines[this.cursorY].length, this.cursorX + 1); break;
            case 'A': this.cursorX = this.lines[this.cursorY].length; break;
            case 'o':
                this.lines.splice(this.cursorY + 1, 0, '');
                this.cursorY++;
                this.cursorX = 0;
                this.dirty = true;
                break;
            case 'O':
                this.lines.splice(this.cursorY, 0, '');
                this.cursorX = 0;
                this.dirty = true;
                break;
        }
        this.mode = 'insert';
    }

    _put(before) {
        if (!editorClipboard) return;
        if (this._guardReadOnly()) return;
        this._snapshotUndo();
        this.dirty = true;

        if (editorClipboard.type === 'line') {
            const linesToInsert = editorClipboard.text.replace(/\n$/, '').split('\n');
            const insertAt = before ? this.cursorY : this.cursorY + 1;
            this.lines.splice(insertAt, 0, ...linesToInsert);
            this.cursorY = insertAt;
            this.cursorX = 0;
        } else {
            const line = this.lines[this.cursorY];
            const insertCol = before ? this.cursorX : Math.min(line.length, this.cursorX + 1);
            const text = editorClipboard.text;
            if (text.includes('\n')) {
                const parts = text.split('\n');
                const pre = line.substring(0, insertCol);
                const post = line.substring(insertCol);
                this.lines[this.cursorY] = pre + parts[0];
                const middle = parts.slice(1, -1);
                this.lines.splice(this.cursorY + 1, 0, ...middle, parts[parts.length - 1] + post);
                this.cursorY += parts.length - 1;
                this.cursorX = 0;
            } else {
                this.lines[this.cursorY] = line.substring(0, insertCol) + text + line.substring(insertCol);
                this.cursorX = Math.max(0, insertCol + text.length - 1);
            }
        }
    }

    _visualRange() {
        const a = { y: this.visualAnchor.y, x: this.visualAnchor.x };
        const b = { y: this.cursorY, x: this.cursorX };
        if (a.y < b.y || (a.y === b.y && a.x <= b.x)) return { start: a, end: b };
        return { start: b, end: a };
    }

    _applyVisualAction(op) {
        if (this.mode === 'visual-line') {
            const y1 = Math.min(this.visualAnchor.y, this.cursorY);
            const y2 = Math.max(this.visualAnchor.y, this.cursorY);
            if (op === 'y') {
                editorClipboard = { type: 'line', text: this.lines.slice(y1, y2 + 1).join('\n') + '\n' };
                this.cursorY = y1;
                this.cursorX = 0;
            } else {
                this._snapshotUndo();
                const removed = this.lines.splice(y1, y2 - y1 + 1);
                editorClipboard = { type: 'line', text: removed.join('\n') + '\n' };
                if (this.lines.length === 0) this.lines.push('');
                this.cursorY = Math.min(y1, this.lines.length - 1);
                this.cursorX = 0;
                this.dirty = true;
            }
        } else {
            const { start, end } = this._visualRange();
            const { text, lineStarts } = this._flatten();
            const lo = this._posToFlat(start.y, start.x, lineStarts);
            const hi = Math.min(text.length, this._posToFlat(end.y, end.x, lineStarts) + 1);
            const slice = text.slice(lo, hi);
            const pos = this._flatToPos(lo, lineStarts);
            if (op === 'y') {
                editorClipboard = { type: 'char', text: slice };
            } else {
                this._snapshotUndo();
                editorClipboard = { type: 'char', text: slice };
                const newText = text.slice(0, lo) + text.slice(hi);
                this.lines = newText.split('\n');
                this.dirty = true;
            }
            this.cursorY = pos.y;
            this.cursorX = pos.x;
        }
        this.mode = 'normal';
        this.visualAnchor = null;
    }

    _selectionRangeForLine(lineIndex) {
        if (this.mode !== 'visual' && this.mode !== 'visual-line') return null;
        if (!this.visualAnchor) return null;
        const { start, end } = this._visualRange();
        if (lineIndex < start.y || lineIndex > end.y) return null;
        const line = this.lines[lineIndex] || '';
        if (this.mode === 'visual-line') {
            return { start: 0, end: line.length };
        }
        const s = (lineIndex === start.y) ? start.x : 0;
        const e = (lineIndex === end.y) ? end.x + 1 : line.length;
        return { start: Math.max(0, s), end: Math.min(line.length, Math.max(s, e)) };
    }

    _renderEditorLine(lineIndex) {
        const line = this.lines[lineIndex] || '';
        const isCursorLine = (lineIndex === this.cursorY);
        const sel = this._selectionRangeForLine(lineIndex);

        const points = new Set([0, line.length]);
        if (sel) { points.add(sel.start); points.add(sel.end); }
        if (isCursorLine) { points.add(this.cursorX); points.add(Math.min(line.length, this.cursorX + 1)); }
        const sorted = Array.from(points).filter(p => p >= 0 && p <= line.length).sort((a, b) => a - b);

        let html = '';
        for (let i = 0; i < sorted.length - 1; i++) {
            const segStart = sorted[i], segEnd = sorted[i + 1];
            if (segStart === segEnd) continue;
            const segText = line.substring(segStart, segEnd);
            const isCursorChar = isCursorLine && segStart === this.cursorX && segEnd === Math.min(line.length, this.cursorX + 1) && this.cursorX < line.length;
            const isSelected = !!sel && segStart >= sel.start && segEnd <= sel.end && sel.end > sel.start;
            const escaped = this.term.escapeHtml(segText);
            if (isCursorChar) {
                html += `<span class="term-cursor">${escaped}</span>`;
            } else if (isSelected) {
                html += `<span style="background-color: var(--terminal-selection-background); color: var(--terminal-selection-foreground);">${escaped}</span>`;
            } else {
                html += escaped;
            }
        }

        let visibleLength = line.length;
        if (isCursorLine && this.cursorX >= line.length) {
            html += `<span class="term-cursor"> </span>`;
            visibleLength += 1;
        }

        const padding = ' '.repeat(Math.max(0, this.termCols - visibleLength));
        return html + padding;
    }

    _render() {
        this.term._initBuffer();

        const roText = this.isReadOnly ? ` ${t('nanoReadOnly')}` : '';
        const topBar = `"${this.filePath}"${this.dirty ? ' [+]' : ''}${roText}`;
        this.term.buffer[0] = this._padLine(topBar, true);

        const editorHeight = this.termRows - 3;
        for (let y = 0; y < editorHeight; y++) {
            const lineIndex = this.topRow + y;
            if (lineIndex < this.lines.length) {
                this.term.buffer[y + 1] = this._renderEditorLine(lineIndex);
            } else {
                this.term.buffer[y + 1] = this._padLine("~");
            }
        }

        const modeLabel = { insert: '-- INSERT --', visual: '-- VISUAL --', 'visual-line': '-- VISUAL LINE --' }[this.mode];
        let bottomBar1;
        if (this.mode === 'command') bottomBar1 = ':' + this.commandBuffer;
        else if (this.mode === 'search') bottomBar1 = '/' + this.commandBuffer;
        else bottomBar1 = modeLabel || ':w write  :q quit  v/V visual  /search  u undo';
        this.term.buffer[this.termRows - 2] = this._padLine(bottomBar1, true);
        this.term.buffer[this.termRows - 1] = this._padLine(this.status, true);

        this.term._render();
    }

    _handleInsertKey(e) {
        if (e.key === 'Escape') {
            this.mode = 'normal';
            if (this.cursorX > 0) this.cursorX--;
            return;
        }
        switch (e.key) {
            case 'Backspace':
                if (this.cursorX > 0) {
                    const line = this.lines[this.cursorY];
                    this.lines[this.cursorY] = line.substring(0, this.cursorX - 1) + line.substring(this.cursorX);
                    this.cursorX--;
                    this.dirty = true;
                } else if (this.cursorY > 0) {
                    const line = this.lines[this.cursorY];
                    const prevLine = this.lines[this.cursorY - 1];
                    this.cursorX = prevLine.length;
                    this.lines[this.cursorY - 1] = prevLine + line;
                    this.lines.splice(this.cursorY, 1);
                    this.cursorY--;
                    this.dirty = true;
                }
                break;
            case 'Enter': {
                const line = this.lines[this.cursorY];
                const before = line.substring(0, this.cursorX);
                const after = line.substring(this.cursorX);
                this.lines[this.cursorY] = before;
                this.lines.splice(this.cursorY + 1, 0, after);
                this.cursorY++;
                this.cursorX = 0;
                this.dirty = true;
                break;
            }
            case 'Tab':
                break;
            default:
                if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
                    const line = this.lines[this.cursorY];
                    this.lines[this.cursorY] = line.substring(0, this.cursorX) + e.key + line.substring(this.cursorX);
                    this.cursorX++;
                    this.dirty = true;
                }
                break;
        }
    }

    async _handleCommandKey(e) {
        if (e.key === 'Escape') {
            this.mode = 'normal';
            this.commandBuffer = '';
            return;
        }
        if (e.key === 'Enter') {
            const cmd = this.commandBuffer;
            const wasSearch = (this.mode === 'search');
            this.mode = 'normal';
            this.commandBuffer = '';
            if (wasSearch) {
                this._executeSearch(cmd, 1);
            } else {
                await this._executeExCommand(cmd);
            }
            return;
        }
        if (e.key === 'Backspace') {
            this.commandBuffer = this.commandBuffer.slice(0, -1);
            return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            this.commandBuffer += e.key;
        }
    }

    async _executeExCommand(cmd) {
        cmd = cmd.trim();
        if (cmd === 'w') {
            if (this._guardReadOnly()) return;
            await this._save();
        } else if (cmd === 'q') {
            if (this.dirty) { this.status = 'No write since last change (use :q! to override)'; return; }
            this._quit = true;
            this.term.exitFullScreenApp();
            this.onExit();
        } else if (cmd === 'q!') {
            this._quit = true;
            this.term.exitFullScreenApp();
            this.onExit();
        } else if (cmd === 'wq' || cmd === 'x') {
            if (this._guardReadOnly()) return;
            await this._save();
            this._quit = true;
            this.term.exitFullScreenApp();
            this.onExit();
        } else if (/^\d+$/.test(cmd)) {
            const n = parseInt(cmd, 10);
            this.cursorY = Math.max(0, Math.min(this.lines.length - 1, n - 1));
            this.cursorX = 0;
        } else if (cmd === '') {
            // no-op
        } else {
            this.status = `E492: Not an editor command: ${cmd}`;
        }
    }

    _executeSearch(newTerm, dir) {
        if (newTerm) { this.searchTerm = newTerm; this.searchDirection = 1; dir = 1; }
        if (!this.searchTerm) return;
        this.searchDirection = dir;
        const n = this.lines.length;
        for (let step = 1; step <= n; step++) {
            const y = ((this.cursorY + dir * step) % n + n) % n;
            const idx = this.lines[y].indexOf(this.searchTerm);
            if (idx !== -1) {
                this.cursorY = y;
                this.cursorX = idx;
                return;
            }
        }
        this.status = `E486: Pattern not found: ${this.searchTerm}`;
    }

    _handleNormalOrVisualKey(e) {
        const key = e.key;
        const inVisual = (this.mode === 'visual' || this.mode === 'visual-line');

        if (e.ctrlKey) {
            if (key.toLowerCase() === 'r') this._redo();
            return;
        }

        if (key === 'Escape') {
            if (inVisual) { this.mode = 'normal'; this.visualAnchor = null; }
            this.pendingOperator = null;
            this.pendingKey = null;
            return;
        }

        if (this.pendingKey === 'g') {
            this.pendingKey = null;
            if (key === 'g') {
                if (this.pendingOperator) {
                    if (this.pendingOperator !== 'y' && this._guardReadOnly()) { this.pendingOperator = null; return; }
                    this._applyOperatorMotion(this.pendingOperator, 'gg');
                } else {
                    this._moveCursor('gg');
                }
            }
            return;
        }

        if (this.pendingOperator) {
            const op = this.pendingOperator;
            if (key === 'd' || key === 'c' || key === 'y') {
                if (key === op) {
                    if (op !== 'y' && this._guardReadOnly()) { this.pendingOperator = null; return; }
                    this._applyOperatorMotion(op, null, true);
                    return;
                }
                this.pendingOperator = null;
                return;
            }
            if (key === 'g') { this.pendingKey = 'g'; return; }
            if (['h', 'l', '0', '$', 'w', 'e', 'b', 'j', 'k', 'G'].includes(key)) {
                if (op !== 'y' && this._guardReadOnly()) { this.pendingOperator = null; return; }
                this._applyOperatorMotion(op, key);
                return;
            }
            this.pendingOperator = null;
            return;
        }

        if (inVisual) {
            if (key === 'y') { this._applyVisualAction('y'); return; }
            if (key === 'd' || key === 'x') {
                if (this._guardReadOnly()) return;
                this._applyVisualAction('d');
                return;
            }
            if (key === 'v') { this.mode = (this.mode === 'visual') ? 'normal' : 'visual'; if (this.mode === 'normal') this.visualAnchor = null; return; }
            if (key === 'V') { this.mode = (this.mode === 'visual-line') ? 'normal' : 'visual-line'; if (this.mode === 'normal') this.visualAnchor = null; return; }
            if (key === 'g') { this.pendingKey = 'g'; return; }
            if (['h', 'l', 'j', 'k', '0', '$', 'w', 'e', 'b', 'G'].includes(key)) {
                this._moveCursor(key);
                return;
            }
            return;
        }

        switch (key) {
            case 'h': case 'l': case 'j': case 'k': case '0': case '$': case 'w': case 'e': case 'b': case 'G':
                this._moveCursor(key);
                return;
            case 'g':
                this.pendingKey = 'g';
                return;
            case 'v':
                this.mode = 'visual';
                this.visualAnchor = { y: this.cursorY, x: this.cursorX };
                return;
            case 'V':
                this.mode = 'visual-line';
                this.visualAnchor = { y: this.cursorY, x: this.cursorX };
                return;
            case 'd': case 'c': case 'y':
                this.pendingOperator = key;
                return;
            case 'x':
                if (this._guardReadOnly()) return;
                this._deleteCharUnderCursor();
                return;
            case 'D':
                if (this._guardReadOnly()) return;
                this._snapshotUndo();
                this._deleteToEndOfLine();
                return;
            case 'C':
                if (this._guardReadOnly()) return;
                this._snapshotUndo();
                this._deleteToEndOfLine();
                this.mode = 'insert';
                return;
            case 'Y':
                this._applyOperatorMotion('y', null, true);
                return;
            case 'p':
                this._put(false);
                return;
            case 'P':
                this._put(true);
                return;
            case 'i': case 'I': case 'a': case 'A': case 'o': case 'O':
                if (this._guardReadOnly()) return;
                this._enterInsert(key);
                return;
            case 'u':
                this._undo();
                return;
            case ':':
                this.mode = 'command';
                this.commandBuffer = '';
                return;
            case '/':
                this.mode = 'search';
                this.commandBuffer = '';
                return;
            case 'n':
                this._executeSearch(null, this.searchDirection || 1);
                return;
            case 'N':
                this._executeSearch(null, -(this.searchDirection || 1));
                return;
            default:
                return;
        }
    }

    async handleKeydown(e) {
        e.preventDefault();
        e.stopPropagation();
        this.status = "";
        this._quit = false;

        if (this.mode === 'insert') {
            this._handleInsertKey(e);
        } else if (this.mode === 'command' || this.mode === 'search') {
            await this._handleCommandKey(e);
        } else {
            this._handleNormalOrVisualKey(e);
        }

        if (this._quit) return;

        this._validateCursor();
        this._handleScrolling();
        this._render();
    }

    async _save() {
        this.status = "Saving...";
        try {
            const content = this.lines.join('\n');
            const success = this.onSave(this.filePath, content);
            if (success) {
                this.dirty = false;
                this.status = t('nanoStatusSaved').replace('{0}', content.length);
            } else {
                if (this.status === "Saving...") {
                    this.status = t('nanoStatusSaveError');
                }
            }
        } catch (e) {
            this.status = `Error saving: ${e.message}`;
        }
    }
}

/**
 * nano/vim 共用的文件打开逻辑：路径解析、权限检查、VFS/书签内容加载、
 * 保存回写（.startrc、/bin/ 脚本、普通书签、新建文件）。
 * 只有 cmdName（错误提示前缀）和 EditorClass（NanoEditor / VimEditor）不同。
 */
function openFileEditor(cmdName, EditorClass, args) {
    let path = args[0];
    if (!path) {
        term.writeLine(`${cmdName}: File name not specified.`);
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

            // 检查权限
            if (!hasPermission(node, 'r')) {
                term.writeHtml(`<span class="term-error">${cmdName}: ${resolvedPath}: ${t('permissionDenied')}</span>`);
                resolve();
                return;
            }

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
                term.writeLine(`${cmdName}: ${resolvedPath} is a directory.`);
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
                        term.writeHtml(`<span class="term-error">Error: ${t('permissionDenied')}</span>`);
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
                        term.writeHtml(`<span class="term-error">${cmdName}: Invalid path.</span>`);
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
                            term.writeHtml(`<span class="term-error">${cmdName}: Invalid path.</span>`);
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
                                term.writeHtml(`<span class="term-error">${cmdName}: Parent directory not writable.</span>`);
                                return false;
                            }
                            // 4. 创建书签
                            await new Promise(resolveCreate => {
                                chrome.bookmarks.create({
                                    parentId: parentResult.node.id,
                                    title: newFileName,
                                    url: savedContent // 内容作为 URL 保存
                                }, resolveCreate);
                            });
                        } else {
                            term.writeHtml(`<span class="term-error">${cmdName}: Directory not found: ${parentPath}</span>`);
                            return false;
                        }
                    }
                }
                return true;
            } catch (e) {
                console.error(`${cmdName} save error:`, e);
                return false; // [!!] 5. 返回 false
            }
        };

        const onExit = () => {
            resolve();
        };

        const editor = new EditorClass(term, resolvedPath, content, onSave, onExit, isReadOnly);
        editor.open();
    });
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
                
                // 简单的参数处理
                if (args[0] && !args[0].startsWith('-')) {
                    targetPath = args[0];
                }

                const result = this._findNodeByPath(targetPath);
                if (result && result.node && result.node.children) {
                    targetNode = result.node;
                } else if (result && result.node) {
                    // [修改] 使用 writeError
                    this.term.writeError(`ls: ${targetPath}: Not a directory`);
                    return;
                } else {
                    // [修改] 使用 writeError
                    this.term.writeError(`ls: ${targetPath}: No such directory`);
                    return;
                }

                let children = targetNode.children || [];
                if (!options.a) { 
                    children = children.filter(child => !child.title.startsWith('.'));
                }
                
                if (options.l) {
                    // 准备数据并计算列宽
                    let maxLinkLen = 0;
                    let maxOwnerLen = 0;
                    let maxGroupLen = 0;
                    let maxSizeLen = 0;

                    const rows = children.map(child => {
                        const meta = getMetadata(child); // 现在 getMetadata 会直接读到我们注入的 owner
                        const isDir = !!child.children;
                        
                        const modeStr = formatMode(meta.mode, isDir);
                        const links = "1"; // 硬编码
                        const owner = meta.owner || 'user'; // 如果注入失败，回退到 user
                        const group = meta.group || 'user';
                        const size = "0"; // 书签没有大小
                        const date = new Date(child.dateAdded || Date.now()).toLocaleDateString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                        
                        // 名字处理
                        let name = child.title.trim();
                        if (name.includes(' ')) name = `"${name}"`; 
                        const nameHtml = isDir ? `<span class="term-folder">${this.term.escapeHtml(name)}/</span>` : this.term.escapeHtml(name);

                        // 更新最大宽度
                        if (links.length > maxLinkLen) maxLinkLen = links.length;
                        if (owner.length > maxOwnerLen) maxOwnerLen = owner.length;
                        if (group.length > maxGroupLen) maxGroupLen = group.length;
                        if (size.length > maxSizeLen) maxSizeLen = size.length;

                        return { modeStr, links, owner, group, size, date, nameHtml };
                    });

                    // 输出对齐后的行
                    for (const row of rows) {
                        const linksPad = row.links.padStart(maxLinkLen);
                        const ownerPad = row.owner.padEnd(maxOwnerLen);
                        const groupPad = row.group.padEnd(maxGroupLen);
                        const sizePad  = row.size.padStart(maxSizeLen);

                        // 格式: mode links owner group size date name
                        this.term.writeHtml(`${row.modeStr} ${linksPad} ${ownerPad} ${groupPad} ${sizePad} ${row.date} ${row.nameHtml}`);
                    }
                } else {
                    if (children.length === 0) return;

                    // --- [LS Grid 逻辑升级] ---

                    // 1. 数据准备：计算显示名称和视觉长度
                    const formattedItems = children.map(child => {
                        let rawTitle = child.title.trim();
                        const isDir = !!child.children;
                        
                        // [核心修改]：如果有空格，用双引号包裹，而不是 escapePath
                        let textToShow = rawTitle;
                        if (textToShow.includes(' ')) {
                            textToShow = `"${textToShow}"`;
                        }
                        
                        // 拼接后缀用于计算长度 (Dir 加 /)
                        // 注意：通常引号不包裹 /，即 "My Folder"/
                        let fullDisplayText = textToShow + (isDir ? '/' : '');

                        // 计算视觉长度
                        const visualLen = getVisualLength(fullDisplayText);

                        // 生成 HTML
                        let html = this.term.escapeHtml(textToShow);
                        
                        if (isDir) {
                            html = `<span class="term-folder">${html}/</span>`;
                        }
                        
                        return { html, visualLen };
                    });

                    // 2. 计算列宽 (Grid Calculation)
                    let maxNameWidth = 0;
                    formattedItems.forEach(item => { 
                        if (item.visualLen > maxNameWidth) maxNameWidth = item.visualLen; 
                    });

                    const colPadding = 2; 
                    const colWidth = maxNameWidth + colPadding;
                    const termWidth = this.term.cols;
                    
                    let numCols = Math.floor(termWidth / colWidth);
                    if (numCols < 1) numCols = 1;

                    const numRows = Math.ceil(formattedItems.length / numCols);

                    // 3. 渲染行 (Grid Rendering)
                    for (let y = 0; y < numRows; y++) {
                        let currentLineStr = "";
                        let currentVisualPos = 0;

                        for (let x = 0; x < numCols; x++) {
                            const index = y + (x * numRows); // 列优先排序 (ls 默认习惯)
                            
                            // 计算当前单元格的目标结束位置
                            const isLastCol = (x === numCols - 1);
                            const targetPos = isLastCol ? termWidth : (x + 1) * colWidth;

                            if (index < formattedItems.length) {
                                const item = formattedItems[index];
                                
                                // 计算填充
                                const paddingLen = Math.max(0, targetPos - (currentVisualPos + item.visualLen));
                                const padding = ' '.repeat(paddingLen);
                                
                                currentLineStr += item.html + padding;
                            } else {
                                // 空白单元格
                                const paddingLen = Math.max(0, targetPos - currentVisualPos);
                                currentLineStr += ' '.repeat(paddingLen);
                            }
                            currentVisualPos = targetPos;
                        }
                        
                        // 强制填满行尾，防止背景断裂 (如果有背景色的话)
                        if (currentVisualPos < termWidth) {
                            currentLineStr += ' '.repeat(termWidth - currentVisualPos);
                        }

                        this.term.writeHtml(currentLineStr);
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
                        this.term.writeHtml(`<span class="term-error">mkdir: ${parentPath}: ${t('permissionDenied')}</span>`);
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
                        this.term.writeHtml(`<span class="term-error">rmdir: ${path}: ${t('permissionDenied')}</span>`);
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
                    term.writeHtml(`<span class="term-error">${t('missingOperand')}</span>`);
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
                            term.writeHtml(`<span class="term-error">rm: ${t('cannotRemove').replace('{0}', target.title)}: ${t('permissionDenied')}</span>`);
                            continue; // 跳过这个文件
                        }
                        
                        // VFS 'rm' 逻辑
                        if (target.id.startsWith('vfs-bin-')) {
                            deleteVfsScript(target.title);
                            this.vfsBin.children = this.vfsBin.children.filter(c => c.id !== target.id);
                            term.writeLine(t('rmVfsSuccess').replace('{0}', target.title));
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
                let destPath = args[1];

                const sourceResult = this._findNodeByPath(sourcePath); //
                if (!sourceResult || !sourceResult.node) {
                    term.writeHtml(`<span class="term-error">mv: ${t('noSuchFileOrDir')}: ${sourcePath}</span>`); return;
                }
                const sourceNode = sourceResult.node;

                // 1. 检查源权限
                if (!hasPermission(sourceNode, 'w')) { //
                    term.writeHtml(`<span class="term-error">mv: cannot move '${sourcePath}': ${t('permissionDenied')}</span>`); return;
                }

                // 2. 查找目标
                const destResult = this._findNodeByPath(destPath);
                let destNode = destResult ? destResult.node : null;
                
                // --- Case A: VFS 脚本重命名 (仅 /bin) ---
                if (sourceNode.id.startsWith('vfs-bin-')) {
                    const newName = destPath.split('/').pop();
                    const isAbsolutePath = destPath.startsWith('/bin/');
                    const isRelativeRename = (!destPath.includes('/') && this.current.id === 'vfs-bin');
                    if ((isAbsolutePath || isRelativeRename) && !destNode) {
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
                    // --- 目标不存在: 移动并重命名 ---
                    
                    // 1. 在解析路径之前，先修剪目标路径末尾的 /
                    if (destPath.endsWith('/') && destPath.length > 1) {
                        destPath = destPath.slice(0, -1);
                    }

                    // 2. 现在安全地检查 /
                    const lastSlash = destPath.lastIndexOf('/');
                    
                    if (lastSlash > -1) {
                        // --- Case 2a: 目标是*新路径* (e.g., mv file /bin/newfile) ---
                        const parentPath = destPath.substring(0, lastSlash) || '/';
                        const newTitle = destPath.substring(lastSlash + 1);
                        
                        const parentResult = this._findNodeByPath(parentPath);
                        if (parentResult && parentResult.node && parentResult.node.children) {
                            destParentNode = parentResult.node;
                            destTitle = newTitle;
                        } else {
                            term.writeHtml(`<span class="term-error">mv: destination path not found: ${parentPath}</span>`); return;
                        }
                    } else {
                        // --- Case 2b: 目标是*重命名* (e.g., mv file1 "new name") ---
                        destParentNode = this.current; // 父目录是当前目录
                        destTitle = destPath; // 目标路径 (L1156) 就是新标题
                    }
                } else {
                    term.writeHtml(`<span class="term-error">mv: destination is not a directory: ${destPath}</span>`); return;
                }
                
                if (destParentNode) {
                    // 检查目标父目录权限
                    if (!hasPermission(destParentNode, 'w')) {
                         term.writeHtml(`<span class="term-error">mv: cannot write to destination: ${t('permissionDenied')}</span>`); return;
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
                        term.writeHtml(`<span class="term-error">touch: cannot touch '${path}': ${t('permissionDenied')}</span>`);
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
                let destPath = args[1];

                const sourceResult = this._findNodeByPath(sourcePath); //
                if (!sourceResult || !sourceResult.node) {
                    term.writeHtml(`<span class="term-error">cp: ${t('noSuchFileOrDir')}: ${sourcePath}</span>`); return;
                }
                const sourceNode = sourceResult.node;
                
                // 1. 检查源 'r' 权限
                if (!hasPermission(sourceNode, 'r')) { //
                    term.writeHtml(`<span class="term-error">cp: cannot read '${sourcePath}': ${t('permissionDenied')}</span>`); return;
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
                    // --- Case 2: cp file newfile (目标是新路径) ---
                    
                    // 1. 在解析路径之前，先修剪目标路径末尾的 /
                    if (destPath.endsWith('/') && destPath.length > 1) {
                        destPath = destPath.slice(0, -1);
                    }

                    // 2. 现在安全地检查 /
                    const lastSlash = destPath.lastIndexOf('/');
                    
                    if (lastSlash > -1) {
                        // --- Case 2a: 目标是*新路径* (e.g., cp file /bin/newfile) ---
                        const parentPath = destPath.substring(0, lastSlash) || '/';
                        newName = destPath.substring(lastSlash + 1); // newName 在 L1188 已被定义
                        
                        const parentResult = this._findNodeByPath(parentPath);
                        if (parentResult && parentResult.node && parentResult.node.children) {
                            destParentNode = parentResult.node;
                        }
                    } else {
                        // --- Case 2b: 目标是*重命名* (e.g., cp file1 "new file") ---
                        destParentNode = this.current; //
                        newName = destPath; // 目标路径 (L1179) 就是新标题
                    }
                }
                
                if (!destParentNode) {
                    term.writeHtml(`<span class="term-error">cp: invalid destination: ${destPath}</span>`); return;
                }
                
                // 3. 检查目标 'w' 权限 (直接使用节点)
                if (!hasPermission(destParentNode, 'w')) {
                    term.writeHtml(`<span class="term-error">cp: cannot write to '${destPath}': ${t('permissionDenied')}</span>`); return;
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

            // 预加载数据，注入到书签节点中
            const metadataStore = JSON.parse(localStorage.getItem('vfs_metadata') || '{}');
            this._injectMetadata(this.root, metadataStore);

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

    _injectMetadata(node, metadataStore) {
        if (!node) return;

        // 如果该节点在 metadataStore 中有记录，直接覆盖属性
        if (metadataStore[node.id]) {
            const meta = metadataStore[node.id];
            node.mode = meta.mode;
            node.owner = meta.owner;
            node.group = meta.group;
        }

        if (node.children) {
            node.children.forEach(child => this._injectMetadata(child, metadataStore));
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

        if (pathStr.endsWith('/') && pathStr.length > 1) {
            pathStr = pathStr.slice(0, -1);
        }

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
#
# --- Completion Style ---
export COMPLETION_STYLE="bash"
#
# --- Colors (optional; overrides the active theme) ---
# export STDOUT_COLOR="#d4d4d4"
# export STDERR_COLOR="#ff5555"
# export ANNOUNCE_INFO_COLOR="#26c6da"
# export ANNOUNCE_WARNING_COLOR="#f1c40f"
# export ANNOUNCE_MAINTENANCE_COLOR="#bd93f9"
# export ANNOUNCE_DANGER_COLOR="#ff5555"
#
# --- Aliases ---
alias ll='ls -l -a'
alias la='ls -a'
welcome
`

/**
 * 解析 .startrc 内容并更新 Environment 对象
 * @param {string} content - .startrc 文件内容
 */
// .startrc 中可以 export 的颜色变量，直接映射到对应的 CSS 自定义属性。
// 由于 .startrc 在 main() 中于 loadStyleSettings()（主题 + style 命令覆盖）之后解析，
// 这里设置的值会自然覆盖当前主题和 style 命令的覆盖层，无需调整启动顺序。
const STARTRC_COLOR_VARS = {
    STDOUT_COLOR: '--terminal-stdout-color',
    STDERR_COLOR: '--terminal-stderr-color',
    ANNOUNCE_INFO_COLOR: '--announcement-info',
    ANNOUNCE_WARNING_COLOR: '--announcement-warning',
    ANNOUNCE_MAINTENANCE_COLOR: '--announcement-maintenance',
    ANNOUNCE_DANGER_COLOR: '--announcement-danger',
};

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

            if (STARTRC_COLOR_VARS[key]) {
                document.documentElement.style.setProperty(STARTRC_COLOR_VARS[key], value);
            }
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
 * 查找一组匹配项的最长公共前缀 (LCP)
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
 * 比较两个匹配数组是否相同
 */
function arraysAreEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i].id !== arr2[i].id) return false; // 按书签 ID 比较
    }
    return true;
}

/**
 * 获取搜索建议 (历史记录 + 书签)
 * @param {string} query - 用户输入的片段
 */
async function getSearchSuggestions(query) {
    if (!query || query.length < 1) return [];
    
    // 如果没有 Chrome API，返回空
    if (typeof chrome === 'undefined' || !chrome.history) return [];

    const suggestions = [];

    // 1. 搜索历史记录 (限制 10 条，按相关性排序)
    // text: query 会自动进行模糊搜索
    const historyItems = await new Promise(resolve => {
        chrome.history.search({ text: query, maxResults: 10 }, resolve);
    });

    // 2. 搜索书签 (限制 5 条)
    const bookmarkItems = await new Promise(resolve => {
        chrome.bookmarks.search(query, resolve);
    });

    // 3. 格式化并合并
    // 我们需要 title 用于显示，url 用于补全
    historyItems.forEach(item => {
        if (item.url && item.title) {
            suggestions.push({
                title: item.title, // 显示在 Grid 里
                value: item.url,   // 补全到命令行里
                type: 'history'
            });
        }
    });

    bookmarkItems.forEach(item => {
        if (item.url && item.title) {
            suggestions.push({
                title: `★ ${item.title}`, // 书签加个星号区分
                value: item.url,
                type: 'bookmark'
            });
        }
    });

    return suggestions;
}

/**
 * Tab 补全
 */
async function handleTabCompletion(line, pos) {
    if (term.tabMenu.active) return;

    const style = (Environment['COMPLETION_STYLE'] || 'bash').toLowerCase();
    const isZshStyle = (style === 'zsh');

    const currentTime = Date.now();

    // 1. 解析 Token
    const lineUpToCursor = line.substring(0, pos);
    const tokens = lineUpToCursor.match(/(?:"[^"]*"|'[^']*'|(?:\\ |[^\s"'])+)/g) || [];
    const tokenCount = tokens.length;

    let isCompletingFirstWord = false;
    let isCompletingSubCommand = false;
    let isCompletingPath = false;
    let isCompletingSearch = false;
    let tokenToComplete = "";
    let tokenStartIndex = 0;

    if (line.endsWith(' ')) {
        tokenToComplete = "";
        tokenStartIndex = pos;
    } else if (tokenCount > 0) {
        tokenToComplete = tokens[tokens.length - 1];
        tokenStartIndex = lineUpToCursor.lastIndexOf(tokenToComplete);
    } else {
        tokenToComplete = "";
        tokenStartIndex = 0;
    }

    const rawCommand = (tokens[0] ? unescapePath(tokens[0]) : "");

    let onlyExecutables = false;

    // --- Sudo 穿透逻辑 ---
    let targetCommand = rawCommand;
    let targetTokenCount = tokenCount;

    if (rawCommand === 'sudo') {
        if (tokenCount === 1 && line.endsWith(' ')) {
            // Case 1: "sudo " -> 准备输入第二个词 -> 视为补全命令
            isCompletingFirstWord = true;
        } else if (tokenCount === 2 && !line.endsWith(' ')) {
            // Case 2: "sudo ap" -> 正在输入第二个词 -> 视为补全命令
            isCompletingFirstWord = true;
        } else if (tokenCount >= 2) {
            // Case 3: "sudo apt " (count=2, space) 或 "sudo apt up" (count=3)
            // -> 穿透 sudo，将目标指向下一个词 (apt)，并减少计数
            targetCommand = unescapePath(tokens[1]);
            targetTokenCount = tokenCount - 1;
        }
    }
    // ---------------------------

    // 2. 决定补全类型 & 准备候选列表
    let subCommandCandidates = [];

    // 注意：这里优先检查 isCompletingFirstWord (可能被 sudo 逻辑置为 true)
    if ((tokenCount === 0 || (tokenCount === 1 && !line.endsWith(' '))) && 
        (tokenToComplete.startsWith('./') || tokenToComplete.startsWith('/') || tokenToComplete.startsWith('~/'))) {
        
        isCompletingPath = true;
        isCompletingFirstWord = false; // [!] 覆盖默认判断，不再查命令列表
        onlyExecutables = true;        // [!] 开启只显示可执行文件的过滤器

    } else if (tokenCount === 0 || (tokenCount === 1 && !line.endsWith(' '))) {
        isCompletingFirstWord = true;
    } else if (targetCommand === 'search') { 
        isCompletingSearch = true;
    
    } else if (targetCommand === 'open') {
        isCompletingPath = true;
    
    } else if (subCommandCompletions.hasOwnProperty(targetCommand)) {
        // 使用 targetTokenCount 进行判断
        if (targetTokenCount === 1 || (targetTokenCount === 2 && !line.endsWith(' '))) {
            let config = subCommandCompletions[targetCommand];
            
            // 执行动态配置函数 (如 theme)
            if (typeof config === 'function') {
                config = config();
            }

            if (Array.isArray(config) && config.length > 0) {
                isCompletingSubCommand = true;
                subCommandCandidates = config;
            } else {
                isCompletingPath = true;
            }
        } else {
            isCompletingPath = true;
        }
    } else {
        isCompletingPath = true;
    }

    // 3. 获取匹配项
    let matches = [];
    let completionPrefix = ''; 
    let searchToken = unescapePath(tokenToComplete);

    if (isCompletingFirstWord) {
        const allCommands = getAllCommandNames();
        matches = allCommands.filter(cmd => cmd.startsWith(tokenToComplete)).map(cmd => ({ title: cmd, value: cmd }));
    
    } else if (isCompletingSearch) {
        if (searchToken.trim().length > 0) {
            matches = await getSearchSuggestions(searchToken);
        }
    
    } else if (isCompletingSubCommand) {
        matches = subCommandCandidates
            .filter(cmd => cmd.startsWith(tokenToComplete))
            .map(cmd => ({ title: cmd, value: cmd }));
    
    } else if (isCompletingPath) {
        const lastSlash = searchToken.lastIndexOf('/');
        if (lastSlash > -1) {
            completionPrefix = searchToken.substring(0, lastSlash + 1); 
            const partial = searchToken.substring(lastSlash + 1); 
            const result = bookmarkSystem._findNodeByPath(completionPrefix); 
            if (result && result.node && result.node.children) {
                matches = result.node.children
                    .filter(child => child.title.trim().startsWith(partial))
                    .map(child => ({ ...child, value: child.title }));
            }
        } else {
            const partial = searchToken; 
            if (bookmarkSystem.current && bookmarkSystem.current.children) {
                matches = bookmarkSystem.current.children
                    .filter(child => child.title.trim().startsWith(partial))
                    .map(child => ({ ...child, value: child.title }));
            }
        }
    }

    if (matches.length === 0) return;

    // --- 4. 补全逻辑 (保持不变) ---
    
    if (isZshStyle) {
        term.tabMenu.active = true;
        term.tabMenu.items = matches;
        term.tabMenu.selected = (matches.length === 1) ? 0 : -1;
        term.tabMenu.originalLine = line;
        term.tabMenu.tokenStart = tokenStartIndex;
        term.tabMenu.completionPrefix = isCompletingSearch ? "" : completionPrefix;

        if (term.tabMenu.selected === 0) {
             const item = matches[0];
             let newValue = item.value || item.title;
             newValue = term.escapePath(newValue);
             const prefix = term.tabMenu.completionPrefix || "";
             const newLine = line.substring(0, tokenStartIndex) + prefix + newValue;
             term.currentLine = newLine;
             term.cursorX = term.prompt.length + newLine.length;
        }
        term._renderMenu();
        return;
    } 

    if (matches.length === 1) {
        const match = matches[0];
        let matchValue = match.value || match.title; 
        matchValue = matchValue.trim();
        let completion = isCompletingSearch ? matchValue : (completionPrefix + matchValue);
        let trailingChar = ' ';
        if (match.children) { completion += '/'; trailingChar = ''; }
        completion = escapePath(completion);
        
        const textBeforeToken = line.substring(0, tokenStartIndex);
        const textAfterCursor = line.substring(pos);
        const newLine = textBeforeToken + completion + trailingChar + textAfterCursor;
        term.setCommand(newLine, (textBeforeToken + completion + trailingChar).length);
        return;
    }

    let lcp = "";
    if (!isCompletingSearch) {
        lcp = findLCP(matches.map(m => ({ title: m.value || m.title })));
    }
    const partial = isCompletingSearch ? searchToken : searchToken.substring(searchToken.lastIndexOf('/') + 1);

    if (!isCompletingSearch && lcp.length > partial.length) {
        lastTabMatches = [];
        let completion = completionPrefix + lcp;
        completion = escapePath(completion);
        const newLine = line.substring(0, tokenStartIndex) + completion + line.substring(pos);
        term.setCommand(newLine, (line.substring(0, tokenStartIndex) + completion).length);
    } else {
        const isDoubleTap = (currentTime - lastTabTime < 500);
        const currentMatchIds = matches.map(m => m.id || m.title);
        const lastMatchIds = lastTabMatches.map(m => m.id || m.title);
        
        if ((isDoubleTap && arraysAreEqual(currentMatchIds, lastMatchIds)) || isCompletingSearch) {
            const fullLineText = term.prompt + line;
            const escapedLine = term.escapeHtml(fullLineText);
            const padding = ' '.repeat(Math.max(0, term.cols - fullLineText.length));
            term.buffer[term.cursorY] = escapedLine + padding;
            term._handleNewline(); 
            
            const displayItems = matches.map(m => {
                let title = m.title.trim();
                if (title.length > 30) title = title.substring(0, 27) + "...";
                const isDir = !!m.children;
                let displayText = title;
                if (isDir) displayText += '/';
                return { 
                    text: displayText, isDir: isDir, 
                    isHistory: m.type === 'history', isBookmark: m.type === 'bookmark',
                    visualLen: getVisualLength(displayText) 
                };
            });

            let maxNameWidth = 0;
            displayItems.forEach(item => { if (item.visualLen > maxNameWidth) maxNameWidth = item.visualLen; });
            const colPadding = 2;
            const colWidth = maxNameWidth + colPadding;
            const termWidth = term.cols;
            let numCols = Math.floor(termWidth / colWidth);
            if (numCols === 0) numCols = 1;
            const numRows = Math.ceil(displayItems.length / numCols);

            for (let y = 0; y < numRows; y++) {
                let currentLineStr = "";
                for (let x = 0; x < numCols; x++) {
                    const index = y + (x * numRows);
                    if (index < displayItems.length) {
                        const item = displayItems[index];
                        const paddingLen = colWidth - item.visualLen;
                        const padding = ' '.repeat(Math.max(0, paddingLen));
                        let html = term.escapeHtml(item.text);
                        if (item.isDir) html = `<span class="term-folder">${html}</span>`;
                        else if (item.isBookmark) html = `<span style="color: #FFD700;">${html}</span>`;
                        else if (item.isHistory) html = `<span style="color: #87CEEB;">${html}</span>`;
                        currentLineStr += html + padding;
                    }
                }
                term.writeHtml(currentLineStr);
            }
            bookmarkSystem.update_user_path(); 
            term.setCommand(line, pos);
            lastTabMatches = [];
        } else {
            lastTabMatches = matches; 
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

/**
 * 语义化版本比较
 * @param {string} v1 - 远程版本 (e.g., "2.1.0")
 * @param {string} v2 - 本地版本 (e.g., "2.0.0")
 * @returns {number} 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    const len = Math.max(p1.length, p2.length);

    for (let i = 0; i < len; i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}


// ===============================================
// =           初始化和使用 Terminal         =
// ===============================================

// Helper Function 
function loadStyleSettings() {
    // 1. 加载 Theme (基准)
    const currentTheme = ThemeManager.load(); 

    // 2. 加载 Font (独立设置)
    const savedFont = localStorage.getItem('terminalFontFamily');
    const savedSize = localStorage.getItem('terminalFontSize');
    
    const rootStyle = getComputedStyle(document.documentElement);
    const defaultFont = rootStyle.getPropertyValue('--terminal-font-family').trim() || "'Consolas', 'Courier New', monospace";
    const defaultSize = rootStyle.getPropertyValue('--terminal-font-size').trim() || '14px';

    const fontFamily = savedFont || defaultFont;
    const fontSize = savedSize || defaultSize;

    document.documentElement.style.setProperty('--terminal-font-family', fontFamily);
    document.documentElement.style.setProperty('--terminal-font-size', fontSize);

    // 3. 加载 Override (覆盖层)
    // 允许用户覆盖 theme 中的具体颜色，或设置壁纸
    try {
        const overrides = JSON.parse(localStorage.getItem('style_overrides') || '{}');
        for (const [key, value] of Object.entries(overrides)) {
            // [修改点]：如果是壁纸，使用我们的新函数，而不是直接 setProperty
            if (key === '--terminal-background-image') {
                // 提取 url('...') 中的 URL
                const match = value.match(/url\(['"]?(.*?)['"]?\)/);
                if (match) {
                    setWallpaper(match[1]); // 使用渐变加载
                } else if (value === 'none') {
                    setWallpaper('none');
                }
            } else {
                document.documentElement.style.setProperty(key, value);
            }
        }
    } catch (e) {
        console.warn("Failed to load style overrides", e);
    }

    return { fontFamily, fontSize, theme: currentTheme };
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
    'ext': async (args, options) => {
        // 1. 动态权限检查与请求
        const hasPerm = await new Promise(r => chrome.permissions.contains({ permissions: ['management'] }, r));

        if (!hasPerm) {
            term.writeLine("This command requires 'management' permission to manage extensions.");
            
            // 必须在用户操作（如按回车）的上下文中调用 request
            try {
                const granted = await new Promise(r => chrome.permissions.request({ permissions: ['management'] }, r));
                if (!granted) {
                    term.writeHtml(`<span class="term-error">Permission denied. Cannot execute 'ext'.</span>`);
                    return;
                }
                term.writeLine("Permission granted! Re-running command...");
            } catch (e) {
                // 如果在非用户手势下调用，Chrome 会报错
                term.writeHtml(`<span class="term-error">Error requesting permission: ${e.message}</span>`);
                return;
            }
        }

        // --- 以下是原有的逻辑 (没有任何变化，只是被包裹在了权限检查之后) ---
        
        const subCommand = args[0] || 'ls';

        try {
            if (subCommand === 'ls') {
                const list = await new Promise(r => chrome.management.getAll(r));
                
                list.sort((a, b) => {
                    if (a.enabled === b.enabled) return a.name.localeCompare(b.name);
                    return a.enabled ? -1 : 1;
                });

                const total = list.length;
                const enabledCount = list.filter(i => i.enabled).length;
                term.writeLine(`Found ${total} items (${enabledCount} enabled).`);
                term.writeLine("ID                                   State  Name");
                term.writeLine("---------------------------------------------------------------");

                list.forEach(item => {
                    if ((options.e || options.enabled) && !item.enabled) return;
                    if (item.id === chrome.runtime.id) return;

                    const checkMark = item.enabled ? "[x]" : "[ ]";
                    const statusColor = item.enabled ? "var(--color-accent-green, #4CAF50)" : "gray";
                    const nameColor = item.enabled ? "var(--terminal-foreground-color)" : "gray";
                    
                    let typeLabel = "";
                    if (item.type === 'theme') typeLabel = " (theme)";
                    else if (item.type !== 'extension') typeLabel = " (app)";

                    const idHtml = `<span style="color:gray">${item.id}</span>`;
                    const stateHtml = `<span style="color:${statusColor}">${checkMark}</span>`;
                    const nameHtml = `<span style="color:${nameColor}">${term.escapeHtml(item.name)}${typeLabel}</span>`;
                    
                    term.writeHtml(`${idHtml}  ${stateHtml}    ${nameHtml}`);
                });

            } else if (subCommand === 'toggle' || subCommand === 'enable' || subCommand === 'disable') {
                const id = args[1];
                if (!id) { term.writeHtml(`<span class="term-error">Usage: ext ${subCommand} <extension-id></span>`); return; }

                const ext = await new Promise(resolve => {
                    chrome.management.get(id, (info) => resolve(chrome.runtime.lastError ? null : info));
                });

                if (!ext) {
                    term.writeHtml(`<span class="term-error">Error: Extension ${id} not found.</span>`);
                    return;
                }

                let newState;
                if (subCommand === 'toggle') newState = !ext.enabled;
                else if (subCommand === 'enable') newState = true;
                else newState = false;

                await new Promise(r => chrome.management.setEnabled(id, newState, r));
                
                const statusStr = newState ? "ENABLED" : "DISABLED";
                const color = newState ? "var(--color-accent-green, #4CAF50)" : "gray";
                
                term.writeHtml(`Extension '${term.escapeHtml(ext.name)}' is now <span style="color:${color}; font-weight:bold">${statusStr}</span>.`);

            } else if (subCommand === 'uninstall' || subCommand === 'rm') {
                const id = args[1];
                if (!id) { term.writeHtml(`<span class="term-error">Usage: ext uninstall <extension-id></span>`); return; }
                
                chrome.management.uninstall(id, { showConfirmDialog: true }, () => {
                    if (chrome.runtime.lastError) {
                        term.writeHtml(`<span class="term-error">Error: ${chrome.runtime.lastError.message}</span>`);
                    } else {
                        term.writeLine(`Uninstall request initiated.`);
                    }
                });

            } else {
                term.writeHtml(`<span class="term-error">Usage: ext [ls|toggle|enable|disable|uninstall]</span>`);
            }
        } catch (e) {
            term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`);
        }
    },
    'theme': (args, options) => {
        const themeName = args[0];

        // 1. 列出主题 (调用 ThemeManager.getList)
        if (!themeName || themeName === 'ls') {
            term.writeLine("Available themes:");
            const list = ThemeManager.getList();
            
            list.forEach(item => {
                const marker = item.active ? '*' : ' ';
                // 使用该主题的强调色来预览名字
                term.writeHtml(` ${marker} <span style="color:${item.accent}">${item.name}</span>`);
            });
            term.writeLine("\nUsage: theme <name>");
            return;
        }

        // 2. 切换主题 (调用 ThemeManager.set)
        if (ThemeManager.set(themeName)) {
            term.writeLine(`Theme changed to '${themeName}'.`);
        } else {
            term.writeHtml(`<span class="term-error">Theme '${themeName}' not found. Try 'theme ls'.</span>`);
        }
    },
    // --- JSON 处理器 ---
    'jq': (args, options, pipedInput) => {
        if (!pipedInput || pipedInput.length === 0) {
            term.writeHtml(`<span class="term-error">jq: error: no input data (use pipe)</span>`);
            return;
        }

        const path = args[0]; // e.g., ".url" or "[0].url" or "data.image"
        
        try {
            // 1. 将管道输入的行合并回单个 JSON 字符串
            const jsonString = pipedInput.join('');
            let data = JSON.parse(jsonString);

            // 2. 如果没有参数，直接格式化输出整个 JSON
            if (!path || path === '.') {
                const pretty = JSON.stringify(data, null, 2);
                const lines = pretty.split('\n');
                lines.forEach(l => term.writeLine(l));
                return lines;
            }

            // 3. 解析路径 (非常简易的解析器: 支持 .key 和 [index])
            // 将 "[0].url" 转换为 ["0", "url"]
            const cleanPath = path.replace(/^\./, ''); // 去除开头的 .
            // 使用正则拆分: 匹配点号或方括号
            const keys = cleanPath.split(/[.\[\]]+/).filter(k => k !== '');

            let current = data;
            for (const key of keys) {
                if (current === undefined || current === null) break;
                
                // 尝试作为数组索引
                if (Array.isArray(current) && !isNaN(parseInt(key))) {
                    current = current[parseInt(key)];
                } else {
                    // 作为对象键
                    current = current[key];
                }
            }

            // 4. 输出结果
            if (current === undefined) {
                term.writeHtml(`<span class="term-error">jq: value not found at path '${path}'</span>`);
                return;
            }

            // 如果结果是字符串，直接输出（不带引号，方便作为命令参数）
            // 如果是对象/数组，格式化输出
            let output;
            if (typeof current === 'string') {
                output = current;
            } else {
                output = JSON.stringify(current);
            }
            
            term.writeLine(output);
            return [output]; // 返回给管道下一级

        } catch (e) {
            term.writeHtml(`<span class="term-error">jq: parse error: ${e.message}</span>`);
        }
    },
    'sysinfo': async (args, options) => {
        // 1. 获取系统数据
        const manifest = chrome.runtime.getManifest();
        const storageUsed = (JSON.stringify(localStorage).length / 1024).toFixed(2);
        
        // 解析 User Agent 获取 Chrome 版本和 OS
        const ua = navigator.userAgent;
        const chromeVer = ua.match(/Chrome\/([\d.]+)/)?.[1] || "Unknown";
        const osMatch = ua.match(/\(([^)]+)\)/)?.[1] || "Web OS";
        
        // 获取屏幕和窗口信息
        const screenRes = `${window.screen.width}x${window.screen.height}`;
        const termSize = `${term.cols}x${term.rows}`;
        
        // 计算 Uptime
        const startTime = window.st2_startTime || Date.now();
        const uptimeMin = Math.floor((Date.now() - startTime) / 60000);
        const uptimeStr = uptimeMin > 60 ? `${Math.floor(uptimeMin/60)}h ${uptimeMin%60}m` : `${uptimeMin}m`;

        // 2. 定义 Logo (HTML 格式以支持特定颜色)
        // 提取自 icon128.png 的配色
        const cBlue = "#4285F4";  // Google Blue
        const cRed  = "#EA4335";  // Google Red
        const cWht  = "var(--terminal-foreground-color, #fff)"; // 跟随主题文字色
        const cGry  = "#5f6368";  // 边框灰

        const logoLines = [
            `<span style="color:${cGry}">╭──────────────────────╮</span>`,
            `<span style="color:${cGry}">│</span> <span style="color:${cBlue}">\\</span>         <span style="color:${cWht}">_.(##)._</span>   <span style="color:${cGry}">│</span>`,
            `<span style="color:${cGry}">│</span>  <span style="color:${cBlue}">\\</span>        <span style="color:${cWht}">(_####_)</span>   <span style="color:${cGry}">│</span>`,
            `<span style="color:${cGry}">│</span>  <span style="color:${cRed}">/</span>         <span style="color:${cWht}">'(__)'</span>    <span style="color:${cGry}">│</span>`,
            `<span style="color:${cGry}">│</span> <span style="color:${cRed}">/</span>          <span style="color:${cWht}">______</span>    <span style="color:${cGry}">│</span>`,
            `<span style="color:${cGry}">╰──────────────────────╯</span>`
        ];

        // 3. 定义信息行
        // 使用 CSS 变量 var(--color-accent-green) 以便未来可以通过 style/theme 命令调节高亮色
        const accent = "var(--color-accent-green, #4CAF50)";
        
        const infoLines = [
            `<span style="color:${accent}; font-weight:bold;">${Environment.USER}</span>@<span style="color:${accent}; font-weight:bold;">${Environment.HOST}</span>`,
            `-------------------------`,
            `<span style="color:${accent}">OS</span>: Chrome OS / Browser`,
            `<span style="color:${accent}">Kernel</span>: ${osMatch}`,
            `<span style="color:${accent}">Browser</span>: Chrome ${chromeVer}`,
            `<span style="color:${accent}">Extension</span>: v${manifest.version}`,
            `<span style="color:${accent}">Resolution</span>: ${screenRes}`,
            `<span style="color:${accent}">Terminal</span>: StartTerminal 2.0`,
            `<span style="color:${accent}">Uptime</span>: ${uptimeStr}`,
            `<span style="color:${accent}">Memory (VFS)</span>: ${storageUsed} KB`
        ];

        // 4. 渲染 (左右布局)
        term.writeLine(""); // 顶部分隔
        const maxLines = Math.max(logoLines.length, infoLines.length);
        
        for (let i = 0; i < maxLines; i++) {
            // 获取 Logo 行 (如果没有则用空字符串填充，保持对齐)
            // 注意：因为 Logo 包含 HTML 标签，我们需要一个固定的视觉宽度来做 padding
            // 简单起见，我们假设 Logo 在视觉上大概占用 26 个字符宽度
            const logoLine = logoLines[i] || "                        "; 
            const infoLine = infoLines[i] || "";
            
            // 如果 logo 这一行是空的（比如 info 比 logo 长），我们需要补齐空格
            // 这里用稍微取巧的方式：如果 i >= logoLines.length，我们手动写空格
            const leftCol = (i < logoLines.length) ? logoLines[i] : "                        ";
            
            // 打印： Logo + 间距 + Info
            term.writeHtml(`${leftCol}   ${infoLine}`);
        }
        term.writeLine(""); // 底部分隔
    },

    // 添加别名 neofetch
    'neofetch': (args, options) => {
        return globalCommands.sysinfo(args, options);
    },
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
        const scriptArgs = args.slice(1);

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
             term.writeHtml(`<span class="term-error">startsh: ${t('permissionDenied')}: ${path}</span>`);
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
             term.writeHtml(`<span class="term-error">startsh: ${t('permissionDenied')}: ${path}</span>`);
             return;
        }

        // 替换 $0 (脚本名), $1-$9 (参数), $@/$* (所有参数)
        // 注意：这是简单的文本替换，模拟 Shell 行为
        
        scriptContent = scriptContent.replace(/\$(\d+|@|\*)/g, (match, token) => {
            if (token === '0') return path; // $0
            if (token === '@' || token === '*') return scriptArgs.join(' '); // $@
            
            const index = parseInt(token); // $1, $2...
            // 参数索引从 1 开始，对应 scriptArgs 数组的 0
            return scriptArgs[index - 1] || ""; 
        });

        // --- 核心执行 ---
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

            case 'groups':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">tabs: 'chrome.tabGroups' API not available. Check manifest.</span>`);
                const groups = await new Promise(resolve => chrome.tabGroups.query({}, resolve));
                if (groups.length === 0) {
                    term.writeLine("No tab groups found.");
                    return;
                }
                term.writeLine("ID        Color       Title");
                term.writeLine("----------------------------------------");
                groups.forEach(g => {
                    const title = term.escapeHtml(g.title || "(No Title)");
                    term.writeHtml(`${String(g.id).padEnd(10)}<span style="color:${g.color}">${g.color.padEnd(12)}</span>${title}`);
                });
                break;

            case 'group':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">API not available.</span>`);
                const tabIdsToGroup = args.slice(1).map(id => parseInt(id)).filter(id => !isNaN(id));
                if (tabIdsToGroup.length === 0) return term.writeHtml(`<span class="term-error">Usage: tabs group &lt;tabId1&gt; [tabId2...]</span>`);
                
                try {
                    const newGroupId = await new Promise((resolve, reject) => {
                        chrome.tabs.group({ tabIds: tabIdsToGroup }, (id) => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve(id);
                        });
                    });
                    term.writeLine(`Successfully grouped tabs into new Group ID: ${newGroupId}`);
                } catch(e) { term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`); }
                break;

            case 'group-add':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">API not available.</span>`);
                const targetGroupId = parseInt(args[1]);
                const tabsToAdd = args.slice(2).map(id => parseInt(id)).filter(id => !isNaN(id));
                if (isNaN(targetGroupId) || tabsToAdd.length === 0) {
                    return term.writeHtml(`<span class="term-error">Usage: tabs group-add &lt;groupId&gt; &lt;tabId1&gt; [tabId2...]</span>`);
                }
                try {
                    await new Promise((resolve, reject) => {
                        chrome.tabs.group({ groupId: targetGroupId, tabIds: tabsToAdd }, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                    term.writeLine(`Added tabs to Group ID: ${targetGroupId}`);
                } catch(e) { term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`); }
                break;

            case 'ungroup':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">API not available.</span>`);
                const tabsToUngroup = args.slice(1).map(id => parseInt(id)).filter(id => !isNaN(id));
                if (tabsToUngroup.length === 0) return term.writeHtml(`<span class="term-error">Usage: tabs ungroup &lt;tabId1&gt; [tabId2...]</span>`);
                try {
                    await new Promise((resolve, reject) => {
                        chrome.tabs.ungroup(tabsToUngroup, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                    term.writeLine(`Successfully ungrouped tabs.`);
                } catch(e) { term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`); }
                break;

            case 'group-title':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">API not available.</span>`);
                const titleGroupId = parseInt(args[1]);
                const newTitle = args.slice(2).join(' ');
                if (isNaN(titleGroupId) || !newTitle) {
                    return term.writeHtml(`<span class="term-error">Usage: tabs group-title &lt;groupId&gt; &lt;new title...&gt;</span>`);
                }
                try {
                    await new Promise((resolve, reject) => {
                        chrome.tabGroups.update(titleGroupId, { title: newTitle }, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                    term.writeLine(`Group ${titleGroupId} title updated to '${term.escapeHtml(newTitle)}'.`);
                } catch(e) { term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`); }
                break;

            case 'group-color':
                if (!chrome.tabGroups) return term.writeHtml(`<span class="term-error">API not available.</span>`);
                const colorGroupId = parseInt(args[1]);
                const newColor = args[2];
                const validColors = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
                if (isNaN(colorGroupId) || !validColors.includes(newColor)) {
                    return term.writeHtml(`<span class="term-error">Usage: tabs group-color &lt;groupId&gt; &lt;${validColors.join('|')}&gt;</span>`);
                }
                try {
                    await new Promise((resolve, reject) => {
                        chrome.tabGroups.update(colorGroupId, { color: newColor }, () => {
                            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                            else resolve();
                        });
                    });
                    term.writeLine(`Group ${colorGroupId} color updated to ${newColor}.`);
                } catch(e) { term.writeHtml(`<span class="term-error">Error: ${e.message}</span>`); }
                break

            case 'save-group':
                const sgId = parseInt(args[1]);
                const sgName = args[2];
                if (isNaN(sgId) || !sgName) {
                    return term.writeHtml(`<span class="term-error">Usage: tabs save-group &lt;groupId&gt; &lt;name&gt;</span>`);
                }
                
                const tabsInGroup = await new Promise(resolve => chrome.tabs.query({ groupId: sgId }, resolve));
                if (tabsInGroup.length === 0) {
                    return term.writeLine("No tabs found in that group.");
                }
                
                // 过滤掉 Chrome 内部安全页面（无法被扩展自动重新创建）
                const urlsToSave = tabsInGroup.map(t => t.url).filter(u => u && !u.startsWith('chrome://'));
                let savedGroupsDB = JSON.parse(localStorage.getItem('st2_saved_groups') || '{}');
                savedGroupsDB[sgName] = urlsToSave;
                localStorage.setItem('st2_saved_groups', JSON.stringify(savedGroupsDB));
                
                term.writeLine(`Saved ${urlsToSave.length} tabs to local session '${term.escapeHtml(sgName)}'.`);
                break;

            case 'saved':
                const db = JSON.parse(localStorage.getItem('st2_saved_groups') || '{}');
                const keys = Object.keys(db);
                if (keys.length === 0) return term.writeLine("No saved groups in ST2.0 local storage.");
                term.writeLine("ST2.0 Local Saved Groups:");
                keys.forEach(k => term.writeLine(`  ${term.escapeHtml(k)} (${db[k].length} tabs)`));
                break;

            case 'load-group':
                const lgName = args[1];
                if (!lgName) return term.writeHtml(`<span class="term-error">Usage: tabs load-group &lt;name&gt;</span>`);
                
                const lgDB = JSON.parse(localStorage.getItem('st2_saved_groups') || '{}');
                const targetUrls = lgDB[lgName];
                if (!targetUrls) return term.writeHtml(`<span class="term-error">Saved group '${term.escapeHtml(lgName)}' not found.</span>`);
                
                term.writeLine(`Loading ${targetUrls.length} tabs...`);
                const newIds = [];
                // 逐个创建静默 Tab
                for (const u of targetUrls) {
                    const t = await new Promise(resolve => chrome.tabs.create({ url: u, active: false }, resolve));
                    if (t && t.id) newIds.push(t.id);
                }
                
                // 自动放入一个新原生 Tab Group 并恢复名字
                if (chrome.tabGroups && newIds.length > 0) {
                     const gid = await new Promise(resolve => chrome.tabs.group({ tabIds: newIds }, resolve));
                     await new Promise(resolve => chrome.tabGroups.update(gid, { title: lgName }, resolve));
                     term.writeLine(`Successfully restored and grouped under '${term.escapeHtml(lgName)}'.`);
                }
                break;

            default:
                term.writeHtml(`<span class="term-error">Unknown command: 'tabs ${subCommand}'. Try 'tabs ls'.</span>`);
        }
    },

    'whatsnew': async (args, options) => {
        const API_URL = Resources.urls.api_updates;
        
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
        // 获取当前安装的版本 (Local)
        let installedVersion = '2.0.0'; // 默认回退版本
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
            installedVersion = chrome.runtime.getManifest().version;
        }

        // 获取远程最新版本 (Remote - 从 updateSystemVersion 缓存中读取)
        const remoteVersion = localStorage.getItem('st2_system_version');

        // 系统版本 
        term.writeLine(t('welcomeTitle').replace('{0}', installedVersion));
        term.writeLine("");

        const welcome_lang = Environment.LANG || 'en';
        const docUrl = Resources.urls.docs[welcome_lang] || Resources.urls.docs['en'];
        
        // 链接 (使用 VFS 文件夹样式)
        // (你可以用 CSS 在 .term-folder 中定义一个亮色)
        term.writeHtml(`${t('welcomeDoc')} <span class='term-folder'>${docUrl}</span>`);
        term.writeHtml(`${t('welcomeMgmt')} <span class='term-folder'>${Resources.urls.extensions}</span>`);
        term.writeHtml(`${t('welcomeSupport')} <span class='term-folder'>${Resources.urls.support}</span>`);
        term.writeLine("");

        // 系统信息 (真实 + 模拟)
        const lang = Environment.LANG || 'en';
        const now = new Date().toLocaleString(lang, { dateStyle: 'long', timeStyle: 'medium' });
        term.writeLine(`  ${t('welcomeSysInfo')} ${now}`);
        term.writeLine("");

        // 获取动态数据
        const tabs = await new Promise(r => chrome.tabs.query({}, r));
        const tabCount = tabs.length;
        const storageSize = JSON.stringify(localStorage).length;
        const storageMB = (storageSize / (1024 * 1024)).toFixed(2);
        const activeUser = Environment.USER || 'user';
        

        // 格式化并打印统计数据
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
            // term.writeLine(""); // 最后的空行
        }

        if (remoteVersion && compareVersions(remoteVersion, installedVersion) > 0) {
            term.writeLine(""); // 空一行
            // term.writeLine("---------------------------------------------------");
            // i18n 提示: "发现新版本: 2.1.0"
            // 使用 CSS 变量或硬编码颜色使其醒目
            term.writeHtml(`<span style="color: var(--color-accent-green, #4CAF50); font-weight: bold;">[!] ${t('updateAvailable').replace('{0}', remoteVersion)}</span>`);
            // i18n 链接提示
            term.writeHtml(`${t('updateLink')} <span class='term-folder'>https://aka.bradleyproject.eu.org/st20_releases</span>`);
            // term.writeLine("---------------------------------------------------");
        }
        displayCachedAnnouncement();
        term.writeLine("");
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
        
        // 1. 动态权限检查 (Downloads Permission)
        const hasPerm = await new Promise(r => chrome.permissions.contains({ permissions: ['downloads'] }, r));

        if (!hasPerm) {
            term.writeLine("wget: Requires 'downloads' permission to save files.");
            try {
                const granted = await new Promise(r => chrome.permissions.request({ permissions: ['downloads'] }, r));
                if (!granted) {
                    term.writeHtml(`<span class="term-error">Permission denied. Cannot execute wget.</span>`);
                    return;
                }
            } catch (e) {
                term.writeHtml(`<span class="term-error">Error requesting permission: ${e.message}</span>`);
                return;
            }
        }

        // 2. 执行下载
        try {
            term.writeLine(`Starting download: ${url}`);
            
            // 此时 chrome.downloads 肯定可用
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
        // 1. 参数解析：分离 URL 和 Headers
        // 逻辑：如果参数包含冒号且不是 http 开头，视为 Header
        let url = null;
        const headers = {};
        
        args.forEach(arg => {
            if (arg.match(/^https?:\/\//i)) {
                url = arg;
            } else if (arg.includes(':')) {
                // 解析 "Key: Value"
                const [key, ...values] = arg.split(':');
                if (key && values.length > 0) {
                    headers[key.trim()] = values.join(':').trim();
                }
            }
        });

        if (!url) {
            term.writeHtml(`<span class="term-error">${t('curlUsage')} [Header: Value]...</span>`);
            return;
        }

        // 2. 动态权限检查 (Host Permissions)
        const origin = "<all_urls>"; 
        const hasPerm = await new Promise(r => chrome.permissions.contains({ origins: [origin] }, r));

        if (!hasPerm) {
            term.writeLine("curl: Requires permission to access external websites.");
            try {
                const granted = await new Promise(r => chrome.permissions.request({ origins: [origin] }, r));
                if (!granted) {
                    term.writeHtml(`<span class="term-error">Permission denied. Cannot execute curl.</span>`);
                    return;
                }
                term.writeLine("Permission granted! Continuing...");
            } catch (e) {
                term.writeHtml(`<span class="term-error">Error requesting permission: ${e.message}</span>`);
                return;
            }
        }

        // 3. 执行 Fetch
        try {
            term._writeLogLine(t('curlProgress').replace('{0}', url)); 
            
            // 构建请求配置
            const fetchOptions = { 
                method: 'GET',
                cache: 'no-store', 
                mode: 'cors',
                headers: headers // 注入用户定义的 Headers
            };

            const response = await fetch(url, fetchOptions);
            
            if (!response.ok) {
                throw new Error(t('curlHttpError').replace('{0}', `${response.status} ${response.statusText}`));
            }
            
            // 4. 智能内容处理
            const contentType = response.headers.get('content-type') || '';
            
            if (contentType.startsWith('image/')) {
                // --- 情况 A: 响应是二进制图片 ---
                // 转换为 Blob -> ObjectURL
                const blob = await response.blob();
                const objectUrl = URL.createObjectURL(blob);
                
                // 将 Blob URL 输出到屏幕和管道
                term.writeLine(objectUrl); 
                return [objectUrl]; // 传递给下一个命令 (如 style wall)
                
            } else {
                // --- 情况 B: 响应是文本/JSON ---
                const text = await response.text();
                term.writeLine(text); 
                return text.split('\n'); 
            }
            
        } catch(e) {
            term._writeLogHtml(`<span class="term-error">curl error: ${e.message}</span>`);
            if (e.message.includes("Failed to fetch")) {
                term._writeLogHtml(`<span class="term-error">Tip: Check CORS or your headers.</span>`);
            }
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
        
        // 1. 核心与语法 (新增部分)
        term.writeHtml(`<b>${t('helpSyntax')}</b>`);
        term.writeHtml(formatHelp('|', 'help_pipe'));
        term.writeHtml(formatHelp('> >> < 2>', 'help_redirect'));
        term.writeHtml(formatHelp('$(...)', 'help_subcmd'));
        term.writeHtml(formatHelp('VAR=VAL', 'help_var'));

        term.writeHtml(`\n<b>${t('helpFS')}</b>`);
        term.writeHtml(formatHelp('ls', 'help_ls'));
        term.writeHtml(formatHelp('cd', 'help_cd'));
        term.writeHtml(formatHelp('cat', 'help_cat'));
        term.writeHtml(formatHelp('nano', 'help_nano'));
        term.writeHtml(formatHelp('vim', 'help_vim'));
        term.writeHtml(formatHelp('mkdir', 'help_mkdir'));
        term.writeHtml(formatHelp('rm', 'help_rm'));
        term.writeHtml(formatHelp('cp', 'cpUsage')); // 确保 i18n 有这个
        term.writeHtml(formatHelp('mv', 'mvUsage')); // 确保 i18n 有这个
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
        term.writeHtml(formatHelp('theme', 'help_theme')); // [新增]
        term.writeHtml(formatHelp('ext', 'help_ext'));     // [新增]
        
        term.writeHtml(`\n<b>${t('helpUtil')}</b>`);
        term.writeHtml(formatHelp('apt', 'help_apt'));
        term.writeHtml(formatHelp('open', 'help_open'));
        term.writeHtml(formatHelp('search', 'help_search'));
        term.writeHtml(formatHelp('curl', 'curlUsage'));
        term.writeHtml(formatHelp('wget', 'wgetUsage'));
        term.writeHtml(formatHelp('jq', 'help_jq'));       // [新增]
        term.writeHtml(formatHelp('style', 'help_style'));
        term.writeHtml(formatHelp('date', 'help_date'));
        term.writeHtml(formatHelp('sysinfo', 'help_neofetch'));
        term.writeHtml(formatHelp('clear', 'help_clear'));
        term.writeHtml(formatHelp('whatsnew', 'help_whatsnew'));
        
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
     'style': async (args, options, pipedInput) => {
        const subCommand = args[0];
        const value = args.slice(1).join(' '); 
        if (pipedInput) options._pipedInput = pipedInput;

        // 获取当前css
        const getStyle = (name) => {
            return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        };

        // 辅助：保存 Override
        const setOverride = (cssVar, cssValue) => {
            const overrides = JSON.parse(localStorage.getItem('style_overrides') || '{}');
            if (cssValue === null) {
                delete overrides[cssVar]; 
            } else {
                overrides[cssVar] = cssValue;
            }
            localStorage.setItem('style_overrides', JSON.stringify(overrides));
            
            if (cssValue === null) {
                ThemeManager.load();
                loadStyleSettings(); 
            } else {
                document.documentElement.style.setProperty(cssVar, cssValue);
            }
        };

        if (!subCommand) {
            term.writeLine("Usage: style <command> [value]");
            term.writeLine("Commands:");
            term.writeLine("  font <name>       Set font family");
            term.writeLine("  size <size>       Set font size (e.g. 16px)");
            term.writeLine("  bg <color>        Set background color");
            term.writeLine("  fg <color>        Set foreground (text) color");
            term.writeLine("  stdout <color>    Set command output (stdout) color");
            term.writeLine("  stderr <color>    Set error output (stderr) color");
            term.writeLine("  accent <color>    Set accent color");
            term.writeLine("  cursor <color>    Set cursor color");
            term.writeLine("  wall <url|none>   Set wallpaper");
            term.writeLine("  opacity <0-1>     Set background opacity");
            term.writeLine("  reset             Reset all styles");
            return;
        }

        let needsResize = false;

        switch (subCommand.toLowerCase()) {
            case 'font':
                if (!value) {
                    term.writeLine(`Current font: ${getStyle('--terminal-font-family')}`);
                    return;
                }
                // 移除用户可能输入的引号，获取纯字体名
                const fontToCheck = value.replace(/['"]/g, '').trim();
                
                // 如果检测不通过
                if (!isFontAvailable(fontToCheck)) {
                    term.writeHtml(`<span class="term-error">Error: Font '${term.escapeHtml(fontToCheck)}' seems unavailable on this system.</span>`);
                    return;
                }
                document.documentElement.style.setProperty('--terminal-font-family', value);
                localStorage.setItem('terminalFontFamily', value);
                term.writeLine(`Font set to: ${value}`);
                needsResize = true;
                break;

            case 'size':
                if (!value) {
                    term.writeLine(`Current size: ${getStyle('--terminal-font-size')}`);
                    return;
                }
                let finalSize = value.trim();
                
                // 正则解释：
                // ^       字符串开始
                // \d+     一个或多个数字
                // (\.\d+)? 可选的小数部分 (例如 .5)
                // $       字符串结束
                // 如果只匹配到纯数字，就追加 px
                if (/^\d+(\.\d+)?$/.test(finalSize)) {
                    finalSize += 'px';
                }
                document.documentElement.style.setProperty('--terminal-font-size', finalSize);
                localStorage.setItem('terminalFontSize', finalSize);
                term.writeLine(`Size set to: ${finalSize}`);
                needsResize = true;
                break;

            case 'bg':
                if (!value) {
                    term.writeLine(`Current background: ${getStyle('--terminal-background-color')}`);
                    return;
                }
                setOverride('--terminal-background-color', value);
                term.writeLine(`Background color set to: ${value}`);
                break;

            case 'fg':
                if (!value) {
                    term.writeLine(`Current foreground: ${getStyle('--terminal-foreground-color')}`);
                    return;
                }
                setOverride('--terminal-foreground-color', value);
                term.writeLine(`Foreground color set to: ${value}`);
                break;

            case 'stdout':
                if (!value) {
                    term.writeLine(`Current stdout color: ${getStyle('--terminal-stdout-color')}`);
                    return;
                }
                setOverride('--terminal-stdout-color', value);
                term.writeLine(`Stdout color set to: ${value}`);
                break;

            case 'stderr':
                if (!value) {
                    term.writeLine(`Current stderr color: ${getStyle('--terminal-stderr-color')}`);
                    return;
                }
                setOverride('--terminal-stderr-color', value);
                term.writeLine(`Stderr color set to: ${value}`);
                break;

            case 'accent':
                if (!value) {
                    term.writeLine(`Current accent: ${getStyle('--terminal-accent')}`);
                    return;
                }
                setOverride('--terminal-accent', value);
                setOverride('--color-accent-green', value); // 兼容旧变量
                term.writeLine(`Accent color set to: ${value}`);
                break;
                
            case 'cursor':
                if (!value) {
                    term.writeLine(`Current cursor: ${getStyle('--cursor-bg-color')}`);
                    return;
                }
                setOverride('--cursor-bg-color', value);
                term.writeLine(`Cursor color set to: ${value}`);
                break;

            // --- [新增] Opacity ---
            case 'opacity':
                // 获取逻辑：尝试从 rgba 中解析 alpha 值
                if (!value) {
                    const currentBg = getStyle('--terminal-background-color');
                    let currentOp = "1.0"; // 默认不透明
                    // 匹配 rgba(r, g, b, alpha) 中的 alpha
                    const match = currentBg.match(/rgba?\(.*,\s*([\d\.]+)\)/);
                    if (match) currentOp = match[1];
                    else if (currentBg.startsWith('#')) currentOp = "1.0"; // Hex 默认为 1

                    term.writeLine(`Current opacity: ${currentOp}`);
                    return;
                }

                // 设置逻辑
                const opacity = parseFloat(value);
                if (isNaN(opacity) || opacity < 0 || opacity > 1) {
                    // [修复] 这里使用了 &lt; &gt; 来防止 HTML 解析问题
                    term.writeHtml(`<span class="term-error">Usage: style opacity &lt;0.0 - 1.0&gt;</span>`); 
                    return; 
                }
                
                // 1. 获取当前生效的背景色 (可能是 Override 的，也可能是 Theme 的)
                const currentBg = getComputedStyle(document.documentElement).getPropertyValue('--terminal-background-color').trim();
                
                // 2. 转换为带透明度的 RGBA
                const newRgba = toRgba(currentBg, opacity);
                
                // 3. 设置为 Override
                setOverride('--terminal-background-color', newRgba);
                term.writeLine(`Opacity set to ${opacity}. (Color: ${newRgba})`);
                break;

            case 'wall': 
            case 'wallpaper':
                let targetUrl = value;
                if (!targetUrl && options._pipedInput && options._pipedInput.length > 0) {
                    targetUrl = options._pipedInput[0].trim();
                }

                if (!targetUrl) { 
                    const currentWall = getStyle('--terminal-background-image');
                    // css 返回的是 url("...")，我们只提取里面的地址以便阅读
                    const match = currentWall.match(/url\(['"]?(.*?)['"]?\)/);
                    const displayVal = match ? match[1] : currentWall;
                    
                    if (displayVal === 'none') {
                        term.writeLine("Current wallpaper: none");
                    } else {
                        // 如果太长，截断显示
                        const shortVal = displayVal.length > 50 ? displayVal.substring(0, 47) + "..." : displayVal;
                        term.writeLine(`Current wallpaper: ${shortVal}`);
                        // 同时建议用法 (这里使用了转义字符)
                        term.writeHtml(`<span style="color:gray; font-size:0.9em">To change: style wall &lt;url&gt;</span>`);
                    }
                    return; 
                }
                
                if (targetUrl === 'none') {
                    setOverride('--terminal-background-image', 'none');
                    setWallpaper('none'); // [调用新函数]
                    term.writeLine("Wallpaper removed.");
                } else {
                    const urlStr = `url('${targetUrl}')`;
                    
                    // 保存到 LocalStorage (Override)
                    // 注意：setOverride 内部会 setProperty，我们需要避免它直接设置图片导致闪烁
                    // 你可以修改 setOverride 逻辑，或者像下面这样手动保存：
                    const overrides = JSON.parse(localStorage.getItem('style_overrides') || '{}');
                    overrides['--terminal-background-image'] = urlStr;
                    localStorage.setItem('style_overrides', JSON.stringify(overrides));

                    // 执行渐变加载
                    setWallpaper(targetUrl);
                    
                    // 智能透明度调整 (保持你原有的逻辑)
                    const currentBg = getComputedStyle(document.documentElement).getPropertyValue('--terminal-background-color').trim();
                    if (!currentBg.startsWith('rgba') || currentBg.endsWith(', 1)')) {
                        const autoRgba = toRgba(currentBg, 0.7);
                        document.documentElement.style.setProperty('--terminal-background-color', autoRgba);
                        overrides['--terminal-background-color'] = autoRgba; // 更新保存
                        localStorage.setItem('style_overrides', JSON.stringify(overrides));
                        term.writeLine(`Wallpaper set. Transparency adjusted to 0.7.`);
                    } else {
                        term.writeLine(`Wallpaper set.`);
                    }
                }
                break;

            case 'reset':
                 const defaultFont = "'Fira Code', 'Consolas', 'Courier New', monospace";
                 const defaultSize = "14px";
                 document.documentElement.style.setProperty('--terminal-font-family', defaultFont);
                 document.documentElement.style.setProperty('--terminal-font-size', defaultSize);
                 localStorage.setItem('terminalFontFamily', defaultFont);
                 localStorage.setItem('terminalFontSize', defaultSize);
                 
                 localStorage.removeItem('style_overrides');
                 ThemeManager.load();
                 
                 term.writeLine("Style reset to current theme defaults.");
                 needsResize = true;
                 break;

            default:
                term.writeHtml(`<span class="term-error">Unknown style command: ${subCommand}</span>`);
                return;
        }

        if (needsResize) {
            await new Promise(resolve => setTimeout(resolve, 50));
            await term._handleResize();
        }
     },

     // --- cat 命令 ---
     'cat': (args, options, pipedInput) => {
        // 1. 优先检查是否有输入流 (来自管道 | 或 输入重定向 <)
        if (pipedInput && pipedInput.length > 0) {
            pipedInput.forEach(line => term.writeLine(line));
            return;
        }

        // 2. 如果没有输入流，检查参数
        if (!args[0]) {
            // 既没有参数也没有输入流 -> 报错
            term.writeError(`${t('missingOperand')}`);
            return;
        }

        const path = args[0];
        const result = bookmarkSystem._findNodeByPath(path);

        if (!result || !result.node) {
            term.writeError(`${t('noSuchFileOrDir')}: ${path}`);
            return;
        }
        if (result.node.children) {
            term.writeError(`${t('isADir')}: ${path}`);
            return;
        }

        if (!hasPermission(result.node, 'r')) {
            term.writeError(`cat: ${path}: ${t('permissionDenied')}`);
            return;
        }

        const url = result.node.url;
        if (!url) {
            term.writeLine(""); 
            return;
        }

        if (result.node.id.startsWith('vfs-')) {
            try {
                const base64Content = url.split(',')[1] || '';
                const content = decodeURIComponent(atob(base64Content));
                term.writeLine(content); 
            } catch (e) {
                term.writeError(`${path}: Error reading file: ${e.message}`);
            }
        } else {
            term.writeLine(url);
        }
     },

     

     'nano': (args, options) => {
        return openFileEditor('nano', NanoEditor, args);
     },

     'vim': (args, options) => {
        return openFileEditor('vim', VimEditor, args);
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
        
        // 解析内容
        await parseStartrc(fileContent);

        // 刷新提示符
        bookmarkSystem.update_user_path();
    },

    '.': (args, options) => {
        // 'source' 的别名
        return globalCommands.source(args, options);
    },

    // 在 globalCommands 对象中添加：

    'df': async (args, options) => {
        const humanReadable = options.h || options.human;

        // 辅助函数：格式化字节
        const formatSize = (bytes) => {
            if (!humanReadable) return Math.ceil(bytes / 1024); // 默认显示 1K-blocks
            if (bytes === 0) return '0B';
            const k = 1024;
            const sizes = ['B', 'K', 'M', 'G'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
        };

        const LOCAL_STORAGE_LIMIT = 5 * 1024 * 1024; // 5MB
        
        let total = LOCAL_STORAGE_LIMIT;
        let used = 0;

        // 计算已用空间 (localStorage 字符串长度近似等于字节数，UTF-16 可能会更多，但作为估算足够)
        // 更精确的计算: new Blob([JSON.stringify(localStorage)]).size;
        used = new Blob([JSON.stringify(localStorage)]).size; 

        // 如果想保留 "系统视图"，你可以把 271G 那个作为 "/dev/disk" 显示，而把 localStorage 作为 "/"
        // 但为了简单和诚实，我们直接显示 localStorage 的限制。
        
        const available = Math.max(0, total - used);
        const percent = Math.min(100, Math.round((used / total) * 100)) + '%';

        // 渲染表头
        // 模仿 Linux df 输出格式
        // Filesystem     Size   Used  Avail Use% Mounted on
        const headerFilesystem = "Filesystem".padEnd(15);
        const headerSize = (humanReadable ? "Size" : "1K-blocks").padEnd(10);
        const headerUsed = "Used".padEnd(10);
        const headerAvail = "Avail".padEnd(10);
        const headerUse = "Use%".padEnd(6);
        const headerMounted = "Mounted on";

        term.writeLine(`${headerFilesystem}${headerSize}${headerUsed}${headerAvail}${headerUse}${headerMounted}`);

        // 渲染数据行
        // VFS (localStorage)
        const fsName = "browser_root".padEnd(15);
        const sizeStr = formatSize(total).toString().padEnd(10);
        const usedStr = formatSize(used).toString().padEnd(10);
        const availStr = formatSize(available).toString().padEnd(10);
        const useStr = percent.padEnd(6);
        const mountedStr = "/";

        term.writeLine(`${fsName}${sizeStr}${usedStr}${availStr}${useStr}${mountedStr}`);

        // Bookmark FS (伪造一个无限的/云端的)
        const bmFsName = "bookmarks".padEnd(15);
        const bmSizeStr = (humanReadable ? "Unlimited" : "0").padEnd(10); // 书签通常没有硬性字节限制
        const bmUsedStr = "---".padEnd(10);
        const bmAvailStr = "---".padEnd(10);
        const bmUseStr = "-".padEnd(6);
        const bmMountedStr = "~"; // Home

        term.writeLine(`${bmFsName}${bmSizeStr}${bmUsedStr}${bmAvailStr}${bmUseStr}${bmMountedStr}`);
    },

    'search': (args, options) => {
        if (args.length === 0) {
            term.writeHtml(`<span class="term-error">Usage: search [-n] <query|url...></span>`);
            return;
        }
        let queryText = args.join(' ');

        // [新增] URL 检测正则
        // 匹配 http://, https://, 或者 www. 开头，或者包含 .com/.net/.org 等常见域名的字符串
        const isUrl = /^(https?:\/\/)|(www\.)|([a-zA-Z0-9-]+\.(com|org|net|io|edu|gov|jp|cn))/i.test(queryText);

        if (typeof chrome !== 'undefined' && chrome.search && chrome.tabs) {
            const disposition = options.n ? "NEW_TAB" : "CURRENT_TAB";

            if (isUrl) {
                // 如果没有协议头，补全 https://
                if (!/^https?:\/\//i.test(queryText)) {
                    queryText = 'https://' + queryText;
                }
                
                // 直接打开 URL
                if (disposition === "NEW_TAB") {
                    chrome.tabs.create({ url: queryText });
                } else {
                    chrome.tabs.update({ url: queryText });
                }
            } else {
                // 普通搜索
                chrome.search.query({ 
                    text: queryText,
                    disposition: disposition
                });
            }
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
        const REPO_URL = Resources.urls.repo;
        const subCommand = args[0];
        const pkgName = args[1];

        // 检查 sudo 权限
        if (!options.sudo && ['install', 'update', 'remove', 'upgrade'].includes(subCommand)) {
            term.writeLine(`apt: This command requires superuser privileges (try 'sudo apt ...')`);
            return;
        }

        // 辅助：获取可升级列表
        const getUpgradablePackages = () => {
            const index = JSON.parse(localStorage.getItem('apt_repo_index') || '{}');
            const installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
            const list = [];
            
            for (const name in installed) {
                const localVer = installed[name].version || '0.0.0'; // 旧数据可能没版本，默认为 0
                const remotePkg = index[name];
                
                // 如果远程存在且版本比本地大
                if (remotePkg && compareVersions(remotePkg.version, localVer) > 0) {
                    list.push({
                        name: name,
                        current: localVer,
                        new: remotePkg.version
                    });
                }
            }
            return list;
        };

        try {
            switch (subCommand) {
                case 'update':
                    const startTime = Date.now();
                    const oldIndexStr = localStorage.getItem('apt_repo_index');

                    try {
                        const response = await fetch(REPO_URL + "index.json", { cache: "no-cache" });

                        if (!response.ok) {
                            throw new Error(`${response.status} ${response.statusText}`);
                        }

                        const blob = await response.blob();
                        const sizeBytes = blob.size;
                        const newIndexStr = await blob.text();

                        const isHit = oldIndexStr === newIndexStr;

                        localStorage.setItem('apt_repo_index', newIndexStr);
                        const index = JSON.parse(newIndexStr);

                        const endTime = Date.now();
                        const durationSec = Math.max((endTime - startTime) / 1000, 0.01);
                        const speedKB = (sizeBytes / 1024 / durationSec).toFixed(0);

                        const sizeDisplay = sizeBytes > 1024 
                            ? `${(sizeBytes/1024).toFixed(1)} kB` 
                            : `${sizeBytes} B`;

                        if (isHit) {
                            term.writeLine(`Hit:1 ${REPO_URL}index.json`);
                        } else {
                            term.writeLine(`Get:1 ${REPO_URL}index.json [${sizeDisplay}]`);
                        }

                        if (!isHit) {
                            term.writeLine(`Fetched ${sizeDisplay} in ${durationSec.toFixed(1)}s (${speedKB} kB/s)`);
                        }

                        term.writeLine("Reading package lists... Done");
                        term.writeLine("Building dependency tree... Done");
                        term.writeLine("Reading state information... Done");

                        // 计算可升级包
                        const upgradableList = getUpgradablePackages();
                        const count = upgradableList.length;

                        if (count > 0) {
                            term.writeLine(`${count} packages can be upgraded. Run 'apt list --upgradable' to see them.`);
                        } else {
                            term.writeLine("All packages are up to date.");
                        }
                    } catch (e) {
                        term.writeHtml(`<span class="term-error">Err:1 ${REPO_URL}index.json</span>`);
                        term.writeHtml(`<span class="term-error">  ${e.message}</span>`);
                        term.writeLine("Reading package lists... Done");
                        term.writeHtml(`<span class="term-error">E: Failed to fetch index file.</span>`);
                    }
                    break;

                case 'list':
                    {
                        const index = JSON.parse(localStorage.getItem('apt_repo_index') || '{}');
                        const installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        
                        // If --upgradeable
                        if (options['upgradable']) {
                            term.writeLine("Listing... Done");
                            const list = getUpgradablePackages();
                            if (list.length === 0) {
                                // 没有任何输出，符合 apt 行为
                            } else {
                                list.forEach(item => {
                                    // 格式: package/remote_version [upgradable from: local_version]
                                    // 例如: weather/2.0.1 [upgradable from: 1.0.0]
                                    term.writeHtml(`<span style="color:var(--color-accent-green, #4CAF50)">${item.name}</span>/${item.new} [upgradable from: ${item.current}]`);
                                });
                            }
                            return;
                        }
                        
                        term.writeLine("Available packages:");
                        for (const key in index) {
                            let installedMark = "";
                            if (installed[key]) {
                                const ver = installed[key].version || 'unknown';
                                installedMark = `[installed, v${ver}]`;
                            }
                            term.writeLine(`  ${key} - ${index[key].desc} ${installedMark}`);
                        }
                    }
                    break;

                case 'upgrade':
                    {
                        const list = getUpgradablePackages();
                        if (list.length === 0) {
                            term.writeLine("0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.");
                            return;
                        }

                        term.writeLine("The following packages will be upgraded:");
                        term.writeLine("  " + list.map(i => i.name).join(" "));
                        
                        const answer = await term.readInput(`${list.length} upgraded. Do you want to continue? [Y/n]`);
                        if (answer !== 'y' && answer !== '') {
                            term.writeLine("Abort.");
                            return;
                        }

                        // 循环调用 install 逻辑
                        for (const item of list) {
                            // 我们复用 install 的内部逻辑，这里为了简单，我们手动触发一次 install 命令
                            // 或者把 install 逻辑抽取出来。为了代码复用，我们直接递归调用 'apt'
                            // 注意：这会产生多余的 logs，但很真实
                            term.writeLine(`Upgrading ${item.name}...`);
                            await globalCommands.apt(['install', item.name], { sudo: true });
                        }
                        
                        term.writeLine("Upgrade complete.");
                    }
                    break;
                
                case 'install':
                    // 获取所有参数作为包名列表
                    const pkgsToInstall = args.slice(1);
                    if (pkgsToInstall.length === 0) { 
                        term.writeHtml(`<span class="term-error">${t('aptInstallUsage')}</span>`); 
                        return; 
                    }
                    
                    const repoIndex = JSON.parse(localStorage.getItem('apt_repo_index') || '{}');
                    
                    // 循环处理每个包
                    for (const pkgName of pkgsToInstall) {
                        term.writeLine(`\nProcessing: ${pkgName}...`);

                        const pkg = repoIndex[pkgName];

                        if (!pkg) {
                            term.writeHtml(`<span class="term-error">${t('aptPkgNotFound').replace('{0}', pkgName)}</span>`);
                            continue; // 跳过，处理下一个
                        }

                        // 权限检查逻辑
                        const reqPermissions = pkg.permissions || [];
                        const reqHostPermissions = pkg.host_permissions || [];
                        const allPermissions = {
                            permissions: reqPermissions,
                            origins: reqHostPermissions
                        };

                        // 检查是否已安装
                        const installedData = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        if (installedData[pkgName] && installedData[pkgName].version === pkg.version) {
                            term.writeLine(`${pkgName} is already the newest version (${pkg.version}).`);
                            continue; // 跳过
                        }

                        // 权限请求 (只能串行，不能并行)
                        let needsPerms = false;
                        if (reqPermissions.length > 0) {
                            term.writeLine(`[!] Package '${pkgName}' requires API: ${reqPermissions.join(', ')}`);
                            needsPerms = true;
                        }
                        if (reqHostPermissions.length > 0) {
                            term.writeLine(`[!] Package '${pkgName}' requires Hosts: ${reqHostPermissions.join(', ')}`);
                            needsPerms = true;
                        }

                        if (needsPerms) {
                            const answer = await term.readInput(t('aptConfirm'));
                            if (answer !== 'y' && answer !== '') {
                                term.writeLine(`Skipping ${pkgName}.`);
                                continue;
                            }
                            const granted = await new Promise((resolve) => {
                                chrome.permissions.request(allPermissions, resolve);
                            });
                            if (!granted) {
                                term.writeLine(`Permissions denied. Skipping ${pkgName}.`);
                                continue;
                            }
                        }
                        
                        // 下载与安装
                        if (pkg.file) {
                            term.writeLine(t('aptFetch').replace('{0}', pkgName).replace('{1}', pkg.file));
                            try {
                                const codeResponse = await fetch(REPO_URL + pkg.file);
                                if (!codeResponse.ok) {
                                    throw new Error(`${codeResponse.status} ${codeResponse.statusText}`);
                                }
                                const codeString = await codeResponse.text();
                                
                                // 重新读取 localStorage，防止循环中覆盖
                                let currentInstalled = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                                currentInstalled[pkgName] = { 
                                    code: codeString,
                                    version: pkg.version
                                };
                                localStorage.setItem('installed_packages', JSON.stringify(currentInstalled));
                                term.writeLine(`Successfully installed ${pkgName}.`);
                            } catch (err) {
                                term.writeHtml(`<span class="term-error">Failed to fetch ${pkgName}: ${err.message}</span>`);
                            }
                        } else {
                            // 虚拟包逻辑 (无代码，仅权限)
                            let currentInstalled = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                            currentInstalled[pkgName] = { 
                                code: null, 
                                version: pkg.version 
                            };
                            localStorage.setItem('installed_packages', JSON.stringify(currentInstalled));
                            term.writeLine(`Permissions for ${pkgName} activated.`);
                        }
                    }
                    break;

                case 'remove':
                     const pkgsToRemove = args.slice(1);
                     if (pkgsToRemove.length === 0) { term.writeLine("Usage: sudo apt remove <package1> [package2...]"); return; }
                     
                     for (const pkgName of pkgsToRemove) {
                        let installed = JSON.parse(localStorage.getItem('installed_packages') || '{}');
                        if (!installed[pkgName]) {
                            term.writeLine(`${pkgName} is not installed.`);
                            continue;
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
    const commandStrings = splitByUnquotedChar(line, ';').map(cmd => cmd.trim()).filter(cmd => cmd.length > 0);
    const parsedCommands = [];
    for (const commandStr of commandStrings) {
        const parsed = parseSingleCommand(commandStr);
        if (parsed) { parsedCommands.push(parsed); } 
        else { console.error(`Failed to parse: "${commandStr}"`); }
    }
    return parsedCommands;
}

function parseSingleCommand(commandStr) {
    const tokens = tokenizeCommand(commandStr);
    if (!tokens || tokens.length === 0) { return null; }
    const commandName = tokens[0];
    const args = [];
    const options = {};
    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.startsWith('--')) {
            const optName = token.substring(2);
            if (optName) { options[optName] = true; }
        } else if (token.startsWith('-')) {
            const optString = token.substring(1);
            if (optString.length > 0) {
                for (const char of optString) { options[char] = true; }
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
    'tabs': ['ls', 'switch', 'close', 'groups', 'group', 'group-add', 'ungroup', 'group-title', 'group-color', 'save-group', 'saved', 'load-group'],
    'apt': ['update', 'list', 'install', 'remove', 'upgrade'],
    'style': ['font', 'size', 'bg', 'fg', 'stdout', 'stderr', 'accent', 'cursor', 'wall', 'opacity', 'reset'],
    'ext': ['ls', 'toggle', 'enable', 'disable', 'uninstall'],
    'theme': () => {
        if (typeof ThemeManager !== 'undefined' && ThemeManager.presets) {
            return Object.keys(ThemeManager.presets);
        }
        return ['default'];
    },
    'mv': [], // 标记为 'path'
    'cp': [], // 标记为 'path'
    'cd': [], // 标记为 'path'
    'ls': [], // 标记为 'path'
    'cat': [], // 标记为 'path'
    'nano': [], // 标记为 'path'
    'vim': [], // 标记为 'path'
    'rm': [], // 标记为 'path'
    'mkdir': [], // 标记为 'path'
    'sh': [], // 标记为 'path'
    'source': [], // 标记为 'path'
    '.': () => {
        if (!bookmarkSystem || !bookmarkSystem.current) return [];
        
        const children = bookmarkSystem.current.children || [];
        
        // 过滤条件：不是目录 且 (是 VFS 脚本 或 拥有 +x 权限)
        return children
            .filter(node => {
                if (node.children) return false; // 排除目录
                
                // 检查 VFS 脚本
                if (node.id.startsWith('vfs-bin-')) return true;
                
                // 检查权限位 (0o100 = User Executable)
                const meta = getMetadata(node);
                return (meta.mode & 0o100) !== 0;
            })
            .map(node => node.title); // 只返回文件名
    },
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

async function updateSystemVersion() {
    const API_URL = "https://api.tianyibrad.com/api/collections/ST2_0/records?sort=-created&perPage=1";
    try {
        const response = await fetch(API_URL);
        if (response.ok) {
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                const latestVersion = data.items[0].version;
                // 将版本号存入缓存
                localStorage.setItem('st2_system_version', latestVersion);
                // console.log(`[System] Version updated to ${latestVersion}`);
            }
        }
    } catch (e) {
        console.warn("[System] Failed to check for updates:", e);
    }
}

const ANNOUNCEMENT_CACHE_KEY = 'st2_service_broadcast';

function isActiveBroadcast(record) {
    return record && (record.is_active === true || record.is_active === 1 ||
        record.is_active === '1' || String(record.is_active).toLowerCase() === 'true');
}

function announcementColor(type) {
    switch (String(type || 'info').toLowerCase()) {
        case 'warning': return 'var(--announcement-warning, #f1c40f)';
        case 'maintenance': return 'var(--announcement-maintenance, #bd93f9)';
        case 'danger': return 'var(--announcement-danger, #ff5555)';
        default: return 'var(--announcement-info, #26c6da)';
    }
}

function wrapAnnouncementText(text, maxLength) {
    const lines = [];
    // 归一化所有换行/行分隔符：#terminal-buffer 是 white-space: pre，
    // 任何字面换行字符（不只是 \n）都会在 buffer 行内产生真实的视觉换行，
    // 导致行尾填充只作用于整块文本而不是每个可见子行（与多行粘贴同类问题）。
    const normalized = String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u2028\u2029]/g, '\n');
    for (const paragraph of normalized.split('\n')) {
        let remaining = paragraph;
        while (remaining.length > maxLength) {
            let breakAt = remaining.lastIndexOf(' ', maxLength);
            if (breakAt <= 0) breakAt = maxLength;
            lines.push(remaining.slice(0, breakAt).trimEnd());
            remaining = remaining.slice(breakAt).trimStart();
        }
        lines.push(remaining);
    }
    return lines;
}

function writeAnnouncementText(text, color, bold = false) {
    // writeHtml() can wrap by truncating HTML fragments. Keep every styled line shorter
    // than the terminal width so its closing span is never split off.
    const maxLength = Math.max(1, term.cols - 1);
    const weight = bold ? '; font-weight: bold' : '';
    for (const line of wrapAnnouncementText(text, maxLength)) {
        term.writeHtml(`<span style="color: ${color}${weight};">${term.escapeHtml(line)}</span>`);
    }
}

function displayCachedAnnouncement() {
    let announcement;
    try {
        announcement = JSON.parse(localStorage.getItem(ANNOUNCEMENT_CACHE_KEY) || 'null');
    } catch (_) {
        localStorage.removeItem(ANNOUNCEMENT_CACHE_KEY);
        return;
    }
    if (!announcement) return;

    const color = announcementColor(announcement.type);
    const type = String(announcement.type || 'info').toUpperCase();
    const title = String(announcement.title || 'Announcement');
    const message = String(announcement.message || '');
    term.writeLine('');
    writeAnnouncementText(`[${type}] ${title}`, color, true);
    if (message) writeAnnouncementText(message, color);
    if (announcement.allow_dismiss === true || announcement.allow_dismiss === 1 ||
        String(announcement.allow_dismiss).toLowerCase() === 'true') {
        term.writeHtml(`<span style="color: var(--terminal-foreground-color); opacity: .7;">(Dismissible announcement)</span>`);
    }
}

async function updateServiceBroadcast() {
    try {
        const response = await fetch(Resources.urls.api_broadcasts, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Server responded with ${response.status}`);
        const data = await response.json();
        const records = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
        const latestSt2 = records.find(record => String(record.target || '').toUpperCase() === 'ST2');

        // The newest ST2 record controls visibility. An inactive newest record clears stale notices.
        if (latestSt2 && isActiveBroadcast(latestSt2)) {
            localStorage.setItem(ANNOUNCEMENT_CACHE_KEY, JSON.stringify({
                id: latestSt2.id,
                title: latestSt2.title || '',
                message: latestSt2.message || '',
                target: latestSt2.target,
                is_active: latestSt2.is_active,
                allow_dismiss: latestSt2.allow_dismiss,
                type: latestSt2.type || 'info'
            }));
        } else {
            localStorage.removeItem(ANNOUNCEMENT_CACHE_KEY);
        }
    } catch (e) {
        console.warn('[System] Failed to check service broadcasts:', e);
    }
}

/**
 * 命令执行引擎
 * - 正确处理分号 (;) [顺序执行]
 * - 正确处理管道 (|) [流式执行]
 */
/**
 * 核心命令执行引擎
 * 支持:
 * 1. 变量赋值: VAR=value
 * 2. 命令替换: $(command)
 * 3. 顺序执行: cmd1; cmd2
 * 4. 管道流: cmd1 | cmd2
 */
function splitByUnquotedChar(str, delimiter) {
    const parts = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escapeNext = false;

    for (let i = 0; i < str.length; i++) {
        const ch = str[i];

        if (escapeNext) {
            current += ch;
            escapeNext = false;
            continue;
        }

        if (ch === '\\') {
            escapeNext = true;
            continue;
        }

        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += ch;
            continue;
        }

        if (ch === '\'' && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += ch;
            continue;
        }

        if (ch === delimiter && !inSingleQuote && !inDoubleQuote) {
            parts.push(current);
            current = '';
            continue;
        }

        current += ch;
    }

    parts.push(current);
    return parts;
}

/**
 * 智能分割命令行字符串
 * 忽略引号内（' 和 "）以及被转义（\）的分隔符
 */
function splitSmart(str, delimiter) {
    const result = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let isEscaped = false;

    for (let i = 0; i < str.length; i++) {
        const char = str[i];

        if (isEscaped) {
            // 如果前一个字符是 \，当前字符直接并入，不作为分隔符处理
            current += char;
            isEscaped = false;
            continue;
        }

        if (char === '\\') {
            isEscaped = true;
            current += char; // 保留 \，交由后续 unescapePath 处理
            continue;
        }

        // 处理引号状态翻转
        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
        }

        // 仅在不在引号内且遇到目标分隔符时进行切割
        if (char === delimiter && !inSingleQuote && !inDoubleQuote) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    if (current.trim()) {
        result.push(current.trim());
    }
    
    // 过滤掉空字符串
    return result.filter(cmd => cmd.length > 0);
}

function tokenizeCommand(commandStr) {
    const parts = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaping = false;

    const decodeEscape = (ch) => {
        switch (ch) {
            case 'n': return '\n';
            case 'r': return '\r';
            case 't': return '\t';
            case 'b': return '\b';
            case 'f': return '\f';
            case 'v': return '\v';
            case '\\': return '\\';
            case '"': return '"';
            case "'": return "'";
            case ' ': return ' ';
            case '|': return '|';
            case ';': return ';';
            default: return ch;
        }
    };

    const pushToken = () => {
        if (current.length > 0) {
            parts.push(current);
            current = '';
        }
    };

    for (let i = 0; i < commandStr.length; i++) {
        const ch = commandStr[i];

        if (escaping) {
            current += decodeEscape(ch);
            escaping = false;
            continue;
        }

        if (ch === '\\') {
            escaping = true;
            continue;
        }

        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (ch === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }

        if (/\s/.test(ch) && !inSingleQuote && !inDoubleQuote) {
            pushToken();
            continue;
        }

        current += ch;
    }

    if (escaping) {
        current += '\\';
    }
    pushToken();
    return parts;
}

async function executeLine(line) {
    if (executeNestLevel > 10) return;
    awaiting();

    // --- 1. $(...) 命令替换 (保持不变) ---
    const subCmdRegex = /\$\((.*?)\)/g;
    let match;
    let processedLine = line;
    while ((match = subCmdRegex.exec(line)) !== null) {
        const fullMatch = match[0]; 
        const innerCmd = match[1];  
        const wasSilent = term.isSilent;
        term.isSilent = true; 
        const result = await executeLine(innerCmd); 
        term.isSilent = wasSilent; 
        let replacement = "";
        if (Array.isArray(result)) replacement = result.join(' '); 
        else if (typeof result === 'object' && result !== null) replacement = JSON.stringify(result);
        else replacement = String(result || "");
        processedLine = processedLine.replace(fullMatch, replacement);
    }
    
    // --- 2. 顺序执行 ; (保持不变) ---
    const processedLineForSeq = processedLine.replace(/\n/g, ';');
    const sequentialCommands = splitSmart(processedLineForSeq, ';')
                                   .filter(cmd => !cmd.startsWith('#'));

    let finalResult = null;

    for (const commandSequence of sequentialCommands) {
        
        // --- 3. 管道 | (使用智能分割) ---
        const pipelineStrings = splitSmart(commandSequence, '|');
        let lastOutput = null; 

        for (let i = 0; i < pipelineStrings.length; i++) {
            let commandStr = pipelineStrings[i];
            
            // ==========================================
            // 重定向解析逻辑
            // ==========================================
            
            // 1. 重置当前 IO 状态
            term.resetIO();

            // 2. 解析输入重定向 (< file)
            // 匹配 < 后面跟着非空字符
            const inputRedirectMatch = commandStr.match(/<\s*([^\s]+)/);
            if (inputRedirectMatch) {
                const inputFile = inputRedirectMatch[1];
                try {
                    const content = readFileContent(inputFile);
                    // 将文件内容转换为行数组，作为 pipedInput 传入
                    lastOutput = content.split('\n');
                    // 从命令字符串中移除重定向部分
                    commandStr = commandStr.replace(inputRedirectMatch[0], '');
                } catch (e) {
                    term.writeError(`startsh: ${e.message}`);
                    break; // 停止当前管道
                }
            }

            // 3. 解析输出重定向 (1>, 2>, >, >>, 2>>)
            // Regex: (fd?)(>>?) \s* (filename)
            // Groups: 1=(1 or 2 or empty), 2=(> or >>), 3=(filename)
            // 注意：要循环匹配，因为可能同时有 1>out 2>err
            const redirectRegex = /([12]?)(>>?)\s*([^\s]+)/g;
            let rMatch;
            const tasks = []; // 存储重定向任务

            // 这里的 replace 是为了把重定向部分从命令字符串中剔除
            // 同时收集重定向信息
            commandStr = commandStr.replace(redirectRegex, (full, fdStr, op, target) => {
                const fd = (fdStr === '2') ? 2 : 1; // 默认为 1 (stdout)
                const type = (op === '>>') ? 'append' : 'overwrite';
                term.setRedirect(fd, type, target);
                tasks.push({ fd, type, target });
                return ''; // 删除该部分
            });

            // ==========================================
            // [结束] 重定向解析
            // ==========================================

            // --- 4. 变量赋值 (VAR=VAL) (保持不变) ---
            if (i === 0 && commandStr.includes('=')) {
                const assignMatch = commandStr.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
                if (assignMatch) {
                    const key = assignMatch[1];
                    let val = assignMatch[2];
                    val = val.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, v) => Environment[v] || "");
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    Environment[key] = val;
                    continue; 
                }
            }

            // --- 5. 解析单个命令 (保持不变) ---
            const parsed = parseSingleCommand(commandStr); // 解析剔除了重定向后的纯命令
            if (!parsed) continue;

            let { command, args, options } = parsed;

            // ... (变量替换 expandVars 保持不变) ...
            const expandVars = (str) => {
                return str.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, varName) => {
                    return Environment[varName] || "";
                });
            };

            args = args.map(arg => {
                if (arg.startsWith('"') && arg.endsWith('"')) {
                    return expandVars(arg.slice(1, -1));
                } else if (arg.startsWith("'") && arg.endsWith("'")) {
                    return arg.slice(1, -1);
                } else {
                    return expandVars(unescapePath(arg));
                }
            });
            command = unescapePath(expandVars(command));

            // ... (Alias 展开保持不变) ...
            if (AliasEnvironment[command]) {
                const aliasContent = AliasEnvironment[command];
                const reCombinedArgs = args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
                const aliasParsed = parseSingleCommand(aliasContent + " " + reCombinedArgs);
                if (aliasParsed) {
                    command = aliasParsed.command;
                    args = aliasParsed.args;
                    options = { ...aliasParsed.options, ...options };
                }
            }
            
            // --- 7. 查找命令 (保持不变) ---
            let commandFunc = null;
            if (command.startsWith('./') || command.startsWith('/') || command.startsWith('~/')) {
                const result = bookmarkSystem._findNodeByPath(command);
                if (!result || !result.node) {
                    term.writeError(`startsh: ${t('noSuchFileOrDir')}: ${command}`); // 改用 writeError
                    isPiping = false; break;
                }
                if (hasPermission(result.node, 'x')) {
                    commandFunc = globalCommands.sh;
                    args.unshift(command);
                } else {
                    term.writeError(`startsh: ${t('permissionDenied')}: ${command}`); // 改用 writeError
                    isPiping = false; break;
                }
            } else if (bookmarkSystem.commands[command]) {
                commandFunc = bookmarkSystem.commands[command];
            } else if (globalCommands[command]) {
                commandFunc = globalCommands[command];
            } else {
                const vfsPath = '/bin/' + command;
                const result = bookmarkSystem._findNodeByPath(vfsPath);
                if (result && result.node && !result.node.children) {
                    if (hasPermission(result.node, 'x')) {
                        commandFunc = globalCommands.sh;
                        args.unshift(vfsPath);
                    } else {
                        term.writeError(`startsh: ${t('permissionDenied')}: ${vfsPath}`);
                        isPiping = false; break;
                    }
                }
            }

            // --- 8. 管道状态 (保持不变) ---
            isPiping = (i < pipelineStrings.length - 1);
            if (isPiping) pipeBuffer = [];

            // --- 9. 执行命令 (保持不变) ---
            const installedPkgs = JSON.parse(localStorage.getItem('installed_packages') || '{}');
            const sandboxPkg = installedPkgs[command];

            if (commandFunc) {
                try {
                    const result = commandFunc(args, options, lastOutput);
                    if (result instanceof Promise) lastOutput = await result;
                    else lastOutput = result;
                } catch (e) {
                    term.writeError(e.message);
                }
            } else if (sandboxPkg) {
                term._writeLogHtml(`<span style="color:gray;">${t('sandboxExec').replace('{0}', command)}</span>`);
                const result = await term.executeInSandbox(sandboxPkg.code, args, options, lastOutput);
                lastOutput = result; 
            } else if (command.trim() !== '') {
                term.writeError(`startsh: ${t('cmdNotFound')}: ${command}`);
                isPiping = false; break;
            }

            // ==========================================
            // [新增] 处理重定向落地 (Flush Buffers)
            // ==========================================
            
            // 只有当 stdout 被重定向了，我们才保存它
            if (term.ioState.stdout) {
                const content = term.ioState.buffer.stdout;
                // 如果是管道中间的命令，通常 stdout 被重定向给下一个命令 (pipeBuffer)
                // 但如果用户显式写了 > file，则 pipeBuffer 可能会变空，或者行为取决于 Shell 实现。
                // 这里我们假设 > file 优先级高于管道（截断流），或者在 Linux 中 tee 行为。
                // 简单起见：> file 写入文件。
                if (content.length > 0) {
                    try {
                        await writeFile(term.ioState.stdout.path, content, term.ioState.stdout.type === 'append');
                    } catch (e) {
                        term.writeError(`IO Error: ${e.message}`);
                    }
                }
            }

            // 处理 stderr 落地
            if (term.ioState.stderr) {
                const content = term.ioState.buffer.stderr;
                if (content.length > 0) {
                    try {
                        await writeFile(term.ioState.stderr.path, content, term.ioState.stderr.type === 'append');
                    } catch (e) {
                        // 如果连 stderr 都写不进去，那就写屏吧
                        term._writeSingleLine(`<span class="term-error">IO Error writing stderr: ${e.message}</span>`);
                        term._handleNewline();
                    }
                }
            }

            // ==========================================

            if (isPiping) {
                if (!lastOutput && pipeBuffer.length > 0) lastOutput = pipeBuffer;
            }
        }
        finalResult = lastOutput; 
    }
    
    await bookmarkSystem._refreshBookmarks();
    term.resetIO(); // 彻底清理
    done();
    return finalResult; 
}


async function main() {
    // Uptime 
    window.st2_startTime = Date.now();

    // Load Settings 
    loadStyleSettings();

    term.writeLine(t('bootProgress'));

    // 2. 初始化终端 (清空缓冲区) [!!]
    // 必须在任何 .startrc 打印之前运行
    await term.initialize();

    // 3. 初始化文件系统 (现在不运行 .startrc) [!!]
    await bookmarkSystem.initialize();

    // 4. 加载用户环境 (这将运行 .startrc 并打印 'welcome' 命令) [!!]
    const activeUser = localStorage.getItem('st2_active_user') || 'user';
    await loadEnvironment(activeUser); // 'welcome' 在这里被打印

    // 5. 设置处理器
    term.onCommand = executeLine;
    term.onTab = handleTabCompletion;

    // 6. 打印静态欢迎信息
    // term.writeLine(t('welcome'));
    // term.writeLine(t('features'));
    localStorage.setItem('st2_last_login', new Date().toISOString());

    // 7. 启用输入 
    // 我们不需要 update_user_path()，因为 loadEnvironment() (L77) 已经调用了它。
    term.enableInput(); 

    updateSystemVersion();
    updateServiceBroadcast();
}

// 使用 load 事件 
window.addEventListener('load', main);

// main();

