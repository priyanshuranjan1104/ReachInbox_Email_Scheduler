'use client';

// ──────────────────────────────────────────────────────────────────────────────
// Spinner — reusable loading indicator
// ──────────────────────────────────────────────────────────────────────────────

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size];
  return (
    <div
      className={`${sizeClass} animate-spin rounded-full border-2 border-slate-600 border-t-violet-400`}
      role="status"
      aria-label="Loading..."
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// EmptyState — shown when a list has no items
// ──────────────────────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="text-slate-500 text-5xl">{icon}</div>
      <p className="text-slate-300 font-semibold text-lg">{title}</p>
      <p className="text-slate-500 text-sm max-w-xs">{description}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// ErrorMessage — shown when an API call fails
// ──────────────────────────────────────────────────────────────────────────────

export function ErrorMessage({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="text-red-400 text-4xl">⚠️</div>
      <p className="text-red-400 font-semibold">Something went wrong</p>
      <p className="text-slate-500 text-sm">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// StatusBadge — colourful badge for job/email statuses
// ──────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  PENDING:     'bg-slate-700 text-slate-300',
  RUNNING:     'bg-blue-900/60 text-blue-300',
  COMPLETED:   'bg-emerald-900/60 text-emerald-300',
  CANCELLED:   'bg-slate-700 text-slate-400',
  FAILED:      'bg-red-900/60 text-red-300',
  SCHEDULED:   'bg-slate-700 text-slate-300',
  QUEUED:      'bg-violet-900/60 text-violet-300',
  SENDING:     'bg-blue-900/60 text-blue-300',
  SENT:        'bg-emerald-900/60 text-emerald-300',
  RATE_LIMITED:'bg-amber-900/60 text-amber-300',
  RESCHEDULED: 'bg-amber-900/60 text-amber-300',
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'bg-slate-700 text-slate-300';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Button
// ──────────────────────────────────────────────────────────────────────────────

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
};

export function Button({
  variant = 'primary',
  loading,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary:   'bg-violet-600 hover:bg-violet-500 text-white',
    secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-200',
    danger:    'bg-red-700 hover:bg-red-600 text-white',
    ghost:     'hover:bg-slate-800 text-slate-300',
  };
  return (
    <button
      {...props}
      disabled={disabled ?? loading}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Input — controlled text input
// ──────────────────────────────────────────────────────────────────────────────

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
};

export function Input({ label, error, hint, className = '', id, ...props }: InputProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <input
        id={inputId}
        className={`bg-slate-800 border ${error ? 'border-red-500' : 'border-slate-600'} rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors ${className}`}
        {...props}
      />
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Textarea
// ──────────────────────────────────────────────────────────────────────────────

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
};

export function Textarea({ label, error, className = '', id, ...props }: TextareaProps) {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
        {label}
      </label>
      <textarea
        id={inputId}
        className={`bg-slate-800 border ${error ? 'border-red-500' : 'border-slate-600'} rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors resize-y min-h-[100px] ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
