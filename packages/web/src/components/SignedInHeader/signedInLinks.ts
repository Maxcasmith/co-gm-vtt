import type { PageHeaderLink } from '../PageHeader/PageHeader';
import { CLIENT_URL } from '../../createCampaignHandoff';

export const SIGNED_IN_LINKS: PageHeaderLink[] = [
  { label: 'Overview', href: '/profile' },
  { label: 'Play', href: CLIENT_URL },
  { label: 'My Games', href: '/profile/my-games' },
  { label: 'Settings', href: '/profile/settings' },
];
