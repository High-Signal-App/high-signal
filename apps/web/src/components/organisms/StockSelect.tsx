'use client';

import { useId, useState } from 'react';
import { Label } from '@saas-maker/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@saas-maker/ui/components/select';

export function StockSelect({
  name,
  label,
  value,
  options,
  allValue = '',
  allLabel = 'All',
}: {
  name: string;
  label: string;
  value?: string;
  allValue?: string;
  allLabel?: string;
  options: (string | { value: string; label: string })[];
}) {
  const id = useId();
  const [selected, setSelected] = useState(value ?? '');
  return (
    <div className="grid min-w-40 gap-2">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select
        name={name}
        value={selected}
        onValueChange={(next) => setSelected(next === '__all' ? allValue : next)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={allValue || '__all'}>{allLabel}</SelectItem>
          {options.map((option) => {
            const item = typeof option === 'string' ? { value: option, label: option } : option;
            return (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
