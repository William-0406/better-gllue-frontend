// 内网地址集中配置。真实地址不写进代码，构建时从环境变量注入：
// 在项目根目录建一个 .env.local（已被 .gitignore 忽略、不会提交），写：
//   VITE_GLLUE_HOST=你们的谷露主机         # 例如 10.0.0.5 或 gllue.mycorp.com（可带端口）
//   VITE_ENHANCE_HOST=你们的增强服务器      # 例如 10.0.0.6:3100，没有就留空
// 公开仓库里只看得到下面的占位符，看不到真实地址。
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const GLLUE_HOST = (env.VITE_GLLUE_HOST || '').trim() || 'your-gllue-host.example.com';
export const GLLUE_ORIGIN = `http://${GLLUE_HOST}`;
export const GLLUE_BASE = `${GLLUE_ORIGIN}/crm`;

const enhanceHost = (env.VITE_ENHANCE_HOST || '').trim();
export const ENHANCE_BASE_URL = enhanceHost ? `http://${enhanceHost}` : '';
