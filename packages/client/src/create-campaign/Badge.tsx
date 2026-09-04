import type { ReactNode } from 'react';

export default function Badge({ children }: { children: ReactNode }) {
  return <span className="create-type-badge">{children}</span>;
}
