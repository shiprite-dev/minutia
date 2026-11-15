"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { materializeClassName, type FlowWord } from "@/lib/summary/flow";
import type { RecapBlock } from "@/lib/summary/structure";

function Word({
  text,
  bold,
  animate,
}: {
  text: string;
  bold: boolean;
  animate: boolean;
}) {
  const [className, setClassName] = React.useState(
    materializeClassName(animate),
  );
  const props = {
    className: cn(className, bold && "font-semibold text-ink"),
    onAnimationEnd: () => setClassName(""),
  };
  return bold ? (
    <strong {...props}>{text}</strong>
  ) : (
    <span {...props}>{text}</span>
  );
}

function Words({ words, animate }: { words: FlowWord[]; animate: boolean }) {
  return words.map((w) => (
    <Word key={w.key} text={w.text} bold={w.bold} animate={animate} />
  ));
}

export function MarkdownBlocks({
  blocks,
  animate = false,
  dense = false,
}: {
  blocks: RecapBlock[];
  animate?: boolean;
  dense?: boolean;
}) {
  return blocks.map((b) =>
    b.kind === "heading" ? (
      <h3
        key={b.key}
        className="mb-2 text-[15px] font-semibold leading-6 text-ink [&:not(:first-child)]:mt-7"
      >
        <Words words={b.words} animate={animate} />
      </h3>
    ) : b.kind === "list" ? (
      <ul
        key={b.key}
        className="list-disc space-y-1.5 pl-5 leading-7 marker:text-ink-4"
      >
        {b.items.map((item) => (
          <li key={item.key}>
            <Words words={item.words} animate={animate} />
          </li>
        ))}
      </ul>
    ) : (
      <p
        key={b.key}
        className={
          dense
            ? "leading-7 [&:not(:first-child)]:mt-1"
            : "leading-8 [&:not(:first-child)]:mt-4"
        }
      >
        <Words words={b.words} animate={animate} />
      </p>
    ),
  );
}
