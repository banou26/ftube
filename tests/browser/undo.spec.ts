import { expect, test } from './test'

test.use({ viewport: { width: 1440, height: 900 } })

test('undoes adding a channel to a group via toast Undo button and Ctrl+Z, while ignoring inputs', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('yt-client:groups', JSON.stringify([{
      id: 'g-tech',
      name: 'Tech',
      emoji: '💻',
      channels: [{ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', name: 'Alpha Tech' }],
      updatedAt: Date.now(),
    }]))
  })

  await page.goto('/feed/channels')
  await expect(async () => {
    const host = page.locator('[data-channels-harness]')
    if (await host.count() === 0) {
      await page.evaluate(async (path) => {
        const harness = await import(path) as typeof import('./fixtures/menu-data-harness')
        harness.mountChannelsSurface()
      }, '/tests/browser/fixtures/menu-data-harness.tsx')
    }
    await expect(host).toBeAttached({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })

  const harness = page.locator('[data-channels-harness]')
  await harness.getByLabel('Filter by group').selectOption('ungrouped')
  const rows = harness.locator('.list .row')
  await expect(rows).toHaveCount(2)

  // 1. Add Beta Music to Tech via Groups menu -> disappears from ungrouped -> click toast Undo
  const betaRow = rows.filter({ hasText: 'Beta Music' })
  await betaRow.getByRole('button', { name: 'Groups', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Tech' }).click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)

  const undoBtn = page.getByRole('status').getByRole('button', { name: 'Undo' })
  await expect(undoBtn).toBeVisible()
  await undoBtn.click()
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Beta Music' })).toBeVisible()

  // 2. Add Beta Music again -> focus search input and press Ctrl/Meta+Z (must NOT undo group edit)
  await rows.filter({ hasText: 'Beta Music' }).getByRole('button', { name: 'Groups', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Tech' }).click()
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(1)

  const filterInput = harness.getByRole('searchbox', { name: 'Filter channels' })
  await filterInput.focus()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows).toHaveCount(1)

  // 3. Blur input and press Ctrl/Meta+Z -> undoes adding Beta Music to Tech
  await filterInput.blur()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: 'Beta Music' })).toBeVisible()
})

test('undoes deleting a group with subfolders from /feed/groups via toast Undo', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now()
    localStorage.setItem('yt-client:groups', JSON.stringify([
      { id: 'g-parent', name: 'Gaming', emoji: '🎮', channels: [], updatedAt: now },
      { id: 'g-child', name: 'Trailers', emoji: '🎬', parentId: 'g-parent', channels: [], updatedAt: now },
    ]))
  })

  await page.goto('/feed/groups')
  const main = page.locator('main')
  await expect(main.getByRole('link', { name: /Gaming/ })).toBeVisible()
  await main.getByRole('button', { name: 'Delete Gaming' }).click()
  await page.getByRole('dialog', { name: 'Delete Gaming?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(main.getByRole('link', { name: /Gaming/ })).toHaveCount(0)

  const undoBtn = page.getByRole('status').getByRole('button', { name: 'Undo' })
  await expect(undoBtn).toBeVisible()
  await undoBtn.click()
  await expect(main.locator('li[data-depth="0"]').getByRole('link', { name: /Gaming/ })).toBeVisible()
  await expect(main.locator('li[data-depth="1"]').getByRole('link', { name: /Trailers/ })).toBeVisible()
})

test('expires undo after the toast disappears and stops Ctrl+Z from restoring expired deletions', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now()
    localStorage.setItem('yt-client:groups', JSON.stringify([
      { id: 'g-expire', name: 'ExpireGroup', emoji: '⌛', channels: [], updatedAt: now },
    ]))
  })

  await page.goto('/feed/groups')
  const main = page.locator('main')
  await expect(main.getByRole('link', { name: /ExpireGroup/ })).toBeVisible()
  await main.getByRole('button', { name: 'Delete ExpireGroup' }).click()
  await page.getByRole('dialog', { name: 'Delete ExpireGroup?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(main.getByRole('link', { name: /ExpireGroup/ })).toHaveCount(0)

  const undoBtn = page.getByRole('status').getByRole('button', { name: 'Undo' })
  await expect(undoBtn).toBeVisible()
  await expect(undoBtn).toBeHidden({ timeout: 8_000 })

  await page.keyboard.press('ControlOrMeta+z')
  await expect(main.getByRole('link', { name: /ExpireGroup/ })).toHaveCount(0)
})

const PLAYLIST_HARNESS = '/tests/browser/fixtures/playlist-undo-harness.tsx'

test('restores removed playlist rows in original position (middle, first, last) on Undo', async ({ page }) => {
  await page.route('**/youtubei/v1/player*', route => route.abort())
  await page.goto('/privacy')
  await page.evaluate(async (path) => {
    history.replaceState(null, '', '/playlist?list=PL-undo-order')
    const mod = await import(path) as typeof import('./fixtures/playlist-undo-harness')
    mod.mountPlaylistUndoHarness()
  }, PLAYLIST_HARNESS)

  const harness = page.locator('[data-playlist-undo-harness]')
  const titles = () => harness.locator('.rows .row [aria-label^="Remove "]').evaluateAll(
    els => els.map(el => el.getAttribute('aria-label')?.replace(/^Remove /, '').replace(/ from this playlist$/, '') ?? ''),
  )

  try {
    await expect(harness.locator('.rows .row')).toHaveCount(3, { timeout: 30_000 })
    expect(await titles()).toEqual(['Alpha Video', 'Beta Video', 'Gamma Video'])

    // 1. Middle row removal -> Undo moves new entry back after predecessor s1
    await harness.getByRole('button', { name: 'Remove Beta Video from this playlist' }).click()
    await expect(harness.locator('.rows .row')).toHaveCount(2)
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).last().click()
    await expect(harness.locator('.rows .row')).toHaveCount(3)
    expect(await titles()).toEqual(['Alpha Video', 'Beta Video', 'Gamma Video'])

    // 2. First row removal -> Undo moves new entry to index 0 (afterSetVideoId omitted)
    await harness.getByRole('button', { name: 'Remove Alpha Video from this playlist' }).click()
    await expect(harness.locator('.rows .row')).toHaveCount(2)
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).last().click()
    await expect(harness.locator('.rows .row')).toHaveCount(3)
    expect(await titles()).toEqual(['Alpha Video', 'Beta Video', 'Gamma Video'])

    // 3. Last row removal -> Undo restores at end without calling movePlaylistItem
    await harness.getByRole('button', { name: 'Remove Gamma Video from this playlist' }).click()
    await expect(harness.locator('.rows .row')).toHaveCount(2)
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).last().click()
    await expect(harness.locator('.rows .row')).toHaveCount(3)
    expect(await titles()).toEqual(['Alpha Video', 'Beta Video', 'Gamma Video'])

    const moves = await page.evaluate(() => window.__playlistUndoHarness?.moves ?? [])
    expect(moves).toEqual([
      { playlistId: 'PL-undo-order', setVideoId: 'added-s-1', afterSetVideoId: 's1' },
      { playlistId: 'PL-undo-order', setVideoId: 'added-s-2', afterSetVideoId: undefined },
    ])
  } finally {
    await page.evaluate(() => window.__playlistUndoHarness?.cleanup())
  }
})
