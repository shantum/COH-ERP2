import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { searchCounterparties } from '../../server/functions/finance';
import { Input } from '../ui/input';
import { Building2, X } from 'lucide-react';

export interface PartyOption {
  id: string;
  name: string;
}

interface PartySearchProps {
  value: PartyOption | null;
  onChange: (party: PartyOption | null) => void;
  placeholder?: string;
  compact?: boolean;
}

export function PartySearch({ value, onChange, placeholder = 'Search party...', compact }: PartySearchProps) {
  const searchFn = useServerFn(searchCounterparties);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const { data: results } = useQuery({
    queryKey: ['finance', 'party-search', query],
    queryFn: () => searchFn({ data: { query, type: 'party' } }),
    enabled: query.length >= 2,
  });
  const parties = results?.success ? results.results : [];

  if (value) {
    return compact ? (
      <div className="flex items-center gap-2">
        <span className="text-sm">{value.name}</span>
        <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={() => onChange(null)}>
          <X className="h-3 w-3" />
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2 mt-1 p-2 border rounded-md bg-muted/30">
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1">{value.name}</span>
        <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => onChange(null)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder={placeholder}
        className={compact ? 'h-8 text-xs' : 'mt-1'}
        onFocus={() => { if (query.length >= 2) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && query.length >= 2 && parties.length > 0 && (
        <div className={`absolute z-20 left-0 right-0 ${compact ? 'top-9 w-full' : 'mt-1'} bg-popover border rounded-md shadow-lg max-h-[180px] overflow-y-auto`}>
          {parties.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`block w-full text-left px-3 ${compact ? 'py-1.5 text-xs' : 'py-2 text-sm'} hover:bg-muted/50`}
              onMouseDown={() => { onChange({ id: p.id, name: p.name }); setOpen(false); setQuery(''); }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
