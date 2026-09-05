import AdminPageShell from './AdminPageShell.tsx';
import PlotHooksTab from './PlotHooksTab.tsx';

interface Props {
  password: string;
  onHome: () => void;
}

export default function AdminPlotHooksPage({ password, onHome }: Props) {
  return (
    <AdminPageShell title="Plot Hooks" onHome={onHome}>
      <PlotHooksTab password={password} />
    </AdminPageShell>
  );
}
