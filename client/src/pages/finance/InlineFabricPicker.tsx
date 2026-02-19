import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pencil, Check, X, Loader2 } from 'lucide-react';
import { getFabricColoursFlat, type FabricColourFlatRow } from '../../server/functions/materials';
import { updateInvoiceLines } from '../../server/functions/finance';

interface InlineFabricPickerProps {
  lineId: string;
  invoiceId: string;
  currentFabricColour: {
    id: string;
    colourName: string;
    code: string | null;
    fabric: { id: string; name: string };
  } | null;
}

export default function InlineFabricPicker({
  lineId,
  invoiceId,
  currentFabricColour,
}: InlineFabricPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const getFlatFn = useServerFn(getFabricColoursFlat);
  const updateLinesFn = useServerFn(updateInvoiceLines);

  // Fetch all active fabric colours (cached for 5 min, only when popover open)
  const { data: coloursResponse, isLoading: coloursLoading } = useQuery({
    queryKey: ['materials', 'fabricColoursFlat', 'picker'],
    queryFn: () => getFlatFn({ data: { activeOnly: true } }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const allColours = coloursResponse?.items ?? [];

  // Client-side filter by search text
  const filtered = useMemo(() => {
    if (!search.trim()) return allColours;
    const lower = search.toLowerCase();
    return allColours.filter(
      (c: FabricColourFlatRow) =>
        c.colourName.toLowerCase().includes(lower) ||
        c.fabricName.toLowerCase().includes(lower) ||
        (c.code && c.code.toLowerCase().includes(lower)),
    );
  }, [allColours, search]);

  const mutation = useMutation({
    mutationFn: (fabricColourId: string | null) =>
      updateLinesFn({
        data: {
          invoiceId,
          lines: [
            {
              id: lineId,
              ...(fabricColourId
                ? { fabricColourId, matchType: 'manual_matched' as const }
                : { fabricColourId: null, matchType: null }),
            },
          ],
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finance', 'invoice', invoiceId] });
      setOpen(false);
    },
  });

  const handleSelect = (colour: FabricColourFlatRow) => {
    // If already selected, do nothing
    if (currentFabricColour?.id === colour.id) {
      setOpen(false);
      return;
    }
    mutation.mutate(colour.id);
  };

  const handleClear = () => {
    mutation.mutate(null);
  };

  return (
    <Popover open={open} onOpenChange={(o: boolean) => { setOpen(o); if (!o) setSearch(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-1 text-left text-xs w-full min-w-0 cursor-pointer"
        >
          {currentFabricColour ? (
            <>
              <span className="truncate">
                {currentFabricColour.colourName}
                {currentFabricColour.code && (
                  <span className="ml-1 text-muted-foreground">({currentFabricColour.code})</span>
                )}
              </span>
              <Pencil
                size={12}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </>
          ) : (
            <>
              <span className="text-muted-foreground truncate">Not matched</span>
              <Pencil
                size={12}
                className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
        {/* Search input */}
        <div className="border-b px-3 py-2">
          <input
            type="text"
            placeholder="Search colours..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-muted/50 rounded px-2 py-1 text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        {/* Options list */}
        <div className="max-h-[240px] overflow-y-auto">
          {coloursLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              No colours found
            </div>
          ) : (
            filtered.map((colour: FabricColourFlatRow) => {
              const isSelected = currentFabricColour?.id === colour.id;
              return (
                <button
                  key={colour.id}
                  type="button"
                  onClick={() => handleSelect(colour)}
                  disabled={mutation.isPending}
                  className="flex items-start gap-2 w-full px-3 py-1.5 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <div className="w-4 shrink-0 pt-0.5">
                    {isSelected && <Check size={14} className="text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium truncate">{colour.colourName}</span>
                      {colour.code && (
                        <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground leading-none">
                          {colour.code}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {colour.fabricName}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Clear selection */}
        {currentFabricColour && (
          <div className="border-t px-3 py-1.5">
            <button
              type="button"
              onClick={handleClear}
              disabled={mutation.isPending}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <X size={12} />
              Clear selection
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
