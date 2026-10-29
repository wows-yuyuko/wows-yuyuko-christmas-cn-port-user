(function () {
    'use strict';

    // ============ 配置 ============
    const API_BASE = 'https://v3-api.wows.shinoaki.com';
    const API_PATH = '/public/wows/christmas/ship/port';
    const INVENTORY_QUERY = '{ inventory { vehicles } }';
    const INVENTORY_BODY = JSON.stringify({query: INVENTORY_QUERY, variables: null, operationName: null});
    // ==============================

    const STORE_KEY = 'wows_cn_port_v1';
    const PANEL_ID = 'wows-cn-port-panel';
    const SHIP_ID_RE = /^\d{1,19}$/;

    const SITE = detectSite();
    const state = {
        accountId: null,
        vehicles: [],
        capturedAt: 0,
        busy: false,
        message: '点击「获取我的数据」开始',
        messageType: 'info'
    };

    function detectSite() {
        const host = location.hostname;
        const langMatch = location.pathname.match(/^\/([a-z]{2}-[a-z]{2})(\/|$)/);
        const lang = langMatch ? langMatch[1] : 'zh-cn';
        if (host === 'armory.wowsgame.cn') {
            return {
                key: 'armory',
                name: '军械库',
                accountInfoUrl: location.origin + '/' + lang + '/api/account/info/',
                inventoryUrls: [
                    'https://vortex.wowsgame.cn/api/graphql/inventory/',
                    'https://vortex.worldofwarships.asia/api/graphql/inventory/'
                ]
            };
        }
        if (host === 'logbook.wowsgame.cn') {
            return {
                key: 'logbook',
                name: '指挥官日志',
                // logbook 没有账号信息接口，借用军械库接口（跨域由后台 service worker 请求）
                accountInfoUrl: 'https://armory.wowsgame.cn/' + lang + '/api/account/info/',
                inventoryUrls: [
                    'https://vortex.wowsgame.cn/api/graphql/inventory/',
                    'https://vortex.worldofwarships.asia/api/graphql/inventory/'
                ]
            };
        }
        return {key: 'unknown', name: host, accountInfoUrl: null, inventoryUrls: []};
    }

    // ---------- 本地缓存 ----------
    const storage = {
        get(key, def) {
            try {
                const raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : def;
            } catch (e) {
                return def;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (e) {
                /* 忽略存储异常 */
            }
        }
    };

    function loadCache() {
        const cache = storage.get(STORE_KEY, null);
        if (cache && Array.isArray(cache.vehicles)) {
            state.vehicles = cache.vehicles
                .map(v => Number(v))
                .filter(v => Number.isSafeInteger(v) && v > 0);
            state.capturedAt = cache.capturedAt || 0;
            state.accountId = cache.accountId || null;
            if (state.vehicles.length) {
                setMessage('本地缓存 ' + state.vehicles.length + ' 艘，可重新获取或直接提交', 'info');
            }
        }
    }

    function saveCache() {
        storage.set(STORE_KEY, {
            accountId: state.accountId,
            vehicles: state.vehicles,
            capturedAt: state.capturedAt
        });
    }

    // ---------- 请求工具 ----------
    function parseResponse(status, text) {
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch (e) {
            /* 非 JSON 响应（例如未登录跳转页） */
        }
        return {status: status, json: json};
    }

    function backgroundRequest(url, init) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                reject(new Error('后台 service worker 不可用'));
                return;
            }
            chrome.runtime.sendMessage({
                type: 'wowsCnPortFetch',
                url: url,
                method: init.method || 'GET',
                headers: init.headers || {},
                body: init.body
            }, response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!response || !response.ok) {
                    reject(new Error((response && response.error) || '后台请求失败'));
                    return;
                }
                resolve(parseResponse(response.status, response.text));
            });
        });
    }

    async function pageRequest(url, init) {
        const response = await fetch(url, Object.assign({credentials: 'include'}, init));
        return parseResponse(response.status, await response.text());
    }

    /**
     * preferBackground=true 时先走 service worker（跨域且页面 CORS 不放行的接口），否则先走页面 fetch
     */
    async function requestJson(url, init, preferBackground) {
        if (preferBackground) {
            try {
                return await backgroundRequest(url, init);
            } catch (e) {
                /* 退回页面请求 */
            }
        }
        try {
            return await pageRequest(url, init);
        } catch (e) {
            try {
                return await backgroundRequest(url, init);
            } catch (e2) {
                throw e;
            }
        }
    }

    /**
     * content script 隔离环境下读不到页面的 catalogue 变量，直接从内联脚本文本里取服务端注入的账号ID
     */
    function readInjectedAccountId() {
        const scripts = document.querySelectorAll('script:not([src])');
        for (const script of scripts) {
            const text = script.textContent || '';
            if (!text.includes('catalogue.state')) continue;
            const match = text.match(/["']?account["']?\s*:\s*\{[\s\S]{0,400}?["']?id["']?\s*:\s*(\d+)/);
            if (match) return match[1];
        }
        return null;
    }

    async function fetchAccountId() {
        if (!SITE.accountInfoUrl) {
            throw new Error('当前页面不是 armory / logbook 国服站点');
        }
        let lastError = null;
        try {
            const result = await requestJson(SITE.accountInfoUrl, {}, SITE.key === 'logbook');
            if (result.status >= 200 && result.status < 300 && result.json && result.json.id) {
                const id = Number(result.json.id);
                if (Number.isSafeInteger(id) && id > 0) return String(id);
            }
            lastError = new Error('账号信息接口返回异常（HTTP ' + result.status + '）');
        } catch (e) {
            lastError = e;
        }
        const injected = readInjectedAccountId();
        if (injected) return injected;
        throw new Error('未获取到账号ID，请确认已登录国服官网（' + (lastError ? lastError.message : '未知错误') + '）');
    }

    function normalizeVehicles(vehicles) {
        const ids = [];
        const seen = new Set();
        for (const item of vehicles) {
            const text = String(item == null ? '' : item).trim();
            if (!SHIP_ID_RE.test(text)) continue;
            const id = Number(text);
            if (!Number.isSafeInteger(id) || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
        return ids;
    }

    async function fetchVehicles() {
        let lastError = null;
        for (const url of SITE.inventoryUrls) {
            try {
                const result = await requestJson(url, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
                    body: INVENTORY_BODY
                }, false);
                const json = result.json;
                const vehicles = json && json.data && json.data.inventory && json.data.inventory.vehicles;
                if (Array.isArray(vehicles)) {
                    return normalizeVehicles(vehicles);
                }
                if (json && json.data && json.data.inventory === null) {
                    lastError = new Error('inventory 返回空数据，可能未登录或登录已过期');
                } else if (json && json.errors) {
                    lastError = new Error('inventory 接口返回错误：' + JSON.stringify(json.errors).slice(0, 120));
                } else {
                    lastError = new Error('inventory 接口响应异常（HTTP ' + result.status + '）');
                }
            } catch (e) {
                lastError = e;
            }
        }
        throw new Error('获取港口数据失败：' + (lastError ? lastError.message : '未知错误'));
    }

    // ---------- 业务流程 ----------
    async function fetchData() {
        if (state.busy) return;
        state.busy = true;
        setMessage('正在获取账号信息…', 'info');
        render();
        try {
            state.accountId = await fetchAccountId();
            saveCache();
            setMessage('正在获取港口战舰数据…', 'info');
            render();
            const vehicles = await fetchVehicles();
            if (vehicles.length === 0) {
                throw new Error('接口返回的战舰列表为空，请在官网确认账号状态');
            }
            state.vehicles = vehicles;
            state.capturedAt = Date.now();
            saveCache();
            setMessage('获取成功，共 ' + vehicles.length + ' 艘，点击「提交到网站」上传', 'ok');
        } catch (e) {
            setMessage(e.message || String(e), 'err');
        } finally {
            state.busy = false;
            render();
        }
    }

    async function submit() {
        if (state.busy) return;
        if (!state.accountId) {
            setMessage('请先点击「获取我的数据」', 'err');
            render();
            return;
        }
        if (state.vehicles.length === 0) {
            setMessage('还没有战舰数据，请先点击「获取我的数据」', 'err');
            render();
            return;
        }
        state.busy = true;
        setMessage('正在提交 ' + state.vehicles.length + ' 艘…', 'info');
        render();
        try {
            const json = await postJson(API_BASE + API_PATH, JSON.stringify({
                accountId: Number(state.accountId),
                vehicles: state.vehicles
            }));
            if (json && json.code === 200) {
                setMessage('提交成功，共 ' + json.data + ' 艘', 'ok');
            } else {
                setMessage('提交失败：' + ((json && json.message) || '未知错误'), 'err');
            }
        } catch (e) {
            setMessage(e.message || String(e), 'err');
        } finally {
            state.busy = false;
            render();
        }
    }

    async function postJson(url, body) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: body
            });
            return JSON.parse(await response.text());
        } catch (e) {
            const result = await backgroundRequest(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: body
            });
            if (!result.json) throw new Error('提交接口返回解析失败');
            return result.json;
        }
    }

    function setMessage(message, type) {
        state.message = message;
        state.messageType = type;
    }

    // ---------- 面板 ----------
    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.cssText = [
            'position:fixed', 'left:16px', 'top:16px', 'z-index:2147483647',
            'width:300px', 'max-height:calc(100vh - 32px)', 'overflow:auto', 'padding:14px',
            'border-radius:12px', 'background:#1c2330', 'color:#e6edf3',
            'font:13px/1.6 "Microsoft YaHei",sans-serif',
            'box-shadow:0 8px 28px rgba(0,0,0,.5)', 'border:1px solid #2f3b4d', 'box-sizing:border-box'
        ].join(';');
        panel.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
            '  <span style="font-weight:600;font-size:14px">圣诞船池提交（国服）</span>' +
            '  <span data-role="close" title="关闭" style="cursor:pointer;color:#8b98ab;font-size:16px;line-height:1">&times;</span>' +
            '</div>' +

            '<div style="background:#161b24;border:1px solid #2f3b4d;border-radius:8px;padding:9px 10px;margin-bottom:10px;color:#b6c2d2">' +
            '  点击「获取我的数据」后，插件会向国服官网接口查询你的账号ID与港口战舰，' +
            '  确认后由你点击「提交到网站」上传到 <span style="color:#e6edf3">wows.shinoaki.com</span>，用于统计国服玩家的圣诞船池。' +
            '</div>' +

            '<details style="margin-bottom:10px;color:#b6c2d2">' +
            '  <summary style="cursor:pointer;color:#58a6ff;outline:none">采集内容与用途说明</summary>' +
            '  <div style="margin-top:6px;display:grid;row-gap:4px">' +
            '    <div><span style="color:#8b98ab">采集内容：</span>国服账号ID、港口中拥有的战舰ID列表</div>' +
            '    <div><span style="color:#8b98ab">请求接口：</span>官网的账号信息接口与 vortex inventory 接口</div>' +
            '    <div><span style="color:#8b98ab">用途：</span>仅用于本站圣诞活动船池统计与掉落概率分析</div>' +
            '    <div><span style="color:#8b98ab">不会采集：</span>密码、令牌、战绩、聊天等任何其他信息</div>' +
            '    <div><span style="color:#8b98ab">保留方式：</span>数据保存在本地浏览器缓存，可随时关闭面板或清除</div>' +
            '  </div>' +
            '</details>' +

            '<div style="display:grid;row-gap:2px;margin-bottom:10px">' +
            '  <div><span style="color:#8b98ab">当前页面：</span><span data-role="site">-</span></div>' +
            '  <div><span style="color:#8b98ab">账号ID：</span><span data-role="account">未获取</span></div>' +
            '  <div><span style="color:#8b98ab">已获取：</span><span data-role="count">0 艘</span></div>' +
            '  <div><span style="color:#8b98ab">获取时间：</span><span data-role="time">-</span></div>' +
            '</div>' +

            '<div style="display:flex;gap:8px">' +
            '  <button data-role="fetch" style="flex:1;padding:8px 0;border:1px solid #2f81f7;border-radius:7px;background:transparent;color:#58a6ff;font-size:13px;font-weight:600;cursor:pointer">获取我的数据</button>' +
            '  <button data-role="submit" style="flex:1;padding:8px 0;border:0;border-radius:7px;background:#2f81f7;color:#fff;font-size:13px;font-weight:600;cursor:pointer">提交到网站</button>' +
            '</div>' +
            '<div data-role="message" style="margin-top:8px;word-break:break-all;min-height:20px"></div>';

        panel.querySelector('[data-role="close"]').addEventListener('click', () => panel.remove());
        panel.querySelector('[data-role="fetch"]').addEventListener('click', fetchData);
        panel.querySelector('[data-role="submit"]').addEventListener('click', submit);
        return panel;
    }

    function render() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.querySelector('[data-role="site"]').textContent = SITE.name;
        panel.querySelector('[data-role="account"]').textContent = state.accountId || '未获取';
        panel.querySelector('[data-role="count"]').textContent = state.vehicles.length + ' 艘';
        panel.querySelector('[data-role="time"]').textContent = state.capturedAt
            ? new Date(state.capturedAt).toLocaleString()
            : '-';

        const fetchButton = panel.querySelector('[data-role="fetch"]');
        fetchButton.disabled = state.busy;
        fetchButton.textContent = state.busy ? '请求中…' : '获取我的数据';
        fetchButton.style.opacity = fetchButton.disabled ? '0.55' : '1';
        fetchButton.style.cursor = fetchButton.disabled ? 'not-allowed' : 'pointer';

        const submitButton = panel.querySelector('[data-role="submit"]');
        submitButton.disabled = state.busy || state.vehicles.length === 0 || !state.accountId;
        submitButton.style.opacity = submitButton.disabled ? '0.55' : '1';
        submitButton.style.cursor = submitButton.disabled ? 'not-allowed' : 'pointer';

        const message = panel.querySelector('[data-role="message"]');
        message.textContent = state.message;
        message.style.color = state.messageType === 'ok' ? '#3fb950'
            : state.messageType === 'err' ? '#f85149' : '#8b98ab';
    }

    function mount() {
        if (!document.body || document.getElementById(PANEL_ID)) return;
        document.body.appendChild(buildPanel());
        render();
    }

    loadCache();
    let observed = false;
    function observe() {
        if (observed || !document.documentElement) return;
        observed = true;
        new MutationObserver(mount).observe(document.documentElement, {childList: true, subtree: true});
    }

    observe();
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
})();
