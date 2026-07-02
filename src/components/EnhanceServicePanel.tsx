import { useEffect, useState } from 'react';
import { Button, Card } from 'animal-island-ui';
import { Cloud, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import { getEnhanceStatus, type EnhanceStatus, upsertCandidateSummaries } from '../services/enhanceApi';
import { gllueApi } from '../services/api';
import { dateOnly } from '../utils/display';

type SyncState = 'idle' | 'syncing' | 'done' | 'error';

export function EnhanceServicePanel() {
  const [status, setStatus] = useState<EnhanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncedCount, setSyncedCount] = useState(0);

  const refreshStatus = async () => {
    setLoading(true);
    const next = await getEnhanceStatus();
    setStatus(next);
    setLoading(false);
  };

  const syncCandidates = async () => {
    setSyncState('syncing');
    try {
      const [latest, today] = await Promise.all([
        gllueApi.getCandidates(1, 60),
        gllueApi.getTodayCandidates(120),
      ]);
      const merged = new Map([...latest.list, ...today.list].map((item) => [item.id, item]));
      const rows = Array.from(merged.values());
      const ok = await upsertCandidateSummaries(rows);
      setSyncedCount(rows.length);
      setSyncState(ok ? 'done' : 'error');
      await refreshStatus();
    } catch {
      setSyncState('error');
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const isConnected = Boolean(status?.ok);
  const hasNewerVersion = Boolean(status?.extensionLatestVersion && status.extensionLatestVersion !== '1.0.0');

  return (
    <Card className="enhance-service-panel">
      <div className="enhance-service-head">
        <div className={`enhance-service-icon ${isConnected ? 'is-online' : 'is-offline'}`}>
          <Cloud size={20} />
        </div>
        <div>
          <span>增强服务</span>
          <strong>{loading ? '检测中' : isConnected ? '已连接' : '未连接'}</strong>
        </div>
        <button className="enhance-icon-button" onClick={refreshStatus} aria-label="刷新增强服务状态">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="enhance-service-grid">
        <div>
          <small>索引人数</small>
          <b>{status?.candidates ?? 0}</b>
        </div>
        <div>
          <small>最近同步</small>
          <b>{status?.updatedAt ? dateOnly(status.updatedAt) : '暂无'}</b>
        </div>
        <div>
          <small>安装包</small>
          <b>{status?.extensionAvailable ? '已就绪' : '未上传'}</b>
        </div>
      </div>

      {hasNewerVersion ? (
        <div className="enhance-version-alert">
          <ShieldCheck size={16} />
          <span>发现新版 {status?.extensionLatestVersion}</span>
        </div>
      ) : null}

      <div className="enhance-service-actions">
        <Button icon={<RefreshCw size={16} />} disabled={syncState === 'syncing'} onClick={syncCandidates}>
          {syncState === 'syncing' ? '同步中' : '同步查重索引'}
        </Button>
        <Button icon={<Download size={16} />} onClick={() => window.open(status?.extensionHomeUrl || `${status?.baseUrl || ''}/download`, '_blank', 'noopener,noreferrer')}>
          下载页
        </Button>
      </div>

      <p className={`enhance-sync-note enhance-sync-note--${syncState}`}>
        {syncState === 'done'
          ? `已同步 ${syncedCount} 位最近人才摘要`
          : syncState === 'error'
            ? '同步失败，仍会回退谷露实时查重'
            : '只同步只读摘要和联系方式 hash，不上传谷露 cookie'}
      </p>
    </Card>
  );
}
