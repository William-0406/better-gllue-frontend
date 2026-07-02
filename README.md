# gllue-ui-shell

一个 MV3 浏览器扩展(Edge / Chrome),注入到你们自建的 **谷露(Gllue) CRM** 页面,用自定义 React 界面替换原生 SPA,提供更好看、更聚合的**只读**视图;写操作仍跳转回谷露原生页面完成。附带:

- **项目图谱**:顾问在本地维护"在招项目",可视化成公司 / 职位 / base 地点的关系图。
- **脉脉查重助手**:在 maimai.cn 人才详情页,提示该候选人是否已在谷露库中。
- **增强服务器**(可选,`server/gllue-enhance-api/`):候选人查重索引 + 百度 OCR 代理。

技术栈:Vite + React 18/19 + TypeScript,组件库 `animal-island-ui`。

> ⚠️ 本仓库**不含任何内网地址**。谷露主机、增强服务器地址都通过环境变量注入(见下)。默认占位符是 `your-gllue-host.example.com`,不填就不会注入到任何真实站点。

## 配置

复制 `.env.example` 为 `.env.local`(已被 gitignore,不会提交),填入你们的地址:

```
VITE_GLLUE_HOST=你们的谷露主机        # 例如 10.0.0.5 或 gllue.mycorp.com（可带端口）
VITE_ENHANCE_HOST=你们的增强服务器     # 例如 10.0.0.6:3100，没有就留空
```

`config.ts` 和构建脚本会在 build 时把这些值注入到代码和 `manifest.json`。

## 构建 & 安装

```bash
npm install
npm run build:extension      # 产物在 dist-extension/
```

然后在浏览器加载解压的扩展:

1. 打开 `edge://extensions/`(Chrome 是 `chrome://extensions/`),开启**开发者模式**。
2. 点"加载解压缩的扩展",选择 `dist-extension/` 文件夹。
3. 打开你们的谷露页面,点扩展图标即可切换到新界面。

其它脚本:`npm run dev`(本地开发,dev 代理目标同样读 `VITE_GLLUE_HOST`)、`npm run build`(网页版)、`npm run watch:extension`(改完自动重 build)。

## 目录

- `src/` — 前端 React 应用与内容脚本 / service worker(`src/extension/`)。
- `src/config.ts` — 内网地址的唯一来源(从环境变量读)。
- `public/manifest.json` — 扩展清单(host 用 `__GLLUE_HOST__` 占位,build 时注入)。
- `server/gllue-enhance-api/` — 可选的增强服务器(Node)。

## 说明

- 扩展只做**只读**展示,不修改谷露数据;所有写操作回谷露原生页面。
- 增强服务器只存候选人**摘要 + 联系方式 hash**,不存谷露 cookie;百度 OCR key 只从环境变量读。
