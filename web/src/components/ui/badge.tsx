import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badge = cva('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap border', {
  variants: {
    tone: {
      neutral: 'bg-surface-2 text-muted border-transparent',
      success: 'text-success border-current/25 bg-success/10',
      warning: 'text-warning border-current/25 bg-warning/10',
      danger: 'text-danger border-current/25 bg-danger/10',
      info: 'text-info border-current/25 bg-info/10',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
