import * as React from 'react';
import { cn } from '@/lib/utils';

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn('h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50', className)}
      {...props}
    />
  );
}
