import { describe, expect, it, vi } from 'vite-plus/test'

type Element = { type: unknown, props: Record<string, unknown> }

const Link = () => null
const element = (type: unknown, props: Record<string, unknown>): Element => ({ type, props })

// wouter, emotion and video-card pull in `react` / UI trees only aliased in the app build
vi.mock('wouter', () => ({ Link }))
vi.mock('../../../src/components/video-card', () => ({ watchHrefFor: (id: string) => `/watch?v=${id}` }))
vi.mock('@emotion/react', () => ({ css: () => undefined }))
vi.mock('@emotion/react/jsx-runtime', () => ({ jsx: element, jsxs: element }))
vi.mock('@emotion/react/jsx-dev-runtime', () => ({ jsxDEV: element }))

const { browseHrefFor, RichText } = await import('../../../src/components/rich-text')

describe('browseHrefFor', () => {
  it('routes hashtag browse ids to tag search instead of /channel/FEhashtag', () => {
    expect(browseHrefFor('FEhashtag', '#nevergonnagiveyouup')).toBe('/results?search_query=%23nevergonnagiveyouup')
    expect(browseHrefFor('FEhashtag', '  #RickAstley  ')).toBe('/results?search_query=%23RickAstley')
  })

  it('drops invalid or non-channel FE browse ids instead of linking to broken channel pages', () => {
    expect(browseHrefFor('FEhashtag', '#')).toBeUndefined()
    expect(browseHrefFor('FEhashtag', 'plain')).toBeUndefined()
    expect(browseHrefFor('FEexplore', 'Explore')).toBeUndefined()
  })

  it('routes playlist VL browse ids and channel UC browse ids', () => {
    expect(browseHrefFor('VLPL123', 'My list')).toBe('/playlist?list=PL123')
    expect(browseHrefFor('VL', 'My list')).toBeUndefined()
    expect(browseHrefFor('UCuAXFkgsw1L7xaCfnd5JJOw', 'Rick Astley')).toBe('/channel/UCuAXFkgsw1L7xaCfnd5JJOw')
  })

  it('renders a Link to tag search for FEhashtag runs and plain span for dropped FE runs', () => {
    const rendered = RichText({
      runs: [
        { text: '#rock', browseId: 'FEhashtag' },
        { text: 'Explore', browseId: 'FEexplore' },
      ],
    }) as unknown as { props: { children: Element[] } }
    expect(rendered.props.children[0]).toMatchObject({ type: Link, props: { href: '/results?search_query=%23rock', children: '#rock' } })
    expect(rendered.props.children[1]).toMatchObject({ type: 'span', props: { children: 'Explore' } })
  })
})
