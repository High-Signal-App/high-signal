import type { ReactNode } from 'react';

export interface ProductArea {
  href: string;
  title: string;
  kicker: string;
  body: string;
}

export interface StatItem {
  label: string;
  value: string;
  sub: string;
}

export interface NavItem {
  href: string;
  title: string;
  sub: string;
}

export interface MetricItem {
  label: string;
  value: string;
}

export interface FeedItem {
  href: string;
  kicker: string;
  title: string;
  body?: string | null;
}

export function PageShell({
  max = 'max-w-5xl',
  children,
}: {
  max?: 'max-w-4xl' | 'max-w-5xl';
  children: ReactNode;
}) {
  return <main className={`mx-auto ${max} px-5 py-14 sm:px-6 sm:py-16`}>{children}</main>;
}

export function BackLink({ href = '/', children = 'back to high signal' }) {
  return (
    <a
      href={href}
      className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-muted)] hover:text-[var(--color-accent)]"
    >
      {children}
    </a>
  );
}

export function HeroHeader({
  eyebrow,
  title,
  children,
  size = 'lg',
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <header className="border-b border-[var(--color-line)] pb-8">
      <div className="flex items-baseline gap-3 font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
        <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
        <span>{eyebrow}</span>
      </div>
      <h1
        className={`mt-4 font-medium tracking-tight ${size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}
      >
        {title}
      </h1>
      <p className="mt-4 max-w-2xl text-[var(--color-muted)]">{children}</p>
    </header>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className="mt-8 border-b border-[var(--color-line)] pb-8">
      <div className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--color-accent)]">
        {eyebrow}
      </div>
      <h1 className="mt-4 text-3xl font-medium tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-4 max-w-2xl text-[var(--color-muted)]">{children}</p>
    </header>
  );
}

export function ProductAreaGrid({ items }: { items: ProductArea[] }) {
  return (
    <section className="mt-10 grid gap-px border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="group min-h-48 bg-[var(--color-bg)] p-5 transition-colors hover:bg-white/[0.025]"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] group-hover:text-[var(--color-accent)]">
            {item.kicker}
          </div>
          <h2 className="mt-8 text-xl font-medium tracking-tight">{item.title}</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
        </a>
      ))}
    </section>
  );
}

export function StatGrid({ items }: { items: StatItem[] }) {
  const columnClass =
    items.length === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : items.length % 3 === 0
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : 'grid-cols-[repeat(auto-fit,minmax(180px,1fr))]';

  return (
    <section className={`mt-10 grid gap-px ${columnClass}`}>
      {items.map((item) => (
        <div
          key={item.label}
          className="border border-[var(--color-line)] bg-[var(--color-bg)] p-5"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            {item.label}
          </div>
          <div className="mt-5 text-xl font-medium">{item.value}</div>
          <div className="mt-2 text-sm text-[var(--color-muted)]">{item.sub}</div>
        </div>
      ))}
    </section>
  );
}

export function RouteList({ items }: { items: NavItem[] }) {
  return (
    <nav className="mt-12 flex flex-col divide-y divide-[var(--color-line)] border-y border-[var(--color-line)] font-mono text-sm">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="group grid gap-2 py-4 transition-colors hover:bg-white/[0.02] sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-baseline"
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-[var(--color-muted)] group-hover:text-[var(--color-accent)]">
              {item.href}
            </span>
            <span className="text-[var(--color-fg)]">{item.title}</span>
          </span>
          <span className="text-[var(--color-muted)] sm:text-right">{item.sub}</span>
        </a>
      ))}
    </nav>
  );
}

export function Panel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border border-[var(--color-line)] p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        {eyebrow}
      </div>
      {title ? <div className="mt-5 text-2xl font-medium tracking-tight">{title}</div> : null}
      {children}
    </section>
  );
}

export function Field({
  label,
  name,
  defaultValue,
  multiline = false,
}: {
  label: string;
  name: string;
  defaultValue: string;
  multiline?: boolean;
}) {
  const id = name;
  return (
    <label className="mt-5 block text-sm text-[var(--color-muted)]" htmlFor={id}>
      {label}
      {multiline ? (
        <textarea
          id={id}
          name={name}
          defaultValue={defaultValue}
          rows={8}
          className="mt-2 block w-full resize-none border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm leading-6 text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
      ) : (
        <input
          id={id}
          name={name}
          defaultValue={defaultValue}
          className="mt-2 block w-full border border-[var(--color-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
        />
      )}
    </label>
  );
}

export function CommandButton({ children }: { children: ReactNode }) {
  return (
    <button
      className="mt-5 w-full border border-[var(--color-line)] px-4 py-2 font-mono text-xs uppercase tracking-[0.18em] text-[var(--color-fg)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      type="submit"
    >
      {children}
    </button>
  );
}

export function MetricGrid({ items }: { items: MetricItem[] }) {
  return (
    <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-px text-sm">
      {items.map((item) => (
        <div
          key={item.label}
          className="border border-[var(--color-line)] bg-[var(--color-bg)] p-4"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
            {item.label}
          </div>
          <div className="mt-3 text-xl">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function FeedList({
  eyebrow,
  empty,
  items,
}: {
  eyebrow: string;
  empty: string;
  items: FeedItem[];
}) {
  return (
    <section className="mt-10 border-y border-[var(--color-line)]">
      <div className="py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-accent)]">
        {eyebrow}
      </div>
      <div className="divide-y divide-[var(--color-line)]">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="block py-5 hover:text-[var(--color-accent)]"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {item.kicker}
            </div>
            <div className="mt-2 text-lg">{item.title}</div>
            {item.body ? (
              <p className="mt-2 text-sm leading-6 text-[var(--color-muted)]">{item.body}</p>
            ) : null}
          </a>
        ))}
        {items.length === 0 ? (
          <p className="py-5 text-sm text-[var(--color-muted)]">{empty}</p>
        ) : null}
      </div>
    </section>
  );
}
