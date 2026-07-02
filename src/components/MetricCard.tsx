import { Card } from 'animal-island-ui';
import { BriefcaseBusiness, Building2, Database, UsersRound } from 'lucide-react';
import type { DashboardMetric } from '../types/gllue';

const toneIcon: Record<DashboardMetric['tone'], React.ReactNode> = {
  blue: <UsersRound size={19} />,
  green: <Building2 size={19} />,
  yellow: <BriefcaseBusiness size={19} />,
  pink: <Database size={19} />,
};

export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <Card className={`metric-card metric-card--${metric.tone}`}>
      <div className="metric-icon">{toneIcon[metric.tone]}</div>
      <span>{metric.label}</span>
      <strong>{metric.value}</strong>
      <small>{metric.hint}</small>
    </Card>
  );
}
