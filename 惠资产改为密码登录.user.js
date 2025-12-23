// ==UserScript==
// @name         惠资产更改为密码登录
// @namespace    Violentmonkey Scripts
// @match        *://hzc.yonghui.cn/oauth/login*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @version      1.1
// @author       Mai
// @description  将惠资产从验证码登录恢复为密码登录
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // 配置登录接口
    const LOGIN_URL = 'https://hzc.yonghui.cn/oauth/login';
    const CUSTOM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

    function init() {
        const form = document.getElementById('phoneForm');
        if (form) {
            // 替换表单内容
            form.innerHTML = `
                <input autocomplete="on" type="text" name="username" id="username"
                       class="form-control login-margin-b"
                       placeholder="请输入用户名"
                       style="color: #FFFFFF"/>

                <input autocomplete="on" type="password" name="password" id="password"
                       class="form-control login-margin-b"
                       placeholder="请输入密码"
                       style="color: #FFFFFF"/>

                <button id="loginSubmit" type="button"
                        class="btn-theme btn-theme-sm btn-base-bg text-uppercase login-margin-b"
                        style="margin-bottom: 6px !important; width: 100%;">
                  登录
                </button>

                <div class="help-link" style="float:right;">
                    <a target="_blank" class="forget-password" href="/oauth/public/default/register.html"
                       style="font-family: PingFangSC-Regular;font-size: 12px;color: #29BECE;letter-spacing: 0;line-height: 20px;">
                      供应商注册
                    </a>
                </div>
            `;

            // 绑定登录事件
            const loginBtn = document.getElementById('loginSubmit');
            loginBtn.addEventListener('click', handleLogin);

            console.log('? GM_xmlhttpRequest登录表单已就绪');
        }
    }

    // Base64编码函数
    function base64Encode(str) {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            return btoa(str);
        }
    }

    // 强制HTTPS跳转函数
    function forceHTTPSRedirect() {
        if (window.location.href.includes('http://hzc.yonghui.cn')) {
            const httpsUrl = window.location.href.replace('http://hzc.yonghui.cn', 'https://hzc.yonghui.cn');
            window.location.replace(httpsUrl);
            return true;
        }
        return false;
    }

    // 处理登录 - 使用GM_xmlhttpRequest
    function handleLogin() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            alert('请输入用户名和密码！');
            return;
        }

        const loginBtn = document.getElementById('loginSubmit');
        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';

        // 准备POST数据
        const postData = `username=${encodeURIComponent(username)}&password=${base64Encode(password)}&plaintext_password=**********`;

        console.log('? 发送GM_xmlhttpRequest POST:', LOGIN_URL);

        GM_xmlhttpRequest({
            method: 'POST',
            url: LOGIN_URL,
            headers: {
                'User-Agent': CUSTOM_UA,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'X-Requested-With': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Referer': window.location.href
            },
            data: postData,
            timeout: 10000,
            onload: function (response) {

                // 提取accessToken
                const tokenMatch = response.responseText.match(/"accessToken"\s*:\s*"([^"]+)"/i) ||
                    response.responseText.match(/accessToken\s*:\s*"([^"]+)"/i) ||
                    response.responseText.match(/'accessToken'\s*:\s*'([^']+)'/i) ||
                    response.responseText.match(/token["']?\s*[:=]\s*["']([^"']+)["']/i);

                if (tokenMatch) {
                    const accessToken = tokenMatch[1];
                    console.log('? Token获取成功:', accessToken);

                    // 保存token到当前域与会话（兼容不同键名）
                    localStorage.setItem('access_token', accessToken);
                    sessionStorage.setItem('access_token', accessToken);

                    // 设置cookie，供 https://hzcf.yonghui.cn/ 使用（域设置为 .yonghui.cn）
                    (function setCookieForHzcf(token) {
                        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString(); // 7天
                        const v = encodeURIComponent(token);
                        document.cookie = `access_token=${v}; Domain=.yonghui.cn; Path=/; Expires=${expires}; Secure; SameSite=None`;
                    })(accessToken);

                    // 登录成功后跳转到目标域
                    setTimeout(() => {
                        window.location.href = "https://hzcf.yonghui.cn/";
                    }, 500);

                } else {
                    console.error('? 未找到Token');
                    alert('登录失败，未找到accessToken\n\n响应内容:\n' + response.responseText.substring(0, 200));
                }

                loginBtn.disabled = false;
                loginBtn.textContent = '登录';
            },
            onerror: function (response) {
                console.error('? GM_xmlhttpRequest请求失败:', response);
                alert('请求失败: ' + (response.error || '网络错误'));
                loginBtn.disabled = false;
                loginBtn.textContent = '登录';
            },
            ontimeout: function (response) {
                console.error('? 请求超时:', response);
                alert('请求超时，请重试');
                loginBtn.disabled = false;
                loginBtn.textContent = '登录';
            }
        });
    }

    // 页面加载时强制HTTPS
    forceHTTPSRedirect();

    // 页面加载完成后执行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 处理动态加载
    const observer = new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
            if (mutation.type === 'childList') {
                const form = document.getElementById('phoneForm');
                if (form && !document.getElementById('loginSubmit')) {
                    init();
                    observer.disconnect();
                }
            }
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 获取token辅助函数
    window.getAccessToken = function () {
        return localStorage.getItem('accessToken') || sessionStorage.getItem('accessToken');
    };

})();
