import type { TargetedEvent } from 'preact'

import type {
  ChatLineMessage,
  ChatPoll,
  ChatRow,
  ChatRun,
  ViewerIdentity,
} from './use-live-chat-session'

import { css } from '@emotion/react'
import {
  BadgeCheck,
  BarChart2,
  Check,
  ChevronDown,
  ChevronUp,
  Crown,
  Gift,
  Heart,
  Info,
  Lock,
  MessageSquare,
  Pin,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wrench,
  X,
} from 'lucide-react'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { Link } from 'wouter'

import { lineFor } from './data-failure'
import { EmojiButton, type CustomEmoji } from './emoji-picker'
import { isSelfMention, splitMentionRuns } from './live-chat-helpers'
import {
  OVERLAY_EMOJI_ANIMATIONS,
  OVERLAY_FONT_FAMILIES,
  OVERLAY_FONT_STACKS,
  OVERLAY_TEXT_ANIMATIONS,
  OVERLAY_TYPE_ANIMATION_FIELDS,
  type OverlayEmojiAnimation,
  type OverlayFontFamily,
  type OverlayTextAnimation,
  resetOverScreenSettings,
  updateOverScreenSettings,
  useOverScreenSettings,
} from './over-screen-messages'
import { OverScreenOverlay } from './over-screen-overlay'
import { PreviewSelect } from './preview-select'
import { RichText } from './rich-text'
import { Menu, MenuItem } from './ui/menu'
import {
  LIVE_CHAT_VIEWS,
  LIVE_REACTIONS,
  TRANSCRIPT_LIMIT,
  useLiveChatSession,
  usePinnedLog,
} from './use-live-chat-session'

export { LIVE_REACTIONS, TRANSCRIPT_LIMIT, usePinnedLog }
export type { ChatLineMessage, ChatRow }

export const chatStyles = css`
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 1.2rem;
  background: var(--bg-subtle);
  overflow: hidden;
  /* youtube.com's chat panel, live or replay, at any window height (measured 2026-11-10) */
  height: 59.6rem;

  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.4rem 0.4rem 0.8rem;
    border-bottom: 1px solid var(--border);
    font-size: 1.4rem;
    font-weight: 500;
  }

  .head .view,
  .head .close {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    background: none;
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    border-radius: 1.8rem;
  }

  .head .view {
    padding: 0.6rem 0.8rem;
    font-size: 1.5rem;
    font-weight: 500;
  }

  .head .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
  }

  .head .top-fans-btn,
  .head .over-screen-btn,
  .head .over-screen-customize-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 1.4rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .head .over-screen-customize-btn {
    padding: 0.45rem 0.65rem;
  }

  .head .over-screen-btn.active {
    background: var(--accent-tint);
    border-color: var(--accent);
  }

  .head .top-fans-btn:hover,
  .head .top-fans-btn[aria-expanded='true'],
  .head .over-screen-btn:hover,
  .head .over-screen-customize-btn:hover,
  .head .over-screen-customize-btn[aria-expanded='true'] {
    background: var(--bg-hover);
  }

  .head .over-screen-btn.active:hover {
    background: var(--accent-tint);
  }

  .head .close {
    padding: 0.8rem;
  }

  .head .view:hover,
  .head .close:hover {
    background: var(--bg-hover);
  }

  .head .ended-badge {
    margin-left: 0.4rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    font-weight: 400;
  }

  .pinned-banner {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.8rem 1.2rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
    font-size: 1.3rem;
  }

  .pinned-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--text-secondary);
    font-size: 1.2rem;
    font-weight: 500;
  }

  .pinned-head-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: auto;
  }

  .pin-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .pin-icon-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .pinned-body {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
  }

  .avatar-link {
    display: inline-flex;
    flex: none;
    border-radius: 50%;
    text-decoration: none;
    cursor: pointer;
  }

  .avatar-link:hover {
    opacity: 0.85;
  }

  .avatar-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .pinned-body img.avatar,
  .pinned-body span.avatar,
  .pinned-body .avatar-link {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    flex: none;
  }

  .pinned-content {
    flex: 1;
    min-width: 0;
    line-height: 1.8rem;
  }

  .pinned-content.clamped {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .log-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .log {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.6rem 0;
    display: flex;
    flex-direction: column;
  }

  /* youtube.com's line: 32 px for a one-line message */
  .row {
    display: grid;
    grid-template-columns: 2.4rem 1fr;
    column-gap: 1.2rem;
    padding: 0.4rem 1.6rem;
    font-size: 1.35rem;
    line-height: 2rem;
  }

  .row img.avatar,
  .row > span.avatar,
  .row > .avatar-link {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 50%;
    grid-row: 1 / span 2;
  }

  .row.paid .paid-head .avatar-link {
    width: 2.4rem;
    height: 2.4rem;
    grid-row: auto;
  }

  .avatar-link > .avatar {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }

  .who {
    color: var(--text-secondary);
    font-weight: 500;
    margin-right: 0.6rem;
  }

  .who-btn {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .who-btn:hover {
    text-decoration: underline;
  }

  .who.owner { color: #ffd600; }
  .who.moderator { color: #5e84f1; }
  .who.member { color: #2ba640; }

  .mention {
    padding: 0.1rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font-weight: 500;
  }

  .mention.self {
    background: var(--accent-tint);
    color: var(--accent);
  }

  /* A paid message is a coloured card rather than a line, which is the whole
     point of paying for it. */
  .row.paid {
    display: block;
    margin: 0.4rem 1.2rem;
    padding: 0;
    border-radius: 0.8rem;
    overflow: hidden;
  }

  .row.paid .paid-head {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    font-weight: 700;
  }

  .row.paid .paid-head .who-btn {
    color: inherit;
    margin-right: 0;
  }

  .row.paid .paid-body {
    padding: 0.8rem 1rem;
  }

  .row.paid .paid-body:empty { display: none; }

  .emoji {
    display: inline-block;
    width: 1.8rem;
    height: 1.8rem;
    vertical-align: -0.35rem;
  }

  .reaction-stage {
    position: absolute;
    right: 1.2rem;
    bottom: 0.8rem;
    width: 6.4rem;
    height: 14rem;
    pointer-events: none;
    overflow: hidden;
  }

  .reaction-particle {
    position: absolute;
    bottom: 0.4rem;
    font-size: 2rem;
    line-height: 1;
    animation: reaction-float 1.7s ease-out forwards;
  }

  @keyframes reaction-float {
    0% {
      opacity: 0;
      transform: translateY(0) scale(0.8);
    }

    15% {
      opacity: 1;
      transform: translateY(-1.8rem) scale(1);
    }

    100% {
      opacity: 0;
      transform: translateY(-11rem) scale(1.05);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reaction-particle {
      animation: reaction-fade 1.2s ease-out forwards;
    }

    @keyframes reaction-fade {
      0% { opacity: 1; }
      100% { opacity: 0; }
    }
  }

  .compose-shell {
    position: relative;
    border-top: 1px solid var(--border);
  }

  .mention-menu {
    position: absolute;
    left: 0.8rem;
    right: 0.8rem;
    bottom: calc(100% + 0.4rem);
    max-height: 22rem;
    overflow-y: auto;
    padding: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-menu);
    box-shadow: var(--shadow-menu);
    z-index: 2;
  }

  .mention-option {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.6rem 0.8rem;
    border: none;
    border-radius: 0.6rem;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    font-size: 1.3rem;
    text-align: left;
    cursor: pointer;
  }

  .mention-option:hover,
  .mention-option[aria-selected='true'] {
    background: var(--bg-hover);
  }

  .mention-option img {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 50%;
    flex: none;
  }

  .mention-option .name {
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mention-option .handle {
    margin-left: auto;
    color: var(--text-secondary);
    font-size: 1.2rem;
    white-space: nowrap;
  }

  .reaction-control {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: none;
  }

  .reaction-tray {
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.6rem);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 999rem;
    background: var(--bg-elevated);
    box-shadow: var(--shadow-menu, 0 4px 16px rgba(0, 0, 0, 0.35));
    z-index: 6;
  }

  .reaction-tray::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    height: 0.8rem;
  }

  .reaction-pick {
    width: 3.2rem;
    height: 3.2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    font-size: 1.7rem;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .reaction-pick:hover {
    background: var(--bg-hover);
  }

  .compose {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.6rem 0.8rem;
  }

  .compose input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border);
    color: inherit;
    font: inherit;
    font-size: 1.3rem;
    padding: 0.4rem 0;
  }

  .compose input:focus {
    outline: none;
    border-bottom-color: var(--text-primary);
  }

  .compose .send-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
    font-size: 1.3rem;
    font-weight: 500;
    padding: 0.4rem 0.8rem;
    border-radius: 1.6rem;
  }

  .compose .send-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .compose .send-btn:disabled { opacity: 0.5; cursor: default; }

  .reaction-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0.4rem 0.8rem;
    border-top: 1px solid var(--border);
  }

  .reaction-toggle {
    flex: none;
    width: 3.6rem;
    height: 3.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }

  .reaction-toggle:hover,
  .reaction-toggle[aria-expanded='true'] {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .badges {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-right: 0.5rem;
    vertical-align: middle;
  }

  .badge-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.55rem;
    border: none;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.5;
    vertical-align: middle;
  }

  button.badge-chip {
    cursor: pointer;
  }

  button.badge-chip:hover {
    filter: brightness(1.08);
  }

  .badge-icon {
    width: 1.5rem;
    height: 1.5rem;
    object-fit: contain;
    vertical-align: -0.25rem;
  }

  .role-icon {
    flex: none;
    vertical-align: -0.15rem;
  }

  .role-icon.owner { color: #ffd600; }
  .role-icon.moderator { color: #5e84f1; }
  .role-icon.verified { color: var(--text-secondary); }

  .row.system {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    margin: 0.3rem 1.2rem;
    padding: 0.6rem 1rem;
    border-radius: 0.8rem;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 1.25rem;
    line-height: 1.8rem;
  }

  .row.system svg {
    flex: none;
    margin-top: 0.2rem;
  }

  .row.gift {
    margin: 0.3rem 1.2rem;
    padding: 0.6rem 1rem;
    border-radius: 0.8rem;
    background: var(--bg-elevated);
  }

  .row.gift .gift-body {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .row.gift .gift-icon {
    color: var(--text-secondary);
    vertical-align: -0.2rem;
  }

  .row.paid .paid-head-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.1rem;
  }

  .row.paid .paid-sub {
    font-size: 1.2rem;
    font-weight: 400;
    opacity: 0.9;
  }

  .row.paid.sticker .sticker-body {
    display: flex;
    justify-content: center;
    padding: 0.8rem 1rem 1rem;
  }

  .sticker-img {
    width: 6.4rem;
    height: 6.4rem;
    object-fit: contain;
  }

  .ticker-strip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.6rem 1.2rem;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    scrollbar-width: none;
  }

  .ticker-strip::-webkit-scrollbar {
    display: none;
  }

  .ticker-pill {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.3rem 0.9rem 0.3rem 0.4rem;
    border: none;
    border-radius: 999px;
    font: inherit;
    font-size: 1.2rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.12s ease, opacity 0.12s ease;
  }

  .ticker-pill:hover {
    opacity: 0.92;
  }

  .ticker-pill img {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .ticker-detail {
    display: flex;
    align-items: flex-start;
    gap: 0.8rem;
    padding: 0.7rem 1.2rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elevated);
    font-size: 1.25rem;
  }

  .ticker-detail-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .ticker-detail-text strong {
    font-weight: 600;
  }

  .ticker-detail-text span {
    color: var(--text-secondary);
  }

  .poll-card {
    margin: 0.6rem 1rem 0;
    padding: 0.9rem 1.1rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .poll-head {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    font-size: 1.3rem;
    font-weight: 600;
    line-height: 1.8rem;
  }

  .poll-head > svg {
    flex: none;
    margin-top: 0.2rem;
    color: var(--text-secondary);
  }

  .poll-title {
    flex: 1;
    min-width: 0;
  }

  .poll-meta {
    color: var(--text-secondary);
    font-size: 1.15rem;
  }

  .poll-choices {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .poll-choice {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    width: 100%;
    padding: 0.6rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.8rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.25rem;
    text-align: left;
    cursor: pointer;
  }

  .poll-choice:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .poll-choice[data-selected='true'] {
    border-color: var(--text-primary);
    font-weight: 600;
  }

  .poll-choice:disabled {
    cursor: default;
  }

  .poll-choice-bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--bg-hover-strong);
    opacity: 0.65;
    pointer-events: none;
    transition: width 0.2s ease;
  }

  .poll-choice-label,
  .poll-choice-pct {
    position: relative;
    z-index: 1;
  }

  .poll-choice-label {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .poll-choice-pct {
    flex: none;
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .leaderboard-panel {
    position: absolute;
    inset: 4.5rem 0 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    background: var(--bg-subtle);
  }

  .leaderboard-head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.8rem 1.2rem;
    border-bottom: 1px solid var(--border);
    font-size: 1.4rem;
    font-weight: 600;
  }

  .leaderboard-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: auto;
  }

  .leaderboard-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.6rem 0;
  }

  .leaderboard-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 1.4rem;
    font-size: 1.3rem;
  }

  .leaderboard-rank {
    min-width: 2.4rem;
    color: var(--text-secondary);
    font-weight: 600;
  }

  .leaderboard-avatar {
    width: 2.8rem;
    height: 2.8rem;
    border-radius: 50%;
    object-fit: cover;
    flex: none;
  }

  .leaderboard-name {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    overflow: hidden;
  }

  .leaderboard-name > span:first-of-type {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .leaderboard-points {
    flex: none;
    color: var(--text-secondary);
    font-size: 1.2rem;
  }

  .over-screen-panel {
    position: absolute;
    inset: 4.5rem 0 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    background: var(--bg-subtle);
  }

  .over-screen-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.2rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }

  .over-screen-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.2rem;
    font-size: 1.3rem;
  }

  .over-screen-subrow {
    padding-left: 1.2rem;
    color: var(--text-secondary);
  }

  .over-screen-row input[type='range'] {
    font: inherit;
    font-size: 1.25rem;
  }

  .over-screen-range {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
  }

  .over-screen-range input[type='range'] {
    width: 11rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .over-screen-range span {
    min-width: 4.2rem;
    text-align: right;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .over-screen-check {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .over-screen-check input {
    width: 1.6rem;
    height: 1.6rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .over-screen-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border);
  }

  .over-screen-action {
    height: 3.2rem;
    padding: 0 1.2rem;
    border: 1px solid var(--border);
    border-radius: 1.6rem;
    background: var(--bg-chip);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.25rem;
    font-weight: 500;
    cursor: pointer;
  }

  .over-screen-action:hover {
    background: var(--bg-chip-hover);
  }

  .over-screen-action.primary {
    background: var(--accent-tint);
    border-color: var(--accent);
  }

  .slow-mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.4rem 1.2rem 0;
    color: var(--text-secondary);
    font-size: 1.15rem;
  }

  .restricted-bar {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    padding: 0.8rem 1rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 1.25rem;
  }

  .restricted-bar > svg {
    flex: none;
  }

  .restricted-text {
    flex: 1;
    min-width: 0;
    line-height: 1.7rem;
  }

  .refresh-chat-btn,
  .signin-link {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 1.6rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
  }

  .refresh-chat-btn:hover:not(:disabled),
  .signin-link:hover {
    background: var(--bg-hover);
  }

  .refresh-chat-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .notice {
    padding: 1.6rem 1.2rem;
    color: var(--text-secondary);
    font-size: 1.3rem;
    text-align: center;
  }

  .resume {
    border: none;
    background: var(--bg-inverse);
    color: var(--text-inverse);
    font: inherit;
    font-size: 1.2rem;
    font-weight: 500;
    padding: 0.5rem 1rem;
    margin: 0 1.2rem 0.8rem;
    border-radius: 1.6rem;
    cursor: pointer;
  }
`

const liveChatMobileStyle = css`
  @media (max-width: 999px) {
    height: 48rem;
  }
`

const teaserStyle = css`
  margin-bottom: 0.4rem;

  button {
    width: 100%;
    height: 3.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.8rem;
    border: 1px solid var(--border);
    border-radius: 1.9rem;
    background: var(--bg-subtle);
    color: var(--text-primary);
    font: inherit;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  button:hover {
    background: var(--bg-hover);
  }
`

const noop = () => {}

/** Collapsed control rendered in place of live chat when the viewer hides the chat panel. */
export const LiveChatTeaser = ({ onShow }: { onShow: () => void }) => (
  <div css={teaserStyle} className='live-chat-teaser'>
    <button type='button' onClick={onShow}>
      <MessageSquare size={18} strokeWidth={1.5} aria-hidden='true' />
      Show chat
    </button>
  </div>
)

const ChatLineBody = (
  { runs, self }: {
    runs: readonly ChatRun[]
    self?: ViewerIdentity
  },
) => (
  <RichText
    runs={runs}
    renderRun={(run: ChatRun, key: string) => {
      if (run.emojiUrl) {
        return <img key={key} className='emoji' src={run.emojiUrl} alt={run.emojiLabel ?? ''} loading='lazy' referrerpolicy='no-referrer' />
      }
      if (!run.url && !run.videoId && !run.browseId) {
        const parts = splitMentionRuns(run.text)
        if (parts.some((part) => Boolean(part.mention))) {
          return (
            <span key={key}>
              {parts.map((part, index) =>
                part.mention
                  ? (
                    <span
                      key={index}
                      className={isSelfMention(part.mention, self) ? 'mention self' : 'mention'}
                    >
                      {part.text}
                    </span>
                  )
                  : part.text)}
            </span>
          )
        }
      }
      return undefined
    }}
  />
)

const ChatBadges = (
  { badges, onTopFanClick }: {
    badges?: ChatRow['badges']
    onTopFanClick?: () => void
  },
) => {
  if (!badges?.length) return null
  return (
    <span className='badges'>
      {badges.map((badge, index) => {
        if (badge.kind === 'top-fan') {
          const style = {
            ...(badge.backgroundColor ? { background: badge.backgroundColor } : {}),
            ...(badge.textColor ? { color: badge.textColor } : {}),
          }
          if (onTopFanClick) {
            return (
              <button
                key={`top-fan-${index}`}
                type='button'
                className='badge-chip top-fan'
                style={style}
                title={`Top fan ${badge.label}`}
                aria-label={`Top fan ${badge.label}`}
                onClick={onTopFanClick}
              >
                <Crown size={11} strokeWidth={2} aria-hidden='true' />
                <span>{badge.label}</span>
              </button>
            )
          }
          return (
            <span key={`top-fan-${index}`} className='badge-chip top-fan' style={style}>
              <Crown size={11} strokeWidth={2} aria-hidden='true' />
              <span>{badge.label}</span>
            </span>
          )
        }
        if (badge.iconUrl) {
          return (
            <img
              key={`icon-${index}`}
              className='badge-icon'
              src={badge.iconUrl}
              alt={badge.label}
              title={badge.label}
              loading='lazy'
              referrerpolicy='no-referrer'
            />
          )
        }
        if (badge.kind === 'owner') {
          return <Crown key={`owner-${index}`} size={12} strokeWidth={2} className='role-icon owner' aria-label={badge.label} />
        }
        if (badge.kind === 'moderator') {
          return <Wrench key={`mod-${index}`} size={12} strokeWidth={2} className='role-icon moderator' aria-label={badge.label} />
        }
        if (badge.kind === 'verified') {
          return <BadgeCheck key={`verified-${index}`} size={12} strokeWidth={2} className='role-icon verified' aria-label={badge.label} />
        }
        return undefined
      })}
    </span>
  )
}

type ChatAvatarAuthor = {
  id?: string | null
  name?: string | null
  avatar?: string | null
}

const ChatAvatar = (
  { author, placeholder = false }: {
    author?: ChatAvatarAuthor | null
    placeholder?: boolean
  },
) => {
  const image = author?.avatar
    ? <img className='avatar' src={author.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
    : placeholder
      ? <span className='avatar' />
      : null
  if (!image) return null
  if (!author?.id) return image
  return (
    <Link
      href={`/channel/${encodeURIComponent(author.id)}`}
      className='avatar-link'
      aria-label={author.name ? `View ${author.name} channel` : 'View channel'}
    >
      {image}
    </Link>
  )
}

export const ChatLine = (
  { message, self, onAuthorClick, onTopFanClick }: {
    message: ChatLineMessage
    self?: ViewerIdentity
    onAuthorClick?: (author: NonNullable<ChatRow['author']>) => void
    onTopFanClick?: () => void
  },
) => {
  const roleClass = message.isOwner
    ? 'owner'
    : message.isModerator
      ? 'moderator'
      : message.isMember
        ? 'member'
        : ''
  const body = <ChatLineBody runs={message.runs} self={self} />
  const badges = <ChatBadges badges={message.badges} onTopFanClick={onTopFanClick} />
  const authorNode = message.author
    ? onAuthorClick
      ? (
        <button
          type='button'
          className={`who who-btn ${roleClass}`}
          title={message.timestampText ?? undefined}
          aria-label={`Mention ${message.author.name}`}
          onClick={() => onAuthorClick(message.author!)}
        >
          {message.author.name}
        </button>
      )
      : <span className={`who ${roleClass}`} title={message.timestampText ?? undefined}>{message.author.name}</span>
    : undefined

  if (message.kind === 'SYSTEM') {
    const restrictedIcon = Boolean(message.iconType && /LOCK|SLOW|SUBSCRIBER|MEMBER/i.test(message.iconType))
    return (
      <div className='row system' data-chat-id={message.id} data-chat-kind='system'>
        {restrictedIcon ? <Lock size={14} strokeWidth={1.75} aria-hidden='true' /> : <Info size={14} strokeWidth={1.75} aria-hidden='true' />}
        <div>{body}</div>
      </div>
    )
  }

  if (message.kind === 'STICKER' || message.stickerUrl) {
    return (
      <div className='row paid sticker' data-chat-id={message.id} data-chat-kind='sticker'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          <ChatAvatar author={message.author} />
          {badges}
          {authorNode}
          {message.purchaseAmountText ? <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span> : undefined}
        </div>
        <div className='paid-body sticker-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {message.stickerUrl
            ? <img className='sticker-img' src={message.stickerUrl} alt={message.stickerLabel ?? message.text} loading='lazy' referrerpolicy='no-referrer' />
            : body}
        </div>
      </div>
    )
  }

  if (message.kind === 'MEMBERSHIP' || message.kind === 'GIFT_MEMBERSHIP') {
    const subtitle = message.headerPrimaryText || message.headerSubtext
    const showSub = Boolean(subtitle && subtitle !== message.text)
    return (
      <div className='row paid membership' data-chat-id={message.id} data-chat-kind={message.kind === 'GIFT_MEMBERSHIP' ? 'gift-membership' : 'membership'}>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#0f7b3e', color: '#fff' }}
        >
          <ChatAvatar author={message.author} />
          <div className='paid-head-meta'>
            <div>
              {badges}
              {authorNode}
            </div>
            {showSub ? <span className='paid-sub'>{subtitle}</span> : undefined}
          </div>
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#139b4f', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }

  if (message.purchaseAmountText || message.kind === 'PAID') {
    return (
      <div className='row paid' data-chat-id={message.id} data-chat-kind='paid'>
        <div
          className='paid-head'
          style={{ background: message.headerBackgroundColor ?? '#1565c0', color: '#fff' }}
        >
          <ChatAvatar author={message.author} />
          {badges}
          {authorNode}
          {message.purchaseAmountText ? <span style={{ marginLeft: 'auto' }}>{message.purchaseAmountText}</span> : undefined}
        </div>
        <div className='paid-body' style={{ background: message.bodyBackgroundColor ?? '#1976d2', color: '#fff' }}>
          {body}
        </div>
      </div>
    )
  }

  if (message.kind === 'GIFT') {
    return (
      <div className='row gift' data-chat-id={message.id} data-chat-kind='gift'>
        <ChatAvatar author={message.author} placeholder />
        <div className='gift-body'>
          <Gift size={14} strokeWidth={1.75} className='gift-icon' aria-hidden='true' />
          {badges}
          {authorNode}
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className='row' data-chat-id={message.id}>
      <ChatAvatar author={message.author} placeholder />
      <div>
        {badges}
        {authorNode}
        {body}
      </div>
    </div>
  )
}

const LiveChatPollCard = (
  { poll, self, collapsed, onToggleCollapse, disabled, voting, onVote }: {
    poll: ChatPoll
    self?: ViewerIdentity
    collapsed: boolean
    onToggleCollapse: () => void
    disabled: boolean
    voting: boolean
    onVote: (choice: ChatPoll['choices'][number]) => void
  },
) => (
  <div className='poll-card' role='region' aria-label='Live poll'>
    <div className='poll-head'>
      <BarChart2 size={15} strokeWidth={1.75} aria-hidden='true' />
      <div className='poll-title'>
        {poll.questionRuns.length > 0 ? <ChatLineBody runs={poll.questionRuns} self={self} /> : poll.question}
      </div>
      <button
        type='button'
        className='pin-icon-btn'
        aria-label={collapsed ? 'Expand poll' : 'Collapse poll'}
        onClick={onToggleCollapse}
      >
        {collapsed ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronUp size={14} strokeWidth={1.75} />}
      </button>
    </div>
    {!collapsed
      ? (
        <>
          {poll.metadataText ? <div className='poll-meta'>{poll.metadataText}</div> : undefined}
          <div className='poll-choices'>
            {poll.choices.map((choice) => {
              const pct = Math.max(0, Math.min(100, Math.round((choice.voteRatio ?? 0) * 100)))
              const canVote = !disabled && !voting && !poll.finished && Boolean(choice.voteParams)
              return (
                <button
                  key={choice.id}
                  type='button'
                  className='poll-choice'
                  data-selected={choice.selected ? 'true' : undefined}
                  disabled={!canVote}
                  onClick={() => onVote(choice)}
                >
                  {choice.voteRatio !== null && choice.voteRatio !== undefined
                    ? <span className='poll-choice-bar' style={{ width: `${pct}%` }} aria-hidden='true' />
                    : undefined}
                  <span className='poll-choice-label'>
                    {choice.selected ? <Check size={13} strokeWidth={2.2} aria-hidden='true' /> : undefined}
                    {choice.runs.length > 0 ? <ChatLineBody runs={choice.runs} self={self} /> : choice.text}
                  </span>
                  {choice.votePercentage ? <span className='poll-choice-pct'>{choice.votePercentage}</span> : undefined}
                </button>
              )
            })}
          </div>
        </>
      )
      : undefined}
  </div>
)

/** Live stream chat panel with Top/Live filter switch, pinned banner, polls, Top fans leaderboard, restrictions, emoji picker, reactions, `@` mentions, and hide toggle. */
export const LiveChat = ({
  videoId,
  subscribed,
  hidden = false,
  paused = false,
  panelContainer,
  onHide,
  onShow,
  onCustomEmojis,
}: {
  videoId: string
  subscribed?: boolean
  hidden?: boolean
  paused?: boolean
  panelContainer?: Element | null
  onHide?: () => void
  onShow?: () => void
  onCustomEmojis?: (emojis: readonly CustomEmoji[]) => void
}) => {
  const overScreen = useOverScreenSettings()
  const panelHidden = hidden || panelContainer === null
  const {
    ready,
    signedIn,
    self,
    view,
    currentView,
    error,
    page,
    messages,
    activePinned,
    pinExpanded,
    setPinExpanded,
    setDismissedPinId,
    customEmojis,
    inputState,
    leaderboardEntry,
    leaderboardOpen,
    setLeaderboardOpen,
    leaderboardResult,
    leaderboardLoading,
    leaderboardError,
    leaderboardPanelRef,
    reexecuteLeaderboard,
    openLeaderboard,
    poll,
    pollCollapsed,
    setPollCollapsed,
    votingPoll,
    handleVotePoll,
    tickerItems,
    selectedTickerId,
    setSelectedTickerId,
    activeTicker,
    refreshing,
    refreshSession,
    slowModeLeft,
    ended,
    sending,
    draft,
    setDraft,
    setCaret,
    setDismissedMentionAt,
    setMentionIndex,
    canCompose,
    mentionSuggestions,
    mentionListId,
    activeMentionIdx,
    activeMentionOptionId,
    chooseMention,
    onInputKeyDown,
    pickEmoji,
    onAuthorClick,
    submit,
    reactionsOpen,
    setReactionsOpen,
    reactions,
    triggerReaction,
    overlayEvent,
    overlayResetSeq,
    logRef,
    onScroll,
    pinned,
    setPinned,
    inputRef,
    switchView,
    hideChat,
  } = useLiveChatSession({
    videoId,
    subscribed,
    hidden: panelHidden,
    scrollKey: panelContainer,
    keepAliveOnHide: overScreen.enabled,
    onHide,
  })
  const [reactionsHovered, setReactionsHovered] = useState(false)
  const [overScreenOpen, setOverScreenOpen] = useState(false)
  const [previewSeq, setPreviewSeq] = useState(0)
  const overScreenTriggerRef = useRef<HTMLButtonElement>(null)
  const overScreenPanelRef = useRef<HTMLDivElement>(null)
  const reactionControlRef = useRef<HTMLDivElement>(null)
  const reactionToggleRef = useRef<HTMLButtonElement>(null)
  const onCustomEmojisRef = useRef(onCustomEmojis)
  onCustomEmojisRef.current = onCustomEmojis

  useLayoutEffect(() => {
    if (!overScreenOpen) return
    const previous = document.activeElement as HTMLElement | null
    overScreenPanelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setOverScreenOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [overScreenOpen])

  useEffect(() => {
    onCustomEmojisRef.current?.(customEmojis)
  }, [customEmojis])

  const handleHide = () => {
    setOverScreenOpen(false)
    setLeaderboardOpen(false)
    setReactionsOpen(false)
    setReactionsHovered(false)
    hideChat()
  }

  const reactionsVisible = !ended && (reactionsOpen || reactionsHovered)

  useLayoutEffect(() => {
    if (!reactionsVisible || ended) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (reactionsOpen) {
        event.preventDefault()
        event.stopPropagation()
        setReactionsOpen(false)
        setReactionsHovered(false)
        reactionToggleRef.current?.focus()
      } else {
        setReactionsHovered(false)
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!reactionsOpen) return
      const target = event.target as Node | null
      if (target && reactionControlRef.current?.contains(target)) return
      setReactionsOpen(false)
      setReactionsHovered(false)
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [reactionsVisible, reactionsOpen, ended, setReactionsOpen])

  const reactionControl = !ended
    ? (
      <div
        ref={reactionControlRef}
        className='reaction-control'
        onMouseEnter={() => setReactionsHovered(true)}
        onMouseLeave={() => setReactionsHovered(false)}
      >
        <button
          ref={reactionToggleRef}
          type='button'
          className='reaction-toggle'
          aria-label='Reactions'
          aria-expanded={reactionsVisible}
          onClick={() => {
            if (reactionsOpen) {
              setReactionsOpen(false)
              setReactionsHovered(false)
            } else {
              setReactionsOpen(true)
            }
          }}
        >
          <Heart size={18} strokeWidth={1.5} />
        </button>
        {reactionsVisible
          ? (
            <div className='reaction-tray' role='group' aria-label='Local reactions'>
              {LIVE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type='button'
                  className='reaction-pick'
                  aria-label={`React ${emoji}`}
                  onClick={() => triggerReaction(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )
          : undefined}
      </div>
    )
    : undefined

  const panelView = hidden
    ? <LiveChatTeaser onShow={onShow ?? noop} />
    : (
      <section css={[chatStyles, liveChatMobileStyle]} className='live-chat' aria-label='Live chat'>
        <div className='head'>
        <Menu
          label='Live chat view'
          align='start'
          trigger={
            <button type='button' className='view'>
              {currentView.label}
              <ChevronDown size={20} strokeWidth={1.5} />
            </button>
          }
        >
          {LIVE_CHAT_VIEWS.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              checked={option.value === view}
              closeOnSelect
              onSelect={() => switchView(option.value)}
            />
          ))}
        </Menu>
        {ended ? <span className='ended-badge'>Ended</span> : undefined}
        <div className='head-actions'>
          {!page?.disabled
            ? (
              <>
                <button
                  type='button'
                  className={overScreen.enabled ? 'over-screen-btn active' : 'over-screen-btn'}
                  aria-label='Over-screen chat messages'
                  aria-pressed={overScreen.enabled}
                  title='Toggle over-screen live chat messages'
                  onClick={() => updateOverScreenSettings({ enabled: !overScreen.enabled })}
                >
                  <Sparkles size={13} strokeWidth={1.9} aria-hidden='true' />
                  <span>Over-screen</span>
                </button>
                <button
                  ref={overScreenTriggerRef}
                  type='button'
                  className='over-screen-customize-btn'
                  aria-label='Customize over-screen messages'
                  aria-expanded={overScreenOpen}
                  title='Customize over-screen messages'
                  onClick={() => {
                    setOverScreenOpen((open) => {
                      const next = !open
                      if (next) setLeaderboardOpen(false)
                      return next
                    })
                  }}
                >
                  <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden='true' />
                </button>
              </>
            )
            : undefined}
          {leaderboardEntry && !page?.disabled
            ? (
              <button
                type='button'
                className='top-fans-btn'
                aria-expanded={leaderboardOpen}
                onClick={() => {
                  if (leaderboardOpen) {
                    setLeaderboardOpen(false)
                  } else {
                    setOverScreenOpen(false)
                    openLeaderboard()
                  }
                }}
              >
                <Trophy size={13} strokeWidth={1.9} aria-hidden='true' />
                <span>{leaderboardEntry.label}</span>
              </button>
            )
            : undefined}
          {onHide
            ? (
              <button type='button' className='close' aria-label='Hide chat' onClick={handleHide}>
                <X size={20} strokeWidth={1.5} />
              </button>
            )
            : undefined}
        </div>
      </div>

      {page?.disabled
        ? <div className='notice'>Live chat is turned off for this stream.</div>
        : (
          <>
            {tickerItems.length > 0
              ? (
                <div className='ticker-strip' role='region' aria-label='Chat highlights'>
                  {tickerItems.map((item) => (
                    <button
                      key={item.id}
                      type='button'
                      className='ticker-pill'
                      style={{
                        background: item.backgroundColor ?? '#1565c0',
                        color: item.textColor ?? '#fff',
                      }}
                      aria-expanded={selectedTickerId === item.id}
                      onClick={() => setSelectedTickerId((cur) => (cur === item.id ? undefined : item.id))}
                    >
                      {item.avatar ? <img src={item.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' /> : undefined}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )
              : undefined}

            {activeTicker
              ? (
                <div className='ticker-detail' role='region' aria-label='Highlight detail'>
                  <div className='ticker-detail-text'>
                    <strong>{[activeTicker.authorName, activeTicker.label].filter(Boolean).join(' ')}</strong>
                    {activeTicker.detailText ? <span>{activeTicker.detailText}</span> : undefined}
                  </div>
                  <button
                    type='button'
                    className='pin-icon-btn ticker-detail-close'
                    aria-label='Close highlight'
                    onClick={() => setSelectedTickerId(undefined)}
                  >
                    <X size={14} strokeWidth={1.75} />
                  </button>
                </div>
              )
              : undefined}

            {activePinned
              ? (
                <div className='pinned-banner' role='region' aria-label='Pinned message'>
                  <div className='pinned-head'>
                    <Pin size={14} strokeWidth={1.75} aria-hidden='true' />
                    <span>{activePinned.header ?? 'Pinned message'}</span>
                    <div className='pinned-head-actions'>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label={pinExpanded ? 'Collapse pinned message' : 'Expand pinned message'}
                        onClick={() => setPinExpanded((value) => !value)}
                      >
                        {pinExpanded ? <ChevronUp size={14} strokeWidth={1.75} /> : <ChevronDown size={14} strokeWidth={1.75} />}
                      </button>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Dismiss pinned message'
                        onClick={() => setDismissedPinId(activePinned.id)}
                      >
                        <X size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <div className='pinned-body'>
                    <ChatAvatar author={activePinned.message.author} placeholder />
                    <div className={pinExpanded ? 'pinned-content' : 'pinned-content clamped'}>
                      {activePinned.message.author
                        ? <span className='who'>{activePinned.message.author.name}</span>
                        : undefined}
                      <ChatLineBody runs={activePinned.message.runs} self={self} />
                    </div>
                  </div>
                </div>
              )
              : undefined}

            {poll
              ? (
                <LiveChatPollCard
                  poll={poll}
                  self={self}
                  collapsed={pollCollapsed}
                  onToggleCollapse={() => setPollCollapsed((value) => !value)}
                  disabled={ended}
                  voting={votingPoll}
                  onVote={handleVotePoll}
                />
              )
              : undefined}

            <div className='log-wrap'>
              <div className='log' ref={logRef} onScroll={onScroll}>
                {messages.length === 0
                  ? (
                    <div className='notice'>
                      {error ? 'Reconnecting to live chat…' : 'Waiting for messages…'}
                    </div>
                  )
                  : messages.map((message) => (
                    <ChatLine
                      key={message.id}
                      message={message}
                      self={self}
                      onAuthorClick={canCompose ? onAuthorClick : undefined}
                      onTopFanClick={leaderboardEntry ? openLeaderboard : undefined}
                    />
                  ))}
              </div>
              {reactions.length > 0
                ? (
                  <div className='reaction-stage' aria-hidden='true'>
                    {reactions.map((item) => (
                      <span
                        key={item.id}
                        className='reaction-particle'
                        style={{ left: `${item.leftPx}px` }}
                      >
                        {item.emoji}
                      </span>
                    ))}
                  </div>
                )
                : undefined}
            </div>

            {!pinned && messages.length > 0
              ? <button type='button' className='resume' onClick={() => setPinned(true)}>Jump to latest</button>
              : undefined}

            {!ended && ready
              ? canCompose
                ? (
                  <div className='compose-shell'>
                    {mentionSuggestions.length > 0
                      ? (
                        <div id={mentionListId} className='mention-menu' role='listbox' aria-label='Mention suggestions'>
                          {mentionSuggestions.map((candidate, index) => (
                            <button
                              key={candidate.id}
                              id={`${mentionListId}-${index}`}
                              type='button'
                              role='option'
                              aria-selected={index === activeMentionIdx}
                              className='mention-option'
                              onMouseDown={(event: MouseEvent) => {
                                event.preventDefault()
                                chooseMention(candidate)
                              }}
                            >
                              {candidate.avatar ? <img src={candidate.avatar} alt='' referrerpolicy='no-referrer' /> : undefined}
                              <span className='name'>{candidate.name}</span>
                              {candidate.handle ? <span className='handle'>{candidate.handle}</span> : undefined}
                            </button>
                          ))}
                        </div>
                      )
                      : undefined}
                    {(inputState?.slowModeSeconds ?? 0) > 0 || slowModeLeft > 0
                      ? (
                        <div className='slow-mode-bar'>
                          <span>{(inputState?.slowModeSeconds ?? 0) > 0 ? `Slow mode (${inputState!.slowModeSeconds}s)` : 'Slow mode'}</span>
                          {slowModeLeft > 0 ? <span>Wait {slowModeLeft}s</span> : undefined}
                        </div>
                      )
                      : undefined}
                    <form className='compose' onSubmit={submit}>
                      <EmojiButton customEmojis={customEmojis} disabled={sending} onPick={pickEmoji} />
                      <input
                        ref={inputRef}
                        value={draft}
                        maxLength={inputState?.maxLength ?? 200}
                        placeholder={slowModeLeft > 0 ? `Slow mode: wait ${slowModeLeft}s…` : inputState?.placeholder || 'Chat…'}
                        aria-autocomplete='list'
                        aria-expanded={mentionSuggestions.length > 0}
                        aria-controls={mentionSuggestions.length > 0 ? mentionListId : undefined}
                        aria-activedescendant={activeMentionOptionId}
                        onKeyDown={onInputKeyDown}
                        onInput={(event: TargetedEvent<HTMLInputElement, Event>) => {
                          const input = event.currentTarget
                          setDraft(input.value)
                          setCaret(input.selectionStart ?? input.value.length)
                          setDismissedMentionAt(undefined)
                          setMentionIndex(0)
                        }}
                        onClick={(event: TargetedEvent<HTMLInputElement, MouseEvent>) => {
                          setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                        }}
                        onKeyUp={(event: TargetedEvent<HTMLInputElement, KeyboardEvent>) => {
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Escape') return
                          setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
                        }}
                      />
                      <button type='submit' className='send-btn' disabled={sending || slowModeLeft > 0 || !draft.trim()}>
                        {slowModeLeft > 0 ? `${slowModeLeft}s` : 'Send'}
                      </button>
                      {reactionControl}
                    </form>
                  </div>
                )
                : !signedIn || inputState?.status === 'SIGN_IN_REQUIRED'
                  ? (
                    <div className='restricted-bar'>
                      <Lock size={14} strokeWidth={1.75} aria-hidden='true' />
                      <span className='restricted-text'>{inputState?.restrictionMessage || 'Sign in to chat'}</span>
                      <Link href='/signin' className='signin-link'>Sign in</Link>
                      {reactionControl}
                    </div>
                  )
                  : (
                    <div className='restricted-bar' role='status'>
                      <Lock size={14} strokeWidth={1.75} aria-hidden='true' />
                      <span className='restricted-text'>{inputState?.restrictionMessage || 'Chat participation is restricted.'}</span>
                      <button
                        type='button'
                        className='refresh-chat-btn'
                        onClick={refreshSession}
                        disabled={refreshing}
                      >
                        <RefreshCw size={13} strokeWidth={1.75} aria-hidden='true' />
                        {refreshing ? 'Checking…' : 'Refresh'}
                      </button>
                      {reactionControl}
                    </div>
                  )
              : reactionControl
                ? <div className='reaction-bar'>{reactionControl}</div>
                : undefined}

            {leaderboardOpen && leaderboardEntry
              ? (
                <div
                  ref={leaderboardPanelRef}
                  tabIndex={-1}
                  className='leaderboard-panel'
                  role='dialog'
                  aria-label={leaderboardResult?.title ?? leaderboardEntry.label}
                >
                  <div className='leaderboard-head'>
                    <Trophy size={15} strokeWidth={1.9} aria-hidden='true' />
                    <span>{leaderboardResult?.title ?? leaderboardEntry.label}</span>
                    <div className='leaderboard-actions'>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Refresh leaderboard'
                        onClick={() => reexecuteLeaderboard({ requestPolicy: 'network-only' })}
                      >
                        <RefreshCw size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Close leaderboard'
                        onClick={() => setLeaderboardOpen(false)}
                      >
                        <X size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <div className='leaderboard-list'>
                    {leaderboardLoading && !leaderboardResult
                      ? <div className='notice'>Loading top fans…</div>
                      : leaderboardResult?.items.length
                        ? leaderboardResult.items.map((item) => (
                          <div key={`${item.rank}-${item.displayName}`} className='leaderboard-row'>
                            <span className='leaderboard-rank'>{item.rank}</span>
                            {item.avatar
                              ? <img className='leaderboard-avatar' src={item.avatar} alt='' loading='lazy' referrerpolicy='no-referrer' />
                              : <span className='leaderboard-avatar' />}
                            <div className='leaderboard-name'>
                              <span>{item.displayName}</span>
                              {item.badgeLabel
                                ? (
                                  <span
                                    className='badge-chip'
                                    style={{
                                      ...(item.badgeBackgroundColor ? { background: item.badgeBackgroundColor } : {}),
                                      ...(item.badgeTextColor ? { color: item.badgeTextColor } : {}),
                                    }}
                                  >
                                    <Crown size={11} strokeWidth={2} aria-hidden='true' />
                                    <span>{item.badgeLabel}</span>
                                  </span>
                                )
                                : undefined}
                            </div>
                            {item.points ? <span className='leaderboard-points'>{item.points}</span> : undefined}
                          </div>
                        ))
                        : leaderboardError
                          ? <div className='notice'>{lineFor(leaderboardError)}</div>
                          : <div className='notice'>No top fans ranked yet.</div>}
                  </div>
                </div>
              )
              : undefined}

            {overScreenOpen
              ? (
                <div
                  ref={overScreenPanelRef}
                  tabIndex={-1}
                  className='over-screen-panel'
                  role='dialog'
                  aria-label='Over-screen chat messages'
                >
                  <div className='leaderboard-head'>
                    <Sparkles size={15} strokeWidth={1.9} aria-hidden='true' />
                    <span>Over-screen messages</span>
                    <div className='leaderboard-actions'>
                      <button
                        type='button'
                        className='pin-icon-btn'
                        aria-label='Close over-screen settings'
                        onClick={() => setOverScreenOpen(false)}
                      >
                        <X size={15} strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <div className='over-screen-body'>
                    <label className='over-screen-check'>
                      <span>Enable over-screen messages</span>
                      <input
                        type='checkbox'
                        aria-label='Enable over-screen messages'
                        checked={overScreen.enabled}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          updateOverScreenSettings({ enabled: event.currentTarget.checked })}
                      />
                    </label>
                    <div className='over-screen-row'>
                      <span>Text animation</span>
                      <PreviewSelect
                        ariaLabel='Text animation'
                        value={overScreen.textAnimation}
                        options={OVERLAY_TEXT_ANIMATIONS.map((option) => ({
                          ...option,
                          previewAnimation: option.value,
                        }))}
                        onChange={(textAnimation: OverlayTextAnimation) => updateOverScreenSettings({ textAnimation })}
                      />
                    </div>
                    <div className='over-screen-row'>
                      <span>Emoji-only animation</span>
                      <PreviewSelect
                        ariaLabel='Emoji-only animation'
                        value={overScreen.emojiAnimation}
                        options={OVERLAY_EMOJI_ANIMATIONS.map((option) => ({
                          ...option,
                          previewAnimation: option.value,
                        }))}
                        onChange={(emojiAnimation: OverlayEmojiAnimation) => updateOverScreenSettings({ emojiAnimation })}
                      />
                    </div>
                    <div className='over-screen-row'>
                      <span>Font style</span>
                      <PreviewSelect
                        ariaLabel='Overlay font'
                        value={overScreen.fontFamily}
                        options={OVERLAY_FONT_FAMILIES.map((option) => ({
                          ...option,
                          fontFamily: OVERLAY_FONT_STACKS[option.value],
                        }))}
                        onChange={(fontFamily: OverlayFontFamily) => updateOverScreenSettings({ fontFamily })}
                      />
                    </div>
                    <label className='over-screen-row'>
                      <span>Font size</span>
                      <span className='over-screen-range'>
                        <input
                          type='range'
                          aria-label='Font size'
                          min={16}
                          max={56}
                          step={2}
                          value={overScreen.fontSizePx}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            updateOverScreenSettings({ fontSizePx: Number(event.currentTarget.value) })}
                        />
                        <span>{`${overScreen.fontSizePx}px`}</span>
                      </span>
                    </label>
                    <label className='over-screen-row'>
                      <span>Speed</span>
                      <span className='over-screen-range'>
                        <input
                          type='range'
                          aria-label='Animation speed'
                          min={0.5}
                          max={2.5}
                          step={0.1}
                          value={overScreen.speed}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            updateOverScreenSettings({ speed: Number(event.currentTarget.value) })}
                        />
                        <span>{`${overScreen.speed.toFixed(1)}x`}</span>
                      </span>
                    </label>
                    <label className='over-screen-row'>
                      <span>Opacity</span>
                      <span className='over-screen-range'>
                        <input
                          type='range'
                          aria-label='Overlay opacity'
                          min={0.2}
                          max={1}
                          step={0.05}
                          value={overScreen.opacity}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            updateOverScreenSettings({ opacity: Number(event.currentTarget.value) })}
                        />
                        <span>{`${Math.round(overScreen.opacity * 100)}%`}</span>
                      </span>
                    </label>
                    <label className='over-screen-row'>
                      <span>Client slow mode</span>
                      <span className='over-screen-range'>
                        <input
                          type='range'
                          aria-label='Client slow mode'
                          min={0}
                          max={5000}
                          step={250}
                          value={overScreen.slowModeMs}
                          onInput={(event: TargetedEvent<HTMLInputElement>) =>
                            updateOverScreenSettings({ slowModeMs: Number(event.currentTarget.value) })}
                        />
                        <span>{overScreen.slowModeMs === 0 ? 'Off' : `${(overScreen.slowModeMs / 1_000).toFixed(2)}s`}</span>
                      </span>
                    </label>
                    <label className='over-screen-check'>
                      <span>Show avatars</span>
                      <input
                        type='checkbox'
                        aria-label='Show avatars'
                        checked={overScreen.showAvatar}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          updateOverScreenSettings({ showAvatar: event.currentTarget.checked })}
                      />
                    </label>
                    <label className='over-screen-check'>
                      <span>Show usernames</span>
                      <input
                        type='checkbox'
                        aria-label='Show usernames'
                        checked={overScreen.showAuthor}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          updateOverScreenSettings({ showAuthor: event.currentTarget.checked })}
                      />
                    </label>
                    <label className='over-screen-check'>
                      <span>Style by message type</span>
                      <input
                        type='checkbox'
                        aria-label='Style by message type'
                        checked={overScreen.styleByType}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          updateOverScreenSettings({ styleByType: event.currentTarget.checked })}
                      />
                    </label>
                    {overScreen.styleByType
                      ? OVERLAY_TYPE_ANIMATION_FIELDS.map(({ key, label }) => (
                        <div key={key} className='over-screen-row over-screen-subrow'>
                          <span>{label}</span>
                          <PreviewSelect
                            ariaLabel={label}
                            value={overScreen[key]}
                            options={OVERLAY_TEXT_ANIMATIONS.map((option) => ({
                              ...option,
                              previewAnimation: option.value,
                            }))}
                            onChange={(value: OverlayTextAnimation) => updateOverScreenSettings({ [key]: value })}
                          />
                        </div>
                      ))
                      : undefined}
                    <label className='over-screen-check'>
                      <span>Enlarge emoji-only messages</span>
                      <input
                        type='checkbox'
                        aria-label='Enlarge emoji-only messages'
                        checked={overScreen.emojiOnlyEnlarged}
                        onChange={(event: TargetedEvent<HTMLInputElement>) =>
                          updateOverScreenSettings({ emojiOnlyEnlarged: event.currentTarget.checked })}
                      />
                    </label>
                    <div className='over-screen-footer'>
                      <button
                        type='button'
                        className='over-screen-action'
                        onClick={() => resetOverScreenSettings()}
                      >
                        Reset
                      </button>
                      <button
                        type='button'
                        className='over-screen-action primary'
                        onClick={() => {
                          if (!overScreen.enabled) updateOverScreenSettings({ enabled: true })
                          setPreviewSeq((seq) => seq + 1)
                        }}
                      >
                        Test preview
                      </button>
                    </div>
                  </div>
                </div>
              )
              : undefined}
          </>
        )}
    </section>
    )

  return (
    <>
      {panelContainer !== undefined
        ? (panelContainer ? createPortal(panelView, panelContainer) : undefined)
        : panelView}
      {!page?.disabled
        ? (
          <OverScreenOverlay
            settings={overScreen}
            event={overlayEvent}
            resetSeq={overlayResetSeq}
            previewSeq={previewSeq}
            paused={paused}
          />
        )
        : undefined}
    </>
  )
}

export default LiveChat
