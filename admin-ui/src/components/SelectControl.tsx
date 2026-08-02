import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectControlProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  displayValue?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  compact?: boolean;
  bare?: boolean;
}

const firstEnabledIndex = (options: SelectOption[], fromEnd = false) => {
  if (fromEnd) {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index].disabled) return index;
    }
    return -1;
  }
  return options.findIndex((option) => !option.disabled);
};

export default function SelectControl({
  value,
  options,
  onChange,
  id,
  name,
  ariaLabel,
  placeholder,
  displayValue,
  className = '',
  disabled = false,
  required = false,
  compact = false,
  bare = false,
}: SelectControlProps) {
  const reactId = useId();
  const triggerId = id ?? `${reactId}-trigger`;
  const listboxId = `${reactId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef('');
  const typeaheadTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const selectedIndex = useMemo(
    () => options.findIndex((option) => option.value === value),
    [options, value],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const viewportPadding = 12;
    const gap = 7;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(128, (placeAbove ? spaceAbove : spaceBelow) - gap);
    const maxHeight = Math.min(320, availableHeight);
    const desiredWidth = Math.max(rect.width, compact ? 190 : 220);
    const width = Math.min(desiredWidth, window.innerWidth - viewportPadding * 2);
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - width - viewportPadding,
    );

    setMenuStyle({
      left,
      width,
      maxHeight,
      ...(placeAbove
        ? { bottom: window.innerHeight - rect.top + gap, top: 'auto' }
        : { top: rect.bottom + gap, bottom: 'auto' }),
    });
  }, [compact]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener('pointerdown', handleOutsidePointer, true);
    document.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer, true);
      document.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [open, updatePosition]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const activeOption = menuRef.current?.children[activeIndex] as HTMLElement | undefined;
    activeOption?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openMenu = (index = selectedIndex) => {
    if (disabled || options.length === 0) return;
    const fallback = firstEnabledIndex(options);
    setActiveIndex(index >= 0 && !options[index]?.disabled ? index : fallback);
    setOpen(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return;
    let index = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) {
        setActiveIndex(index);
        return;
      }
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    setActiveIndex(index);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTypeahead = (key: string) => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current);
    typeaheadRef.current += key.toLocaleLowerCase();
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = '';
      typeaheadTimerRef.current = null;
    }, 650);

    const query = typeaheadRef.current;
    const start = Math.max(activeIndex, selectedIndex, -1);
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (start + offset) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLocaleLowerCase().startsWith(query)) {
        setActiveIndex(index);
        if (!open) setOpen(true);
        return;
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      handleTypeahead(event.key);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openMenu();
        else moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openMenu(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options, true));
        else moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (!open) openMenu(firstEnabledIndex(options));
        else setActiveIndex(firstEnabledIndex(options));
        break;
      case 'End':
        event.preventDefault();
        if (!open) openMenu(firstEnabledIndex(options, true));
        else setActiveIndex(firstEnabledIndex(options, true));
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open && activeIndex >= 0) choose(activeIndex);
        else openMenu();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const menu = open && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={`select-control-menu ${compact ? 'select-control-menu-compact' : ''}`}
          style={menuStyle}
          role="listbox"
          aria-label={ariaLabel}
          onMouseDown={(event) => event.preventDefault()}
        >
          {options.map((option, index) => (
            <div
              id={`${listboxId}-option-${index}`}
              key={`${option.value}-${index}`}
              className={`select-control-option ${index === activeIndex ? 'is-active' : ''} ${option.value === value ? 'is-selected' : ''}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              onPointerMove={() => !option.disabled && setActiveIndex(index)}
              onClick={(event) => {
                event.stopPropagation();
                choose(index);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check aria-hidden="true" size={17} />}
            </div>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className={`select-control ${compact ? 'select-control-compact' : ''} ${bare ? 'select-control-bare' : ''}`}
    >
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        className={`${bare ? '' : 'input-classic'} select-control-trigger ${className}`.trim()}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`select-control-value ${selectedOption ? '' : 'is-placeholder'}`}>
          {displayValue ?? selectedOption?.label ?? placeholder ?? '—'}
        </span>
        <ChevronDown aria-hidden="true" className="select-control-chevron" size={18} />
      </button>
      {menu}
    </div>
  );
}
