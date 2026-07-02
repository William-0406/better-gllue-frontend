export function textValue(value: unknown, fallback = '未填写') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return textValue(obj.name ?? obj.__name__ ?? obj.value ?? obj.chineseName ?? obj.englishName, fallback);
  }
  return fallback;
}

export function dateOnly(value: unknown) {
  const text = textValue(value, '');
  return text ? text.slice(0, 16) : '未记录';
}

export function includesKeyword(parts: unknown[], keyword: string) {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return parts.some((part) => textValue(part, '').toLowerCase().includes(q));
}
