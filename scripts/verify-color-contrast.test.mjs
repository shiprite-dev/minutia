import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync("src/app/globals.css", "utf8");

function themeTokens(selector) {
  const block = css.split(`${selector} {`)[1].split("}")[0];
  const raw = Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, n, v]) => [n, v.trim()]),
  );
  const resolve = (v) => {
    const ref = v.match(/^var\(--([\w-]+)\)$/);
    if (ref) return resolve(raw[ref[1]]);
    return v.match(/^oklch\(([^)]+)\)/)[1].trim().split(/\s+/).map(Number);
  };
  return Object.fromEntries(
    Object.keys(raw)
      .filter((n) => /oklch|var\(/.test(raw[n]))
      .map((n) => [n, resolve(raw[n])]),
  );
}

function luminance([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x) => Math.min(Math.max(x, 0), 1);
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = [1, 0, 0];
const SURFACES = ["paper", "paper-2", "paper-3"];
const TEXT_ON = {
  ink: SURFACES,
  "ink-2": SURFACES,
  "ink-3": SURFACES,
  "ink-4": SURFACES,
  "accent-text": [...SURFACES, "accent-soft"],
  "danger-text": [...SURFACES, "danger-soft"],
  success: [...SURFACES, "success-soft"],
  warn: [...SURFACES, "warn-soft"],
  ...Object.fromEntries(
    [1, 2, 3, 4, 5].map((n) => [
      `speaker-${n}`,
      [...SURFACES, `speaker-${n}-soft`],
    ]),
  ),
};

for (const [theme, selector] of [
  ["light", ":root"],
  ["dark", ".dark"],
]) {
  const t = themeTokens(selector);

  test(`${theme} mode: every coloured label is readable on every surface it sits on`, () => {
    const unreadable = [];
    for (const [fg, bgs] of Object.entries(TEXT_ON)) {
      for (const bg of bgs) {
        const ratio = contrast(t[fg], t[bg]);
        if (ratio < 4.5)
          unreadable.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1`);
      }
    }
    assert.deepEqual(unreadable, []);
  });

  test(`${theme} mode: white text on the orange and red buttons is readable`, () => {
    for (const fill of ["accent", "danger"]) {
      const ratio = contrast(WHITE, t[fill]);
      assert.ok(ratio >= 4.5, `white on ${fill}: ${ratio.toFixed(2)}:1`);
    }
  });
}
