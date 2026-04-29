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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Create series</DialogTitle>
          <DialogDescription>
            A series groups your recurring meetings together.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="series-name">Name</Label>
            <Input
              id="series-name"
              placeholder="e.g. Weekly Standup"
              {...register("name")}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-danger">{errors.name.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="series-description">Description</Label>
            <Textarea
              id="series-description"
              placeholder="Optional description"
              {...register("description")}
              className="min-h-[60px]"
            />
          </div>

          {/* Cadence */}
          <div className="space-y-1.5">
            <Label>Cadence</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup">
              {CADENCES.map((cadence) => (
                <button
                  key={cadence}
                  type="button"
                  role="radio"
                  aria-checked={selectedCadence === cadence}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
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
          <div className="space-y-1.5">
            <Label htmlFor="series-attendees">Default attendees</Label>
            <Input
              id="series-attendees"
              placeholder="email@example.com, another@example.com"
              onChange={handleAttendeesChange}
            />
            <p className="text-[10px] text-ink-4">Comma-separated emails</p>
          </div>

          <DialogFooter>
            <Button
              type="submit"
              disabled={createSeries.isPending}
              className="bg-accent text-white hover:bg-accent-hover"
            >
              {createSeries.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Create series
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
