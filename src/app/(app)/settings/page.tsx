"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useProfile, useUpdateProfile } from "@/lib/hooks/use-profile";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const themeOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export default function SettingsPage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfile = useUpdateProfile();
  const { theme, setTheme } = useTheme();

  const [name, setName] = useState("");
  const [nameInitialized, setNameInitialized] = useState(false);

  // Sync profile name once loaded
  if (profile?.name && !nameInitialized) {
    setName(profile.name);
    setNameInitialized(true);
  }

  const isDirty = name !== (profile?.name ?? "");
  const isValid = name.trim().length >= 1 && name.length <= 100;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    updateProfile.mutate({ name: name.trim() });
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-4">
        <p className="text-sm text-ink-3">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div className="mx-auto w-full max-w-lg space-y-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name and account details.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {name.length > 0 && !isValid && (
                  <p className="text-xs text-danger">
                    Name must be between 1 and 100 characters.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <p className="text-sm text-ink-2">{profile?.email}</p>
              </div>

              <Button
                type="submit"
                size="sm"
                className="self-start"
                disabled={updateProfile.isPending || !isDirty || !isValid}
              >
                {updateProfile.isPending ? "Saving..." : "Save"}
              </Button>

              {updateProfile.isSuccess && (
                <p className="text-xs text-success">Profile updated.</p>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose how Minutia looks for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {themeOptions.map((option) => (
                <Button
                  key={option.value}
                  variant={theme === option.value ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "gap-1.5",
                    theme === option.value &&
                      "border-rule-strong bg-paper-2 text-ink"
                  )}
                >
                  <option.icon className="size-3.5" />
                  {option.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
