// 项目图谱 · 联网版数据层（预留，当前未接入 UI）。
// 调用 enhance server 的 /projects 接口（server/gllue-enhance-api），实现全员共享的项目库。
// 2026-07-01 决定：每个人先各自在本地（localStorage，见 projectsApi.ts）维护自己的项目图谱，
// 这个文件保留完整的联网 CRUD 实现，等以后要做"多人共享 / 云同步"时直接换掉 projectsApi.ts 的实现
// 或者加一个"同步到团队"按钮调这里的函数即可，不用重新写一遍。
import { getEnhanceBaseUrl } from './enhanceApi';
import type { TeamProject, TeamProjectInput } from '../types/gllue';

const TIMEOUT_MS = 4000;

async function requestJson<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; data: T | null; error?: string }> {
  const baseUrl = await getEnhanceBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, data: null, error: body?.error || `请求失败（${response.status}）` };
    }
    return { ok: true, data: body as T };
  } catch (error) {
    return { ok: false, data: null, error: error instanceof Error ? error.message : '网络错误' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listProjectsRemote(): Promise<{ ok: boolean; projects: TeamProject[]; error?: string }> {
  const result = await requestJson<{ ok: boolean; projects: TeamProject[] }>('/projects');
  if (!result.ok || !result.data) return { ok: false, projects: [], error: result.error || '加载失败' };
  return { ok: true, projects: result.data.projects || [] };
}

export async function createProjectRemote(input: TeamProjectInput): Promise<{ ok: boolean; project: TeamProject | null; error?: string }> {
  const result = await requestJson<{ ok: boolean; project: TeamProject }>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!result.ok || !result.data) return { ok: false, project: null, error: result.error || '新增失败' };
  return { ok: true, project: result.data.project };
}

export async function updateProjectRemote(id: number, patch: Partial<TeamProjectInput>): Promise<{ ok: boolean; project: TeamProject | null; error?: string }> {
  const result = await requestJson<{ ok: boolean; project: TeamProject }>(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!result.ok || !result.data) return { ok: false, project: null, error: result.error || '更新失败' };
  return { ok: true, project: result.data.project };
}

export async function deleteProjectRemote(id: number): Promise<{ ok: boolean; error?: string }> {
  const result = await requestJson<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' });
  if (!result.ok) return { ok: false, error: result.error || '删除失败' };
  return { ok: true };
}
