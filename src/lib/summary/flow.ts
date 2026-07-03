// Pure client helpers. splitWords produces stable index keys so React
// reconciliation appends only newly arrived spans (earlier words keep their
// DOM node and do not re-animate). materializeClassName gates the enter
// animation on the reduced-motion preference; content still renders.

export interface FlowWord {
  key: number;
  text: string;
  bold: boolean;
}

// Strip **bold** markers to plain text while recording which characters fall
// inside a closed bold span. An unterminated trailing opener is treated as
// literal (no bold, no leaked markers) so a mid-stream frame never flashes the
// wrong emphasis or raw markup; it settles once the closer arrives.
function stripBold(text: string): { plain: string; bold: boolean[] } {
  let plain = "";
  const bold: boolean[] = [];
  let open = false;
  let openStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "*" && text[i + 1] === "*") {
      open = !open;
      openStart = open ? plain.length : -1;
      i++;
      continue;
    }
    plain += text[i];
    bold.push(open);
  }
  // Unterminated opener: revert everything after it to non-bold.
  if (open && openStart >= 0) {
    for (let i = openStart; i < bold.length; i++) bold[i] = false;
  }
  return { plain, bold };
}

export function splitWords(text: string): FlowWord[] {
  if (!text) return [];
  const { plain, bold } = stripBold(text);
  const re = /\S+\s*/g;
  const words: FlowWord[] = [];
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(plain)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    let isBold = false;
    for (let i = start; i < end; i++) {
      if (bold[i]) {
        isBold = true;
        break;
      }
    }
    words.push({ key: key++, text: match[0], bold: isBold });
  }
  return words;
}

export function materializeClassName(reducedMotion: boolean): string {
  return reducedMotion ? "" : "materialize";
}

// The muted provenance timings shown under a finished recap: how long until the
// first words landed and the total stream duration, each to one decimal second.
export function formatProvenance(p: {
  firstWordMs: number | null;
  totalMs: number | null;
}): string {
  const parts: string[] = [];
  if (p.firstWordMs != null) parts.push(`first words in ${(p.firstWordMs / 1000).toFixed(1)}s`);
  if (p.totalMs != null) parts.push(`${(p.totalMs / 1000).toFixed(1)}s total`);
  return parts.join(" · ");
}
