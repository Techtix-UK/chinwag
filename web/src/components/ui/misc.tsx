import * as React from 'react';
import { Switch as S, Tabs as T, Tooltip as TT, Checkbox as C, Avatar as A } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn, initials } from '@/lib/utils';

export function Switch({ className, ...p }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root className={cn('peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-border transition-colors data-[state=checked]:bg-primary disabled:opacity-50', className)} {...p}>
      <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
    </S.Root>
  );
}

export function Checkbox({ className, ...p }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root className={cn('flex size-4 shrink-0 items-center justify-center rounded border bg-surface data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', className)} {...p}>
      <C.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}

export const Tabs = T.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('inline-flex h-9 items-center gap-1 rounded-md bg-surface-2 p-1', className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof T.Trigger>) {
  return <T.Trigger className={cn('rounded px-2.5 py-1 text-[13px] font-medium text-muted data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm cursor-pointer', className)} {...p} />;
}
export const TabsContent = T.Content;

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TT.Root delayDuration={300}>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content sideOffset={6} className="z-50 rounded bg-foreground px-2 py-1 text-xs text-background shadow">
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}
export const TooltipProvider = TT.Provider;

export function Avatar({ src, name, className }: { src?: string | null; name?: string | null; className?: string }) {
  return (
    <A.Root className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full bg-accent', className)}>
      {src ? <A.Image src={src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : null}
      <A.Fallback className="flex size-full items-center justify-center text-xs font-semibold text-primary">{initials(name)}</A.Fallback>
    </A.Root>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-surface-2', className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Loading" className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border bg-surface-2 px-1 font-mono text-[11px]">{children}</kbd>;
}
