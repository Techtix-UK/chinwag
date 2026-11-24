import type { ReactNode } from 'react';

export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="leading-tight">
            <p className="text-sm font-semibold">Techtix WhatsApp</p>
            <p className="text-xs text-muted">by Techtix Global</p>
          </div>
        </div>
        {children}
      </div>
      <p className="mt-8 max-w-md text-center text-[11px] text-muted">
        Techtix WhatsApp is an independent product and is not affiliated with, endorsed by or an official product of WhatsApp or Meta.
      </p>
    </div>
  );
}
