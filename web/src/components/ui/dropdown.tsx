import * as React from 'react';
import { DropdownMenu as M } from 'radix-ui';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export function DropdownMenuContent({ className, align = 'end', ...p }: React.ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={4} className={cn('z-50 min-w-44 rounded-md border bg-surface p-1 shadow-lg', className)} {...p} />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, destructive, ...p }: React.ComponentProps<typeof M.Item> & { destructive?: boolean }) {
  return <M.Item className={cn('flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50 [&_svg]:size-4', destructive && 'text-danger', className)} {...p} />;
}
export function DropdownMenuLabel({ className, ...p }: React.ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2 py-1.5 text-xs text-muted', className)} {...p} />;
}
export const DropdownMenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
export const DropdownMenuRadioGroup = M.RadioGroup;
export function DropdownMenuRadioItem({ className, children, ...p }: React.ComponentProps<typeof M.RadioItem>) {
  return (
    <M.RadioItem className={cn('flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-surface-2', className)} {...p}>
      <span className="flex size-3.5 items-center justify-center rounded-full border">
        <M.ItemIndicator className="size-1.5 rounded-full bg-primary" />
      </span>
      {children}
    </M.RadioItem>
  );
}
