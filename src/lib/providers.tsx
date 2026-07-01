"use client";

import {
  QueryClient,
  QueryClientProvider,
  MutationCache,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";

import { humanizeError } from "@/lib/errors";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
        // Success/error toasts are driven declaratively from each mutation's
        // `meta` (see src/types/react-query.d.ts). A mutation opts into a
        // success toast with `meta.successMessage`; every mutation gets a
        // humanized error toast unless it sets `meta.silentError`.
        mutationCache: new MutationCache({
          onSuccess: (_data, _vars, _ctx, mutation) => {
            const message = mutation.meta?.successMessage;
            if (message) toast.success(message);
          },
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.meta?.silentError) return;
            toast.error(mutation.meta?.errorMessage ?? humanizeError(error));
          },
        }),
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        {/* Honor prefers-reduced-motion for all Motion animations (CSS handles
            transitions; this covers the JS layer). */}
        <MotionConfig reducedMotion="user">
          <ConfirmProvider>{children}</ConfirmProvider>
          <Toaster />
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
