import type { ButtonHTMLAttributes, PropsWithChildren } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'

const styles: Record<Variant, string> = {
  primary:
    'bg-veil-700 text-sand-50 hover:bg-veil-600 shadow-sm border border-veil-800/20',
  secondary:
    'bg-ink-900 text-sand-50 hover:bg-ink-800 shadow-sm border border-ink-950/30',
  ghost: 'bg-transparent text-ink-800 hover:bg-ink-900/5',
  danger: 'bg-red-700 text-white hover:bg-red-600 border border-red-900/20',
  outline:
    'bg-white/60 text-ink-800 hover:bg-white border border-ink-200 backdrop-blur'
}

export function Button({
  className,
  variant = 'primary',
  children,
  ...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none',
        styles[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
