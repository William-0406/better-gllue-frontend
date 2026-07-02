import { Button } from 'animal-island-ui';
import { ExternalLink } from 'lucide-react';
import { openGllueHash } from '../utils/gllueLinks';

interface OriginalGllueLinkProps {
  hash: string;
  label?: string;
  children?: React.ReactNode;
  type?: 'primary' | 'default';
}

export function OriginalGllueLink({ hash, label, children, type = 'default' }: OriginalGllueLinkProps) {
  return (
    <Button size="small" type={type} icon={<ExternalLink size={14} />} onClick={() => openGllueHash(hash)}>
      {children || label || '谷露打开'}
    </Button>
  );
}
