'use client';

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200",
  {
    variants: {
      variant: {
        default: "border-gray-300 dark:border-gray-700 focus-visible:border-primary",
        glass: "backdrop-blur-sm bg-white/10 dark:bg-black/10 border-white/20 dark:border-gray-600/30",
        neon: "border-transparent shadow-[0_0_15px_rgba(147,51,234,0.3)] focus-visible:shadow-[0_0_20px_rgba(147,51,234,0.5)]",
      },
      size: {
        default: "h-10",
        sm: "h-8 text-xs",
        lg: "h-12 text-base",
        xl: "h-14 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  error?: string
  label?: string
  helperText?: string
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant, size, leftIcon, rightIcon, error, label, helperText, type = "text", ...props }, ref) => {
    const [isFocused, setIsFocused] = React.useState(false)
    const [isDragging, setIsDragging] = React.useState(false)
    const fileInputRef = React.useRef<HTMLInputElement>(null)

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (type === "file") {
        setIsDragging(true)
      }
    }

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (type === "file") {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      if (type === "file" && fileInputRef.current && e.dataTransfer.files.length > 0) {
        const dataTransfer = new DataTransfer()
        Array.from(e.dataTransfer.files).forEach(file => dataTransfer.items.add(file))
        fileInputRef.current.files = dataTransfer.files
        fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    const handleContainerClick = () => {
      if (type === "file" && fileInputRef.current) {
        fileInputRef.current.click()
      }
    }

    const renderFileInput = () => (
      <div
        className={cn(
          "relative cursor-pointer",
          isDragging && "ring-2 ring-primary ring-offset-2"
        )}
        onClick={handleContainerClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          ref={fileInputRef}
          {...props}
        />
        <div className="flex items-center justify-between w-full">
          <span className="truncate text-muted-foreground">
            {props.value || props.placeholder || "Arrastra archivos o haz clic para seleccionar"}
          </span>
          <div className="flex items-center gap-2">
            {leftIcon && <div className="text-muted-foreground">{leftIcon}</div>}
            <div className="px-3 py-1 text-xs rounded-md bg-secondary text-secondary-foreground">
              Examinar
            </div>
          </div>
        </div>
      </div>
    )

    return (
      <div className="w-full space-y-2">
        {label && (
          <label
            htmlFor={props.id}
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {leftIcon && type !== "file" && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
              {leftIcon}
            </div>
          )}

          {type === "file" ? (
            renderFileInput()
          ) : (
            <input
              type={type}
              className={cn(
                inputVariants({ variant, size, className }),
                leftIcon && "pl-10",
                rightIcon && "pr-10",
                isFocused && variant === "glass" && "bg-white/20 dark:bg-black/20",
                error && "border-destructive focus-visible:ring-destructive"
              )}
              ref={ref}
              onFocus={(e) => {
                setIsFocused(true)
                props.onFocus?.(e)
              }}
              onBlur={(e) => {
                setIsFocused(false)
                props.onBlur?.(e)
              }}
              aria-invalid={!!error}
              aria-describedby={error ? `${props.id}-error` : helperText ? `${props.id}-helper` : undefined}
              {...props}
            />
          )}

          {rightIcon && type !== "file" && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
              {rightIcon}
            </div>
          )}
        </div>

        {(error || helperText) && (
          <p
            id={error ? `${props.id}-error` : `${props.id}-helper`}
            className={cn(
              "text-sm",
              error ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    )
  }
)

Input.displayName = "Input"

export { Input, inputVariants }
