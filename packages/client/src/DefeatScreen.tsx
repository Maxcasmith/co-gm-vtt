import { useEffect } from 'react';
import { Button } from './components/Button/Button.tsx';
import './app.css';

interface Props { onDismiss: () => void }

export default function DefeatScreen({ onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 12000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="defeat-overlay" onClick={onDismiss}>
      <div className="defeat-card" onClick={e => e.stopPropagation()}>
        <h1 className="defeat-title">Defeated</h1>
        <p className="defeat-subtitle">The party has fallen.</p>
        <p className="defeat-flavour">Your wounds overwhelm you. Darkness takes hold.</p>
        <Button variant="ghost" className="defeat-dismiss" onClick={onDismiss}>Continue</Button>
      </div>
    </div>
  );
}
