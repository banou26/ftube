import type { ComponentChildren, FunctionComponent } from 'preact'

import { css } from '@emotion/react'
import { CircleUserRound } from 'lucide-react'

import { signIn } from '../sign-in'

type PromptIcon = FunctionComponent<{ size?: number, strokeWidth?: number }>

const style = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 52rem;
  margin: 0 auto;
  padding: 8.8rem 1.6rem 4.8rem;
  text-align: center;

  > .prompt-icon {
    margin-bottom: 2.4rem;
    color: var(--text-primary);
  }

  > .prompt-icon svg {
    display: block;
  }

  > h2 {
    margin: 0;
    font-size: 2.4rem;
    font-weight: 700;
    line-height: 3.2rem;
    color: var(--text-primary);
  }

  > .prompt-subtitle {
    margin: 1.2rem 0 0;
    font-size: 1.4rem;
    line-height: 2rem;
    color: var(--text-secondary);
  }

  > .prompt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.2rem;
    max-width: 100%;
    margin-top: 2.4rem;
  }

  > .prompt-actions .sign-in {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    min-height: 3.6rem;
    max-width: 100%;
    margin-top: 0;
    padding: 0.6rem 1.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 1.8rem;
    background: transparent;
    color: var(--accent);
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  > .prompt-actions .sign-in svg {
    flex: none;
  }

  > .prompt-actions .sign-in:hover {
    background: var(--accent-hover);
    border-color: transparent;
  }

  > .prompt-actions .sign-in:disabled {
    cursor: default;
    opacity: 0.6;
  }

  @media (max-width: 656px) {
    padding: 4.8rem 0 3.2rem;
  }
`

/**
 * Centered signed-out empty state for feed pages: a large icon, heading, subtitle, and Sign in pill button.
 * Pass `actions` for extra controls beside Sign in and `children` for status notices below the action row.
 */
export const SignedOutPrompt = ({
  icon: Icon,
  title,
  subtitle,
  onSignIn = signIn,
  actions,
  children,
}: {
  icon: PromptIcon
  title: string
  subtitle: string
  onSignIn?: () => void
  actions?: ComponentChildren
  children?: ComponentChildren
}) => (
  <div css={style} className='signed-out-prompt'>
    <span className='prompt-icon' aria-hidden='true'>
      <Icon size={72} strokeWidth={1.25} />
    </span>
    <h2>{title}</h2>
    <p className='prompt-subtitle'>{subtitle}</p>
    <div className='prompt-actions'>
      <button type='button' className='sign-in' onClick={onSignIn}>
        <CircleUserRound size={24} strokeWidth={1.5} aria-hidden='true' />
        Sign in
      </button>
      {actions}
    </div>
    {children}
  </div>
)
