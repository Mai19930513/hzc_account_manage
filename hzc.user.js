// ==UserScript==
// @name         惠资产账户管理 (带悬浮球版)
// @namespace    http://violentmonkey.net/
// @version      1.0
// @description  修复退出托管无法清除Cookie的Bug
// @author       Mai
// @match        *://*.yonghui.cn/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @run-at       document-start
// @inject-into  page
// ==/UserScript==

(function () {
    'use strict';
    // ================= 配置区域 =================
    const REDIRECT_URL = 'https://hzcf.yonghui.cn/';
    // 悬浮球位置和可见性
    const BALL_POS_KEY = 'VM_BALL_POS';
    const BALL_VISIBLE_KEY = 'VM_BALL_VISIBLE';

    // ===========================================

    // 初始化数据
    let CONFIG = GM_getValue('VM_ACCOUNT_MANAGER', { current: null, list: {} });
    let activeProfileId = CONFIG.current;
    let activeProfile = activeProfileId ? CONFIG.list[activeProfileId] : null;
    const LOCK_MAP = activeProfile ? activeProfile.data : {};
    const KEYS = Object.keys(LOCK_MAP);
    const IS_ACTIVE = KEYS.length > 0;

    // [修复] 添加一个全局标记，用于在退出时绕过拦截器
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
                // 1. 写入 Storage
                localStorage.setItem(key, val);
                sessionStorage.setItem(key, val);
                // 2. 写入 Cookie
                safeSetCookie(key, val);
            } catch (e) {
                console.error("[VM] Apply Error:", e);
            }
        });
    };
    // =================================================
    // 🚀 核心拦截逻辑
    // =================================================
    if (IS_ACTIVE) {
        console.log(`%c[VM] 托管中: ${activeProfile.name}`, "color: #00e676; font-weight: bold;");


        // 初始检查与恢复
        KEYS.forEach(key => {
            const val = LOCK_MAP[key];
            try {
                if (localStorage.getItem(key) !== val) localStorage.setItem(key, val);
                if (sessionStorage.getItem(key) !== val) sessionStorage.setItem(key, val);
                const cookieStr = document.cookie || "";
                const count = (cookieStr.match(new RegExp(`(?:^|;\\s*)${key}=`, 'g')) || []).length;
                // 注意：这里运行的时候拦截器还没挂载，所以 safeSetCookie 可以成功
                if (count === 0 || count > 1 || getCookie(key) !== val) {
                    safeSetCookie(key, val);
                }
            } catch (e) { }
        });

        try {
            // 劫持 Storage
            const hijackProto = (proto) => {
                const _set = proto.setItem;
                const _remove = proto.removeItem;
                const _clear = proto.clear;
                proto.setItem = function (k, v) { if (!isExiting && LOCK_MAP[k]) return; _set.apply(this, arguments); };
                proto.removeItem = function (k) { if (!isExiting && LOCK_MAP[k]) return; _remove.apply(this, arguments); };
                proto.clear = function () {
                    if (isExiting) { _clear.apply(this); return; }
                    _clear.apply(this);
                    KEYS.forEach(k => this.setItem(k, LOCK_MAP[k]));
                };
            };
            hijackProto(Storage.prototype);

            // [修复] 劫持 Cookie
            const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
            if (cookieDesc && cookieDesc.set) {
                const _set = cookieDesc.set;
                Object.defineProperty(document, 'cookie', {
                    configurable: true, enumerable: true,
                    get: function () { return cookieDesc.get.call(document); },
                    set: function (val) {
                        val = String(val).trim();

                        // [关键修复] 如果不是正在退出，才进行拦截检查
                        if (!isExiting) {
                            for (let key of KEYS) {
                                if (val.startsWith(`${key}=`)) return;
                            }
                        }
                        _set.call(document, val);
                    }
                });
            }
        } catch (e) { }
    }

    // =================================================
    // 🎨 UI 构建区域
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
                display: none; background: white; width: 260px; margin-right: 15px;
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
            .vm-list-item .icon { margin-right: 10px; font-size: 16px; width: 20px; text-align: center;}
            .vm-list-item .del-btn { margin-left: auto; color: #999; padding: 4px; font-size: 12px; }
            .vm-list-item .del-btn:hover { color: #ff4444; }
            .vm-toolbar {
                padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
                border-top: 1px solid #eee; background: #fff;
            }
            .vm-btn {
                border: 1px solid #e0e0e0; background: #fff; color: #555; padding: 6px;
                border-radius: 6px; cursor: pointer; font-size: 12px; text-align: center; transition: all 0.2s;
            }
            .vm-btn:hover { background: #f5f5f5; border-color: #ccc; }
            .vm-btn.primary { background: #0072FF; color: white; border-color: #0072FF; }
            .vm-btn.primary:hover { background: #005bb5; }
            @keyframes vm-fade-in { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
            .vm-list::-webkit-scrollbar { width: 4px; }
            .vm-list::-webkit-scrollbar-thumb { background: #ddd; border-radius: 2px; }
        `;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.id = 'vm-ball-container';
        // 读取上次保存的位置（只记 top，保持固定在右侧）
        const savedPos = GM_getValue(BALL_POS_KEY, null);
        if (savedPos && typeof savedPos.top === 'number') {
            // 简单做一次安全夹紧，避免分辨率变化后跑出屏幕
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
        // 根据开关控制是否显示悬浮球
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

    function renderAccountList(container) {
        container.innerHTML = '';
        const ids = Object.keys(CONFIG.list);

        // =========================================================================
        // "停止托管 & 清空"
        // =========================================================================
        const logoutItem = document.createElement('div');
        logoutItem.className = `vm-list-item ${!IS_ACTIVE ? 'current' : ''}`;
        logoutItem.innerHTML = `<span class="icon">🧹</span><span>停止托管 & 清空Cookie</span>`;
        logoutItem.onclick = () => {
            if (confirm("⚠️ 确定要停止托管并清空当前页面的 Cookie 吗？\n\n这将导致当前页面退出登录。")) {
                // [修复] 1. 开启放行标记，允许删除操作穿透拦截器
                isExiting = true;

                CONFIG.current = null;
                GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);

                // 2. 执行强力清理 (主要针对 access_token)
                const targetKeys = ["access_token"];
                targetKeys.forEach(key => {
                    // Storage
                    localStorage.removeItem(key);
                    sessionStorage.removeItem(key);

                    // Cookie (尝试清理根域、子域、当前域)
                    const domains = [
                        undefined,
                        location.hostname,
                        '.yonghui.cn',
                        location.hostname.split('.').slice(-2).join('.') // 尝试根域
                    ];
                    const paths = ['/', location.pathname];

                    domains.forEach(d => {
                        paths.forEach(p => {
                            const dAttr = d ? `; domain=${d}` : '';
                            document.cookie = `${key}=; path=${p}${dAttr}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
                        });
                    });
                });

                // 3. 刷新
                alertAndRedirect("✅ 已停止托管并清理，即将刷新...");
            }
        };
        container.appendChild(logoutItem);
        // =========================================================================

        if (ids.length === 0) return;

        ids.forEach(id => {
            const acc = CONFIG.list[id];
            const isCurr = (id === CONFIG.current);
            const item = document.createElement('div');
            item.className = `vm-list-item ${isCurr ? 'current' : ''}`;
            item.innerHTML = `
                <span class="icon">${isCurr ? '✅' : '👤'}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${acc.name}</span>
                <span class="del-btn">🗑️</span>
            `;

            item.onclick = (e) => {
                if (e.target.classList.contains('del-btn')) return;
                if (isCurr) return;
                if (confirm(`切换到 [${acc.name}] ?`)) {
                    isExiting = true;
                    CONFIG.current = id;
                    GM_setValue('VM_ACCOUNT_MANAGER', CONFIG);
                    console.log("[VM] Switching: Applying new data immediately...");
                    alertAndRedirect(`正在切换...`);
                }

            };

            item.querySelector('.del-btn').onclick = (e) => {
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

        // [修复] 手动修改也临时开启权限
        isExiting = true;

        let shouldUpdateProfile = false;
        if (activeProfile) {
            shouldUpdateProfile = confirm(`✅ 即将写入当前页面。\n\n是否同时更新到托管账号 [${activeProfile.name}] 中？`);
        }

        isExiting = true; // 允许写入
        applyAccountData({ [key]: val }); // 统一调用工具函数立即生效
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
        }
        else {
            location.href = targetUrl;
        }
    }

    function getCookie(n) {
        let v = document.cookie.match('(^|;) ?' + n + '=([^;]*)(;|$)');
        return v ? v[2] : null;
    }

    GM_registerMenuCommand("🔄 恢复悬浮球", () => {
        document.getElementById('vm-ball-container').style.display = 'flex';
    });
    GM_registerMenuCommand("显示悬浮球", () => {
        GM_setValue(BALL_VISIBLE_KEY, true);
        const el = document.getElementById('vm-ball-container');
        if (el) el.style.display = 'flex';
    });

    GM_registerMenuCommand("隐藏悬浮球", () => {
        GM_setValue(BALL_VISIBLE_KEY, false);
        const el = document.getElementById('vm-ball-container');
        if (el) el.style.display = 'none';
    });

})();
