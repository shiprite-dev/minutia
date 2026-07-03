// Pure word-pacer. Providers emit deltas of arbitrary size and cadence; this
// regroups them into whole words (each carrying its trailing whitespace) and
// spaces emits by a minimum interval so the client renders smooth word frames
// regardless of upstream jitter. No characters are dropped: the buffer holds a
// partial word until its boundary arrives, and the tail flushes at the end.

const WORD_WITH_TRAILING_WS = /\S+\s+/;

export async function* paceWords(
  source: AsyncIterable<string>,
  opts: { minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): AsyncGenerator<string> {
  const minIntervalMs = opts.minIntervalMs ?? 18;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let buffer = "";
  let emitted = false;

  const drain = async function* (): AsyncGenerator<string> {
    let match = buffer.match(WORD_WITH_TRAILING_WS);
    while (match) {
      const end = match.index! + match[0].length;
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end);
      if (emitted) await sleep(minIntervalMs);
      emitted = true;
      yield chunk;
      match = buffer.match(WORD_WITH_TRAILING_WS);
    }
  };

  for await (const delta of source) {
    buffer += delta;
    yield* drain();
  }
  if (buffer.length > 0) {
    if (emitted) await sleep(minIntervalMs);
    yield buffer;
  }
}
