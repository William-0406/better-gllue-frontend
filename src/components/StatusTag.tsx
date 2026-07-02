interface StatusTagProps {
  children: React.ReactNode;
  tone?: 'mint' | 'sky' | 'sun' | 'rose' | 'soil';
}

export function StatusTag({ children, tone = 'mint' }: StatusTagProps) {
  return <span className={`status-tag status-tag--${tone}`}>{children}</span>;
}
