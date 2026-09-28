import type { ReactNode } from 'react';

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="stat-label">{label}</p>
      <p className="stat-value mt-1">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const CONFIDENCE_STYLES = {
  high: 'bg-emerald-500/15 text-emerald-300',
  medium: 'bg-amber-500/15 text-amber-300',
  exploratory: 'bg-slate-500/15 text-slate-400',
} as const;

export function ConfidenceBadge({ confidence }: { confidence: keyof typeof CONFIDENCE_STYLES }) {
  const label = confidence === 'high' ? 'Đủ tin cậy' : confidence === 'medium' ? 'Cần thêm data' : 'Thử nghiệm';
  return <span className={`chip ${CONFIDENCE_STYLES[confidence]}`}>{label}</span>;
}
