export interface PackageTree {
  read: (path: string) => string | undefined
  exists: (path: string) => boolean
  sizeOf: (path: string) => number
  files: () => string[]
}

export declare const readTree: (root: string) => PackageTree
export declare const packageProblems: (
  pkg: Record<string, unknown>,
  repo: Record<string, unknown>,
  tree: PackageTree,
) => string[]
