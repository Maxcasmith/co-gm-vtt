import { iconSlug } from 'shared';
import emptyFrameIcon from './assets/icons/Icon-Frame-Blue.jpg';

const API = `http://${window.location.hostname}:3001`;

// Every icon in the app resolves through this one convention: an explicit iconPath (a
// hand-authored bundled asset) always wins when present; otherwise it's storage/icons/<iconSlug
// (name)>/icon.jpg — whatever the admin "Create Icons" pipeline last generated for that name (see
// dungeon/icons.ts). A name with no generated icon yet just 404s and falls back to the empty frame.
export function iconSrcFor(name: string, iconPath?: string): string {
  return iconPath || `${API}/api/icons/${iconSlug(name)}/icon.jpg`;
}

interface Props {
  name: string;
  iconPath?: string;
  className?: string;
  alt?: string;
  title?: string;
}

export default function ItemIcon({ name, iconPath, className, alt = '', title }: Props) {
  return (
    <img
      src={iconSrcFor(name, iconPath)}
      alt={alt}
      title={title}
      className={className}
      onError={e => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = emptyFrameIcon;
      }}
    />
  );
}
