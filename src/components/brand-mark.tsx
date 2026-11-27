import { BRAND_CHEVRON_PATH, BRAND_PILL_PATH, BRAND_PLAY_PATH } from '../theme/app-icon'

/** FTube logo mark using the same SVG geometry and colors as the browser favicon. */
export const BrandMark = ({ className, width, height }: { className?: string, width: number, height: number }) => (
  <svg className={className} width={width} height={height} viewBox='0 4.75 32 22.5' aria-hidden='true'>
    <path
      d={BRAND_PILL_PATH}
      fill='var(--brand-mark, #ff0000)'
      stroke='var(--brand-mark-stroke, none)'
      strokeWidth='1'
    />
    <path d={BRAND_PLAY_PATH} fill='var(--brand-mark-ink, #ffffff)' />
    <path
      d={BRAND_CHEVRON_PATH}
      fill='none'
      stroke='var(--brand-mark-ink, #ffffff)'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
)
