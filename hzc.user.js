// ==UserScript==
// @name         惠资产账户管理 (自动同步Token版-修复验证码登录)
// @namespace    http://violentmonkey.net/
// @version      1.4
// @description  管理账号+快速切换+去水印
// @author       Mai
// @match        *://*.yonghui.cn/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        unsafeWindow
// @grant        GM_notification
// @run-at       document-start
// @inject-into  page
// ==/UserScript==

(function () {
    'use strict';
    // ================= 配置区域 =================
    const REDIRECT_URL = 'https://hzcf.yonghui.cn/';
    const BALL_POS_KEY = 'VM_BALL_POS';
    const BALL_VISIBLE_KEY = 'VM_BALL_VISIBLE';
    const STORAGE_KEY = 'p2a_remove_watermark_enabled';
    const GlobalVarName = "webpackChunkp2a_platform_fe"
    const blockedKeywords = ['微信', 'ua', 'name', 't', 'browserName']
    const Patches = [
        {
            find: /watermark_alpha\s*:\s*0?\.04/g,
            replace: 'watermark_alpha:0'
        },
        {
            find: /watermark_txt\s*:/g,
            replace: 'watermark_txt:"",_ignore_txt:'
        }
    ]
    const MSG_CONFIG = {
        url: 'https://hzc.yonghui.cn/hmsg/v1/1/messages/user?size=10&page=0&readFlag=0',
        interval: 300 * 1000,
        checkHasUnread: (json) => {
            if (json && json.empty === false) {
                const count = Number(json.totalElements);
                return !isNaN(count) && count > 0;
            }
            return false;
        },
        getUnreadCount: (json) => {
            return (json && json.totalElements) ? json.totalElements : "新";
        }
    };
    let lastUnreadStatus = false;
    let lastUnreadCount = 0;
    // ===========================================

    // 初始化数据
    let isEnabled = GM_getValue(STORAGE_KEY, true);
    let CONFIG = GM_getValue('VM_ACCOUNT_MANAGER', { current: null, list: {} });
    let activeProfileId = CONFIG.current;
    let activeProfile = activeProfileId ? CONFIG.list[activeProfileId] : null;
    const LOCK_MAP = activeProfile ? activeProfile.data : {};
    const KEYS = Object.keys(LOCK_MAP);
    const IS_ACTIVE = KEYS.length > 0;
    hookConsoleMethod('log', blockedKeywords);
    let isExiting = false;

    // =================================================
    // 🛠️ 核心工具函数
    // =================================================

    const safeSetCookie = (key, val) => {
        const hostname = location.hostname;
        const paths = ['/', location.pathname];
        const targetDomains = [undefined, hostname];

        targetDomains.forEach(d => {
            paths.forEach(p => {
                const domainAttr = d ? `; domain=${d}` : '';
                document.cookie = `${key}=; path=${domainAttr}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
            });
        });
        document.cookie = `${key}=${val}; path=/; max-age=604800`;
    };

    const applyAccountData = (dataMap) => {
        if (!dataMap) return;
        Object.keys(dataMap).forEach(key => {
            const val = dataMap[key];
            try {
                localStorage.setItem(key, val);
                sessionStorage.setItem(key, val);
                safeSetCookie(key, val);
            } catch (e) {
                console.error("[VM] Apply Error:", e);
            }
        });
    };

    function hookConsoleMethod(methodName, keywords) {
        const targetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const origin = targetWindow.console[methodName];

        targetWindow.console[methodName] = function (...args) {
            const str = args.map(String).join(' ');
            if (keywords.some(k => str.includes(k))) return;
            origin.apply(targetWindow.console, args);
        }
    }

    // 更新托管的Token配置（修复登录问题的关键）
    function updateManagedToken(key, value) {
        if (!activeProfileId || !CONFIG.list[activeProfileId]) return;
        if (!value || value === "null" || value === "undefined") return;

        // 如果值发生了变化，更新内存和存储
        if (CONFIG.list[activeProfileId].data[key] !== value) {
            console.log(`[VM] 检测到登录更新，自动同步 ${key}`);
            CONFIG.list[activeProfileId].data[key] = value;
            if(LOCK_MAP[key]) LOCK_MAP[key] = value; // 更新内存锁
            GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
        }
    }

    function checkMessages() {
        if (!GM_getValue('enable_msg_notify', true)) return;

        const realTimeToken = getCookie('access_token') || localStorage.getItem('access_token');
        if (!realTimeToken) return;

        fetch(MSG_CONFIG.url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${realTimeToken}`
            },
            credentials: 'include'
        })
            .then(response => {
                if (response.ok) {
                    // 二次校验，防止fetch期间Token又变了
                    if (activeProfileId && CONFIG.list[activeProfileId]) {
                        const storedToken = CONFIG.list[activeProfileId].data['access_token'];
                        if (realTimeToken !== storedToken) {
                            updateManagedToken('access_token', realTimeToken);
                            GM_notification({
                                text: `检测到最新的登录凭证，已自动同步到账号：${CONFIG.list[activeProfileId].name}`,
                                title: "🔄 Token自动同步成功",
                                timeout: 3000
                            });
                        }
                    }
                }
                if (!response.ok) throw new Error('Network response was not ok');
                return response.json();
            })
            .then(data => {
                const hasUnread = MSG_CONFIG.checkHasUnread(data);
                const currentCount = Number(MSG_CONFIG.getUnreadCount(data)) || 0;

                if (hasUnread) {
                    if (currentCount > lastUnreadCount || !lastUnreadStatus) {
                        GM_notification({
                            text: `您有 ${currentCount} 条未处理的惠资产消息`,
                            title: "📬 新消息提醒",
                            image: "https://hzcf.yonghui.cn/11e5e72c571b82921cfc.png",
                            timeout: 5000,
                            onclick: () => {
                                window.focus();
                                window.location.href = 'https://hzcf.yonghui.cn/hmsg/user-message/list';
                            }
                        });
                    }
                }
                lastUnreadStatus = hasUnread;
                lastUnreadCount = currentCount;
            })
            .catch(() => {});
    }

    // =================================================
    // 🚀 核心拦截逻辑 (已修复验证码登录Bug)
    // =================================================
    if (IS_ACTIVE) {
        console.log(`%c[VM] 托管中: ${activeProfile.name}`, "color: #00e676; font-weight: bold;");

        // 初始强制写入一次，保证打开页面即登录
        KEYS.forEach(key => {
            const val = LOCK_MAP[key];
            try {
                if (localStorage.getItem(key) !== val) localStorage.setItem(key, val);
                if (sessionStorage.getItem(key) !== val) sessionStorage.setItem(key, val);
                if (getCookie(key) !== val) safeSetCookie(key, val);
            } catch (e) { }
        });

        try {
            // 修复1：Storage 劫持逻辑修改
            const hijackProto = (proto) => {
                const _set = proto.setItem;
                const _remove = proto.removeItem;
                const _clear = proto.clear;

                proto.setItem = function (k, v) {
                    if (!isExiting && LOCK_MAP[k]) {
                        // 【关键修改】如果网站尝试写入新的Token，允许写入并同步更新脚本配置
                        // 而不是直接 return 阻止
                        if (v && v !== LOCK_MAP[k]) {
                            updateManagedToken(k, v);
                        }
                        // 依然执行原方法，让网站正常感知写入成功
                        _set.apply(this, arguments);
                        return;
                    }
                    _set.apply(this, arguments);
                };

                proto.removeItem = function (k) {
                    // 防止意外登出，但允许手动退出操作
                    if (!isExiting && LOCK_MAP[k]) return;
                    _remove.apply(this, arguments);
                };

                proto.clear = function () {
                    if (isExiting) { _clear.apply(this); return; }
                    _clear.apply(this);
                    // 清空时自动恢复受保护的 key
                    KEYS.forEach(k => this.setItem(k, LOCK_MAP[k]));
                };
            };
            hijackProto(Storage.prototype);

            // 修复2：Cookie 劫持逻辑修改
            const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
            if (cookieDesc && cookieDesc.set) {
                const _set = cookieDesc.set;
                Object.defineProperty(document, 'cookie', {
                    configurable: true, enumerable: true,
                    get: function () { return cookieDesc.get.call(document); },
                    set: function (val) {
                        val = String(val).trim();
                        if (!isExiting) {
                            for (let key of KEYS) {
                                if (val.startsWith(`${key}=`)) {
                                    // 提取新 Cookie 的值
                                    const match = val.match(new RegExp(`^${key}=([^;]+)`));
                                    const newVal = match ? match[1] : null;

                                    // 【关键修改】如果检测到 Cookie 更新，同步到配置
                                    if (newVal && newVal !== LOCK_MAP[key]) {
                                        updateManagedToken(key, newVal);
                                    }
                                    // 允许写入
                                    _set.call(document, val);
                                    return;
                                }
                            }
                        }
                        _set.call(document, val);
                    }
                });
            }
        } catch (e) { }
    }

    // =================================================
    // 🎨 UI 构建区域 (保持不变)
    // =================================================
    function initUI() {
        const style = document.createElement('style');
        style.textContent = `
            #vm-ball-container {
                position: fixed; top: 40%; right: -20px; z-index: 2147483647;
                display: flex; flex-direction: row-reverse; align-items: flex-start;
                transition: right 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                font-family: system-ui, -apple-system, sans-serif;
            }
            #vm-ball-container.vm-active { right: 10px; }
            #vm-ball {
                width: 48px; height: 48px;
                background: linear-gradient(135deg, #1872e4 0%, #39e8f5ff 100%);
                border-radius: 50%; box-shadow: 0 4px 15px rgba(0, 114, 255, 0.4);
                cursor: pointer; display: flex; align-items: center; justify-content: center;
                color: white; font-size: 24px; user-select: none; transition: transform 0.2s;
            }
            #vm-ball:active { transform: scale(0.9); }
            #vm-menu-panel {
                display: none; background: white; width: 280px; margin-right: 15px;
                border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.15);
                overflow: hidden; flex-direction: column; animation: vm-fade-in 0.2s ease-out;
                border: 1px solid #eee;
            }
            #vm-ball-container.vm-active #vm-menu-panel { display: flex; }
            .vm-header {
                padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #eee;
                font-size: 13px; color: #666; font-weight: 600; display: flex; justify-content: space-between;
            }
            .vm-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; display: inline-block; margin-right: 6px; }
            .vm-status-dot.active { background: #00e676; box-shadow: 0 0 0 2px rgba(0,230,118,0.2); }
            .vm-list { max-height: 250px; overflow-y: auto; padding: 5px 0; }
            .vm-list-item {
                padding: 10px 16px; cursor: pointer; display: flex; align-items: center;
                font-size: 14px; color: #333; transition: background 0.2s;
            }
            .vm-list-item:hover { background: #f0f7ff; }
            .vm-list-item.current { background: #e6f4ea; color: #1e8e3e; font-weight: 500; }
            .vm-list-item .icon { margin-right: 8px; font-size: 16px; width: 20px; text-align: center;}
            .vm-list-item .del-btn { margin-left: auto; color: #999; padding: 4px; font-size: 12px; }
            .vm-list-item .del-btn:hover { color: #ff4444; }
            .vm-token-status {
                font-size: 10px; margin-left: 8px; padding: 2px 6px; border-radius: 4px; background: #eee; color: #999; font-weight: normal; white-space: nowrap;
            }
            .vm-token-status.valid { background: #e6f4ea; color: #1e8e3e; }
            .vm-token-status.invalid { background: #fce8e6; color: #d93025; }
            .vm-toolbar {
                padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                border-top: 1px solid #eee; background: #fff;
            }
            .vm-btn {
                border: 1px solid #e0e0e0; background: #fff; color: #555; padding: 6px;
                border-radius: 6px; cursor: pointer; font-size: 12px; text-align: center; transition: all 0.2s; display:flex; align-items:center; justify-content:center;
            }
            .vm-btn:hover { background: #f5f5f5; border-color: #ccc; }
            .vm-btn.primary { background: #0072FF; color: white; border-color: #0072FF; }
            .vm-btn.primary:hover { background: #005bb5; }
            .vm-btn.full-width { grid-column: span 2; font-weight: bold; }
            @keyframes vm-fade-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
            .vm-list::-webkit-scrollbar { width: 4px; }
            .vm-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        `;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.id = 'vm-ball-container';
        const savedPos = GM_getValue(BALL_POS_KEY, null);
        if (savedPos && typeof savedPos.top === 'number') {
            const minTop = 0;
            const maxTop = Math.max(window.innerHeight - 60, 0);
            const top = Math.min(Math.max(savedPos.top, minTop), maxTop);
            container.style.top = top + 'px';
        }

        const panel = document.createElement('div');
        panel.id = 'vm-menu-panel';

        const header = document.createElement('div');
        header.className = 'vm-header';
        header.innerHTML = `<span><span class="vm-status-dot ${IS_ACTIVE ? 'active' : ''}"></span>${IS_ACTIVE ? '托管中' : '未托管'}</span><span style="font-size:10px;color:#999;cursor:pointer" id="vm-close-menu">✕</span>`;
        panel.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.className = 'vm-list';
        renderAccountList(listContainer);
        panel.appendChild(listContainer);

        const toolbar = document.createElement('div');
        toolbar.className = 'vm-toolbar';

        const wmBtnText = isEnabled ? '🚫 去水印: 已开启' : '💧 去水印: 已关闭';
        const wmBtnClass = isEnabled ? 'primary full-width' : 'full-width';

        const wmBtn = createBtn(wmBtnText, wmBtnClass, function () {
            isEnabled = !isEnabled;
            GM_setValue(STORAGE_KEY, isEnabled);
            this.textContent = isEnabled ? '🚫 去水印: 已开启' : '💧 去水印: 已关闭';
            this.className = `vm-btn full-width ${isEnabled ? 'primary' : ''}`;
            if (confirm(`去除水印功能已${isEnabled ? '开启' : '关闭'}。\n\n需要刷新页面才能生效，是否立即刷新？`)) {
                location.reload();
            }
        });
        toolbar.appendChild(wmBtn);

        toolbar.append(
            createBtn('➕ 保存当前', 'primary', saveCurrentAsProfile),
            createBtn('🛠️ 改Token', '', manualSetMenu),
            createBtn('📤 导出', '', exportMenu),
            createBtn('📥 导入', '', importMenu)
        );
        panel.appendChild(toolbar);

        const ball = document.createElement('div');
        ball.id = 'vm-ball';
        ball.innerHTML = '🧑‍';
        ball.title = "点击管理账号";

        ball.onclick = (e) => {
            e.stopPropagation();
            container.classList.toggle('vm-active');
            if (container.classList.contains('vm-active')) renderAccountList(listContainer);
        };

        header.querySelector('#vm-close-menu').onclick = (e) => {
            e.stopPropagation();
            container.classList.remove('vm-active');
        };

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) container.classList.remove('vm-active');
        });

        let isDragging = false;
        let startY, startTop;
        ball.addEventListener('mousedown', (e) => {
            isDragging = true; startY = e.clientY; startTop = container.offsetTop; e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newTop = startTop + (e.clientY - startY);
            const minTop = 0;
            const maxTop = Math.max(window.innerHeight - container.offsetHeight, 0);
            newTop = Math.min(Math.max(newTop, minTop), maxTop);
            container.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!isDragging) return;
            isDragging = false;
            const top = container.offsetTop;
            GM_setValue(BALL_POS_KEY, { top });
        });

        container.appendChild(panel);
        container.appendChild(ball);

        const isVisible = GM_getValue(BALL_VISIBLE_KEY, true);
        container.style.display = isVisible ? 'flex' : 'none';
        document.body.appendChild(container);
    }

    function createBtn(text, cls, callback) {
        const btn = document.createElement('div');
        btn.className = `vm-btn ${cls}`;
        btn.textContent = text;
        btn.onclick = callback;
        return btn;
    }

    function verifyToken(token, statusElement) {
        if (!token) {
            statusElement.textContent = "无Token";
            return;
        }
        fetch(MSG_CONFIG.url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        })
        .then(res => {
            if (res.status === 401) {
                statusElement.textContent = "失效,需重新登录";
                statusElement.className = "vm-token-status invalid";
            } else if (res.ok) {
                statusElement.textContent = "有效";
                statusElement.className = "vm-token-status valid";
            } else {
                statusElement.textContent = "未知";
                statusElement.title = `状态码: ${res.status}`;
            }
        })
        .catch(() => {
            statusElement.textContent = "网络误";
        });
    }

    function renderAccountList(container) {
        container.innerHTML = '';
        const ids = Object.keys(CONFIG.list);

        const logoutItem = document.createElement('div');
        logoutItem.className = `vm-list-item ${!IS_ACTIVE ? 'current' : ''}`;
        logoutItem.innerHTML = `<span class="icon">🧹</span><span>停止托管 & 清空Cookie</span>`;
        logoutItem.onclick = () => {
            if (confirm("⚠️ 确定要停止托管并清空当前页面的 Cookie 吗？\n\n这将导致当前页面退出登录。")) {
                isExiting = true;
                CONFIG.current = null;
                GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
                const targetKeys = ["access_token"];
                targetKeys.forEach(key => {
                    localStorage.removeItem(key);
                    sessionStorage.removeItem(key);
                    const domains = [undefined, location.hostname, '.yonghui.cn', location.hostname.split('.').slice(-2).join('.')];
                    const paths = ['/', location.pathname];
                    domains.forEach(d => {
                        paths.forEach(p => {
                            const dAttr = d ? `; domain=${d}` : '';
                            document.cookie = `${key}=; path=${p}${dAttr}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
                        });
                    });
                });
                alertAndRedirect("✅ 已停止托管并清理，即将刷新...");
            }
        };
        container.appendChild(logoutItem);

        if (ids.length === 0) return;

        ids.forEach(id => {
            const acc = CONFIG.list[id];
            const isCurr = (id === CONFIG.current);
            const item = document.createElement('div');
            item.className = `vm-list-item ${isCurr ? 'current' : ''}`;

            const iconSpan = document.createElement('span');
            iconSpan.className = 'icon';
            iconSpan.textContent = isCurr ? '✅' : '👤';

            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;";
            nameSpan.textContent = acc.name;

            const statusSpan = document.createElement('span');
            statusSpan.className = 'vm-token-status';
            statusSpan.textContent = '检测中...';

            const delBtn = document.createElement('span');
            delBtn.className = 'del-btn';
            delBtn.textContent = '🗑️';

            item.appendChild(iconSpan);
            item.appendChild(nameSpan);
            item.appendChild(statusSpan);
            item.appendChild(delBtn);

            const token = acc.data['access_token'];
            verifyToken(token, statusSpan);

            item.onclick = (e) => {
                if (e.target.classList.contains('del-btn')) return;
                if (isCurr) return;
                isExiting = true;
                CONFIG.current = id;
                GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
                alertAndRedirect(`正在切换...`);
            };

            delBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm(`确定删除 [${acc.name}] 吗?`)) {
                    if (CONFIG.current == id) CONFIG.current = null;
                    delete CONFIG.list[id];
                    GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
                    renderAccountList(container);
                }
            };
            container.appendChild(item);
        });
    }

    const waitBody = setInterval(() => {
        if (document.body) { clearInterval(waitBody); initUI(); }
    }, 100);

    // =================================================
    // 🛠️ 功能函数区域
    // =================================================
    function manualSetMenu() {
        const key = "access_token";
        let oldVal = localStorage.getItem(key) || sessionStorage.getItem(key) || getCookie(key) || "";
        if (activeProfile && activeProfile.data[key]) oldVal = activeProfile.data[key];

        let val = prompt(`请输入${key}的新值:`, oldVal);
        if (val === null) return;
        isExiting = true;
        let shouldUpdateProfile = false;
        if (activeProfile) shouldUpdateProfile = confirm(`✅ 即将写入当前页面。\n\n是否同时更新到托管账号 [${activeProfile.name}] 中？`);
        applyAccountData({ [key]: val });
        isExiting = false;

        if (shouldUpdateProfile && activeProfileId) {
            CONFIG.list[activeProfileId].data[key] = val;
            GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
            alertAndRedirect(`✅ 配置已更新并同步！即将跳转...`);
        } else {
            alertAndRedirect(`✅ 仅当前页面已修改，即将跳转...`);
        }
    }

    function saveCurrentAsProfile() {
        let keys = ["access_token"];
        let data = {};
        let found = 0;
        keys.forEach(k => {
            let val = localStorage.getItem(k) || getCookie(k) || sessionStorage.getItem(k);
            if (val) { data[k] = val; found++; }
        });
        if (found === 0) return alert("❌ 未找到有效值，请先登录或手动设置后再抓取。");
        let name = prompt(`给账号起个名:`, "账号-" + Date.now().toString().slice(-4));
        if (!name) return;
        let id = "prof_" + Date.now();
        CONFIG.list[id] = { name: name, data: data };
        CONFIG.current = id;
        GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
        alertAndRedirect(`✅ 账号 [${name}] 已保存!`);
    }

    function exportMenu() {
        let json = JSON.stringify(CONFIG, null, 2);
        try { GM_setClipboard(json); alert("✅ 配置已复制到剪贴板"); }
        catch (e) { prompt("复制下方 JSON:", json); }
    }

    function importMenu() {
        let json = prompt("粘贴配置 JSON:");
        if (!json) return;
        try {
            let newConf = JSON.parse(json);
            if (!newConf.list) throw new Error();
            if (confirm("⚠️ 确定覆盖当前配置吗？")) {
                GM_setValue('VM_ACCOUNT_MANAGER', newConf);
                alertAndRedirect("✅ 导入成功!");
            }
        } catch (e) { alert("❌ 格式错误"); }
    }

    function alertAndRedirect(msg) {
        console.log(msg);
        const targetUrl = (REDIRECT_URL && REDIRECT_URL.trim() !== '') ? REDIRECT_URL : location.href;
        const cleanCurrent = location.href.replace(/\/$/, '');
        const cleanTarget = targetUrl.replace(/\/$/, '');
        if (cleanCurrent === cleanTarget) {
            location.reload();
        } else {
            location.href = targetUrl;
        }
    }

    function getCookie(n) {
        let v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
        return v ? v[2] : null;
    }

    function hookWebpack() {
        let chunkWindow = unsafeWindow || window;
        const hookPush = (originalPush) => {
            return function (chunk) {
                const modules = chunk[1];
                for (let moduleId in modules) {
                    let originalFactory = modules[moduleId];
                    let funcStr = originalFactory.toString();

                    if (funcStr.includes('watermark_txt') && funcStr.includes('watermark_alpha')) {
                        if (!isEnabled) {
                            continue;
                        }
                        let newFuncStr = funcStr;
                        let isPatched = false;

                        Patches.forEach(patch => {
                            if (patch.find.test(newFuncStr)) {
                                newFuncStr = newFuncStr.replace(patch.find, patch.replace);
                                isPatched = true;
                            }
                        });

                        if (isPatched) {
                            try {
                                const patchedFactory = (0, eval)(`(${newFuncStr})`);
                                modules[moduleId] = patchedFactory;
                            } catch (e) {
                                console.error('[Hook Error]', e);
                            }
                        }
                    }
                }
                return originalPush.call(this, chunk);
            };
        };

        let webpackGlobal = chunkWindow[GlobalVarName];
        if (Array.isArray(webpackGlobal)) {
            webpackGlobal.push = hookPush(webpackGlobal.push.bind(webpackGlobal));
        } else {
            let _val;
            Object.defineProperty(chunkWindow, GlobalVarName, {
                get: function () { return _val; },
                set: function (val) {
                    _val = val;
                    if (val && Array.isArray(val)) {
                        val.push = hookPush(val.push.bind(val));
                    }
                },
                configurable: true
            });
        }
    }

    GM_registerMenuCommand("🔄 恢复悬浮球", () => document.getElementById('vm-ball-container').style.display = 'flex');
    GM_registerMenuCommand("👀 显示悬浮球", () => {
        GM_setValue(BALL_VISIBLE_KEY, true);
        const el = document.getElementById('vm-ball-container');
        if (el) el.style.display = 'flex';
    });
    GM_registerMenuCommand("🙈 隐藏悬浮球", () => {
        GM_setValue(BALL_VISIBLE_KEY, false);
        const el = document.getElementById('vm-ball-container');
        if (el) el.style.display = 'none';
    });
    const menuName = isEnabled ? '✅ 去除水印：已开启 (点击关闭)' : '❌ 去除水印：已关闭 (点击开启)';
    GM_registerMenuCommand(menuName, () => {
        isEnabled = !isEnabled;
        GM_setValue(STORAGE_KEY, isEnabled);
        alert(`去除水印功能已${isEnabled ? '开启' : '关闭'}，即将刷新页面生效。`);
        location.reload();
    });
    const toggleMsgName = GM_getValue('enable_msg_notify', true) ? '🔕 关闭消息通知' : '🔔 开启消息通知';
    GM_registerMenuCommand(toggleMsgName, () => {
        const current = GM_getValue('enable_msg_notify', true);
        GM_setValue('enable_msg_notify', !current);
        alert(`消息通知已${!current ? '开启' : '关闭'}。`);
    });
    hookWebpack();

    // 启动时立即检查一次
    checkMessages();
    setInterval(() => {
        if (GM_getValue('enable_msg_notify', true)) {
            checkMessages();
        }
    }, MSG_CONFIG.interval);

        window.addEventListener('load', () => {
    const phoneInput = document.getElementById("phone");
    if (phoneInput) { // 只有当元素存在时才执行
        phoneInput.autocomplete = "on";
      console.log("phone已改为记住手机号");
    } else {
        console.warn("未找到 ID 为 'phone' 的元素，可能 ID 变了或者尚未加载。");
    }
      });



})();
