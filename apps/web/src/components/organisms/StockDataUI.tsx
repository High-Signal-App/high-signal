import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@saas-maker/ui/components/card';
import { StockSelect } from './StockSelect';

export { StockSelect };

export function StockPanel({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="my-6 min-w-0 gap-5 rounded-md border-border shadow-none">
      <CardHeader>
        <p className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
        {title ? (
          <CardTitle role="heading" aria-level={2} className="text-xl font-medium tracking-tight">
            {title}
          </CardTitle>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function StockStats({ items }: { items: { label: string; value: string; sub: string }[] }) {
  return (
    <div
      className={`my-6 grid grid-cols-2 gap-3 ${items.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}
    >
      {items.map((item) => (
        <Card key={item.label} className="min-w-0 gap-3 rounded-md py-5 shadow-none">
          <CardHeader className="px-5">
            <p className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
              {item.label}
            </p>
          </CardHeader>
          <CardContent className="px-5">
            <div className="break-words font-mono text-xl tabular-nums sm:text-2xl">
              {item.value}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
