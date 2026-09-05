import AdminPageShell from './AdminPageShell.tsx';
import BestiaryTab from './BestiaryTab.tsx';

interface Props {
  password: string;
  onHome: () => void;
}

export default function AdminBestiaryPage({ password, onHome }: Props) {
  return (
    <AdminPageShell title="Bestiary" onHome={onHome}>
      <BestiaryTab password={password} />
    </AdminPageShell>
  );
}
