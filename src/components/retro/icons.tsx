"use client";

import React from "react";

interface IcoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  sw?: number;
  d?: string;
  children?: React.ReactNode;
}

function Ico({ d, size = 20, fill = "none", sw = 1.75, children, ...rest }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children || (d ? <path d={d} /> : null)}
    </svg>
  );
}

export type IconProps = { size?: number } & React.SVGProps<SVGSVGElement>;

export const Icons = {
  Timer: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="M5 3 2 6" />
      <path d="m22 6-3-3" />
      <path d="M6.38 18.7 4 21" />
      <path d="M17.64 18.67 20 21" />
    </Ico>
  ),
  Eye: (p: IconProps) => (
    <Ico {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Ico>
  ),
  EyeOff: (p: IconProps) => (
    <Ico {...p}>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </Ico>
  ),
  Check: (p: IconProps) => (
    <Ico {...p} sw={2.5}>
      <path d="M20 6 9 17l-5-5" />
    </Ico>
  ),
  CheckCircle: (p: IconProps) => (
    <Ico {...p}>
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
    </Ico>
  ),
  Clock: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Ico>
  ),
  Users: (p: IconProps) => (
    <Ico {...p}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Ico>
  ),
  Link: (p: IconProps) => (
    <Ico {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Ico>
  ),
  Download: (p: IconProps) => (
    <Ico {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Ico>
  ),
  Sparkles: (p: IconProps) => (
    <Ico {...p}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </Ico>
  ),
  ArrowRight: (p: IconProps) => (
    <Ico {...p} sw={2}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </Ico>
  ),
  ThumbsUp: (p: IconProps) => (
    <Ico {...p}>
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </Ico>
  ),
  Plus: (p: IconProps) => (
    <Ico {...p} sw={2}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Ico>
  ),
  Volume: (p: IconProps) => (
    <Ico {...p}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </Ico>
  ),
  Sun: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </Ico>
  ),
  Moon: (p: IconProps) => (
    <Ico {...p}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Ico>
  ),
};
