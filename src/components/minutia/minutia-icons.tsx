import type { ReactNode, SVGProps } from "react";
import type { Cadence, IssueCategory, MeetingStatus } from "@/lib/types";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ActionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5.3" cy="12" r="4.2" fill="currentColor" />
      <path
        d="M10 6.2 15.5 12 10 17.8"
        stroke="var(--accent)"
        strokeWidth="3.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.4 6.2 20.8 12 15.4 17.8"
        stroke="currentColor"
        strokeWidth="3.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconBase>
  );
}

export function DecisionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect
        x="3"
        y="7.1"
        width="8.2"
        height="2.9"
        rx="1.45"
        fill="currentColor"
      />
      <rect
        x="3"
        y="14"
        width="8.2"
        height="2.9"
        rx="1.45"
        fill="currentColor"
      />
      <path
        d="M10.5 8.6h3.2L17.5 12l-3.8 3.4h-3.2"
        stroke="currentColor"
        strokeWidth="2.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="17.2"
        y="10.5"
        width="5"
        height="3"
        rx="1.5"
        fill="var(--accent)"
      />
    </IconBase>
  );
}

export function InfoIcon(props: IconProps) {
  const dots = [
    [6, 6],
    [12, 6],
    [18, 6],
    [6, 12],
    [12, 12],
    [18, 12],
    [6, 18],
    [12, 18],
    [18, 18],
  ];

  return (
    <IconBase {...props}>
      {dots.map(([cx, cy]) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r="2.2"
          fill={cx === 12 && cy === 12 ? "var(--accent)" : "currentColor"}
        />
      ))}
    </IconBase>
  );
}

export function RiskIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4.2 21 19H3L12 4.2Z" fill="currentColor" />
      <rect
        x="10.8"
        y="9"
        width="2.4"
        height="5.6"
        rx="1.2"
        fill="var(--paper)"
      />
      <circle cx="12" cy="16.4" r="1.35" fill="var(--accent)" />
    </IconBase>
  );
}

export function BlockerIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect
        x="2.5"
        y="10"
        width="7.5"
        height="4"
        rx="1.5"
        fill="currentColor"
      />
      <rect
        x="14"
        y="10"
        width="7.5"
        height="4"
        rx="1.5"
        fill="currentColor"
      />
      <rect
        x="10.5"
        y="5"
        width="3"
        height="14"
        rx="1.5"
        fill="var(--accent)"
      />
    </IconBase>
  );
}

export function RecurringMeetingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M5.5 8.7c2.8-3.2 10.2-3.2 13 0"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M18.5 15.3c-2.8 3.2-10.2 3.2-13 0"
        stroke="var(--accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="6.3" cy="12" r="2.55" fill="currentColor" />
      <circle cx="12" cy="12" r="2.55" fill="currentColor" />
      <circle cx="17.7" cy="12" r="2.55" fill="currentColor" />
    </IconBase>
  );
}

export function AdhocMeetingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path
        d="M6 9V6h3M15 6h3v3M18 15v3h-3M9 18H6v-3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="4.3" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="var(--accent)" />
    </IconBase>
  );
}

export function UpcomingMeetingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect
        x="3.5"
        y="5"
        width="13"
        height="3"
        rx="1.6"
        fill="currentColor"
      />
      <circle cx="19" cy="6.5" r="2.25" fill="var(--accent)" />
      <rect
        x="3.5"
        y="10.5"
        width="17"
        height="3"
        rx="1.6"
        fill="currentColor"
      />
      <rect
        x="3.5"
        y="16"
        width="17"
        height="3"
        rx="1.6"
        fill="currentColor"
      />
    </IconBase>
  );
}

export function LiveMeetingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4.25" fill="var(--accent)" />
      <path
        d="M7 6.8a7.6 7.6 0 0 0 0 10.4M17 6.8a7.6 7.6 0 0 1 0 10.4"
        stroke="currentColor"
        strokeWidth="2.9"
        strokeLinecap="round"
      />
    </IconBase>
  );
}

export function CompletedMeetingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.6" fill="currentColor" />
      <circle cx="12" cy="12" r="4.7" fill="var(--paper)" />
      <circle cx="12" cy="12" r="2.5" fill="var(--accent)" />
    </IconBase>
  );
}

export function MinutiaCategoryIcon({
  category,
  ...props
}: IconProps & { category: IssueCategory }) {
  const icons = {
    action: ActionIcon,
    decision: DecisionIcon,
    info: InfoIcon,
    risk: RiskIcon,
    blocker: BlockerIcon,
  } satisfies Record<IssueCategory, (props: IconProps) => ReactNode>;

  const Icon = icons[category];
  return <Icon {...props} />;
}

export function MinutiaMeetingStatusIcon({
  status,
  ...props
}: IconProps & { status: MeetingStatus }) {
  const icons = {
    upcoming: UpcomingMeetingIcon,
    live: LiveMeetingIcon,
    completed: CompletedMeetingIcon,
  } satisfies Record<MeetingStatus, (props: IconProps) => ReactNode>;

  const Icon = icons[status];
  return <Icon {...props} />;
}

export function MinutiaCadenceIcon({
  cadence,
  ...props
}: IconProps & { cadence: Cadence }) {
  const Icon = cadence === "adhoc" ? AdhocMeetingIcon : RecurringMeetingIcon;
  return <Icon {...props} />;
}
