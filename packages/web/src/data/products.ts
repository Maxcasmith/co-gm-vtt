import type { ComponentType } from 'react';
import { CloudIcon, DownloadIcon } from '../components/icons/Icons';

export interface ProductPlan {
  id: 'cloud' | 'desktop';
  icon: ComponentType<{ className?: string }>;
  title: string;
  tagline: string;
  price: string;
  priceSuffix: string;
  features: string[];
  cta: string;
  ctaVariant: 'fill' | 'outline';
}

// Shared by the Products page and the signup journey's product-selection step —
// keep both in sync from one source instead of duplicating copy/pricing.
export const PRODUCTS: ProductPlan[] = [
  {
    id: 'cloud',
    icon: CloudIcon,
    title: 'Web & Cloud',
    tagline: 'Subscription · play anywhere',
    price: '$19',
    priceSuffix: '/month',
    features: [
      'Play instantly in any browser, nothing to install',
      'Campaigns and characters saved to the cloud',
      'Invite your party with a single link',
      'New features and AI models roll out automatically',
    ],
    cta: 'Start Subscription',
    ctaVariant: 'fill',
  },
  {
    id: 'desktop',
    icon: DownloadIcon,
    title: 'Desktop',
    tagline: 'One-time license · own it forever',
    price: '$79',
    priceSuffix: ' once',
    features: [
      'One-time purchase, yours to keep',
      'Play fully offline, no account required',
      'Local-first save files, nothing leaves your machine',
      'Free updates for the life of this major version',
    ],
    cta: 'Buy License',
    ctaVariant: 'outline',
  },
];
