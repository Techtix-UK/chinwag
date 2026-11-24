import { cn } from '@/lib/utils';

/** Chinwag mark: the Techtix "T" in a speech bubble (branding/chinwag-mark.svg). */
export function ChinwagMark({ className }: { className?: string }) {
  return <img src="/brand/chinwag-mark.svg" alt="" width={512} height={512} className={cn('size-7', className)} />;
}

/** Official Techtix lockup (unaltered logo-pack exports); the theme variant shows the right one for light/dark. */
export function TechtixLogo({ className }: { className?: string }) {
  return (
    <>
      <img src="/brand/techtix-horizontal-primary.png" alt="Techtix" width={600} height={113} className={cn('h-4 w-auto dark:hidden', className)} />
      <img src="/brand/techtix-horizontal-orange-white.png" alt="Techtix" width={600} height={113} className={cn('hidden h-4 w-auto dark:block', className)} />
    </>
  );
}

/** Product lockup: Chinwag mark + wordmark, optional "by Techtix". A custom logo (Settings) replaces the mark. */
export function ProductLockup({ className, customUrl, appName = 'Chinwag', size = 'md', byline = false }: { className?: string; customUrl?: string | null; appName?: string; size?: 'md' | 'lg'; byline?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {customUrl ? <img src={customUrl} alt="" className={size === 'lg' ? 'h-9 w-auto' : 'h-7 w-auto'} /> : <ChinwagMark className={size === 'lg' ? 'size-9' : 'size-7'} />}
      <div className="leading-tight">
        <p className={cn('font-bold tracking-tight', size === 'lg' ? 'text-xl' : 'text-[15px]')}>{appName}</p>
        {byline && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
            by <TechtixLogo className="h-3" />
          </p>
        )}
      </div>
    </div>
  );
}
