import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Select, Switch } from 'animal-island-ui';
import { FilePenLine, FlaskConical, Network, Plus, RefreshCw, Share2, Table2, Trash2 } from 'lucide-react';
import { ProjectForm } from '../components/ProjectForm';
import { ProjectGraphCanvas } from '../components/ProjectGraphCanvas';
import { StatusTag } from '../components/StatusTag';
import { clearAllProjects, createManyProjects, createProject, deleteProject, listProjects, updateProject } from '../services/projectsApi';
import type { TeamProject, TeamProjectInput } from '../types/gllue';

const ALL = '__all__';
type ProjectView = 'list' | 'graph';

function uniqueSorted(values: Array<string | undefined>): string[] {
  const set = new Set(values.map((value) => (value || '').trim()).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

// 仅供压力测试图谱布局用：随机组合出一批看起来还算真实的测试项目（公司/职位/地点互相复用，
// 这样图里的枢纽节点才会有大有小，跟真实数据的样子接近）。
const SAMPLE_COMPANIES = ['字节跳动', '阿里巴巴', '腾讯', '美团', '拼多多', '快手', '小红书', '蚂蚁集团', '京东', '滴滴', 'B站', '爱奇艺', '携程', '网易', '商汤科技', '智谱AI', '月之暗面', '元气森林', '蔚来', '理想汽车'];
const SAMPLE_TITLES = ['高级后端工程师', '前端工程师', '产品经理', '数据分析师', '算法工程师', '测试工程师', 'UI设计师', '运营专员', '增长负责人', '数据运营', '销售经理', 'HRBP', '财务经理', '供应链专员', '客户成功经理'];
const SAMPLE_LOCATIONS = ['北京', '上海', '深圳', '杭州', '广州', '成都', '苏州', '武汉', '南京', '西安'];
const SAMPLE_OWNERS = ['顾问A', '顾问B', '顾问C', '顾问D', '顾问E'];

function randomPick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function generateSampleProjects(count: number): TeamProjectInput[] {
  return Array.from({ length: count }, () => ({
    company: randomPick(SAMPLE_COMPANIES),
    title: randomPick(SAMPLE_TITLES),
    location: randomPick(SAMPLE_LOCATIONS),
    status: Math.random() < 0.85 ? '进行中' : '已结束',
    owners: [randomPick(SAMPLE_OWNERS)],
    notes: '',
  }));
}

export function ProjectMap() {
  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<TeamProject | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [view, setView] = useState<ProjectView>('graph');

  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [titleFilter, setTitleFilter] = useState(ALL);
  const [locationFilter, setLocationFilter] = useState(ALL);
  const [includeEnded, setIncludeEnded] = useState(false);

  // 压测按钮默认对普通用户隐藏；需要调试时在控制台执行
  // localStorage.gllueProjectDevTools = '1' 再刷新即可显示。
  const showDevTools = useMemo(() => {
    try {
      return localStorage.getItem('gllueProjectDevTools') === '1';
    } catch {
      return false;
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listProjects();
    if (result.ok) {
      setProjects(result.projects);
      setError('');
    } else {
      setError(result.error || '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const companyOptions = useMemo(() => [{ key: ALL, label: '全部公司' }, ...uniqueSorted(projects.map((p) => p.company)).map((v) => ({ key: v, label: v }))], [projects]);
  const titleOptions = useMemo(() => [{ key: ALL, label: '全部职位' }, ...uniqueSorted(projects.map((p) => p.title)).map((v) => ({ key: v, label: v }))], [projects]);
  const locationOptions = useMemo(() => [{ key: ALL, label: '全部地点' }, ...uniqueSorted(projects.map((p) => p.location)).map((v) => ({ key: v, label: v }))], [projects]);

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        if (!includeEnded && project.status === '已结束') return false;
        if (companyFilter !== ALL && project.company !== companyFilter) return false;
        if (titleFilter !== ALL && project.title !== titleFilter) return false;
        if (locationFilter !== ALL && project.location !== locationFilter) return false;
        return true;
      }),
    [projects, companyFilter, titleFilter, locationFilter, includeEnded],
  );

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const openAddForm = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEditForm = (project: TeamProject) => {
    setEditing(project);
    setFormOpen(true);
  };

  const handleCreate = async (input: TeamProjectInput) => {
    setSubmitting(true);
    const result = await createProject(input);
    setSubmitting(false);
    if (result.ok && result.project) {
      setProjects((prev) => [...prev, result.project as TeamProject]);
      closeForm();
    } else {
      setError(result.error || '新增失败');
    }
  };

  const handleUpdate = async (input: TeamProjectInput) => {
    if (!editing) return;
    setSubmitting(true);
    const result = await updateProject(editing.id, input);
    setSubmitting(false);
    if (result.ok && result.project) {
      setProjects((prev) => prev.map((p) => (p.id === editing.id ? (result.project as TeamProject) : p)));
      closeForm();
    } else {
      setError(result.error || '更新失败');
    }
  };

  const handleFilterHub = (kind: 'company' | 'title' | 'location', value: string) => {
    if (kind === 'company') setCompanyFilter(value);
    if (kind === 'title') setTitleFilter(value);
    if (kind === 'location') setLocationFilter(value);
  };

  const handleGenerateSample = async () => {
    setLoading(true);
    await createManyProjects(generateSampleProjects(100));
    await load();
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm('确定清空本地全部项目数据？这个操作不能撤销。');
    if (!confirmed) return;
    setLoading(true);
    await clearAllProjects();
    await load();
  };

  const handleDelete = async (project: TeamProject) => {
    const confirmed = window.confirm(`确定删除「${project.company} · ${project.title}」这条项目记录？`);
    if (!confirmed) return;
    const result = await deleteProject(project.id);
    if (result.ok) {
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (editing?.id === project.id) closeForm();
    } else {
      setError(result.error || '删除失败');
    }
  };

  return (
    <section className="page-stack">
      <Card className="project-list-card">
        <div className="section-heading">
          <div>
            <h2>
              <Network size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
              在招项目
            </h2>
            <p>只存在你自己浏览器本地，按公司 / 职位 / base 地点筛选。</p>
          </div>
          <div className="row-actions">
            <div className="project-view-toggle">
              <Button size="small" type={view === 'graph' ? 'primary' : 'default'} icon={<Share2 size={15} />} onClick={() => setView('graph')}>
                图谱
              </Button>
              <Button size="small" type={view === 'list' ? 'primary' : 'default'} icon={<Table2 size={15} />} onClick={() => setView('list')}>
                列表
              </Button>
            </div>
            <Button icon={<RefreshCw size={15} />} onClick={load} disabled={loading}>
              {loading ? '加载中…' : '刷新'}
            </Button>
            <Button type="primary" icon={<Plus size={15} />} onClick={openAddForm}>
              添加项目
            </Button>
          </div>
        </div>

        <div className="project-filters">
          <Select value={companyFilter} onChange={setCompanyFilter} options={companyOptions} placeholder="按公司筛选" />
          <Select value={titleFilter} onChange={setTitleFilter} options={titleOptions} placeholder="按职位筛选" />
          <Select value={locationFilter} onChange={setLocationFilter} options={locationOptions} placeholder="按地点筛选" />
          <label className="project-filter-switch">
            <Switch size="small" checked={includeEnded} onChange={setIncludeEnded} />
            <span>包含已结束</span>
          </label>
        </div>

        {showDevTools ? (
          <div className="project-dev-tools">
            <FlaskConical size={13} />
            <span>压测图谱：</span>
            <button type="button" className="project-dev-tools-btn" onClick={handleGenerateSample} disabled={loading}>
              生成 100 条测试数据
            </button>
            <button type="button" className="project-dev-tools-btn project-dev-tools-btn--danger" onClick={handleClearAll} disabled={loading}>
              清空全部项目
            </button>
          </div>
        ) : projects.length ? (
          <div className="project-dev-tools">
            <button type="button" className="project-dev-tools-btn project-dev-tools-btn--danger" onClick={handleClearAll} disabled={loading}>
              清空全部项目
            </button>
          </div>
        ) : null}

        {error ? <div className="leaderboard-empty">{error}</div> : null}

        {!loading && projects.length === 0 && !error ? (
          <div style={{ textAlign: 'center', padding: '54px 24px', maxWidth: 480, margin: '0 auto' }}>
            <div style={{ width: 60, height: 60, borderRadius: 20, background: '#eef2fe', color: '#5b7ae0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Network size={28} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>还没有项目，先加第一个</h3>
            <p style={{ margin: '0 0 18px', color: '#8a765b', fontSize: 14, lineHeight: 1.75 }}>
              把手上的在招项目录进来（公司 / 职位 / base 地点），图谱会自动把共享同一公司或职位的项目连起来——一眼看出哪些项目在抢同一批人、新需求能复用哪些老项目。
            </p>
            <Button type="primary" icon={<Plus size={16} />} onClick={openAddForm}>
              添加第一个项目
            </Button>
            <p style={{ margin: '14px 0 0', color: '#a08a63', fontSize: 12 }}>数据只存在你本地浏览器，不上传、不共享。</p>
          </div>
        ) : (
          <>
            {!loading && !filteredProjects.length ? <div className="leaderboard-empty">暂无符合筛选条件的项目</div> : null}
            {view === 'graph' ? (
          <ProjectGraphCanvas projects={filteredProjects} onSelectProject={openEditForm} onFilterHub={handleFilterHub} />
        ) : (
          <div className="project-list">
            {filteredProjects.map((project) => (
              <div key={project.id} className="project-item">
                <div className="project-item-main">
                  <strong>{project.company || '公司未填写'}</strong>
                  <span className="project-item-title">{project.title || '职位未填写'}</span>
                  {project.location ? <span className="project-item-location">{project.location}</span> : null}
                  <StatusTag tone={project.status === '进行中' ? 'mint' : 'soil'}>{project.status}</StatusTag>
                </div>
                <div className="project-item-meta">
                  {project.owners.length ? <span>负责顾问：{project.owners.join('、')}</span> : <span>负责顾问：未填写</span>}
                  {project.notes ? <span className="project-item-notes">{project.notes}</span> : null}
                </div>
                <div className="row-actions">
                  <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openEditForm(project)}>
                    编辑
                  </Button>
                  <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => handleDelete(project)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
              </div>
            )}
          </>
        )}
      </Card>

      {formOpen ? (
        <div
          onClick={closeForm}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2147483647,
            background: 'rgba(57, 45, 30, 0.34)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            overflowY: 'auto',
            padding: '48px 16px',
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)' }}>
            <ProjectForm key={editing?.id ?? 'new'} initial={editing} submitting={submitting} onSubmit={editing ? handleUpdate : handleCreate} onCancel={closeForm} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
