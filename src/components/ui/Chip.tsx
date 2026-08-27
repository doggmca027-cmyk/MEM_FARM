import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Small status pill with an optional leading icon. */
export function Chip({ icon, children, className = '' }: Props) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-xl border-2 border-black',
        'px-2 py-1 text-xs font-bold leading-none',
        className,
      ].join(' ')}
    >
      {icon}
      {children}
    </span>
  );
}
