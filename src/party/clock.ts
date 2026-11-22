// Clock offset estimation between a guest and the host using Cristian's algorithm.

export type ClockSample = {
  /** Round trip time in milliseconds; lower means tighter error bound. */
  rtt: number
  /** Add to a local timestamp to estimate the host's clock. */
  offset: number
}

/** Samples with a round trip at or above this ceiling are ignored as congested or stalled. */
export const MAX_USABLE_RTT_MS = 10_000

/** Computes a single offset sample from local send/receive timestamps and the host's reply timestamp. */
export const clockSample = (sent: number, hostAt: number, received: number): ClockSample => ({
  rtt: received - sent,
  offset: hostAt - (sent + received) / 2,
})

/** Picks the usable sample with the lowest round trip time. */
export const bestSample = (samples: readonly ClockSample[]): ClockSample | undefined => {
  let best: ClockSample | undefined
  for (const sample of samples) {
    if (!Number.isFinite(sample.rtt) || !Number.isFinite(sample.offset)) continue
    if (sample.rtt < 0 || sample.rtt >= MAX_USABLE_RTT_MS) continue
    if (!best || sample.rtt < best.rtt) best = sample
  }
  return best
}

/** Converts a host timestamp onto this browser's clock. */
export const toLocalTime = (hostAt: number, offset: number): number => hostAt - offset

/** Converts a local timestamp onto the host's clock. */
export const toHostTime = (localAt: number, offset: number): number => localAt + offset
