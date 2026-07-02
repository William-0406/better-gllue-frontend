import { useEffect, useState } from 'react';
import { Button, Card, Input, Select } from 'animal-island-ui';
import { Save, X } from 'lucide-react';
import type { TeamProject, TeamProjectInput, TeamProjectStatus } from '../types/gllue';

const STATUS_OPTIONS: Array<{ key: TeamProjectStatus; label: string }> = [
  { key: '进行中', label: '进行中' },
  { key: '已结束', label: '已结束' },
];

function splitOwners(raw: string): string[] {
  return raw
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

interface ProjectFormProps {
  initial?: TeamProject | null;
  submitting?: boolean;
  onSubmit: (input: TeamProjectInput) => void;
  onCancel?: () => void;
}

export function ProjectForm({ initial, submitting, onSubmit, onCancel }: ProjectFormProps) {
  const [company, setCompany] = useState(initial?.company ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [status, setStatus] = useState<TeamProjectStatus>(initial?.status ?? '进行中');
  const [ownersText, setOwnersText] = useState(initial?.owners?.join('、') ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setCompany(initial?.company ?? '');
    setTitle(initial?.title ?? '');
    setLocation(initial?.location ?? '');
    setStatus(initial?.status ?? '进行中');
    setOwnersText(initial?.owners?.join('、') ?? '');
    setNotes(initial?.notes ?? '');
    setFormError('');
  }, [initial?.id]);

  const isEditing = Boolean(initial);

  const handleSubmit = () => {
    if (!company.trim() && !title.trim()) {
      setFormError('公司和职位至少填一个');
      return;
    }
    setFormError('');
    onSubmit({
      company: company.trim(),
      title: title.trim(),
      location: location.trim(),
      status,
      owners: splitOwners(ownersText),
      notes: notes.trim(),
    });
    if (!isEditing) {
      setCompany('');
      setTitle('');
      setLocation('');
      setStatus('进行中');
      setOwnersText('');
      setNotes('');
    }
  };

  return (
    <Card className="project-form">
      <div className="section-heading">
        <div>
          <h2>{isEditing ? '编辑项目' : '添加项目'}</h2>
          <p>公司 / 职位 / base 地点 / 状态 / 负责顾问，手动录入。只存在你自己浏览器本地，不上传、不读谷露项目数据。</p>
        </div>
      </div>
      <div className="project-form-grid">
        <label>
          <span>公司</span>
          <Input placeholder="例如：字节跳动" value={company} onChange={(e) => setCompany(e.target.value)} allowClear />
        </label>
        <label>
          <span>职位</span>
          <Input placeholder="例如：高级后端工程师" value={title} onChange={(e) => setTitle(e.target.value)} allowClear />
        </label>
        <label>
          <span>base 地点</span>
          <Input placeholder="例如：上海" value={location} onChange={(e) => setLocation(e.target.value)} allowClear />
        </label>
        <label>
          <span>状态</span>
          <Select value={status} onChange={(key) => setStatus(key as TeamProjectStatus)} options={STATUS_OPTIONS} />
        </label>
        <label>
          <span>负责顾问</span>
          <Input placeholder="多人用、或,分隔" value={ownersText} onChange={(e) => setOwnersText(e.target.value)} allowClear />
        </label>
        <label className="project-form-notes">
          <span>备注</span>
          <Input placeholder="选填" value={notes} onChange={(e) => setNotes(e.target.value)} allowClear />
        </label>
      </div>
      {formError ? <div className="project-form-error">{formError}</div> : null}
      <div className="project-form-actions">
        <Button type="primary" icon={<Save size={15} />} onClick={handleSubmit} loading={submitting}>
          {isEditing ? '保存修改' : '添加项目'}
        </Button>
        {onCancel ? (
          <Button icon={<X size={15} />} onClick={onCancel} disabled={submitting}>
            取消
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
