// Checks the full npm packument (including `time` tombstones) to verify a version number can still be published.

/**
 * Decides whether `version` in `packument` can be published, skipped, or must be refused.
 *
 * @param packument parsed registry packument JSON, or null if unpublished
 * @param version   package.json version string
 * @returns {{ action: 'publish' | 'skip' | 'refuse', reason: string }}
 */
export const decide = (packument, version) => {
  if (!packument) return { action: 'publish', reason: 'the registry serves no package under this name yet' }
  if (packument.versions?.[version]) return { action: 'skip', reason: `${version} is already published` }
  if (packument.time?.[version]) {
    return {
      action: 'refuse',
      reason: `${version} was published on ${packument.time[version]} and unpublished. npm reserves the version forever; bump version first.`,
    }
  }
  return { action: 'publish', reason: `${version} has never been used` }
}

/** Fetches the full packument from npm, or returns null on 404. */
export const fetchPackument = async (name) => {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`registry answered ${response.status} for ${name}`)
  return response.json()
}

if (process.argv[1]?.endsWith('npm-version-gate.mjs')) {
  const [name, version] = process.argv.slice(2)
  if (!name || !version) {
    console.error('usage: npm-version-gate.mjs <package name> <version>')
    process.exit(1)
  }
  const { action, reason } = decide(await fetchPackument(name), version)
  console.error(`${name} ${version}: ${action}, ${reason}`)
  if (action === 'refuse') process.exit(1)
  console.log(`changed=${action === 'publish'}`)
}
