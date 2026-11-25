import * as React from "react"
import { cn } from "cn"
import { Label as LabelPrimitive } from "radix-ui"

const CONTROL = 'input, select, textarea, [role="combobox"]'

function Label({
  className,
  htmlFor,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  const id = React.useId()
  const ref = React.useRef<HTMLLabelElement>(null)
  // A label written just before its control (<Label>Date</Label><Input />) names it for screen readers
  // and focuses it on click, without every form wiring htmlFor and id by hand. An explicit htmlFor wins.
  React.useEffect(() => {
    const el = ref.current
    if (!el || htmlFor) return
    const next = el.nextElementSibling
    const control = next?.matches(CONTROL) ? next : next?.querySelector(CONTROL)
    if (!control) return
    control.id ||= id
    el.htmlFor = control.id
  })
  return (
    <LabelPrimitive.Root
      ref={ref}
      htmlFor={htmlFor}
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
