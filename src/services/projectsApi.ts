// 项目图谱 · 本地版数据层（默认使用）。
// 每个人的项目数据存在自己浏览器的 localStorage 里（跟 recommendationRewards.ts 的存储方式一致），
// 不发任何网络请求，别人看不到、也不会互相覆盖。
// 想要"多人共享 / 云同步"时，参考 projectsRemoteApi.ts —— 那边已经写好一份完整的联网实现
// （调用 enhance server 的 /projects 接口），接口签名跟这个文件完全一样，届时可以直接替换。
import type { TeamProject, TeamProjectInput } from '../types/gllue';

const STORAGE_KEY = 'gllue-shell-projects-local';

function readAll(): TeamProject[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(projects: TeamProject[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // 隐私模式等 localStorage 不可用的场景下静默失败，不影响页面其它功能。
  }
}

function nextId(projects: TeamProject[]): number {
  return projects.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function toOwnerList(value: string[] | undefined): string[] {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

export async function listProjects(): Promise<{ ok: boolean; projects: TeamProject[]; error?: string }> {
  return { ok: true, projects: readAll() };
}

export async function createProject(input: TeamProjectInput): Promise<{ ok: boolean; project: TeamProject | null; error?: string }> {
  if (!input.company?.trim() && !input.title?.trim()) {
    return { ok: false, project: null, error: '公司和职位至少填一个' };
  }
  const projects = readAll();
  const now = new Date().toISOString();
  const project: TeamProject = {
    id: nextId(projects),
    company: input.company.trim(),
    title: input.title.trim(),
    location: input.location.trim(),
    status: input.status ?? '进行中',
    owners: toOwnerList(input.owners),
    source: 'manual',
    notes: input.notes?.trim() || '',
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...projects, project]);
  return { ok: true, project };
}

export async function updateProject(id: number, patch: Partial<TeamProjectInput>): Promise<{ ok: boolean; project: TeamProject | null; error?: string }> {
  const projects = readAll();
  const index = projects.findIndex((item) => item.id === id);
  if (index === -1) return { ok: false, project: null, error: '项目不存在' };
  const existing = projects[index];
  const updated: TeamProject = {
    ...existing,
    ...(patch.company !== undefined ? { company: patch.company.trim() } : {}),
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.location !== undefined ? { location: patch.location.trim() } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.owners !== undefined ? { owners: toOwnerList(patch.owners) } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  projects[index] = updated;
  writeAll(projects);
  return { ok: true, project: updated };
}

export async function deleteProject(id: number): Promise<{ ok: boolean; error?: string }> {
  const projects = readAll();
  const next = projects.filter((item) => item.id !== id);
  if (next.length === projects.length) return { ok: false, error: '项目不存在' };
  writeAll(next);
  return { ok: true };
}

// 批量新增/清空：主要给"生成测试数据 / 清空全部"这类调试工具用，一次性读写一次 localStorage，
// 不会像循环调 createProject 那样连续读写 N 次。
export async function createManyProjects(inputs: TeamProjectInput[]): Promise<{ ok: boolean; count: number }> {
  const projects = readAll();
  let cursor = nextId(projects);
  const now = new Date().toISOString();
  const created: TeamProject[] = inputs
    .filter((input) => input.company?.trim() || input.title?.trim())
    .map((input) => ({
      id: cursor++,
      company: input.company.trim(),
      title: input.title.trim(),
      location: input.location.trim(),
      status: input.status ?? '进行中',
      owners: toOwnerList(input.owners),
      source: 'manual',
      notes: input.notes?.trim() || '',
      createdAt: now,
      updatedAt: now,
    }));
  writeAll([...projects, ...created]);
  return { ok: true, count: created.length };
}

export async function clearAllProjects(): Promise<{ ok: boolean }> {
  writeAll([]);
  return { ok: true };
}
