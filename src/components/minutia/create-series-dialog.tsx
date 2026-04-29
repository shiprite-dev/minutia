"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSeriesSchema, type CreateSeriesInput } from "@/lib/schemas";
import { useCreateSeries } from "@/lib/hooks/use-series";
import { CADENCES } from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface CreateSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const cadenceLabels: Record<string, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  adhoc: "Ad hoc",
};

export function CreateSeriesDialog({
  open,
  onOpenChange,
}: CreateSeriesDialogProps) {
  const createSeries = useCreateSeries();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateSeriesInput>({
    resolver: zodResolver(createSeriesSchema as any),
    defaultValues: {
      name: "",
      description: "",
      cadence: "weekly",
      default_attendees: [],
    },
  });

  const selectedCadence = watch("cadence");

  async function onSubmit(data: CreateSeriesInput) {
    await createSeries.mutateAsync(data);
    reset();
    onOpenChange(false);
  }

  function handleAttendeesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    const attendees = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setValue("default_attendees", attendees);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0" showCloseButton>
        <div className="px-8 pt-8 pb-2">
          <DialogHeader className="space-y-1.5 mb-0">
            <DialogTitle className="font-display text-xl">Create series</DialogTitle>
            <DialogDescription className="text-sm text-ink-3">
              A series groups your recurring meetings together.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-8 pb-8 space-y-6">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="series-name" className="text-sm font-semibold text-ink">Name</Label>
            <Input
              id="series-name"
              placeholder="e.g. Weekly Standup"
              {...register("name")}
              aria-invalid={!!errors.name}
              className="h-11"
            />
            {errors.name && (
              <p className="text-xs text-danger">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="series-description" className="text-sm font-semibold text-ink">Description</Label>
            <Textarea
              id="series-description"
              placeholder="Optional description"
              {...register("description")}
              className="min-h-[100px]"
            />
          </div>

          {/* Cadence */}
          <div className="space-y-2.5">
            <Label className="text-sm font-semibold text-ink">Cadence</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {CADENCES.map((cadence) => (
                <button
                  key={cadence}
                  type="button"
                  role="radio"
                  aria-checked={selectedCadence === cadence}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                    selectedCadence === cadence
                      ? "bg-ink text-paper"
                      : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
                  )}
                  onClick={() => setValue("cadence", cadence)}
                >
                  {cadenceLabels[cadence]}
                </button>
              ))}
            </div>
          </div>

          {/* Default attendees */}
          <div className="space-y-2">
            <Label htmlFor="series-attendees" className="text-sm font-semibold text-ink">Default attendees</Label>
            <Input
              id="series-attendees"
              placeholder="email@example.com, another@example.com"
              onChange={handleAttendeesChange}
              className="h-11"
            />
            <p className="text-xs text-ink-4">Comma-separated emails</p>
          </div>

          <div className="border-t border-rule pt-6 flex justify-end">
            <Button
              type="submit"
              disabled={createSeries.isPending}
              className="bg-accent text-white hover:bg-accent-hover px-6 h-10"
            >
              {createSeries.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Create series
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
