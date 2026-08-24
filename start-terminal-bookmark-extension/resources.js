// resources.js
// 存储所有非语言的静态资源、URL 和配置常量

const Resources = {
    // 所有的外部链接
    urls: {
        // 文档中心 (按语言区分)
        docs: {
            en: "https://aka.bradleyproject.eu.org/st20_doc",
            zh: "https://aka.bradleyproject.eu.org/st20_doc_zh"
        },
        // 软件仓库 (APT)
        repo: "https://raw.githubusercontent.com/BradleyBao/StartTerminal2/main/start-terminal-bookmark-extension/repo/",
        // 更新 API (PocketBase)
        api_updates: "https://api.tianyibrad.com/api/collections/ST2_0/records?sort=-created&perPage=1",
        // Cross-application service broadcasts
        api_broadcasts: "https://api.tianyibrad.com/api/collections/Service_Broadcast/records?sort=-created&perPage=100",
        // 支持/官网
        support: "https://www.tianyibrad.com",
        // 扩展管理页面
        extensions: "chrome://extensions"
    },

    // 系统常量 (可选)
    system: {
        default_user: "user",
        default_host: "ST2.0",
        repo_index_file: "index.json"
    }
};
