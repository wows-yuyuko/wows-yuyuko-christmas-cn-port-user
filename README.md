# 战舰世界国服船池提交

油猴脚本 + Chrome/Edge 扩展：读取国服官网的账号ID与港口战舰ID，提交到 [wows.shinoaki.com](https://wows.shinoaki.com)，用于统计国服玩家的圣诞船池与掉落概率。

## 采集内容

| 数据 | 说明 |
| --- | --- |
| 账号ID | 国服官网 `api/account/info/` 返回的 `id` |
| 战舰ID列表 | vortex `inventory` 接口中的 `data.inventory.vehicles` |

- 仅在你点击「获取我的数据」后才发起请求，页面加载时不联网
- 不会采集密码、令牌、战绩、聊天等任何其他信息
- 数据只缓存在浏览器本地（`localStorage`），可随时清除

## 安装

### 油猴脚本（Tampermonkey）

**第一步：安装 Tampermonkey（官方商店地址）**

| 浏览器 | 官方地址 |
| --- | --- |
| Chrome | https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo |
| Edge | https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd |
| Firefox | https://addons.mozilla.org/firefox/addon/tampermonkey/ |

官网：https://www.tampermonkey.net/

**第二步：安装脚本**

打开安装链接，在 Tampermonkey 提示页点击「安装」：

```
https://cdn.jsdelivr.net/gh/wows-yuyuko/wows-yuyuko-christmas-cn-port-user@main/wows-christmas-cn-port.user.js
```

脚本带 `@updateURL` / `@downloadURL`，发布新版本后 Tampermonkey 会自动检查更新（默认每 24 小时一次，也可在管理面板手动「检查脚本更新」）。

### Chrome 扩展

插件尚未上架 Chrome 应用商店，目前只能本地加载：

1. 打开 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本仓库的 `extension` 目录

### Edge 扩展

插件尚未上架 Edge 加载项商店，目前只能本地加载：

1. 打开 `edge://extensions`
2. 打开左侧「开发人员模式」
3. 点击「加载解压缩的扩展」，选择本仓库的 `extension` 目录

> 解压加载的扩展不会自动更新，拉取新代码后在扩展管理页点击刷新即可。

### Firefox

- **油猴脚本**：Firefox 版 Tampermonkey 可直接使用同一个 `.user.js` 安装链接，功能与 Chrome/Edge 一致
- **扩展**：暂未适配。Firefox 的 MV3 不支持 `background.service_worker`，需要单独的 Firefox manifest 才能加载；目前请使用油猴脚本

## 使用

1. 在浏览器中登录国服官网
2. 打开 [armory.wowsgame.cn](https://armory.wowsgame.cn/zh-cn/) 或 [logbook.wowsgame.cn/profile](https://logbook.wowsgame.cn/profile)
3. 左上角面板点击「获取我的数据」，脚本会请求账号信息与港口数据
4. 确认数量无误后点击「提交到网站」

限制：

- 仅支持国服（CN）账号
- 账号需先在站内查询过战绩，否则提交会提示 `accountId不存在`
- 同一账号提交有 10 秒频率限制
- 提交的战舰ID必须存在于战舰库中，且不能重复

## 目录结构

```
.
├── wows-christmas-cn-port.user.js   # 油猴脚本
└── extension/                       # Chrome / Edge 扩展
    ├── manifest.json
    ├── content.js
    └── service-worker.js
```

## 实现说明

- 油猴脚本在页面内直接 `fetch`，跨域受限时退回 `GM_xmlhttpRequest`
- 扩展的 content script 优先用页面 `fetch`（vortex 已对官网域名开放 CORS），失败时通过 service worker 请求
- 两个版本逻辑一致：先判断当前站点（armory / logbook），再构造对应的账号信息与 inventory 请求
- inventory 请求体：`{"query":"{ inventory { vehicles } }","variables":null,"operationName":null}`

## 自动更新

油猴版本发布新版本时：

1. 修改脚本头部的 `@version`
2. 推送到 `main` 分支

jsDelivr 对 `@main` 约有 12 小时缓存，需要立即生效时请求一次：

```
https://purge.jsdelivr.net/gh/wows-yuyuko/wows-yuyuko-christmas-cn-port-user@main/wows-christmas-cn-port.user.js
```
