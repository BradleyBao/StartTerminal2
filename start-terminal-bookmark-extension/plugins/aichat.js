/**
 * aichat - A generic and configurable AI chat plugin.
 * This version uses the TerminalAPI to persistently store its own configuration
 * (API Key, Endpoint, Response Path) in chrome.storage.sync.
 */
(function() {
    const DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent";
    const DEFAULT_RESPONSE_PATH = "candidates[0].content.parts[0].text";

    // --- Plugin's private state, stored only in the sandbox memory for the session ---
    let conversationHistory = [];
    let config = null; // 将用于在会话期间缓存配置

    /**
     * 辅助函数，用于安全地从对象中按路径获取值。
     */
    function getValueFromPath(obj, path) {
        if (!path) return undefined;
        return path.split(/[.\[\]]+/).filter(Boolean).reduce((o, k) => (o || {})[k], obj);
    }

    /**
     * 辅助函数，用于加载并缓存配置。
     */
    async function loadConfig() {
        if (config === null) { // 只在第一次需要时加载
            config = await TerminalAPI.getPluginConfig();
        }
        return config;
    }

    TerminalAPI.registerCommand('aichat', {
        exec: async (args) => {
            await loadConfig(); // 确保配置已加载

            // --- 1. 优先处理配置命令 ---
            if (args[0] === 'config') {
                const key = args[1];
                const value = args.slice(2).join(' ');

                if (!key) {
                    TerminalAPI.print("Usage: aichat config <key> [value]", "error");
                    TerminalAPI.print("Keys: --key, --endpoint, --path, --show, --reset", "hint");
                    return;
                }

                switch (key) {
                    case 'key':
                        if (!value) return TerminalAPI.print("Usage: aichat config --key <YOUR_API_KEY>", "error");
                        config.apiKey = value;
                        await TerminalAPI.setPluginConfig(config);
                        TerminalAPI.print("API Key has been saved.", "success");
                        break;
                    case 'endpoint':
                        if (!value) return TerminalAPI.print("Usage: aichat config --endpoint <URL>", "error");
                        config.endpoint = value;
                        await TerminalAPI.setPluginConfig(config);
                        TerminalAPI.print(`API Endpoint set to: ${value}`, "success");
                        break;
                    case 'path':
                        if (!value) return TerminalAPI.print("Usage: aichat config --path <response.path>", "error");
                        config.responsePath = value;
                        await TerminalAPI.setPluginConfig(config);
                        TerminalAPI.print(`Response Path set to: ${value}`, "success");
                        break;
                    case 'show':
                        TerminalAPI.print("--- AI Chat Configuration ---", 'highlight');
                        TerminalAPI.print(`Endpoint:      ${config.endpoint || DEFAULT_ENDPOINT}`);
                        TerminalAPI.print(`Response Path: ${config.responsePath || DEFAULT_RESPONSE_PATH}`);
                        TerminalAPI.print(`API Key:       ${config.apiKey ? '********' : 'Not set'}`);
                        break;
                    case 'reset':
                        config = {}; // 清空本地缓存
                        await TerminalAPI.setPluginConfig({}); // 清空存储
                        TerminalAPI.print("Configuration reset to default (Google Gemini).", "success");
                        TerminalAPI.print("Note: API key has been cleared.", "warning");
                        break;
                    default:
                        TerminalAPI.print(`Unknown config key: '${key}'`, "error");
                }
                return;
            }

            // --- 2. 检查API密钥是否已配置 ---
            if (!config.apiKey) {
                TerminalAPI.print("AI API key not configured.", "error");
                TerminalAPI.print("Please set it first using:", "hint");
                TerminalAPI.print("  aichat config --key <YOUR_API_KEY>", "hint");
                return;
            }
            
            // --- 3. 处理会话命令 ---
            if (args[0] === '--new' || args[0] === '-n') {
                conversationHistory = [];
                TerminalAPI.print("New chat session started.", 'success');
                return;
            }
            if (args[0] === '--history') {
                TerminalAPI.print("--- Current Session History ---", "highlight");
                if (conversationHistory.length === 0) {
                    TerminalAPI.print("(No history in this session)");
                } else {
                    conversationHistory.forEach(turn => {
                        TerminalAPI.print(`[${turn.role}]: ${turn.parts[0].text}`);
                    });
                }
                return;
            }
            
            const prompt = args.join(' ');
            if (!prompt) {
                 TerminalAPI.print("Usage: aichat <prompt>", "error");
                 return;
            }

            // --- 4. 核心聊天逻辑 ---
            TerminalAPI.print("AI is thinking...", 'info');
            const endpoint = (await loadConfig()).endpoint || DEFAULT_ENDPOINT;
            const path = (await loadConfig()).responsePath || DEFAULT_RESPONSE_PATH;
            const apiKey = (await loadConfig()).apiKey;

            const requestBody = {
                contents: [
                    ...conversationHistory,
                    {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                ]
            };

            try {
                const data = await TerminalAPI.request('generic_fetch', {
                    url: `${endpoint}?key=${apiKey}`,
                    options: {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody)
                    }
                });
                const aiResponse = getValueFromPath(data, path);

                if (typeof aiResponse !== 'string' || !aiResponse.trim()) {
                    TerminalAPI.print(`Error: Could not find valid text at path '${path}'.`, 'error');
                    return;
                }

                TerminalAPI.print(aiResponse, 'highlight');
                conversationHistory.push({ role: "user", parts: [{ text: prompt }] });
                conversationHistory.push({ role: "model", parts: [{ text: aiResponse }] });

            } catch (e) {
                TerminalAPI.print(`Request failed: ${e.message}`, 'error');
            }
        },
        manual: `NAME
  aichat - a configurable chat interface for AI models.

SYNOPSIS
  aichat config <key> [value]
  aichat <prompt>

DESCRIPTION
  Starts a conversational chat with a user-configured AI model.
  Your configuration is saved permanently.

CONFIGURATION
  aichat config key <API_KEY>
    Sets and saves your API key.

  aichat config endpoint <URL>
    Sets and saves the API URL.

  aichat config path <dot.notation.path>
    Sets and saves the path to the text response in the result JSON.
  
  aichat config show
    Displays the current configuration.
  
  aichat config reset
    Resets all configurations to default.

CHAT
  aichat <prompt>
    Sends your question to the AI.`
    });
})();
