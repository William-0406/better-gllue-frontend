import { useMemo, useState } from 'react';
import { Button, Card, Divider, Icon } from 'animal-island-ui';
import { Bell, BriefcaseBusiness, CalendarCheck, Check, FileText, Inbox, KanbanSquare, Network, Plus, Search, Send, Sparkles, StickyNote, UserPlus } from 'lucide-react';
import { EnhanceServicePanel } from '../components/EnhanceServicePanel';
import { ResumeImportCheckModal } from '../components/ResumeImportCheckModal';
import { ConsultantTracker } from '../components/ConsultantTracker';
import { StatusTag } from '../components/StatusTag';
import { useDashboardSummary } from '../services/useDashboardSummary';
import type { Candidate, ModuleKey, PipelineSubmission } from '../types/gllue';
import { dateOnly, textValue } from '../utils/display';
import { openGllueHash } from '../utils/gllueLinks';

interface DashboardProps {
  onNavigate: (module: ModuleKey) => void;
}

const quickLinks = [
  { label: 'Pipeline', description: '候选人项目流程', hash: '#jobsubmission/list', icon: KanbanSquare },
  { label: '我的待办', description: '任务和提醒', hash: '#todo/list', icon: Inbox },
  { label: '消息', description: '站内通知', hash: '#message/list', icon: Bell },
  { label: '文档', description: '附件与知识库', hash: '#document/list', icon: FileText },
  { label: '报表', description: '统计分析', hash: '#report', icon: BriefcaseBusiness },
];

const candidateName = (item: { chineseName?: string; englishName?: string; id: number }) => item.chineseName || item.englishName || `候选人 #${item.id}`;
const userName = (value: Candidate['addedBy'] | Candidate['owner']) => (typeof value === 'object' ? value.chineseName || value.__name__ : '');
const candidateConsultant = (item: Candidate) => userName(item.addedBy) || userName(item.owner);
const candidateNote = (item: Candidate) =>
  (Array.isArray(item.note_set) ? item.note_set.map((note) => note.content || note.note).find((content) => String(content || '').trim()) : undefined) ||
  item.today_note_text ||
  (Number(item.note_count ?? item.candidate__note_count ?? 0) > 0 ? '有备注记录' : undefined);
const submissionCandidateName = (item: PipelineSubmission) => textValue(item.candidate?.chineseName || item.candidate?.englishName || item.candidate?.__name__ || item.__name__, `流程 #${item.id}`);
const submissionProjectName = (item: PipelineSubmission) => textValue(item.joborder?.jobTitle || item.joborder?.__name__, '未关联项目');
const submissionDate = (item: PipelineSubmission) => dateOnly(item.detail?.target?.date || item.detail?.target?.dateAdded || item.lastUpdateDate || item.dateAdded);
const submissionDateTime = (item: PipelineSubmission) => item.detail?.target?.date || item.detail?.target?.dateAdded || item.lastUpdateDate || item.dateAdded || '';
const submissionTimestamp = (item: PipelineSubmission) => {
  const value = submissionDateTime(item);
  if (!value) return Number.NaN;
  return new Date(String(value).replace(' ', 'T')).getTime();
};
const openSubmission = (item: PipelineSubmission) => {
  if (item.candidate?.id) {
    openGllueHash(`#candidate/detail?id=${item.candidate.id}&jobsubmission=${item.id}`);
    return;
  }
  openGllueHash(`#jobsubmission/detail?id=${item.id}`);
};

export function Dashboard({ onNavigate }: DashboardProps) {
  const summary = useDashboardSummary();
  const [importCheckOpen, setImportCheckOpen] = useState(false);
  const [reminderText, setReminderText] = useState('');
  const [reminders, setReminders] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('gllue-shell-reminders') || '[]') as string[];
    } catch {
      return [];
    }
  });
  const nextInterview = useMemo(() => {
    const now = Date.now();
    return [...summary.latest.weeklyInterviews]
      .map((item) => ({ item, time: submissionTimestamp(item) }))
      .filter(({ time }) => Number.isFinite(time) && time > now)
      .sort((a, b) => a.time - b.time)[0]?.item;
  }, [summary.latest.weeklyInterviews]);
  const addReminder = () => {
    const value = reminderText.trim();
    if (!value) return;
    const next = [value, ...reminders].slice(0, 5);
    setReminders(next);
    localStorage.setItem('gllue-shell-reminders', JSON.stringify(next));
    setReminderText('');
  };
  const openImportCheck = () => setImportCheckOpen(true);
  const openCandidateSearch = () => openGllueHash('#candidate/list');
  const openInterviewTarget = () => (nextInterview ? openSubmission(nextInterview) : openGllueHash('#clientinterview/list'));

  return (
    <section className="page-stack">
      <div className="hero-panel">
        <div className="today-people-panel">
          <div className="today-people-head">
            <div>
              <p className="eyebrow">Today Candidates</p>
              <h1>今日备注人才</h1>
              <p>当天有联系记录且留下备注的候选人，按最近联系时间滚动展示。</p>
            </div>
            <StatusTag tone="mint">{summary.loading ? '加载中' : `${summary.latest.todayCandidates.length} 位`}</StatusTag>
          </div>
          <div className="today-people-marquee">
            <div className="today-people-track">
              {(summary.latest.todayCandidates.length ? [...summary.latest.todayCandidates, ...summary.latest.todayCandidates] : []).map((item, index) => (
                <button className="today-person-card" key={`${item.id}-${index}`} onClick={() => onNavigate('candidates')}>
                  <div className="today-person-avatar">{candidateName(item).slice(0, 1).toUpperCase()}</div>
                  <strong>{candidateName(item)}</strong>
                  <span>{textValue(item.company?.name || item.company?.__name__, '未填写公司')}</span>
                  <em>{`顾问：${textValue(candidateConsultant(item), '顾问未记录')}`}</em>
                  <small>{textValue(candidateNote(item), '暂无备注')}</small>
                  <time>{dateOnly(item.lastContactDate || item.dateAdded)}</time>
                </button>
              ))}
              {!summary.loading && !summary.latest.todayCandidates.length ? (
                <div className="today-people-empty">今天暂无带备注的联系人</div>
              ) : null}
            </div>
          </div>
        </div>
        <Card className="hero-note">
          <div className="today-board-head">
            <Icon name="icon-critterpedia" size={42} bounce />
            <div>
              <strong>备注速览</strong>
              <span>{summary.loading ? '加载中' : `${summary.latest.todayCandidates.length} 位候选人`}</span>
            </div>
          </div>
          <div className="hero-note-summary">
            <strong>{summary.latest.todayCandidates.length}</strong>
            <span>今日备注</span>
            <Button type="primary" icon={<Sparkles size={18} />} onClick={() => onNavigate('candidates')}>
              查看人才库
            </Button>
          </div>
        </Card>
      </div>

      <div className="workbench-action-grid">
        <Card className="workbench-action-card workbench-action-card--notes">
          <div className="workbench-action-icon">
            <StickyNote size={22} />
          </div>
          <div>
            <span>提醒事项</span>
            <strong>{reminders.length || '记录'}</strong>
          </div>
          <div className="reminder-composer">
            <input value={reminderText} onChange={(event) => setReminderText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addReminder()} placeholder="写一条提醒" />
            <button onClick={addReminder} aria-label="添加提醒">
              <Plus size={16} />
            </button>
          </div>
          <small>{reminders[0] || '本地保存，不写入谷露'}</small>
        </Card>

        {/* 导入前查重入口暂隐藏：与谷露原生"重复数据"功能重复，价值有限。功能代码保留，改回 true 即恢复。 */}
        {false && (
        <Card className="workbench-action-card workbench-action-card--add" onClick={openImportCheck}>
          <div className="workbench-action-icon">
            <UserPlus size={22} />
          </div>
          <div>
            <span>新增人才</span>
            <strong>查重</strong>
          </div>
          <small>选择简历后自动解析并查在库备注</small>
          <Button icon={<UserPlus size={17} />} onClick={openImportCheck}>
            导入前检查
          </Button>
        </Card>
        )}

        <Card className="workbench-action-card workbench-action-card--search" onClick={openCandidateSearch}>
          <div className="workbench-action-icon">
            <Search size={22} />
          </div>
          <div>
            <span>搜索人才</span>
            <strong>查找</strong>
          </div>
          <small>进入人才库搜索与筛选</small>
          <Button icon={<Search size={17} />} onClick={openCandidateSearch}>
            打开搜索
          </Button>
        </Card>

        <Card className="workbench-action-card workbench-action-card--interview" onClick={openInterviewTarget}>
          <div className="workbench-action-icon">
            <CalendarCheck size={22} />
          </div>
          <div>
            <span>下一场面试</span>
            <strong>{summary.loading ? '...' : nextInterview ? submissionCandidateName(nextInterview) : '暂无'}</strong>
          </div>
          <small>{nextInterview ? `${submissionDate(nextInterview)} · ${submissionProjectName(nextInterview)}` : '本周暂无客户面试'}</small>
          <Button icon={<Check size={17} />} onClick={openInterviewTarget}>
            查看安排
          </Button>
        </Card>

        <Card className="workbench-action-card workbench-action-card--todo">
          <div className="workbench-action-icon">
            <Sparkles size={22} />
          </div>
          <div>
            <span>敬请期待</span>
            <strong>待定</strong>
          </div>
          <small>新模块规划中</small>
        </Card>

        {/* mapping/脉脉 入口暂时隐藏（私有版，功能代码保留）。 */}
      </div>

      {/* 增强服务面板暂时隐藏（私有版，功能代码保留）。 */}
      {/* <EnhanceServicePanel /> */}

      <ConsultantTracker />

      <Card className="api-preview-card">
        <div className="section-heading">
          <div>
            <h2>本周业务进展</h2>
            <p>集中查看本周推荐简历和客户面试的人选与对应项目。</p>
          </div>
          <StatusTag tone={summary.fromMock ? 'rose' : 'mint'}>{summary.fromMock ? '预览' : '实时'}</StatusTag>
        </div>
        <div className="weekly-kpi-grid">
          <div className="weekly-kpi-panel weekly-kpi-panel--mint">
            <div className="weekly-kpi-title">
              <div>
                <span>简历推荐</span>
                <strong>{summary.loading ? '...' : summary.totals.weeklyRecommended}</strong>
              </div>
              <Send size={22} />
            </div>
            <div className="weekly-kpi-list">
              {summary.latest.weeklyRecommended.map((item) => (
                <button key={item.id} className="weekly-kpi-row" onClick={() => openSubmission(item)}>
                  <span className="weekly-kpi-name">{submissionCandidateName(item)}</span>
                  <span className="weekly-kpi-project">{submissionProjectName(item)}</span>
                  <time>{submissionDate(item)}</time>
                </button>
              ))}
              {!summary.loading && !summary.latest.weeklyRecommended.length ? <div className="weekly-kpi-empty">本周暂无推荐简历</div> : null}
            </div>
            <button className="weekly-kpi-more" onClick={() => openGllueHash('#jobsubmission/list?gql=joborder__jobStatus__eq%3DLive%26_hide_spec_id%3D1%26jobsubmission_status_kanban%3Dcvsent%26cvsent_set__user__eq%3D%7B%7Buser.id%7D%7D%26cvsent_set__date__this_week')}>
              打开推荐列表
            </button>
          </div>
          <div className="weekly-kpi-panel weekly-kpi-panel--sky">
            <div className="weekly-kpi-title">
              <div>
                <span>客户面试</span>
                <strong>{summary.loading ? '...' : summary.totals.weeklyInterviews}</strong>
              </div>
              <CalendarCheck size={22} />
            </div>
            <div className="weekly-kpi-list">
              {summary.latest.weeklyInterviews.map((item) => (
                <button key={item.id} className="weekly-kpi-row" onClick={() => openSubmission(item)}>
                  <span className="weekly-kpi-name">{submissionCandidateName(item)}</span>
                  <span className="weekly-kpi-project">{submissionProjectName(item)}</span>
                  <time>{submissionDate(item)}</time>
                </button>
              ))}
              {!summary.loading && !summary.latest.weeklyInterviews.length ? <div className="weekly-kpi-empty">本周暂无客户面试</div> : null}
            </div>
            <button className="weekly-kpi-more" onClick={() => openGllueHash('#jobsubmission/list?gql=clientinterview_set__date__this_week%26jobsubmission_status__current%3Dclientinterview%2Coffersign%26candidate__owner__eq%3D%7B%7Buser.id%7D%7D')}>
              打开面试列表
            </button>
          </div>
        </div>
      </Card>

      <Card className="api-preview-card">
        <div className="section-heading">
          <div>
            <h2>快捷入口</h2>
            <p>快速进入常用模块。</p>
          </div>
          <StatusTag tone="sky">常用</StatusTag>
        </div>
        <div className="quick-link-grid">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <button className="quick-link-card" key={link.label} onClick={() => openGllueHash(link.hash)}>
                <Icon size={20} />
                <span>{link.label}</span>
                <small>{link.description}</small>
              </button>
            );
          })}
        </div>
      </Card>
      <Divider type="line-teal" />
      <ResumeImportCheckModal open={importCheckOpen} onClose={() => setImportCheckOpen(false)} />
    </section>
  );
}
