import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'animal-island-ui';
import { AlertTriangle, Clock3, ExternalLink, FileSearch, FileText, Mail, Phone, Upload, UserRound, X } from 'lucide-react';
import { gllueApi } from '../services/api';
import { parseResumeIdentity, type ResumeIdentity } from '../services/resumeParser';
import type { Candidate } from '../types/gllue';
import { dateOnly, textValue } from '../utils/display';
import { candidateDetail, openGllueHash } from '../utils/gllueLinks';

interface ResumeImportCheckModalProps {
  open: boolean;
  onClose: () => void;
}

type CheckState = 'idle' | 'parsing' | 'searching' | 'matched' | 'clear' | 'error';

function userName(value: Candidate['addedBy'] | Candidate['owner'] | Candidate['lastUpdateBy']) {
  return typeof value === 'object' ? value.chineseName || value.__name__ : '';
}

function noteEntries(item: Candidate) {
  if (Array.isArray(item.note_set)) return item.note_set;
  if (item.note_set && typeof item.note_set === 'object') return Object.values(item.note_set);
  return [];
}

function recentNote(item: Candidate) {
  const entries = noteEntries(item)
    .map((entry) => ({
      text: textValue(entry.content || entry.note, ''),
      date: entry.lastUpdateDate || entry.dateAdded,
      consultant: userName(entry.user) || userName(entry.addedBy),
    }))
    .filter((entry) => entry.text);
  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const first = entries[0];
  if (first) return first;
  if (item.today_note_text) return { text: item.today_note_text, date: item.noteDate || item.lastContactDate, consultant: '' };
  if (Number(item.note_count ?? item.candidate__note_count ?? 0) > 0) return { text: '在库人才有备注，列表接口未返回备注正文。', date: item.noteDate || item.lastContactDate, consultant: '' };
  return { text: '暂无备注', date: item.noteDate || item.lastContactDate, consultant: '' };
}

function candidateName(item: Candidate) {
  return item.chineseName || item.englishName || item.__name__ || `人才 #${item.id}`;
}

function candidateCompany(item: Candidate) {
  return item.company?.name || item.company?.__name__ || item.candidateexperience_set?.[0]?.client?.name || item.candidateexperience_set?.[0]?.client?.__name__;
}

function candidateTitle(item: Candidate) {
  return item.title || item.candidateexperience_set?.[0]?.title;
}

function consultant(item: Candidate) {
  return userName(item.lastUpdateBy) || userName(item.owner) || userName(item.addedBy) || '未记录';
}

function friendlyParseError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message && /[\u4e00-\u9fa5]/.test(message)) return message;
  return '解析失败，请换一份 PDF、DOCX、TXT 或 HTML 简历重试。';
}

function signalSummary(identity: ResumeIdentity | null) {
  if (!identity) return [];
  return [
    identity.nameFromContent ? { icon: <UserRound size={14} />, label: `姓名 ${identity.nameFromContent}` } : null,
    identity.nameFromFilename && !identity.nameFromContent ? { icon: <UserRound size={14} />, label: `文件名疑似 ${identity.nameFromFilename}` } : null,
    ...identity.phones.map((phone) => ({ icon: <Phone size={14} />, label: phone })),
    ...identity.emails.map((email) => ({ icon: <Mail size={14} />, label: email })),
    { icon: <FileSearch size={14} />, label: identity.confidence === 'high' ? '强信号' : identity.confidence === 'medium' ? '姓名弱匹配' : '低置信度' },
  ].filter(Boolean) as Array<{ icon: ReactNode; label: string }>;
}

export function ResumeImportCheckModal({ open, onClose }: ResumeImportCheckModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [identity, setIdentity] = useState<ResumeIdentity | null>(null);
  const [matches, setMatches] = useState<Candidate[]>([]);
  const [state, setState] = useState<CheckState>('idle');
  const [message, setMessage] = useState('选择一份简历，插件会在本地解析姓名、手机和邮箱，再只读查询谷露人才库。');

  const reset = () => {
    setFileName('');
    setIdentity(null);
    setMatches([]);
    setState('idle');
    setMessage('选择一份简历，插件会在本地解析姓名、手机和邮箱，再只读查询谷露人才库。');
    if (inputRef.current) inputRef.current.value = '';
  };

  const runCheck = async (file: File) => {
    setFileName(file.name);
    setIdentity(null);
    setMatches([]);
    setState('parsing');
    setMessage('正在本地解析简历...');
    try {
      const parsed = await parseResumeIdentity(file);
      setIdentity(parsed);
      if (!parsed.signals.length) {
        setState('error');
        setMessage('没有从简历中解析到姓名、手机或邮箱，暂时无法自动查重。');
        return;
      }

      setState('searching');
      setMessage(parsed.confidence === 'high' ? '已解析到手机或邮箱，正在查询谷露人才库...' : '未解析到手机或邮箱，将用姓名检查是否重复...');
      const result = await gllueApi.getCandidateImportMatches(parsed).catch((searchError: unknown) => {
        console.error('[gllue查重] 搜索失败 ->', searchError);
        return null;
      });
      if (!result) {
        setState('error');
        setMessage('简历已解析，但查重查询出错（详见控制台 [gllue查重]）。可直接去谷露原页面继续导入。');
        return;
      }
      if (result.fromMock) {
        setState('error');
        setMessage('当前无法连接谷露接口，未做在库判断。请回谷露原导入页继续。');
        return;
      }
      setMatches(result.list);
      if (result.list.length) {
        setState('matched');
        setMessage(
          parsed.phones.length || parsed.emails.length
            ? `发现 ${result.list.length} 位联系方式精确命中的在库人才，建议先看最近更新和备注。`
            : `发现 ${result.list.length} 位姓名重复的在库人才：${result.list.map(candidateName).join('、')}。请人工确认是否同一人。`,
        );
        return;
      }
      setState('clear');
      setMessage('未发现明显在库记录，可以去谷露原页面继续导入。');
    } catch (error) {
      setState('error');
      setMessage(friendlyParseError(error));
    }
  };

  const openOriginalImport = () => {
    openGllueHash('#candidate/add');
    onClose();
  };

  useEffect(() => {
    if (state !== 'clear') return undefined;
    const timer = window.setTimeout(() => {
      openOriginalImport();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!open) return null;

  return (
    <div className="resume-import-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="resume-import-dialog" role="dialog" aria-modal="true" aria-label="导入前查重">
        <div className="resume-import-dialog-head">
          <div>
            <span>新增人才</span>
            <strong>导入前查重</strong>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="resume-import-dialog-body">
          <div className="resume-import-panel">
            <input
              ref={inputRef}
              className="resume-file-input"
              type="file"
              accept=".pdf,.docx,.txt,.html,.htm,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/html"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void runCheck(file);
              }}
            />
            <button className="resume-upload-zone" onClick={() => inputRef.current?.click()}>
              <span>
                <Upload size={22} />
              </span>
              <strong>{fileName || '选择简历并自动查重'}</strong>
              <small>支持 PDF、DOCX、TXT、HTML；解析在浏览器本地完成</small>
            </button>

            <div className={`resume-import-status resume-import-status--${state}`}>
              {state === 'error' ? <AlertTriangle size={18} /> : state === 'idle' ? <FileText size={18} /> : <FileSearch size={18} />}
              <span>{message}</span>
            </div>

            {identity ? (
              <div className="resume-signal-row">
                {signalSummary(identity).map((signal) => (
                  <span key={`${signal.label}`}>
                    {signal.icon}
                    {signal.label}
                  </span>
                ))}
                <em>{identity.textLength ? `已解析 ${identity.textLength} 字` : '已读取文件'}</em>
              </div>
            ) : null}

            {state === 'matched' ? (
              <div className="resume-match-list">
                {matches.map((item) => {
                  const note = recentNote(item);
                  return (
                    <article className="resume-match-card" key={item.id}>
                      <div className="resume-match-head">
                        <div>
                          <strong>{candidateName(item)}</strong>
                          <span>{[candidateCompany(item), candidateTitle(item)].filter(Boolean).join(' / ') || '公司职位未记录'}</span>
                        </div>
                        <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash(candidateDetail(item.id))}>
                          打开在库人才
                        </Button>
                      </div>
                      <div className="resume-match-meta">
                        <span>
                          <Clock3 size={14} />
                          更新时间 {dateOnly(item.lastUpdateDate || item.lastContactDate || item.dateAdded)}
                        </span>
                        <span>顾问 {consultant(item)}</span>
                        <span>备注时间 {dateOnly(note.date)}</span>
                      </div>
                      <p>{note.text}</p>
                      {note.consultant ? <small>备注顾问：{note.consultant}</small> : null}
                    </article>
                  );
                })}
              </div>
            ) : null}

            {state === 'clear' ? (
              <div className="resume-clear-panel">
                <strong>未发现重复，正在跳转</strong>
                <span>插件没有通过简历里的姓名、手机、邮箱查到明显在库记录，将打开谷露原页面继续导入。</span>
                <Button type="primary" icon={<ExternalLink size={16} />} onClick={openOriginalImport}>
                  立即打开
                </Button>
              </div>
            ) : null}

            {state === 'error' || state === 'matched' ? (
              <div className="resume-import-actions">
                <Button icon={<Upload size={16} />} onClick={reset}>
                  换一份简历
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="modal-footer">
          <Button icon={<X size={16} />} onClick={onClose}>
            关闭
          </Button>
          <Button type="primary" icon={<ExternalLink size={16} />} onClick={openOriginalImport}>
            去谷露导入
          </Button>
        </div>
      </section>
    </div>
  );
}
