import { cn } from '@/lib/utils';

/** Gier mark: prey-lime square, dashed orbit, bird. Matches branding/logo-mark.svg. */
export function LogoMark({ className, title = 'Gier' }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      className={cn('size-8 shrink-0', className)}
    >
      <rect width="512" height="512" rx="128" fill="#C8F169" />
      <circle
        cx="256"
        cy="256"
        r="164"
        fill="none"
        stroke="#16161A"
        strokeWidth="24"
        strokeLinecap="round"
        strokeDasharray="38 50"
      />
      <path
        d="M154 248c38-38 64-38 102 13 38-51 64-51 102-13"
        fill="none"
        stroke="#16161A"
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark className="size-7" title="" />
      <span className="font-display text-xl font-extrabold tracking-tight">Gier</span>
    </span>
  );
}
