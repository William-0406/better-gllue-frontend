import { useMemo } from 'react';
import { Button, Card } from 'animal-island-ui';
import { CalendarCheck, Minus, RefreshCw, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { StatusTag } from './StatusTag';
import { useConsultantLeaderboard } from '../services/useConsultantLeaderboard';
import type { LeaderboardEntry, LeaderboardMetric, LeaderboardPeriod } from '../services/leaderboard';

const PERIOD_OPTIONS: Array<{ key: LeaderboardPeriod; label: string }> = [
  { key: 'week', label: '本周 / 上周' },
  { key: 'month', label: '本月 / 上月' },
  { key: 'quarter', label: '本季 / 上季' },
];

const METRIC_OPTIONS: Array<{ key: LeaderboardMetric; label: string }> = [
  { key: 'recommendations', label: '简历推荐' },
  { key: 'newCandidates', label: '新增候选人' },
];

const METRIC_HINT: Record<LeaderboardMetric, string> = {
  recommendations: '全队各顾问"简历推荐(cvsent)"与"推荐后面试"横向对比,含环比与转化率。只读不写谷露。',
  newCandidates: '全队各顾问"录入候选人"数量横向对比,含环比。只读不写谷露。',
};

function pct(value: number | null | undefined) {
  return value == null ? '' : `${Math.round(value * 100)}%`;
}

function DeltaBadge({ entry }: { entry: LeaderboardEntry }) {
  if (entry.previous === 0 && entry.current > 0) {
    return <span className="lb-delta lb-delta--new">新 +{entry.current}</span>;
  }
  if (entry.delta > 0) {
    return (
      <span className="lb-delta lb-delta--up">
        <TrendingUp size={13} /> +{entry.delta}
        {entry.deltaPct == null ? '' : ` ${pct(entry.deltaPct)}`}
      </span>
    );
  }
  if (entry.delta < 0) {
    return (
      <span className="lb-delta lb-delta--down">
        <TrendingDown size={13} /> {entry.delta}
        {entry.deltaPct == null ? '' : ` ${pct(entry.deltaPct)}`}
      </span>
    );
  }
  return (
    <span className="lb-delta lb-delta--flat">
      <Minus size={13} /> 0
    </span>
  );
}

export function ConsultantLeaderboardCard() {
  const { period, setPeriod, metric, setMetric, data, loading, error, refresh } = useConsultantLeaderboard('month', 'recommendations');

  const maxCurrent = useMemo(() => Math.max(1, ...(data?.entries.map((entry) => entry.current) ?? [])), [data]);
  const topEntries = data?.entries.slice(0, 12) ?? [];
  const selfEntry = data?.entries.find((entry) => entry.isSelf);
  const selfOutsideTop = selfEntry && selfEntry.rank > 12 ? selfEntry : null;
  const metricLabel = data?.metricLabel ?? METRIC_OPTIONS.find((o) => o.key === metric)?.label ?? '简历推荐';
  const hasInterviews = data?.hasInterviews ?? false;

  return (
    <Card className="api-preview-card leaderboard-card">
      <div className="section-heading">
        <div>
          <h2>
            <Trophy size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            顾问榜 · {metricLabel}
          </h2>
          <p>{METRIC_HINT[metric]}</p>
        </div>
        <StatusTag tone={error ? 'rose' : 'mint'}>{error ? '加载失败' : '实时'}</StatusTag>
      </div>

      <div className="leaderboard-toolbar">
        <div className="leaderboard-switch-group">
          <div className="leaderboard-period-switch">
            {METRIC_OPTIONS.map((option) => (
              <button key={option.key} className={option.key === metric ? 'is-active' : ''} onClick={() => setMetric(option.key)} disabled={loading}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="leaderboard-period-switch">
            {PERIOD_OPTIONS.map((option) => (
              <button key={option.key} className={option.key === period ? 'is-active' : ''} onClick={() => setPeriod(option.key)} disabled={loading}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Button icon={<RefreshCw size={15} />} onClick={refresh} disabled={loading}>
          {loading ? '统计中…' : '刷新'}
        </Button>
      </div>

      {data && !loading ? (
        <div className="leaderboard-summary">
          {selfEntry ? (
            <>
              你（{selfEntry.name}）{data.currentLabel}{metricLabel} <strong>{selfEntry.current}</strong>
              {hasInterviews ? <> · 面试 <strong>{selfEntry.interviews ?? 0}</strong>（转化 {pct(selfEntry.interviewRate) || '0%'}）</> : null}
              ,排名 <strong>第 {selfEntry.rank}</strong> / 共 {data.totalConsultants} 人 · 环比{' '}
              {selfEntry.previous === 0 && selfEntry.current > 0 ? '新增' : selfEntry.delta >= 0 ? `+${selfEntry.delta}` : selfEntry.delta}
            </>
          ) : (
            <>
              全队 {data.currentLabel}共 {metricLabel} <strong>{data.totalCurrent}</strong>
              {hasInterviews ? <> · 面试 <strong>{data.totalInterviews}</strong></> : null},{data.totalConsultants} 位顾问上榜
            </>
          )}
        </div>
      ) : null}

      {error ? <div className="leaderboard-empty">排行榜加载失败:{error}</div> : null}
      {loading && !data ? <div className="leaderboard-empty">正在按顾问逐个统计{metricLabel}…</div> : null}

      {data ? (
        <div className="leaderboard-list" aria-busy={loading}>
          {topEntries.map((entry) => (
            <LeaderboardRow key={entry.userId} entry={entry} maxCurrent={maxCurrent} data={data} />
          ))}
          {selfOutsideTop ? (
            <>
              <div className="leaderboard-row-divider">…</div>
              <LeaderboardRow entry={selfOutsideTop} maxCurrent={maxCurrent} data={data} />
            </>
          ) : null}
          {!topEntries.length && !loading ? <div className="leaderboard-empty">该周期暂无{metricLabel}记录</div> : null}
        </div>
      ) : null}
    </Card>
  );
}

function LeaderboardRow({
  entry,
  maxCurrent,
  data,
}: {
  entry: LeaderboardEntry;
  maxCurrent: number;
  data: { currentLabel: string; previousLabel: string; hasInterviews: boolean };
}) {
  const barWidth = `${Math.round((entry.current / maxCurrent) * 100)}%`;
  const rankClass = entry.rank <= 3 ? `lb-rank lb-rank--top${entry.rank}` : 'lb-rank';
  return (
    <div className={`leaderboard-row${entry.isSelf ? ' is-self' : ''}`}>
      <div className={rankClass}>{entry.rank}</div>
      <div className="leaderboard-main">
        <div className="leaderboard-name">
          <strong>{entry.name}</strong>
          {entry.isSelf ? <span className="lb-you">你</span> : null}
          {entry.team ? <span className="lb-team">{entry.team}</span> : null}
        </div>
        <div className="leaderboard-bar">
          <span style={{ width: barWidth }} />
        </div>
      </div>
      <div className="leaderboard-metrics">
        <div className="lb-current" title={data.currentLabel}>
          {entry.current}
        </div>
        {data.hasInterviews ? (
          <div className="lb-interview" title="推荐后面试 · 转化率">
            <CalendarCheck size={13} /> {entry.interviews ?? 0}
            {entry.interviewRate == null ? '' : ` · ${pct(entry.interviewRate)}`}
          </div>
        ) : null}
        <div className="lb-previous" title={data.previousLabel}>
          {data.previousLabel} {entry.previous}
        </div>
        <DeltaBadge entry={entry} />
      </div>
    </div>
  );
}
