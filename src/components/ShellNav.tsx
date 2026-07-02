import { Button, Time } from 'animal-island-ui';
import { Building2, LayoutDashboard, Network, RotateCcw, Trophy, UsersRound } from 'lucide-react';
import type { ModuleKey } from '../types/gllue';
import { restoreGllue } from '../utils/gllueLinks';
import { GlobalSearch } from './GlobalSearch';
import { GLLUE_HOST } from '../config';

const brandLogo = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128' role='img' aria-label='%E6%9B%B4%E5%A5%BD%E7%9A%84%E8%B0%B7%E9%9C%B2%E5%89%8D%E7%AB%AF'%3E%3Cdefs%3E%3Cfilter id='shadow' x='-20%25' y='-10%25' width='140%25' height='140%25' color-interpolation-filters='sRGB'%3E%3CfeDropShadow dx='0' dy='5' stdDeviation='0' flood-color='%235f4b33' flood-opacity='.16'/%3E%3CfeDropShadow dx='0' dy='10' stdDeviation='8' flood-color='%235f4b33' flood-opacity='.12'/%3E%3C/filter%3E%3C/defs%3E%3Crect x='10' y='10' width='108' height='108' rx='34' fill='%238fb1f2' filter='url(%23shadow)'/%3E%3Ccircle cx='43' cy='62' r='14' fill='%23fff7df'/%3E%3Ccircle cx='64' cy='43' r='16' fill='%23fff7df'/%3E%3Ccircle cx='86' cy='64' r='14' fill='%23fff7df'/%3E%3Cpath d='M49 66c9 12 28 12 38 0' fill='none' stroke='%235f4b33' stroke-width='7' stroke-linecap='round'/%3E%3Cpath d='M36 89h49' fill='none' stroke='%237dcebc' stroke-width='11' stroke-linecap='round'/%3E%3Cpath d='M85 89 72 77m13 12L72 101' fill='none' stroke='%237dcebc' stroke-width='11' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E`;

interface ShellNavProps {
  active: ModuleKey;
  onChange: (key: ModuleKey) => void;
}

const navItems: Array<{ key: ModuleKey; label: string; icon: React.ReactNode }> = [
  { key: 'dashboard', label: '首页', icon: <LayoutDashboard size={17} /> },
  { key: 'candidates', label: '人才', icon: <UsersRound size={17} /> },
  { key: 'clients', label: '公司', icon: <Building2 size={17} /> },
  { key: 'leaderboard', label: '推荐榜', icon: <Trophy size={17} /> },
  { key: 'projectMap', label: '项目图谱', icon: <Network size={17} /> },
  // 项目(Jobs/谷露joborder)入口已移除（项目数据命名不规范，暂无展示价值）。
  // “项目图谱”是新的、顾问手动维护的在招项目视图，与上面的 Jobs 无关，见交接手册知识图谱设计。
  // Mapping 暂为 MVP，先从导航隐藏；功能代码保留，做完整后取消注释即可恢复。
];

export function ShellNav({ active, onChange }: ShellNavProps) {
  return (
    <header className="shell-header">
      <div className="brand">
        <div className="brand-mark">
          <img src={brandLogo} alt="" />
        </div>
        <div>
          <strong>更好的谷露前端</strong>
          <span>人才 · 公司 · 项目</span>
        </div>
      </div>
      <div className="shell-center">
        <GlobalSearch />
        <nav className="shell-tabs">
          {navItems.map((item) => (
            <Button key={item.key} type={active === item.key ? 'primary' : 'default'} icon={item.icon} onClick={() => onChange(item.key)}>
              {item.label}
            </Button>
          ))}
        </nav>
      </div>
      <div className="header-time">
        {window.location.host === GLLUE_HOST ? (
          <Button icon={<RotateCcw size={16} />} onClick={() => restoreGllue('#dashboard')}>
            恢复谷露
          </Button>
        ) : null}
        <Time />
      </div>
    </header>
  );
}
