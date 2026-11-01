"use client"

/**
 * A searchable select with the same API as shadcn's Radix Select
 * (Select / SelectTrigger / SelectValue / SelectContent / SelectItem).
 *
 * Why not Radix Select: on iOS its scroll-up/down arrow buttons mount and
 * unmount while the list is touch-scrolled, and it re-measures its own height
 * as they do, so the list jumps and can paint a blank frame. This version is a
 * plain popover holding a natively scrolling cmdk list: nothing in it is
 * measured or moved while you scroll.
 */

import * as React from "react"
import { cn } from "cn"
import { Command as CommandPrimitive } from "cmdk"
import { Popover as PopoverPrimitive } from "radix-ui"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

/** Lists at least this long get a search box; a 2-4 option list doesn't need one. */
const SEARCH_THRESHOLD = 6

type SelectCtx = {
  value: string | undefined
  open: boolean
  setOpen: (open: boolean) => void
  select: (value: string) => void
  disabled?: boolean
  register: (value: string, node: React.ReactNode, text: string, disabled: boolean) => void
  unregister: (value: string) => void
  items: React.RefObject<Map<string, { node: React.ReactNode; text: string; disabled: boolean }>>
  itemCount: number
  contentId: string
}

const SelectContext = React.createContext<SelectCtx | null>(null)
function useSelect(part: string) {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error(`<${part}> must be inside <Select>`)
  return ctx
}

/** "collect" renders items invisibly so the trigger knows their labels while closed. */
const ItemModeContext = React.createContext<"collect" | "list">("collect")

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children)
  return ""
}

function Select({
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled,
  children,
}: {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  children?: React.ReactNode
}) {
  const [innerValue, setInnerValue] = React.useState(defaultValue)
  const value = valueProp !== undefined ? valueProp : innerValue
  const [innerOpen, setInnerOpen] = React.useState(defaultOpen)
  const open = openProp !== undefined ? openProp : innerOpen
  const contentId = React.useId()

  const items = React.useRef(new Map<string, { node: React.ReactNode; text: string; disabled: boolean }>())
  const [itemCount, setItemCount] = React.useState(0)
  // Bumped only when a label's text, or the set of items, actually changes, so
  // registering from an effect can't loop.
  const [, setVersion] = React.useState(0)

  const register = React.useCallback((v: string, node: React.ReactNode, text: string, dis: boolean) => {
    const prev = items.current.get(v)
    items.current.set(v, { node, text, disabled: dis })
    if (!prev) setItemCount(items.current.size)
    if (!prev || prev.text !== text || prev.disabled !== dis) setVersion((n) => n + 1)
  }, [])
  const unregister = React.useCallback((v: string) => {
    if (items.current.delete(v)) {
      setItemCount(items.current.size)
      setVersion((n) => n + 1)
    }
  }, [])

  const setOpen = React.useCallback(
    (o: boolean) => {
      if (openProp === undefined) setInnerOpen(o)
      onOpenChange?.(o)
    },
    [openProp, onOpenChange]
  )
  const select = React.useCallback(
    (v: string) => {
      if (valueProp === undefined) setInnerValue(v)
      if (v !== value) onValueChange?.(v)
      setOpen(false)
    },
    [valueProp, value, onValueChange, setOpen]
  )

  const ctx: SelectCtx = {
    value, open, setOpen, select, disabled, register, unregister, items, itemCount, contentId,
  }

  return (
    <SelectContext.Provider value={ctx}>
      <PopoverPrimitive.Root open={open && !disabled} onOpenChange={setOpen} modal>
        {children}
      </PopoverPrimitive.Root>
    </SelectContext.Provider>
  )
}

function SelectValue({
  placeholder,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & { placeholder?: React.ReactNode }) {
  const { value, items } = useSelect("SelectValue")
  const item = value !== undefined ? items.current.get(value) : undefined
  return (
    <span data-slot="select-value" className={cn("truncate", className)} {...props}>
      {item ? item.node : placeholder}
    </span>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<"button"> & { size?: "sm" | "default" }) {
  const { value, items, disabled, open, contentId } = useSelect("SelectTrigger")
  const hasValue = value !== undefined && items.current.has(value)
  return (
    <PopoverPrimitive.Trigger asChild>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? contentId : undefined}
        data-slot="select-trigger"
        data-size={size}
        data-placeholder={hasValue ? undefined : ""}
        disabled={disabled}
        className={cn(
          "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:inset-ring-3 focus-visible:inset-ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:inset-ring-3 aria-invalid:inset-ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:inset-ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </button>
    </PopoverPrimitive.Trigger>
  )
}

const prefersTouch = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches

function SelectContent({
  className,
  children,
  align = "start",
  sideOffset = 4,
  collisionPadding = 8,
  // Accepted for compatibility with the old Radix Select API; there is only one layout now.
  position: _position,
  ...props
}: Omit<React.ComponentProps<typeof PopoverPrimitive.Content>, "children"> & {
  children?: React.ReactNode
  position?: "popper" | "item-aligned"
}) {
  const { itemCount, contentId } = useSelect("SelectContent")
  const listRef = React.useRef<HTMLDivElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  return (
    <>
      {/* Always mounted, renders nothing: lets the trigger show the chosen label while closed. */}
      <ItemModeContext.Provider value="collect">{children}</ItemModeContext.Provider>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={contentId}
          data-slot="select-content"
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          onOpenAutoFocus={(e) => {
            // Opening the iOS keyboard would resize the viewport and shove the
            // list around, so on touch screens the search box waits for a tap.
            e.preventDefault()
            const input = rootRef.current?.querySelector<HTMLInputElement>("[cmdk-input]")
            if (input && !prefersTouch()) input.focus({ preventScroll: true })
            else rootRef.current?.focus({ preventScroll: true })
          }}
          className={cn(
            "z-50 flex max-h-[min(20rem,var(--radix-popover-content-available-height,20rem))] w-(--radix-popover-trigger-width) min-w-36 origin-(--radix-popover-content-transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden data-open:animate-in data-open:fade-in-0 data-open:duration-100",
            className
          )}
          {...props}
        >
          <SelectList rootRef={rootRef} listRef={listRef} searchable={itemCount >= SEARCH_THRESHOLD}>
            {children}
          </SelectList>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </>
  )
}

/** Mounted fresh on every open (the popover unmounts its content on close), so search and highlight start clean. */
function SelectList({
  children,
  rootRef,
  listRef,
  searchable,
}: {
  children?: React.ReactNode
  rootRef: React.RefObject<HTMLDivElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  searchable: boolean
}) {
  const { value } = useSelect("SelectContent")
  const [search, setSearch] = React.useState("")
  const [active, setActive] = React.useState(value ?? "")

  // Start with the chosen item centred, set directly (no smooth scroll) before
  // the first paint, and once more after the popover has its final height.
  React.useLayoutEffect(() => {
    const centre = () => {
      const list = listRef.current
      const sel = list?.querySelector<HTMLElement>("[data-checked=true]")
      if (!list || !sel) return
      const l = list.getBoundingClientRect()
      const r = sel.getBoundingClientRect()
      list.scrollTop += r.top - l.top - (l.height - r.height) / 2
    }
    centre()
    const raf = requestAnimationFrame(centre)
    return () => cancelAnimationFrame(raf)
  }, [listRef])

  return (
    <CommandPrimitive
      ref={rootRef}
      tabIndex={-1}
      loop
      value={active}
      onValueChange={setActive}
      filter={(_value, query, keywords) => {
        const q = query.trim().toLowerCase()
        if (!q) return 1
        return (keywords ?? []).join(" ").toLowerCase().includes(q) ? 1 : 0
      }}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      {searchable ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <CommandPrimitive.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search…"
            // 16px stops iOS Safari zooming the page in when the box is tapped.
            className="h-9 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
          />
        </div>
      ) : null}
      <CommandPrimitive.List
        ref={listRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1 [-webkit-overflow-scrolling:touch]"
      >
        <CommandPrimitive.Empty className="py-6 text-center text-sm text-muted-foreground">
          Nothing matches
        </CommandPrimitive.Empty>
        <ItemModeContext.Provider value="list">{children}</ItemModeContext.Provider>
      </CommandPrimitive.List>
    </CommandPrimitive>
  )
}

function SelectItem({
  className,
  children,
  value,
  disabled = false,
  textValue,
  ...props
}: Omit<React.ComponentProps<"div">, "onSelect" | "value"> & {
  value: string
  disabled?: boolean
  textValue?: string
}) {
  const mode = React.useContext(ItemModeContext)
  const ctx = useSelect("SelectItem")
  const text = textValue ?? textOf(children)

  const { register, unregister } = ctx
  React.useLayoutEffect(() => {
    if (mode === "collect") register(value, children, text, disabled)
  }, [mode, register, value, children, text, disabled])
  React.useLayoutEffect(() => {
    if (mode !== "collect") return
    return () => unregister(value)
  }, [mode, unregister, value])

  if (mode === "collect") return null

  const checked = ctx.value === value
  return (
    <CommandPrimitive.Item
      value={value}
      keywords={[text]}
      disabled={disabled}
      onSelect={() => ctx.select(value)}
      aria-selected={checked}
      data-slot="select-item"
      data-checked={checked}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-1.5 text-sm outline-hidden select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked ? (
        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
          <CheckIcon />
        </span>
      ) : null}
    </CommandPrimitive.Item>
  )
}

function SelectGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div role="group" data-slot="select-group" className={cn("p-1", className)} {...props} />
}

function SelectLabel({ className, ...props }: React.ComponentProps<"div">) {
  const mode = React.useContext(ItemModeContext)
  if (mode === "collect") return null
  return <div data-slot="select-label" className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)} {...props} />
}

function SelectSeparator({ className, ...props }: React.ComponentProps<"div">) {
  const mode = React.useContext(ItemModeContext)
  if (mode === "collect") return null
  return <div data-slot="select-separator" className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)} {...props} />
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
