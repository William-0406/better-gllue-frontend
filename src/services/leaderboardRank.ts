// 排行榜纯逻辑：无任何依赖，便于单测（Node 直接跑）。

export interface RawConsultantCount {
  id: number;
  name: string;
  team?: string;
  current: number;
  previous: number;
  /** 仅"简历推荐"指标时填充：当期"推荐后面试"数。 */
  interviews?: number;
}

export interface LeaderboardEntry {
  userId: number;
  name: string;
  team?: string;
  current: number;
  previous: number;
  delta: number;
  /** 环比：上期>0 时为比率（0.5 = +50%）；上期=0 且本期>0 时为 null（"新增、无基数"）。 */
  deltaPct: number | null;
  /** 当期"推荐后面试"数（仅推荐指标）。 */
  interviews?: number;
  /** 推荐→面试转化率（interviews/current），current=0 时为 null。 */
  interviewRate?: number | null;
  rank: number;
  isSelf: boolean;
}

/** 把"每个顾问的当期/上期计数"排成榜：按当期降序，算名次、环比、是否本人。 */
export function rankConsultantCounts(rows: RawConsultantCount[], selfUserId: number | null): LeaderboardEntry[] {
  const ranked = rows
    .filter((row) => row.current > 0 || row.previous > 0)
    .map<LeaderboardEntry>((row) => ({
      userId: row.id,
      name: row.name,
      team: row.team,
      current: row.current,
      previous: row.previous,
      delta: row.current - row.previous,
      deltaPct: row.previous > 0 ? (row.current - row.previous) / row.previous : null,
      interviews: row.interviews,
      interviewRate: row.interviews == null ? undefined : row.current > 0 ? row.interviews / row.current : null,
      isSelf: selfUserId != null && row.id === selfUserId,
      rank: 0,
    }))
    .sort((a, b) => b.current - a.current || b.previous - a.previous || a.name.localeCompare(b.name));
  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });
  return ranked;
}
