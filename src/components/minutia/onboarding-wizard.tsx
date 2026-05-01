"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useUpdateProfile } from "@/lib/hooks/use-profile";
import { useCompleteOnboarding } from "@/lib/hooks/use-profile";
import { useCreateSeries } from "@/lib/hooks/use-series";
import { CADENCES } from "@/lib/constants";
import type { Cadence } from "@/lib/types";

const TOTAL_STEPS = 3;

const cadenceLabels: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  adhoc: "Ad hoc",
};

interface OnboardingWizardProps {
  userName: string | null;
  userEmail: string;
}

export function OnboardingWizard({ userName, userEmail }: OnboardingWizardProps) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [direction, setDirection] = React.useState(1);

  const [name, setName] = React.useState(userName ?? "");
  const [seriesName, setSeriesName] = React.useState("");
  const [cadence, setCadence] = React.useState<Cadence>("weekly");
  const [attendees, setAttendees] = React.useState("");
  const [createdSeriesId, setCreatedSeriesId] = React.useState<string | null>(null);

  const updateProfile = useUpdateProfile();
  const createSeries = useCreateSeries();
  const completeOnboarding = useCompleteOnboarding();

  function goNext() {
    setDirection(1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  }

  async function handleFinishStep0() {
    if (name.trim() && name.trim() !== userName) {
      await updateProfile.mutateAsync({ name: name.trim() });
    }
    goNext();
  }

  async function handleFinishStep1() {
    if (seriesName.trim()) {
      const attendeeList = attendees
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const series = await createSeries.mutateAsync({
        name: seriesName.trim(),
        cadence,
        default_attendees: attendeeList,
      });
      setCreatedSeriesId(series.id);
    }
    goNext();
  }

  async function handleComplete() {
    await completeOnboarding.mutateAsync();
    if (createdSeriesId) {
      router.push(`/series/${createdSeriesId}`);
    } else {
      router.push("/");
    }
    router.refresh();
  }

  async function handleSkip() {
    await completeOnboarding.mutateAsync();
    router.push("/");
    router.refresh();
  }

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -80 : 80, opacity: 0 }),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper">
      <div className="w-full max-w-lg px-6">
        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === step ? "w-8 bg-accent" : i < step ? "w-4 bg-accent/40" : "w-4 bg-rule"
              )}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="relative overflow-hidden rounded-2xl border border-rule bg-card p-8 min-h-[360px]">
          <AnimatePresence mode="wait" custom={direction}>
            {step === 0 && (
              <motion.div
                key="step-0"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepWelcome
                  name={name}
                  onNameChange={setName}
                  onNext={handleFinishStep0}
                  isPending={updateProfile.isPending}
                />
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="step-1"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepCreateSeries
                  seriesName={seriesName}
                  onSeriesNameChange={setSeriesName}
                  cadence={cadence}
                  onCadenceChange={setCadence}
                  attendees={attendees}
                  onAttendeesChange={setAttendees}
                  onNext={handleFinishStep1}
                  onSkip={goNext}
                  isPending={createSeries.isPending}
                />
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step-2"
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <StepTour
                  onComplete={handleComplete}
                  isPending={completeOnboarding.isPending}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Skip link */}
        <div className="mt-4 text-center">
          <button
            onClick={handleSkip}
            className="text-xs text-ink-4 hover:text-ink-3 transition-colors"
          >
            Skip setup
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0: Welcome + Name
// ---------------------------------------------------------------------------

function StepWelcome({
  name,
  onNameChange,
  onNext,
  isPending,
}: {
  name: string;
  onNameChange: (v: string) => void;
  onNext: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="inline-flex items-center justify-center size-12 rounded-full bg-accent/10 mb-4"
        >
          <span className="font-display text-xl font-bold text-accent">m</span>
        </motion.div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Welcome to Minutia
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          Stop losing track of what was said, decided, and owed.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboard-name" className="text-ink-2">
          What should we call you?
        </Label>
        <Input
          id="onboard-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Your name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) onNext();
          }}
          className="h-11 rounded-xl"
        />
      </div>

      <Button
        onClick={onNext}
        disabled={!name.trim() || isPending}
        className="w-full h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
      >
        Continue
        <ArrowRight className="size-4 ml-1" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Create first series
// ---------------------------------------------------------------------------

function StepCreateSeries({
  seriesName,
  onSeriesNameChange,
  cadence,
  onCadenceChange,
  attendees,
  onAttendeesChange,
  onNext,
  onSkip,
  isPending,
}: {
  seriesName: string;
  onSeriesNameChange: (v: string) => void;
  cadence: Cadence;
  onCadenceChange: (v: Cadence) => void;
  attendees: string;
  onAttendeesChange: (v: string) => void;
  onNext: () => void;
  onSkip: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          Create your first series
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          A series is a recurring meeting you want to track issues for.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboard-series" className="text-ink-2">
          Meeting name
        </Label>
        <Input
          id="onboard-series"
          value={seriesName}
          onChange={(e) => onSeriesNameChange(e.target.value)}
          placeholder="e.g. Weekly Standup, Vendor Sync, 1:1 with Alex"
          autoFocus
          className="h-11 rounded-xl"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-ink-2">How often?</Label>
        <div className="flex flex-wrap gap-1.5">
          {CADENCES.map((c) => (
            <button
              key={c}
              type="button"
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                cadence === c
                  ? "bg-ink text-paper"
                  : "bg-paper-2 text-ink-3 hover:text-ink-2 hover:bg-paper-3"
              )}
              onClick={() => onCadenceChange(c)}
            >
              {cadenceLabels[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="onboard-attendees" className="text-ink-2">
          Attendees <span className="text-ink-4 font-normal">(optional)</span>
        </Label>
        <Input
          id="onboard-attendees"
          value={attendees}
          onChange={(e) => onAttendeesChange(e.target.value)}
          placeholder="alice@co.com, bob@co.com"
          className="h-11 rounded-xl"
        />
        <p className="text-[10px] text-ink-4">Comma-separated emails</p>
      </div>

      <div className="flex gap-3">
        <Button
          variant="ghost"
          onClick={onSkip}
          className="flex-1 h-11 rounded-xl text-ink-3"
        >
          Skip for now
        </Button>
        <Button
          onClick={onNext}
          disabled={!seriesName.trim() || isPending}
          className="flex-1 h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
        >
          {isPending ? "Creating..." : "Create series"}
          {!isPending && <ArrowRight className="size-4 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Quick tour
// ---------------------------------------------------------------------------

const features = [
  {
    title: "OIL Board",
    desc: "Your dashboard for all outstanding issues across every series.",
    shortcut: "J/K",
  },
  {
    title: "Live Capture",
    desc: "Start a meeting and raise issues in real-time with type prefixes.",
    shortcut: "N",
  },
  {
    title: "Pre-Meeting Brief",
    desc: "Auto-generated summary of pending items before your next meeting.",
  },
  {
    title: "Keyboard First",
    desc: "Navigate, update status, and add items without touching the mouse.",
    shortcut: "?",
  },
];

function StepTour({
  onComplete,
  isPending,
}: {
  onComplete: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-xl font-semibold text-ink">
          You're all set
        </h2>
        <p className="text-sm text-ink-3 mt-1">
          Here's what you can do with Minutia.
        </p>
      </div>

      <div className="space-y-2.5">
        {features.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.1 + i * 0.08,
              duration: 0.3,
              ease: [0.2, 0.8, 0.2, 1],
            }}
            className="flex items-start gap-3 rounded-lg border border-rule p-3"
          >
            <div className="mt-0.5 flex items-center justify-center size-5 rounded-full bg-accent/10 shrink-0">
              <ChevronRight className="size-3 text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">{f.title}</p>
                {f.shortcut && (
                  <kbd className="rounded bg-paper-2 px-1.5 py-0.5 text-[10px] font-mono text-ink-4">
                    {f.shortcut}
                  </kbd>
                )}
              </div>
              <p className="text-xs text-ink-3 mt-0.5">{f.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <Button
        onClick={onComplete}
        disabled={isPending}
        className="w-full h-11 rounded-xl bg-accent text-white hover:bg-accent-hover"
      >
        {isPending ? "Getting ready..." : "Start tracking"}
        {!isPending && <Sparkles className="size-4 ml-1" />}
      </Button>
    </div>
  );
}
