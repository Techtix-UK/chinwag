import * as React from 'react';
import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, wide, ...p }: React.ComponentProps<typeof D.Content> & { wide?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
      <D.Content
        className={cn('fixed left-1/2 top-1/2 z-50 grid max-h-[90dvh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-surface p-5 shadow-xl', wide ? 'max-w-2xl' : 'max-w-md', className)}
        {...p}
      >
        {children}
        <D.Close className="absolute right-3 top-3 rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
export function DialogHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="grid gap-1 pr-6">
      <D.Title className="text-base font-semibold">{title}</D.Title>
      {description ? <D.Description className="text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
    </div>
  );
}
export function DialogFooter({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />;
}
