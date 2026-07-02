import { useCallback, useEffect, useState } from 'react';
import { buildConsultantLeaderboard, type ConsultantLeaderboard, type LeaderboardMetric, type LeaderboardPeriod } from './leaderboard';

export function useConsultantLeaderboard(initialPeriod: LeaderboardPeriod = 'month', initialMetric: LeaderboardMetric = 'recommendations') {
  const [period, setPeriod] = useState<LeaderboardPeriod>(initialPeriod);
  const [metric, setMetric] = useState<LeaderboardMetric>(initialMetric);
  const [data, setData] = useState<ConsultantLeaderboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((targetPeriod: LeaderboardPeriod, targetMetric: LeaderboardMetric, force = false) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    buildConsultantLeaderboard(targetPeriod, targetMetric, force)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '排行榜加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(period, metric), [period, metric, load]);

  return {
    period,
    setPeriod,
    metric,
    setMetric,
    data,
    loading,
    error,
    refresh: () => load(period, metric, true),
  };
}
