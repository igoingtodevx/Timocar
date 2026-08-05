import { useEffect, useMemo, useRef, useState } from "react";

export interface VariantOption {
  modelId: number;
  displayName: string;
}

interface VariantComboboxProps {
  disabled?: boolean;
  make?: string;
  series?: string;
  selectedModelId: number | null;
  query: string;
  results: VariantOption[];
  onChangeQuery: (value: string) => void;
  onSelect: (option: VariantOption) => void;
  onBlur?: () => void;
}

export default function VariantCombobox({
  disabled,
  make,
  series,
  selectedModelId,
  query,
  results,
  onChangeQuery,
  onSelect,
  onBlur,
}: VariantComboboxProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemId = (index: number) => `pt-variant-option-${index}`;

  const normalizedQuery = query.trim();

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        listRef.current?.contains(target) ||
        inputRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        inputRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!make || !series) return [];
    const deduped = results.filter((item, index, array) => array.findIndex((x) => x.modelId === item.modelId) === index);
    return deduped.slice(0, 25);
  }, [results, make, series]);

  const activeId = activeIndex >= 0 && activeIndex < filtered.length ? itemId(activeIndex) : undefined;

  const emptyState = useMemo(() => {
    if (!make || !series) return null;
    if (filtered.length > 0) return null;
    if (normalizedQuery.length === 0) return null;
    return "Keine passende Variante gefunden.";
  }, [filtered.length, make, normalizedQuery, series]);

  const selectOption = (option: VariantOption) => {
    onSelect(option);
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <label htmlFor="pt-variant-combobox" className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-white/60">
        Variante
      </label>
      <input
        id="pt-variant-combobox"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="pt-variant-listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-haspopup="listbox"
        value={query}
        onChange={(event) => {
          onChangeQuery(event.target.value);
          setOpen(true);
          setActiveIndex(filtered.length > 0 ? 0 : -1);
        }}
        onFocus={() => {
          if (disabled) return;
          setOpen(true);
        }}
        onBlur={() => {
          if (!open) {
            onBlur?.();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActiveIndex(filtered.length > 0 ? 0 : -1);
              return;
            }
            setActiveIndex((current) => {
              const next = filtered.length > 0 ? (current + 1) % filtered.length : -1;
              return next;
            });
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) return;
            setActiveIndex((current) => {
              const next = filtered.length > 0 ? (current - 1 + filtered.length) % filtered.length : -1;
              return next;
            });
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (open && activeIndex >= 0 && activeIndex < filtered.length) {
              selectOption(filtered[activeIndex]!);
              return;
            }
            if (filtered.length > 0) {
              selectOption(filtered[0]!);
              return;
            }
            setOpen(false);
            return;
          }
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
        }}
        disabled={disabled || !series}
        placeholder="z. B. E 400"
        autoComplete="off"
        className="w-full rounded-lg border border-[#222222] bg-[#0D0D0D] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      />
      {open && !disabled && series && (
        <div
          id="pt-variant-listbox"
          ref={listRef}
          role="listbox"
          aria-label="Varianten"
          className="absolute z-50 mt-1 max-h-[280px] w-full overflow-y-auto rounded-lg border border-[#222222] bg-[#0D0D0D]"
        >
          {emptyState ? (
            <div className="px-3 py-3 text-xs text-white/70">{emptyState}</div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = selectedModelId === item.modelId;
              const isActive = index === activeIndex;
              return (
                <div
                  key={item.modelId}
                  id={itemId(index)}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive || undefined}
                  className={`cursor-pointer px-3 py-2.5 text-sm transition-colors ${
                    isSelected ? "text-brand-orange" : "text-white/85"
                  } ${isActive ? "bg-white/10" : "bg-transparent"}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectOption(item);
                  }}
                >
                  {item.displayName}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
