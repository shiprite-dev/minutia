// Pure client helpers. splitWords produces stable index keys so React
// reconciliation appends only newly arrived spans (earlier words keep their
// DOM node and do not re-animate). materializeClassName returns the enter
// animation class only when asked to animate (streaming, motion allowed);
// content always renders.

export interface FlowWord {
  key: number;
  text: string;
  bold: boolean;
}

// Strip **bold** markers to plain text while recording which characters fall
// inside a closed bold span. An unterminated trailing opener reverts to
// non-bold unless openBold is set (streaming), in which case the trailing words
// stay bold; markers are never leaked.
function stripBold(text: string, openBold: boolean): { plain: string; bold: boolean[] } {
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
  if (!openBold && open && openStart >= 0) {
    for (let i = openStart; i < bold.length; i++) bold[i] = false;
  }
  return { plain, bold };
}

export function splitWords(text: string, opts?: { openBold?: boolean }): FlowWord[] {
  if (!text) return [];
  const { plain, bold } = stripBold(text, !!opts?.openBold);
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

export function materializeClassName(animate: boolean): string {
  return animate ? "materialize" : "";
}
