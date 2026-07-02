"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm action as destructive (red). */
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Promise-based confirmation. Any destructive handler becomes:
 *   if (!(await confirm({ title, danger: true }))) return
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider")
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null)

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    // Settle any prior pending confirm as cancelled so a second confirm opened
    // while one is still awaiting never leaves the first caller hanging forever.
    resolverRef.current?.(false)
    setOptions(opts)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = React.useCallback((result: boolean) => {
    resolverRef.current?.(result)
    resolverRef.current = null
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) settle(false)
        }}
      >
        {options && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>
              {options.description && (
                <AlertDialogDescription>
                  {options.description}
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => settle(false)}>
                {options.cancelLabel ?? "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => settle(true)}
                className={
                  options.danger
                    ? cn(buttonVariants({ variant: "destructive" }))
                    : undefined
                }
              >
                {options.confirmLabel ?? "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
