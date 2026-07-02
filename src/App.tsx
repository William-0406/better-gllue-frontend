import { Cursor, Footer } from 'animal-island-ui';
import { useEffect, useMemo, useState } from 'react';
import { RecommendationRewardModal } from './components/RecommendationRewardModal';
import { ShellNav } from './components/ShellNav';
import { Candidates } from './pages/Candidates';
import { Clients } from './pages/Clients';
import { Dashboard } from './pages/Dashboard';
import { Jobs } from './pages/Jobs';
// 推荐榜暂为内测，入口点击后只弹提示、不进页面（私有版，功能代码保留）。
// import { Leaderboard } from './pages/Leaderboard';
import { Mapping } from './pages/Mapping';
import { ProjectMap } from './pages/ProjectMap';
import { checkPendingRecommendation, getRecommendationStats, recordRecommendationReward } from './services/recommendationRewards';
import type { ModuleKey, RecommendationReward, RecommendationStats } from './types/gllue';

const routeMap: Record<string, ModuleKey> = {
  '#/dashboard': 'dashboard',
  '#/candidates': 'candidates',
  '#/clients': 'clients',
  '#/jobs': 'jobs',
  '#/leaderboard': 'leaderboard',
  // '#/mapping' 路由暂时关闭（私有版，功能代码保留）。
  '#/project-map': 'projectMap',
};

const hashMap: Record<ModuleKey, string> = {
  dashboard: '#/dashboard',
  candidates: '#/candidates',
  clients: '#/clients',
  jobs: '#/jobs',
  leaderboard: '#/leaderboard',
  mapping: '#/mapping',
  projectMap: '#/project-map',
};

export default function App() {
  const initial = useMemo(() => routeMap[window.location.hash] ?? 'dashboard', []);
  const [active, setActive] = useState<ModuleKey>(initial);
  const [reward, setReward] = useState<RecommendationReward | null>(null);
  const [rewardStats, setRewardStats] = useState<RecommendationStats>(() => getRecommendationStats());

  useEffect(() => {
    const onHashChange = () => setActive(routeMap[window.location.hash] ?? 'dashboard');
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.location.hash = hashMap.dashboard;
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    let checking = false;
    let cancelled = false;
    const checkReward = async () => {
      if (checking || reward) return;
      checking = true;
      try {
        const nextReward = await checkPendingRecommendation();
        if (nextReward && !cancelled) {
          const nextStats = recordRecommendationReward(nextReward);
          setRewardStats(nextStats);
          setReward(nextReward);
        } else if (!cancelled) {
          setRewardStats(getRecommendationStats());
        }
      } finally {
        checking = false;
      }
    };
    const onFocus = () => void checkReward();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkReward();
    };
    window.setTimeout(() => void checkReward(), 800);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reward]);

  const navigate = (key: ModuleKey) => {
    window.location.hash = hashMap[key];
    setActive(key);
  };

  return (
    <Cursor>
      <div className="app-shell">
        <ShellNav active={active} onChange={navigate} />
        <main className="content-shell">
          {active === 'dashboard' && <Dashboard onNavigate={navigate} />}
          {active === 'candidates' && <Candidates />}
          {active === 'clients' && <Clients />}
          {active === 'jobs' && <Jobs />}
          {active === 'leaderboard' && (
            <div style={{ padding: '64px 24px', textAlign: 'center', color: '#6b6257' }}>
              <h2 style={{ margin: '0 0 8px' }}>推荐榜还在内测</h2>
              <p style={{ margin: 0 }}>该功能内测中，暂未开放。</p>
            </div>
          )}
          {/* {active === 'mapping' && <Mapping />} 路由已关闭 */}
          {active === 'projectMap' && <ProjectMap />}
        </main>
        <Footer type="tree" />
        <RecommendationRewardModal reward={reward} stats={rewardStats} onClose={() => setReward(null)} />
      </div>
    </Cursor>
  );
}
