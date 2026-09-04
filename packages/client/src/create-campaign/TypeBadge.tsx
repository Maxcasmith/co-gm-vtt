import Badge from './Badge.tsx';

interface Props {
  sourceType?: string;
}

function typeLabel(sourceType?: string): string {
  switch (sourceType) {
    case 'dungeon-crawl': return 'Dungeon';
    case 'campaign': return 'Campaign';
    case 'module': return 'Module';
    case 'one-shot': return 'One-Shot';
    default: return '';
  }
}

export default function TypeBadge({ sourceType }: Props) {
  const label = typeLabel(sourceType);
  if (!label) return null;
  return <Badge>{label}</Badge>;
}
