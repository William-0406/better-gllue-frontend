import type { Candidate, CandidateMatchResult, MaimaiProfile } from '../types/gllue';
import type { ResumeIdentity } from './resumeParser';
import { ENHANCE_BASE_URL } from '../config';

const DEFAULT_BASE_URL = ENHANCE_BASE_URL;
const BASE_URL_KEY = 'gllueEnhanceBaseUrl';
const TIMEOUT_MS = 2500;

export type EnhanceStatus = {
  ok: boolean;
  baseUrl: string;
  version?: string;
  extensionLatestVersion?: string;
  extensionDownloadUrl?: string;
  extensionHomeUrl?: string;
  candidates?: number;
  updatedAt?: string | null;
  extensionAvailable?: boolean;
  features?: Record<string, boolean>;
};

type CandidateSummary = {
  id: number;
  name?: string;
  chineseName?: string;
  englishName?: string;
  company?: string;
  title?: string;
  experiences?: Array<{ company?: string; title?: string }>;
  phoneHashes?: string[];
  emailHashes?: string[];
  lastUpdateDate?: string;
  recentNoteDate?: string;
  recentNoteText?: string;
  consultant?: string;
};

type ResumeMatchResponse = {
  status?: 'matched' | 'not_found' | 'unknown';
  candidates?: CandidateMatchResult['candidates'];
};

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return textValue(objectValue.name ?? objectValue.__name__ ?? objectValue.value ?? objectValue.chineseName ?? objectValue.englishName);
  }
  return '';
}

function normalizePhone(value: unknown) {
  return String(value || '').replace(/[^\d]/g, '').replace(/^86/, '');
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

// 纯 JS SHA-256 兜底：谷露页面是 HTTP（非安全上下文），crypto.subtle 为 undefined，
// 直接用会抛错导致整个查重失败。无 subtle 时改用此实现，保证哈希在 HTTP 下也能算。
function sha256Hex(ascii: string): string {
  const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;
  let hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;
  const isComposite: Record<number, number> = {};
  for (let candidate = 2; primeCounter < 64; candidate += 1) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter += 1;
    }
  }
  let padded = `${ascii}\x80`;
  while (padded.length % 64 - 56) padded += '\x00';
  for (let i = 0; i < padded.length; i += 1) {
    const j = padded.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (let i = 0; i < 64; i += 1) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = i < 16 ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i += 1) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i += 1) {
    for (let j = 3; j + 1; j -= 1) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

function utf8Binary(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

async function sha256(value: string) {
  const subtle = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto.subtle : undefined;
  if (subtle) {
    const bytes = new TextEncoder().encode(value);
    const digest = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(utf8Binary(value));
}

async function hashValues(values: string[]) {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return Promise.all(unique.map(sha256));
}

async function getBaseUrl() {
  const maybeChrome = globalThis as typeof globalThis & { chrome?: { storage?: { local?: { get?: (key: string) => Promise<Record<string, unknown>> } } } };
  try {
    const value = await maybeChrome.chrome?.storage?.local?.get?.(BASE_URL_KEY);
    if (typeof value?.[BASE_URL_KEY] === 'string' && value[BASE_URL_KEY]) return String(value[BASE_URL_KEY]).replace(/\/+$/, '');
  } catch {
    // Use local/default config if extension storage is unavailable.
  }
  try {
    const stored = localStorage.getItem(BASE_URL_KEY);
    if (stored) return stored.replace(/\/+$/, '');
  } catch {
    // Service workers do not have localStorage.
  }
  return DEFAULT_BASE_URL;
}

export async function getEnhanceBaseUrl() {
  return getBaseUrl();
}

// OCR 比普通查重慢，单独用更长的超时；失败返回空串，由调用方决定提示。
const OCR_TIMEOUT_MS = 30000;

export async function ocrImagesWithEnhance(images: string[]): Promise<string> {
  if (!images.length) return '';
  const baseUrl = await getBaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/ocr/image`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images }),
    });
    if (!response.ok) return '';
    const data = (await response.json()) as { ok?: boolean; text?: string };
    return data?.ok ? String(data.text || '') : '';
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T | null> {
  const baseUrl = await getBaseUrl();
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
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function candidateName(item: Partial<Candidate>) {
  return item.chineseName || item.englishName || item.__name__ || `人才 #${item.id}`;
}

function candidateCompany(item: Partial<Candidate>) {
  return textValue(item.company) || textValue(item.candidateexperience_set?.[0]?.client);
}

function candidateTitle(item: Partial<Candidate>) {
  return item.title || item.candidateexperience_set?.[0]?.title;
}

function candidateExperiences(item: Partial<Candidate>) {
  const experiences = [
    { company: candidateCompany(item), title: candidateTitle(item) },
    ...(item.candidateexperience_set || []).map((experience) => ({
      company: textValue(experience.client),
      title: experience.title,
    })),
  ];
  const seen = new Set<string>();
  return experiences.filter((experience) => {
    const company = textValue(experience.company);
    const title = textValue(experience.title);
    const key = `${company}|${title}`.toLowerCase();
    if ((!company && !title) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const objectValue = value as Record<string, unknown>;
  return firstText(objectValue.content) || firstText(objectValue.note) || firstText(objectValue.all_content);
}

function recentNote(item: Partial<Candidate>) {
  const entries = Array.isArray(item.note_set)
    ? item.note_set
    : item.note_set && typeof item.note_set === 'object'
      ? Object.values(item.note_set)
      : [];
  const notes = entries
    .map((entry) => ({
      text: firstText(entry),
      date: entry.lastUpdateDate || entry.dateAdded,
      consultant: textValue(entry.user) || textValue(entry.addedBy),
    }))
    .filter((entry) => entry.text);
  notes.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return notes[0] || {
    text: firstText(item.note),
    date: item.noteDate || item.lastContactDate || item.lastUpdateDate || item.dateAdded,
    consultant: '',
  };
}

async function summarizeCandidate(item: Partial<Candidate>): Promise<CandidateSummary | null> {
  if (!item.id) return null;
  const record = item as Partial<Candidate> & { mobile1?: string; mobile2?: string; phone?: string; phone1?: string; phone2?: string; tel?: string };
  const emailRecord = item as Partial<Candidate> & { email1?: string; email2?: string; email3?: string };
  const note = recentNote(item);
  return {
    id: item.id,
    name: candidateName(item),
    chineseName: item.chineseName,
    englishName: item.englishName,
    company: candidateCompany(item),
    title: candidateTitle(item),
    experiences: candidateExperiences(item),
    phoneHashes: await hashValues([record.mobile, record.mobile1, record.mobile2, record.phone, record.phone1, record.phone2, record.tel].map(normalizePhone).filter(Boolean)),
    emailHashes: await hashValues([emailRecord.email, emailRecord.email1, emailRecord.email2, emailRecord.email3].map(normalizeEmail).filter(Boolean)),
    lastUpdateDate: item.lastUpdateDate || item.lastContactDate || item.dateAdded,
    recentNoteDate: note.date || undefined,
    recentNoteText: note.text || undefined,
    consultant: note.consultant || textValue(item.lastUpdateBy) || textValue(item.owner) || textValue(item.addedBy),
  };
}

function remoteCandidateToCandidate(item: CandidateMatchResult['candidates'][number]): Candidate {
  return {
    id: item.id,
    chineseName: item.name,
    __name__: item.name,
    company: item.company ? { name: item.company } : undefined,
    title: item.title,
    lastUpdateDate: item.lastUpdateDate,
    noteDate: item.recentNoteDate,
    note: item.recentNoteText,
    lastUpdateBy: item.consultant ? { chineseName: item.consultant } : undefined,
  };
}

export async function upsertCandidateSummaries(candidates: Array<Partial<Candidate>>) {
  const summaries = (await Promise.all(candidates.map(summarizeCandidate))).filter(Boolean);
  if (!summaries.length) return false;
  const result = await requestJson<{ ok?: boolean }>('/index/candidates/upsert', {
    method: 'POST',
    body: JSON.stringify({ candidates: summaries }),
  });
  return Boolean(result?.ok);
}

export async function getEnhanceStatus(): Promise<EnhanceStatus> {
  const baseUrl = await getBaseUrl();
  const [health, config] = await Promise.all([
    requestJson<Partial<EnhanceStatus>>('/health'),
    requestJson<Partial<EnhanceStatus>>('/config'),
  ]);
  return {
    ok: Boolean(health?.ok || config?.ok),
    baseUrl,
    ...config,
    ...health,
    extensionDownloadUrl: config?.extensionDownloadUrl,
    extensionHomeUrl: config?.extensionHomeUrl,
  };
}

export async function matchMaimaiWithEnhance(profile: MaimaiProfile): Promise<CandidateMatchResult | null> {
  const result = await requestJson<CandidateMatchResult>('/match/maimai', {
    method: 'POST',
    body: JSON.stringify({ profile }),
  });
  if (result?.status === 'matched' && result.candidates?.length) return result;
  return null;
}

export async function matchResumeWithEnhance(identity: ResumeIdentity): Promise<Candidate[] | null> {
  const phoneHashes = await hashValues(identity.phones.map(normalizePhone).filter(Boolean));
  const emailHashes = await hashValues(identity.emails.map(normalizeEmail).filter(Boolean));
  const result = await requestJson<ResumeMatchResponse>('/match/resume', {
    method: 'POST',
    body: JSON.stringify({
      identity: {
        name: identity.name,
        nameFromContent: identity.nameFromContent,
        nameFromFilename: identity.nameFromFilename,
        phoneHashes,
        emailHashes,
      },
    }),
  });
  if (result?.status === 'matched' && result.candidates?.length) {
    return result.candidates.map(remoteCandidateToCandidate);
  }
  return null;
}
