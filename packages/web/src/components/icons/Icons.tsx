interface IconProps {
  className?: string;
}

export function D20Icon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round">
      <polygon points="12,2 20.7,7 20.7,17 12,22 3.3,17 3.3,7" />
      <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="8" fontFamily="'Cinzel', serif" stroke="none" fill="currentColor">20</text>
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2c.6 3.9 1.7 6.4 3.3 8 1.6 1.6 4.1 2.7 8 3.3-3.9.6-6.4 1.7-8 3.3-1.6 1.6-2.7 4.1-3.3 8-.6-3.9-1.7-6.4-3.3-8C7.1 15 4.6 13.9.7 13.3c3.9-.6 6.4-1.7 8-3.3C10.3 8.4 11.4 5.9 12 2Z" />
    </svg>
  );
}

export function CompassIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M14.8 9.2 10.6 13.4 9.2 14.8 13.4 10.6Z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FlameIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M12 21c4 0 6.5-2.5 6.5-6 0-2.7-1.7-4.3-2.5-6.5-.4 1.3-1 2.2-1.9 2.8.2-2.7-.7-5.5-3.1-7.3.6 2.3-.2 4-1.7 5.6C7.5 11 6 12.6 6 15c0 3.5 2.5 6 6 6Z" />
    </svg>
  );
}

export function DropIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M12 3c3 4.2 6 7.6 6 11.2A6 6 0 0 1 6 14.2C6 10.6 9 7.2 12 3Z" />
    </svg>
  );
}

export function GemIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4.5 9 8 4h8l3.5 5-7.5 11z" strokeLinejoin="round" />
      <path d="M4.5 9h15M8 4l1.5 5L12 20M16 4l-1.5 5L12 20" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
      <path d="m12 3 2.6 5.8 6.4.7-4.8 4.3 1.3 6.2L12 16.9 6.5 20l1.3-6.2-4.8-4.3 6.4-.7Z" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.8-4.8" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  );
}

export function ListIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8M21 20c0-2.8-2-5.1-4.6-5.8" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function KebabIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 4.5v15l13-7.5Z" />
    </svg>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    </svg>
  );
}

export function LayoutIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.2" />
      <path d="M3.5 9.5h17M9 9.5V19.5" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <circle cx="6" cy="12" r="2.3" />
      <circle cx="18" cy="6" r="2.3" />
      <circle cx="18" cy="18" r="2.3" />
      <path d="m8.1 10.8 7.8-3.6M8.1 13.2l7.8 3.6" />
    </svg>
  );
}

export function GearIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2.3M12 18.2v2.3M20.5 12h-2.3M5.8 12H3.5M17.7 6.3l-1.6 1.6M7.9 16.1l-1.6 1.6M17.7 17.7l-1.6-1.6M7.9 7.9 6.3 6.3" />
    </svg>
  );
}

export function CloudIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 18.5a4.2 4.2 0 0 1-.6-8.36 5.2 5.2 0 0 1 9.94-1.7A3.9 3.9 0 0 1 17.5 18.5Z" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3.5v11.5M7.5 11l4.5 4.5L16.5 11" />
      <path d="M4.5 18.5h15" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function PayPalIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8.5 4.5h5.3c2.6 0 4.3 1.5 3.9 3.9-.5 2.9-2.5 4.4-5.4 4.4h-2l-.9 5.7H6.4L8.5 4.5Zm2.2 2 -1 6.3h1.4c1.7 0 2.9-.8 3.2-2.6.3-1.9-.6-2.7-2.3-2.7h-1.3Z" />
      <path d="M11.8 8.6h5.3c2.6 0 4.3 1.5 3.9 3.9-.5 2.9-2.5 4.4-5.4 4.4h-2l-.9 5.7H9.7l2.1-14Z" opacity="0.55" />
    </svg>
  );
}

export function AppleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.4 12.9c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.8-3.5.8-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.2.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.5-1-2.5-3.8Z" />
      <path d="M14.1 6c.6-.7 1-1.7.9-2.7-.9.1-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2Z" />
    </svg>
  );
}

export function GoogleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4c-.2 1.3-1 2.3-2 3v2.5h3.3c1.9-1.8 3-4.4 3-7.4Z" opacity="0.55" />
      <path d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2.1 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3v2.6C4.7 19.8 8.1 22 12 22Z" />
      <path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3a10 10 0 0 0 0 9.2Z" opacity="0.55" />
      <path d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 2.8 14.7 2 12 2 8.1 2 4.7 4.2 3 7.4l3.4 2.6C7.2 7.7 9.4 5.9 12 5.9Z" />
    </svg>
  );
}

export function AmazonIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.5 3.5c-1.8 1.6-4.6 3.4-8.5 3.4S5.3 5.1 3.5 3.5c-.2-.1-.4.1-.3.3 1.5 1.9 4.8 4.7 8.8 4.7s7.3-2.8 8.8-4.7c.1-.2-.1-.4-.3-.3Z" />
      <path d="M6.8 9.5c-1.9 0-3.4 1.4-3.4 3.5 0 2.4 1.7 4 4.2 4 1.2 0 2.1-.4 2.9-1.1l-.6-.9c-.6.5-1.2.8-2 .8-1.3 0-2.2-.8-2.4-2.1h5.3v-.6c0-2.3-1.3-3.6-3-3.6Zm-2.3 2.9c.2-1.1 1-1.7 2-1.7s1.7.6 1.8 1.7H4.5Z" />
      <path d="M14.8 9.5c-1.9 0-3.4 1.5-3.4 3.7 0 2.3 1.5 3.8 3.6 3.8 1 0 1.9-.3 2.6-.9l-.6-.9c-.5.4-1.1.6-1.8.6-1.2 0-2.1-.8-2.3-2.1h5v-.7c0-2.1-1.3-3.5-3.1-3.5Zm-1.9 2.8c.2-1 .9-1.6 1.8-1.6.9 0 1.5.6 1.6 1.6h-3.4Z" />
      <path d="M20.9 12.7c-.4-.5-1.3-.7-2.2-.7v-.4c0-.6-.2-1-1-1-.6 0-1.1.4-1.2 1.1l1.2.1c0-.2.1-.4.4-.4.4 0 .5.3.5.7v.2c-1.6 0-2.9.5-2.9 1.9 0 1 .7 1.5 1.6 1.5.8 0 1.2-.3 1.6-.7.1.3.2.5.3.7l1.1-.6c-.2-.3-.3-.6-.3-1.1v-1.3Zm-1.3 1.5c-.2.3-.5.5-.9.5-.4 0-.6-.2-.6-.6 0-.6.7-.8 1.5-.8v.9Z" />
    </svg>
  );
}
