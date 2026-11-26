import { render } from 'preact'
import { useState } from 'preact/hooks'
import { Client, fetchExchange, Provider } from 'urql'

import { CustomAppearance } from '../../../src/components/custom-appearance'
import { EmojiButton } from '../../../src/components/emoji-picker'
import { GroupDialog } from '../../../src/components/group-dialog'
import { DEFAULT_SETTINGS, type Settings } from '../../../src/settings'

const CUSTOM_SVG = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ff4444"/></svg>',
)

const EmojiPickerHarness = ({ onPicked }: { onPicked: (value: string) => void }) => {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS }))
  const [groupOpen, setGroupOpen] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <EmojiButton
          customEmojis={[{ id: 'ce-1', shortcut: ':party:', url: CUSTOM_SVG }]}
          onPick={onPicked}
        />
        <button type='button' onClick={() => setGroupOpen(true)}>
          Open group dialog
        </button>
      </div>
      <div data-testid='seek-handle-state'>
        {settings.seekHandle.kind === 'emoji' ? settings.seekHandle.value : settings.seekHandle.kind}
      </div>
      <CustomAppearance
        settings={settings}
        onUpdate={(patch: Partial<Settings>) => setSettings(current => ({ ...current, ...patch }))}
      />
      {groupOpen ? <GroupDialog onClose={() => setGroupOpen(false)} /> : undefined}
    </div>
  )
}

export const mountEmojiPickerHarness = () => {
  document.querySelector('[data-emoji-harness]')?.remove()
  const container = document.createElement('div')
  container.setAttribute('data-emoji-harness', 'true')
  container.style.maxWidth = '720px'
  container.style.padding = '16px'
  ;(document.querySelector('main') ?? document.body).prepend(container)

  const picked: string[] = []
  const client = new Client({
    url: '/emoji-harness',
    exchanges: [fetchExchange],
    preferGetMethod: false,
    fetch: async (_url, init) => {
      const { operationName } = JSON.parse(init?.body as string) as { operationName: string }
      if (operationName === 'Session') {
        return new Response(JSON.stringify({
          data: { session: { signedIn: false, name: null, avatar: null, handle: null, accounts: [] } },
        }), { headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: null }), { headers: { 'content-type': 'application/json' } })
    },
  })

  render(
    <Provider value={client}>
      <EmojiPickerHarness onPicked={(value: string) => picked.push(value)} />
    </Provider>,
    container,
  )

  return {
    picked: () => [...picked],
  }
}
