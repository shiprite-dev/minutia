"use client";

import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { useOrgMembers } from "@/lib/hooks/use-org-members";
import { cn } from "@/lib/utils";

export interface MemberAssignPayload {
  owner_user_id: string | null;
  owner_name: string;
}

interface MemberComboboxProps {
  ownerName: string | null;
  onAssign: (payload: MemberAssignPayload) => void;
  attendees?: string[];
  className?: string;
  disabled?: boolean;
}

function InitialsAvatar({ label }: { label: string }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-ink-3">
      {label.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function MemberCombobox({
  ownerName,
  onAssign,
  attendees = [],
  className,
  disabled,
}: MemberComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const { data: members = [] } = useOrgMembers();

  function assign(payload: MemberAssignPayload) {
    onAssign(payload);
    setOpen(false);
    setQuery("");
  }

  const trimmedQuery = query.trim().toLowerCase();
  const matches = (value: string) => value.toLowerCase().includes(trimmedQuery);

  const filteredMembers = members.filter(
    (member) =>
      trimmedQuery.length === 0 || matches(member.name ?? "") || matches(member.email)
  );
  const memberMatchesQuery = trimmedQuery.length > 0 && filteredMembers.length > 0;

  const attendeeOptions = attendees.filter(
    (name) => !members.some((member) => member.name === name || member.email === name)
  );
  const filteredAttendees = attendeeOptions.filter(
    (name) => trimmedQuery.length === 0 || matches(name)
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label="Assign owner"
          className={cn("justify-start gap-1.5 font-normal", className)}
        >
          {ownerName ? (
            <>
              <InitialsAvatar label={ownerName} />
              <span className="truncate">{ownerName}</span>
            </>
          ) : (
            <span className="text-ink-4">Unassigned</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search people..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {(filteredMembers.length > 0 || filteredAttendees.length > 0) && (
              <CommandGroup heading="Workspace">
                {filteredMembers.map((member) => {
                  const label = member.name || member.email;
                  return (
                    <CommandItem
                      key={member.id}
                      value={`member-${member.id}`}
                      onSelect={() =>
                        assign({ owner_user_id: member.id, owner_name: label })
                      }
                    >
                      <InitialsAvatar label={label} />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {member.name && (
                        <span className="truncate text-xs text-ink-4">{member.email}</span>
                      )}
                    </CommandItem>
                  );
                })}
                {filteredAttendees.map((name) => (
                  <CommandItem
                    key={`attendee-${name}`}
                    value={`attendee-${name}`}
                    onSelect={() => assign({ owner_user_id: null, owner_name: name })}
                  >
                    <InitialsAvatar label={name} />
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmedQuery.length > 0 && !memberMatchesQuery && (
              <CommandGroup>
                <CommandItem
                  value={`freetext-${trimmedQuery}`}
                  onSelect={() => assign({ owner_user_id: null, owner_name: query.trim() })}
                >
                  Assign to &quot;{query.trim()}&quot;
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              <CommandItem
                value="unassign"
                onSelect={() => assign({ owner_user_id: null, owner_name: "" })}
              >
                Unassign
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
