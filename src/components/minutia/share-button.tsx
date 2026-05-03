"use client";

import * as React from "react";
import { useCreateGuestShare, getShareUrl } from "@/lib/hooks/use-guest-shares";
import { Button } from "@/components/ui/button";
import { Link2, Check, Loader2 } from "lucide-react";
import type { ShareResourceType } from "@/lib/types";

interface ShareButtonProps {
  resource_type: ShareResourceType;
  resource_id: string;
}

export function ShareButton({ resource_type, resource_id }: ShareButtonProps) {
  const createShare = useCreateGuestShare();
  const [copied, setCopied] = React.useState(false);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>(null);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function handleClick() {
    if (createShare.isPending || copied) return;

    const share = await createShare.mutateAsync({
      resource_type,
      resource_id,
    });

    const url = getShareUrl(share.token);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API unavailable (e.g. headless browser)
    }

    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={createShare.isPending}
      aria-label={copied ? "Link copied" : "Share link"}
    >
      {createShare.isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : copied ? (
        <Check className="size-4 text-success" />
      ) : (
        <Link2 className="size-4" />
      )}
    </Button>
  );
}
