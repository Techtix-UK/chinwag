import { cn } from '@/lib/utils';

/**
 * Techtix logo lockups from the official logo pack (unaltered PNG exports).
 * Light backgrounds use the primary (orange + carbon) lockup, dark backgrounds the orange + white lockup;
 * both are in the DOM and the theme variant shows the right one, so it follows system or manual theme without JS.
 */
export function TechtixLogo({ className, customUrl }: { className?: string; customUrl?: string | null }) {
  if (customUrl) return <img src={customUrl} alt="Techtix" className={cn('h-7 w-auto', className)} />;
  return (
    <>
      <img src="/brand/techtix-horizontal-primary.png" alt="Techtix" width={600} height={113} className={cn('h-7 w-auto dark:hidden', className)} />
      <img src="/brand/techtix-horizontal-orange-white.png" alt="Techtix" width={600} height={113} className={cn('hidden h-7 w-auto dark:block', className)} />
    </>
  );
}

export function TechtixIcon({ className }: { className?: string }) {
  return <img src="/brand/techtix-icon-orange.png" alt="Techtix" width={493} height={493} className={cn('size-7', className)} />;
}

/** Product lockup: Techtix logo plus the product name, separated by a rule. */
export function ProductLockup({ className, customUrl, size = 'md' }: { className?: string; customUrl?: string | null; size?: 'md' | 'lg' }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <TechtixLogo customUrl={customUrl} className={size === 'lg' ? 'h-8' : 'h-6'} />
      <span aria-hidden className={cn('w-px self-stretch bg-border', size === 'lg' ? 'my-1' : 'my-0.5')} />
      <span className={cn('font-semibold tracking-tight', size === 'lg' ? 'text-base' : 'text-[13px]')}>WhatsApp</span>
    </div>
  );
}
