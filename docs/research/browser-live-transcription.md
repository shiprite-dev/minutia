# Browser Live Meeting Transcription (Granola-style, browser-only)

**Status:** Backlog research. Not scheduled. Pick up when free.
**Date:** 2026-06-08
**Author:** research synthesis (deep-research harness, 21 sources, 25 claims adversarially verified) + codebase analysis.

---

## 1. Goal

Let a user hit **Record** during a meeting and have the live conversation transcribed into the meeting's transcript field, which then powers the existing AI notes + suggestions pipeline. No meeting bot, no native app: capture audio in the browser and stream it to a real-time speech-to-text (STT) vendor.

This is the pragmatic, browser-only version of Granola. Granola is a native macOS app that taps system audio via Core Audio process taps (macOS 14.4+). We cannot do system-wide capture from a browser, but we can capture **the meeting tab's audio + the microphone**, which covers browser-based Zoom/Meet/Teams calls. That is ~70% of Granola's value with zero native code.

---

## 2. The key codebase finding: this is an input-side feature only

Live transcription requires **zero changes to the AI pipeline.** Everything downstream of a transcript already exists:

| Asset | Location | Role |
|---|---|---|
| `meetings.transcript_raw` (text) | `supabase/migrations/00001_initial_schema.sql:91` | Storage for the transcript |
| `useUpdateMeetingTranscript` | `src/lib/hooks/use-meetings.ts` | Debounced save to that column |
| Transcript section (collapsible textarea) | `src/app/(app)/series/[id]/meetings/[meetingId]/meeting-detail-content.tsx:752` | Existing paste UI |
| `enhance-notes` route | `src/app/api/meetings/[meetingId]/enhance-notes/route.ts` | Consumes `transcript_raw` → AI notes |
| `suggestions` route | `src/app/api/meetings/[meetingId]/suggestions/route.ts` | Consumes `transcript_raw` → issue suggestions |
| OpenRouter transport | `src/lib/ai/openrouter.ts` | Shared LLM call (unchanged) |

**Implication:** the entire feature is "a Record button that appends text into the same `transcript` state and `transcript_raw` column that paste already fills." The recently shipped paste-a-transcript feature (commit `699578e`) built the seam; live capture is a second way to fill it. Risk to the AI pipeline is nil.

---

## 3. Verified research findings

Confidence reflects 3-vote adversarial verification (2/3 to confirm). Pricing/latency numbers were **refuted** as stated and must be re-confirmed at build time (see §4).

### Browser capture support (high confidence)

- **`getDisplayMedia()` audio is Chromium-desktop-only.** Chrome 74+, Edge 79+, Opera 62+. **Firefox returns zero audio tracks. Safari (desktop and iOS) returns zero audio tracks.** Sources: caniuse/MDN BCD, W3C Screen Capture spec.
- **Audio is never guaranteed.** Even on Chromium, the spec says the user agent MAY return no audio track, and the user must tick "Share tab audio" in the picker. Always handle the no-audio-track case.
- **Tab-sharing is the reliable capture mode.** Sharing a browser **tab** with audio works; sharing a **window** generally yields no audio; full-**screen** system audio is inconsistent and the "Windows/ChromeOS only when sharing entire screen" claim was **refuted (0-3)**, so do not design around system-audio capture. Prefer "share the meeting tab."
- **Mic and tab audio are separate streams.** `getUserMedia()` (mic) and `getDisplayMedia()` (tab) return independent `MediaStream`s. To send one transcription stream you mix them with the Web Audio API: two `createMediaStreamSource` nodes → one `MediaStreamDestination`. (Confirmed; MDN.)

### Vendor / auth architecture (high confidence)

- **Never put a raw STT API key in the browser bundle.** Confirmed; this is the explicit anti-pattern in vendor docs.
- **Both Deepgram and AssemblyAI support browser-direct streaming via short-lived ephemeral tokens minted server-side.** Deepgram: a ~30s grant JWT for the WebSocket handshake. AssemblyAI v3: a token with configurable 1-600s TTL. The short TTL is fine because it only needs to survive the handshake; the socket stays open after. Confirmed.
- **A thin server route mints the token; the browser opens the WebSocket directly to the vendor.** This keeps audio off our servers (lower cost/latency, no egress) while keeping the real key server-side. Deepgram names the server-proxy alternative as the other common pattern.
- **Deepgram self-reports 5.26% WER (Nova-3)** and is the latency leader, but trails AssemblyAI and Speechmatics on read-speech accuracy benchmarks (arXiv 2503.06924). For meeting audio (noisy, multi-speaker) accuracy ranking can differ; benchmark on real meeting recordings before committing.

---

## 4. Refuted / unverified (do NOT design around these)

These claims failed verification or were killed. Treat as **unknown until re-checked at build time against live vendor pricing/docs pages**:

- ❌ "System audio only on Windows/ChromeOS when sharing entire screen" (0-3 refuted).
- ❌ "Streaming requires PCM16 / 16kHz / mono / 100-250ms chunks" (0-3 refuted). Vendors accept multiple encodings and container formats; do not hardcode this assumption.
- ⚠️ AssemblyAI "~150ms P50, 6.3% WER, $0.45/hr + $0.12/hr diarization" (1-2, unverified).
- ⚠️ Deepgram "<500ms latency, 50+ real-time languages" (1-2, unverified).

**Open questions to resolve before/at implementation:**
1. Exact per-minute streaming price for each vendor (Deepgram vs AssemblyAI vs Speechmatics) at current rates.
2. Required/optimal audio encoding and chunk cadence per vendor's current streaming docs.
3. Diarization (speaker labels): supported in streaming? extra cost? worth it for OIL notes?
4. Fallback UX when the browser is Firefox/Safari or the user declines tab audio.

---

## 5. Recommended architecture (Next.js)

```
Browser (meeting detail page)
  ├─ getUserMedia({audio})            → mic MediaStream
  ├─ getDisplayMedia({audio,video})   → tab MediaStream (user picks meeting tab + "share audio")
  ├─ Web Audio API                    → mix mic + tab into one MediaStreamDestination
  ├─ GET /api/transcription/token     → server mints ephemeral vendor token (key stays server-side)
  ├─ WebSocket → vendor STT (direct)  → interim + final transcripts stream back
  └─ append finals → transcript state → useUpdateMeetingTranscript (debounced → transcript_raw)

Server (thin BFF, per repo backend boundary)
  └─ /api/transcription/token: calls vendor token endpoint with the real key (Supabase function secret),
     returns a 30-600s token. No audio passes through our servers.
```

Notes:
- The token route fits the repo's "Next.js route handlers are thin BFF adapters only" rule. The vendor key lives in a Supabase function secret / runtime secret, never a `NEXT_PUBLIC_` var (CLAUDE.md backend boundary).
- Browser-direct WebSocket (not server-proxied audio) is preferred for cost and latency. Reconsider only if a vendor's browser-direct token flow proves unreliable.
- Drop the video track from `getDisplayMedia` immediately (`getVideoTracks()[0].stop()`); we only want audio. Requesting `video: true` is still required because some Chromium versions won't offer the audio checkbox for audio-only requests.

---

## 6. Vendor recommendation (provisional)

**Lead candidate: Deepgram.** Latency leader, clean ephemeral-token browser-direct flow, well-documented WebSocket protocol. Accuracy is "good enough" and the AI enhancement layer is forgiving of minor transcription errors (it summarizes, it doesn't quote verbatim).

**Backup: AssemblyAI.** Comparable token flow, often-cited higher accuracy. Evaluate if Deepgram's meeting-audio accuracy disappoints.

**Decision gate:** run both against 2-3 real recorded meeting clips, compare WER + cost + latency, then pick. Do not pick on vendor blog benchmarks (they're self-reported and several were refuted here).

---

## 7. Build plan (phased)

**Effort: roughly 3-5 focused days for Phase A+B. Phase C optional.**

### Phase A — Capture + mix (browser, no vendor yet) (~1 day)
- `useMeetingAudioCapture` hook: request mic + display media, mix via Web Audio API, expose a single `MediaStream` + `start/stop` + capability detection (is `getDisplayMedia` audio supported? did user grant tab audio?).
- Graceful degradation: Firefox/Safari or declined tab audio → mic-only, with a clear inline notice ("Tab audio needs Chrome/Edge; recording mic only").
- TDD: Playwright can't grant real screen-share, so unit-test the capability/branching logic and mock `MediaStream`. Manual verification for the real capture path.

### Phase B — Stream to STT + fill transcript (~2 days)
- `/api/transcription/token` route: mint ephemeral token (start with chosen vendor). Guard behind auth + meeting ownership. 503 when not configured, matching `enhance-notes` behavior.
- Browser WebSocket client: open with token, send mixed audio frames, receive interim/final results. Append **finals** to the transcript textarea state; show **interims** as ghosted live text (don't persist interims).
- Wire the existing `useUpdateMeetingTranscript` debounce so finals persist to `transcript_raw`. The existing "Enhance notes" / "Suggestions" buttons then just work.
- Record/Stop button + live state (recording indicator, elapsed time, mic/tab level meter optional).
- Runtime config flag: `TRANSCRIPTION_PROVIDER` + vendor key in secrets; feature hidden when unconfigured (self-host friendly, like AI notes).

### Phase C — Polish (optional, later)
- Diarization → speaker-attributed transcript lines (if vendor supports in streaming and cost is acceptable).
- Pause/resume, reconnect on socket drop (vendors document data/net WebSocket errors; handle close codes + backoff).
- Persist partials to IndexedDB so a tab crash mid-meeting doesn't lose the transcript (the offline-capture pattern already exists in the app).

---

## 8. UX pitfalls (verified + practitioner)

1. **The share picker is friction.** Users must pick the right tab AND tick "Share tab audio." Provide a one-time inline explainer with a screenshot. Detect a video-only stream (no audio track) and prompt to retry with audio.
2. **No audio track ≠ error.** Chromium returns a stream with no audio track if the user forgot the checkbox. Check `stream.getAudioTracks().length` and re-prompt, don't silently record nothing.
3. **Browser gating.** Firefox/Safari can't capture tab audio at all. Detect and fall back to mic-only with an honest message rather than appearing broken.
4. **Echo / double-capture.** If the user has the meeting in the same tab and also has mic on, the mic may pick up speaker output. Mixing both streams is fine for transcription, but warn users on headphones-vs-speakers if accuracy suffers.
5. **Privacy + consent.** Recording other participants has legal/consent implications. Show a visible recording indicator and consider a consent acknowledgment, especially for the hosted product.
6. **Cost runaway.** Streaming bills per minute. Auto-stop on meeting end / tab blur / silence timeout. Surface elapsed minutes.

---

## 9. Risks

- **Low technical risk to existing code** (input-side only; AI pipeline untouched).
- **Medium UX risk** (the share-picker flow is inherently clunky; this is the main thing to nail).
- **Vendor lock-in is low** (token route + WS client are swappable behind one interface; build it vendor-agnostic).
- **Self-host story:** feature must be optional and key-gated, like AI notes, so OSS self-hosters without an STT key see it cleanly hidden.

---

## 10. Next actions when picked up

1. Re-confirm §4 open questions against live Deepgram + AssemblyAI streaming docs/pricing.
2. Record 2-3 real meeting clips; bench Deepgram vs AssemblyAI for WER/latency/cost.
3. Build Phase A (`useMeetingAudioCapture`) behind a feature flag; manually verify capture + mix in Chrome.
4. Build Phase B; verify the full loop: Record → live transcript → Stop → Enhance notes produces sane output.

---

### Sources (verified subset)

- getDisplayMedia audio support: https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support
- MDN getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- MDN Using Screen Capture: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture
- Mixing streams (createMediaStreamSource): https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamSource
- Deepgram token-based auth: https://developers.deepgram.com/guides/fundamentals/token-based-authentication
- Deepgram protecting API key: https://deepgram.com/learn/protecting-api-key
- Deepgram WebSocket protocol: https://developers.deepgram.com/docs/using-the-sec-websocket-protocol
- Deepgram WS error handling: https://developers.deepgram.com/docs/stt-troubleshooting-websocket-data-and-net-errors
- AssemblyAI temporary token: https://www.assemblyai.com/docs/streaming/authenticate-with-a-temporary-token
- STT accuracy benchmark (Nova-3 WER): https://arxiv.org/abs/2503.06924
- addpipe getDisplayMedia demo (practitioner): https://github.com/addpipe/getDisplayMedia-demo
