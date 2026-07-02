import { useMemo, useState } from 'react';
import { Button, Card } from 'animal-island-ui';
import { Download, ExternalLink, FileJson, FileSpreadsheet, Network, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { StatusTag } from '../components/StatusTag';
import { gllueApi } from '../services/api';
import type { GllueExportSnapshot, MappingCandidate, MappingProject } from '../types/gllue';
import { dateOnly } from '../utils/display';
import { openGllueHash } from '../utils/gllueLinks';

type MappingState = 'idle' | 'loading' | 'done' | 'error';
type ExportState = 'idle' | 'exporting' | 'done' | 'error';

const STORAGE_KEY = 'gllue-shell-latest-mapping-project';

function splitKeywords(value: string) {
  return value.split(/[\s,，;；、|/]+/).map((item) => item.trim()).filter(Boolean);
}

function safeFilePart(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 40) || 'mapping';
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvCell(value: unknown) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return `"${text.replace(/"/g, '""')}"`;
}

function projectToCsv(project: MappingProject) {
  const headers = ['一级', '二级', '三级', '姓名', '职位', '当前公司', '顾问', '最近备注', '备注时间', '更新时间', '可信度', '下一步', '谷露链接'];
  const rows = project.candidates.map((item) => [
    project.targetCompany,
    item.suggestedLevel2,
    item.suggestedLevel3,
    item.name,
    item.title,
    item.currentCompany,
    item.consultant,
    item.recentNoteText,
    item.recentNoteDate,
    item.lastUpdateDate,
    item.confidence,
    item.nextAction,
    item.detailHash,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

function candidateSubtitle(candidate: MappingCandidate) {
  return [candidate.currentCompany, candidate.title].filter(Boolean).join(' / ') || '公司职位未记录';
}

export function Mapping() {
  const [targetCompany, setTargetCompany] = useState('');
  const [keywordText, setKeywordText] = useState('');
  const [roleFocus, setRoleFocus] = useState('');
  const [state, setState] = useState<MappingState>('idle');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [message, setMessage] = useState('输入目标公司后，同步谷露只读数据生成三级 mapping 草稿。');
  const [exportMessage, setExportMessage] = useState('导出谷露全量只读数据后，Codex 可以从本地 JSON 里做更完整的 mapping。');
  const [snapshot, setSnapshot] = useState<GllueExportSnapshot | null>(null);
  const [project, setProject] = useState<MappingProject | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as MappingProject | null;
    } catch {
      return null;
    }
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, MappingCandidate[]>();
    project?.candidates.forEach((candidate) => {
      const key = `${candidate.suggestedLevel2}|||${candidate.suggestedLevel3}`;
      groups.set(key, [...(groups.get(key) || []), candidate]);
    });
    return Array.from(groups.entries()).map(([key, candidates]) => {
      const [level2, level3] = key.split('|||');
      return { level2, level3, candidates };
    });
  }, [project]);

  const syncMapping = async () => {
    const company = targetCompany.trim();
    if (!company) {
      setState('error');
      setMessage('请先输入目标公司。');
      return;
    }
    setState('loading');
    setMessage('正在只读查询谷露人才、详情、备注和流程...');
    try {
      const next = await gllueApi.getMappingProject({
        targetCompany: company,
        keywords: splitKeywords(keywordText),
        roleFocus,
      });
      setProject(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setState('done');
      setMessage(next.fromMock ? '谷露接口暂不可用，未生成可靠 mapping。' : `已生成 ${next.candidates.length} 位候选人的 mapping 草稿。`);
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : '同步失败，请确认已登录谷露后重试。');
    }
  };

  const exportJson = () => {
    if (!project) return;
    downloadText(`${safeFilePart(project.targetCompany)}-mapping-latest.json`, JSON.stringify(project, null, 2), 'application/json;charset=utf-8');
  };

  const exportCsv = () => {
    if (!project) return;
    downloadText(`${safeFilePart(project.targetCompany)}-mapping-candidates.csv`, `\ufeff${projectToCsv(project)}`, 'text/csv;charset=utf-8');
  };

  const exportAllData = async () => {
    setExportState('exporting');
    setExportMessage('正在分页读取谷露人才、公司、项目、流程和候选人详情；数据多时会需要几分钟。');
    try {
      const next = await gllueApi.exportReadonlySnapshot();
      setSnapshot(next);
      localStorage.setItem('gllue-shell-latest-export-snapshot-meta', JSON.stringify({ id: next.id, generatedAt: next.generatedAt, stats: next.stats }));
      downloadText(`gllue-readonly-export-${next.generatedAt.slice(0, 10)}.json`, JSON.stringify(next, null, 2), 'application/json;charset=utf-8');
      setExportState('done');
      setExportMessage(`已导出：人才 ${next.stats.candidates}、详情 ${next.stats.candidateDetails}、公司 ${next.stats.clients}、项目 ${next.stats.jobs}、流程 ${next.stats.submissions}。`);
    } catch (error) {
      setExportState('error');
      setExportMessage(error instanceof Error ? error.message : '全量导出失败，请确认已登录谷露后重试。');
    }
  };

  return (
    <section className="page-stack mapping-page">
      <Card className="mapping-hero">
        <div>
          <p className="eyebrow">Mapping Workbench</p>
          <h1>转正 Mapping 工作台</h1>
          <p>只读搜索谷露数据，生成公司 / 事业部 / 团队岗位三级草稿，原始数据只留在本机。</p>
        </div>
        <div className="mapping-safety">
          <ShieldCheck size={22} />
          <strong>不写谷露</strong>
          <span>不上传公网服务，不保存 cookie</span>
        </div>
      </Card>

      <Card className="mapping-control-card">
        <div className="mapping-form-grid">
          <label>
            <span>目标公司</span>
            <input value={targetCompany} onChange={(event) => setTargetCompany(event.target.value)} placeholder="例如：字节跳动" />
          </label>
          <label>
            <span>关键词</span>
            <input value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="HRBP 招聘 商业化 产品" />
          </label>
          <label>
            <span>目标方向</span>
            <input value={roleFocus} onChange={(event) => setRoleFocus(event.target.value)} placeholder="例如：人力资源 / 商业化 / 技术" />
          </label>
        </div>
        <div className="mapping-actions">
          <Button type="primary" icon={state === 'loading' ? <RefreshCw size={16} /> : <Search size={16} />} disabled={state === 'loading'} onClick={syncMapping}>
            {state === 'loading' ? '同步中' : '同步 Mapping 数据'}
          </Button>
          <Button icon={<FileJson size={16} />} disabled={!project} onClick={exportJson}>
            导出 JSON
          </Button>
          <Button icon={<FileSpreadsheet size={16} />} disabled={!project} onClick={exportCsv}>
            导出 CSV
          </Button>
        </div>
        <div className={`mapping-status mapping-status--${state}`}>
          <Network size={17} />
          <span>{message}</span>
        </div>
      </Card>

      <Card className="mapping-export-card">
        <div className="section-heading">
          <div>
            <h2>全量只读数据包</h2>
            <p>先把谷露可读数据导成本地 JSON，我再帮你从全量样本里找目标公司和三级架构线索。</p>
          </div>
          <StatusTag tone={exportState === 'done' ? 'mint' : exportState === 'error' ? 'rose' : 'sky'}>
            {exportState === 'exporting' ? '导出中' : exportState === 'done' ? '已导出' : exportState === 'error' ? '失败' : '本地'}
          </StatusTag>
        </div>
        <div className="mapping-export-body">
          <div className={`mapping-status mapping-status--${exportState === 'exporting' ? 'loading' : exportState === 'done' ? 'done' : exportState === 'error' ? 'error' : 'idle'}`}>
            <FileJson size={17} />
            <span>{exportMessage}</span>
          </div>
          {snapshot ? (
            <div className="mapping-export-stats">
              <span>人才 {snapshot.stats.candidates}</span>
              <span>详情 {snapshot.stats.candidateDetails}</span>
              <span>公司 {snapshot.stats.clients}</span>
              <span>项目 {snapshot.stats.jobs}</span>
              <span>流程 {snapshot.stats.submissions}</span>
            </div>
          ) : null}
          <Button type="primary" icon={<Download size={16} />} disabled={exportState === 'exporting'} onClick={exportAllData}>
            {exportState === 'exporting' ? '正在导出全量数据' : '导出全量只读数据包'}
          </Button>
        </div>
      </Card>

      {project ? (
        <>
          <div className="mapping-metric-grid">
            <Card>
              <span>查询组合</span>
              <strong>{project.stats.queries}</strong>
            </Card>
            <Card>
              <span>原始命中</span>
              <strong>{project.stats.rawRows}</strong>
            </Card>
            <Card>
              <span>去重人才</span>
              <strong>{project.stats.uniqueCandidates}</strong>
            </Card>
            <Card>
              <span>详情补全</span>
              <strong>{project.stats.withDetails}</strong>
            </Card>
          </div>

          <Card className="mapping-structure-card">
            <div className="section-heading">
              <div>
                <h2>{project.targetCompany} 三级架构草稿</h2>
                <p>自动归类只作为草稿，待确认项适合电话或备注二次校验。</p>
              </div>
              <StatusTag tone={project.fromMock ? 'rose' : 'mint'}>{project.fromMock ? '不可用' : dateOnly(project.generatedAt)}</StatusTag>
            </div>
            <div className="mapping-structure-list">
              {grouped.map((group) => (
                <article key={`${group.level2}-${group.level3}`} className="mapping-structure-row">
                  <div>
                    <small>一级</small>
                    <strong>{project.targetCompany}</strong>
                  </div>
                  <div>
                    <small>二级</small>
                    <strong>{group.level2}</strong>
                  </div>
                  <div>
                    <small>三级</small>
                    <strong>{group.level3}</strong>
                  </div>
                  <span>{group.candidates.length} 人</span>
                </article>
              ))}
            </div>
          </Card>

          <Card className="mapping-structure-card">
            <div className="section-heading">
              <div>
                <h2>候选人清单</h2>
                <p>保留谷露链接、备注摘要、流程摘要和下一步动作，不导出联系方式明文。</p>
              </div>
              <Button icon={<Download size={16} />} onClick={exportCsv}>
                下载表格
              </Button>
            </div>
            <div className="mapping-candidate-list">
              {project.candidates.map((candidate) => (
                <article className="mapping-candidate-card" key={candidate.id}>
                  <div className="mapping-candidate-head">
                    <div>
                      <strong>{candidate.name}</strong>
                      <span>{candidateSubtitle(candidate)}</span>
                    </div>
                    <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash(candidate.detailHash)}>
                      谷露打开
                    </Button>
                  </div>
                  <div className="mapping-chip-row">
                    <span>{candidate.suggestedLevel2}</span>
                    <span>{candidate.suggestedLevel3}</span>
                    <span>可信度 {candidate.confidence}</span>
                    <span>顾问 {candidate.consultant}</span>
                  </div>
                  <p>{candidate.recentNoteText}</p>
                  <small>{candidate.nextAction}</small>
                </article>
              ))}
            </div>
          </Card>

          <Card className="mapping-gap-card">
            <div className="section-heading">
              <div>
                <h2>信息缺口</h2>
                <p>这些点可以作为后续寻访、电话和补充 mapping 的 checklist。</p>
              </div>
            </div>
            <div className="mapping-gap-list">
              {(project.gaps.length ? project.gaps : ['当前样本没有明显缺口，建议人工确认汇报关系和团队边界。']).map((gap) => (
                <span key={gap}>{gap}</span>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </section>
  );
}
