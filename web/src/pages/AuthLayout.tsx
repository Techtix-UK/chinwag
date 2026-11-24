import { ProductLockup } from '@/components/Brand';
import type { ReactNode } from 'react';

export function AuthLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className={wide ? 'w-full max-w-2xl' : 'w-full max-w-sm'}>
        <div className="mb-6">
          <ProductLockup size="lg" byline />
        </div>
        {children}
      </div>
      <p className="mt-8 max-w-md text-center text-[11px] text-muted">
        Chinwag is an independent open-source project by Techtix. It is not affiliated with, endorsed by or an official product of WhatsApp or Meta.
      </p>
    </div>
  );
}
