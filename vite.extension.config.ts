import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// 扩展的三个入口分三次独立 build（见 package.json 的 build:extension）：
//   - content / maimai 是内容脚本，输出 IIFE 单文件，天然没有 ESM import，
//     不再需要以前那套“事后把共享 chunk 内联回入口”的后处理 hack。
//   - background 是 MV3 module service worker（manifest 里 type: "module"），
//     单独输出自包含的 ES 模块，绝不引入含 window/document 的共享代码。
// 之前“单一 shared chunk + 事后内联”的方案在 rolldown-vite 下会把三个入口
// 全部合并进 content.js，background/maimai 变成 facade，SW 直接崩，故废弃。
// 三个入口统一输出 ES 格式：单入口 + 不分包（inlineDynamicImports/codeSplitting:false）
// 的 ES 产物没有任何 import/export 语句，内容脚本按 classic script 执行没问题。
// 不要改成 iife：vite 8(rolldown) 对 iife 会把 CSS 内联进 JS 运行时注入，
// content.css 不再产出（manifest 引用它会加载失败），且内联 CSS 里的字体
// url(./assets/...) 会按页面域名解析导致 404。
const targets = {
  content: { input: 'src/extension/content.tsx', format: 'es' as const },
  maimai: { input: 'src/extension/maimai.ts', format: 'es' as const },
  background: { input: 'src/extension/background.ts', format: 'es' as const },
};

type TargetName = keyof typeof targets;

// 注入内网地址：把 dist 里 manifest.json / pdf-page-parser.mjs 的占位符替换成
// .env.local 的真实值。幂等（替换过就找不到占位符，自然跳过），每次 build 后都跑，
// 这样 watch 模式重新拷贝 public 后也会立刻重新注入。
// 公开仓库里 manifest 保持 __GLLUE_HOST__ 占位；内部 build 前在 .env.local 填真实地址即可。
function injectHostPlaceholders(): Plugin {
  return {
    name: 'inject-host-placeholders',
    apply: 'build',
    async closeBundle() {
      const outDir = resolve(__dirname, 'dist-extension');
      const env: Record<string, string> = {};
      for (const name of ['.env.local', '.env']) {
        try {
          const content = await readFile(resolve(__dirname, name), 'utf8');
          content.split(/\r?\n/).forEach((line) => {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
            if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim();
          });
        } catch {
          // 没有 env 文件就跳过，manifest 保持占位符。
        }
      }
      const gllueHost = env.VITE_GLLUE_HOST || 'your-gllue-host.example.com';
      const enhanceHost = env.VITE_ENHANCE_HOST || '127.0.0.1:3100';
      for (const file of ['manifest.json', 'pdf-page-parser.mjs']) {
        const filePath = resolve(outDir, file);
        try {
          let text = await readFile(filePath, 'utf8');
          text = text.split('__GLLUE_HOST__').join(gllueHost).split('__ENHANCE_HOST__').join(enhanceHost);
          await writeFile(filePath, text);
        } catch {
          // 文件不在预期位置就跳过。
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const name = mode.startsWith('ext-') ? mode.slice(4) : 'content';
  const target: TargetName = name in targets ? (name as TargetName) : 'content';
  const entry = targets[target];

  return {
    plugins: [react(), injectHostPlaceholders()],
    base: './',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir: 'dist-extension',
      // 永不在配置里清空输出目录：watch:extension 只 build content，若在这里清空
      // 会把已经 build 好的 background.js / maimai.js 删掉。完整 build 的第一步
      // 由 package.json 里的 --emptyOutDir 命令行参数负责清空。
      emptyOutDir: false,
      sourcemap: false,
      rollupOptions: {
        input: resolve(__dirname, entry.input),
        output: {
          format: entry.format,
          // 单入口 + 全部内联 => 保证产物是一个自包含文件，不会出现共享 chunk。
          inlineDynamicImports: true,
          entryFileNames: `${target}.js`,
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) return `${target}.css`;
            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
});
