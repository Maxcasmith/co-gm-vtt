import { PageHeader } from '../PageHeader/PageHeader';
import { SIGNED_IN_LINKS } from './signedInLinks';
import { useUserInitials } from '../../useUserInitials';

// Shared header for every page behind login — same nav and the same real-initials avatar,
// so the nav/avatar logic lives in one place instead of being copied per page.
export function SignedInHeader() {
  const initials = useUserInitials();

  return (
    <PageHeader
      links={SIGNED_IN_LINKS}
      actions={
        <span className="signed-in-avatar" aria-label="Account">
          {initials}
        </span>
      }
    />
  );
}
