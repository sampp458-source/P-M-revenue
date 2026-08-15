import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronsUpDown,
} from "lucide-react";
import type { AppModule } from "./moduleState";
import { workspaceOptions as options } from "./workspaceNavigation";

export function AppSwitcher({
  module,
  onSwitch,
}: {
  module: AppModule;
  onSwitch: (module: AppModule) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const currentOption = options.find((option) => option.id === module)!;
  const CurrentIcon = currentOption.icon;

  useEffect(() => {
    if (!open) return;
    const currentIndex = options.findIndex((option) => option.id === module);
    requestAnimationFrame(() => itemRefs.current[currentIndex]?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [module, open]);

  const selectModule = (target: AppModule) => {
    setOpen(false);
    if (target !== module) onSwitch(target);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = itemRefs.current.findIndex(
      (item) => item === document.activeElement,
    );
    if ((event.key === "Enter" || event.key === " ") && currentIndex >= 0) {
      event.preventDefault();
      itemRefs.current[currentIndex]?.click();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "ArrowDown")
      nextIndex = (Math.max(currentIndex, -1) + 1) % options.length;
    else
      nextIndex = (currentIndex <= 0 ? options.length : currentIndex) - 1;
    itemRefs.current[nextIndex]?.focus();
  };

  return (
    <div ref={rootRef} className="relative z-50">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="pm-module-switcher-menu"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          setOpen(true);
        }}
        className="flex h-9 w-full items-center gap-2.5 rounded-[11px] border border-white/[0.08] bg-white/[0.055] px-3 text-left text-white outline-none transition hover:border-white/[0.15] hover:bg-white/[0.085] focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <CurrentIcon
          aria-hidden="true"
          className="shrink-0 text-blue-100/65"
          size={16}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium leading-none text-blue-100/45">
            P&amp;M OS
          </span>
          <span className="mt-1 block truncate text-xs font-semibold leading-none">
            {currentOption.title}
          </span>
        </span>
        <ChevronsUpDown
          aria-hidden="true"
          className="shrink-0 text-blue-100/45"
          size={15}
        />
      </button>
      {open && (
        <div
          id="pm-module-switcher-menu"
          role="menu"
          aria-label="P&M OS 모듈"
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-slate-200/15 bg-[#102942] p-1.5 shadow-[0_18px_40px_rgba(5,20,35,0.32)]"
        >
          {options.map((option, index) => {
            const Icon = option.icon;
            const selected = option.id === module;
            return (
              <button
                key={option.id}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => selectModule(option.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-white/65 ${
                  selected
                    ? "bg-white/[0.095] text-white"
                    : "text-blue-50/72 hover:bg-white/[0.055] hover:text-white"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className="shrink-0"
                  size={17}
                  strokeWidth={selected ? 2.15 : 1.8}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">
                    {option.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-blue-100/45">
                    {option.switcherDescription}
                  </span>
                </span>
                {selected && (
                  <Check
                    aria-hidden="true"
                    className="shrink-0 text-[#9bc9e7]"
                    size={16}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
