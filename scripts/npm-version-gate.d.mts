export interface VersionDecision {
  action: 'publish' | 'skip' | 'refuse'
  reason: string
}

export declare const decide: (
  packument: { versions?: Record<string, unknown>; time?: Record<string, string> } | null,
  version: string,
) => VersionDecision

export declare const fetchPackument: (name: string) => Promise<Record<string, unknown> | null>
