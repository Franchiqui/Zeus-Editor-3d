'use client';

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    thumbClassName?: string;
    rangeClassName?: string;
  }
>(({ className, thumbClassName, rangeClassName, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-gray-700">
      <SliderPrimitive.Range className={cn("absolute h-full bg-emerald-500", rangeClassName)} />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      className={cn(
        "flex items-stretch justify-between gap-[1.5px] rounded-[2px] border border-primary bg-background px-[2px] h-[12px] w-[18px] -mt-[1px] ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        thumbClassName
      )}
    >
      <span className="block w-px self-center h-[7px] bg-primary/60" />
      <span className="block w-px self-center h-[7px] bg-primary/60" />
      <span className="block w-px self-center h-[7px] bg-primary/60" />
    </SliderPrimitive.Thumb>
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }