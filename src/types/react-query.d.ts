import "@tanstack/react-query"

// Type the mutation `meta` we read in the global MutationCache (see providers.tsx):
// success/error toasts are driven declaratively from each mutation's meta.
declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Toast shown on success. Omit for no success toast. */
      successMessage?: string
      /** Override the humanized error toast copy. */
      errorMessage?: string
      /** Suppress the automatic error toast (handle it locally). */
      silentError?: boolean
    }
  }
}
