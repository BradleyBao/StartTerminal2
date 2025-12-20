/**
 * theme.js - 主题管理模块
 */

const ThemeManager = {
    // 预设主题库
    presets: {
        'default': {
            // 经典 VSCode Dark 风格，但选区改为经典的 白底黑字
            bg: '#1e1e1e', 
            fg: '#d4d4d4', 
            accent: '#4CAF50', 
            cursor: '#d4d4d4',
            selectionBg: '#ffffff', // [修改] 激进的高亮改为经典的白色背景
            selectionFg: '#000000'  // [修改] 黑色文字
        },
        'matrix': {
            // 黑客帝国：选区保持绿色调，但降低透明度
            bg: '#000000', 
            fg: '#00FF00', 
            accent: '#008F11', 
            cursor: '#00FF00',
            selectionBg: 'rgba(0, 255, 0, 0.3)',
            selectionFg: 'inherit'
        },
        'dracula': {
            bg: '#282a36', 
            fg: '#f8f8f2', 
            accent: '#bd93f9', 
            cursor: '#f8f8f2',
            selectionBg: '#44475a', // Dracula 官方选区色
            selectionFg: 'inherit'
        },
        'ubuntu': {
            bg: '#300a24', 
            fg: '#ffffff', 
            accent: '#E95420', 
            cursor: '#ffffff',
            selectionBg: '#E95420', // Ubuntu 使用橙色选区
            selectionFg: '#ffffff'
        },
        'powershell': {
            bg: '#012456', 
            fg: '#ffffff', 
            accent: '#f1c500', 
            cursor: '#ffffff',
            selectionBg: 'rgba(255, 255, 255, 0.5)',
            selectionFg: '#000000'
        },
        'solarized-dark': {
            bg: '#002b36', 
            fg: '#839496', 
            accent: '#b58900', 
            cursor: '#93a1a1',
            selectionBg: '#073642',
            selectionFg: 'inherit'
        },
        'monokai': {
            bg: '#272822', 
            fg: '#f8f8f2', 
            accent: '#a6e22e', 
            cursor: '#f8f8f2',
            selectionBg: 'rgba(255, 255, 255, 0.2)',
            selectionFg: 'inherit'
        }
    },

    /**
     * 应用主题到 CSS 变量
     */
    apply: function(themeName) {
        const theme = this.presets[themeName] || this.presets['default'];
        const root = document.documentElement;

        // 基础颜色
        root.style.setProperty('--terminal-background-color', theme.bg);
        root.style.setProperty('--terminal-foreground-color', theme.fg);
        root.style.setProperty('--terminal-accent', theme.accent);
        
        // 光标
        root.style.setProperty('--cursor-bg-color', theme.cursor);
        root.style.setProperty('--cursor-fg-color', theme.bg); // 光标文字通常反色

        // 选区 (Selection) - 这里实现了你的需求
        root.style.setProperty('--terminal-selection-background', theme.selectionBg);
        root.style.setProperty('--terminal-selection-foreground', theme.selectionFg || 'inherit');
    },

    /**
     * 启动时加载
     */
    load: function() {
        const savedName = localStorage.getItem('terminalThemeName') || 'default';
        this.apply(savedName);
        console.log(`[Theme] Loaded: ${savedName}`);
        return savedName;
    },

    /**
     * 切换主题
     */
    set: function(themeName) {
        if (this.presets[themeName]) {
            this.apply(themeName);
            localStorage.setItem('terminalThemeName', themeName);
            return true;
        }
        return false;
    },

    /**
     * 获取主题列表 (用于 theme ls)
     */
    getList: function() {
        return Object.keys(this.presets).map(name => {
            return {
                name: name,
                accent: this.presets[name].accent,
                active: (localStorage.getItem('terminalThemeName') || 'default') === name
            };
        });
    }
};