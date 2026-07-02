# Better Gllue Frontend

一个面向 Gllue CRM 的 MV3 浏览器扩展，用 React 重做更清爽的只读工作台。

它会注入到你自己的 Gllue 页面中，把常用信息整理成更容易浏览、搜索和切换的界面；新增、编辑、备注、推荐等写操作仍回到 Gllue 原生页面完成。

## Features

- **Dashboard**: 汇总人才、公司、项目和本周业务进展。
- **Candidate / Client Views**: 更聚合的列表、搜索和详情入口。
- **Project Map**: 在本地维护在招项目，并按公司、职位、地点生成关系图谱。
- **Maimai Helper**: 在 maimai.cn 人才详情页提示候选人是否已在库。
- **Optional Enhance API**: 可选的 Node 服务，用于候选人索引和 OCR 代理。

## Safety First

This public repository does not include private hosts, tokens, candidate data, or internal deployment files.

Runtime addresses are injected from local environment variables during build. If no host is configured, the extension keeps the placeholder host and will not run against a real CRM site.

## Tech Stack

- Vite
- React
- TypeScript
- Chrome / Edge MV3 extension
- animal-island-ui
- lucide-react

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run build:extension
```

The extension build will be generated in:

```text
dist-extension/
```

Load it in your browser:

1. Open `edge://extensions/` or `chrome://extensions/`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the `dist-extension/` folder.
5. Open your Gllue CRM page and click the extension icon.

## Configuration

Create `.env.local` from `.env.example`:

```env
VITE_GLLUE_HOST=your-gllue-host.example.com
VITE_ENHANCE_HOST=
```

Field notes:

- `VITE_GLLUE_HOST`: your CRM host, without protocol.
- `VITE_ENHANCE_HOST`: optional enhance API host, without protocol.

`src/config.ts` and the extension build config inject these values into the app and `manifest.json` at build time.

## Scripts

```bash
npm run dev              # local Vite development
npm run build            # web build
npm run build:extension  # browser extension build
npm run watch:extension  # watch extension content script
npm run preview          # preview web build
```

## Project Structure

```text
src/
  components/       Shared UI components
  extension/        MV3 background, bridge, content scripts
  pages/            Dashboard and business views
  services/         API clients and data hooks
  config.ts         Runtime host configuration

public/
  manifest.json     Extension manifest template

server/
  gllue-enhance-api Optional enhance API service
```

## Data And Privacy

- The extension is designed as a read-only overlay.
- Write actions intentionally open the original Gllue page.
- Local project-map records are stored in the browser only.
- `.env.local`, build outputs, local data, logs, and internal documents are ignored by Git.
- The optional enhance API should be deployed and configured privately by each team.

## License

No license has been declared yet. Treat this repository as source-available unless a license is added.
