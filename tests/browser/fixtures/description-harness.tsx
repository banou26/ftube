import { render } from 'preact'

import { DescriptionBox } from '../../../src/components/description-box'

type PanelDescriptionOptions = {
  viewCountText?: string | null
  publishedDateText?: string | null
  likeCount?: number | null
  likeCountText?: string | null
}

// served by the dev server and imported from a spec: the full screen panel's description, as wide as youtube.com's, with a text of `lines` lines
export const mountPanelDescription = (lines: number, options?: PanelDescriptionOptions) => {
  const host = document.createElement('div')
  host.setAttribute('data-description-harness', '')
  host.style.width = '286px'
  document.body.append(host)
  const description = Array.from({ length: lines }, (_, index) => `Line ${index + 1}`).join('\n')
  render(<DescriptionBox description={description} open {...options} />, host)
}
