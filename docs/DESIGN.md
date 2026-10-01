# Tip Jar design

## Overview

The implemented page is a quiet, light-only tip jar for Sepolia visitors. A large serif introduction leads into a live statistics row and the primary tip form. Recent public notes sit beside the form on wide screens. Secondary token actions use native disclosures below the core task. The warm paper background, dark green text, and simple jar illustration are inferred design choices for this new frontend.

The implementation is in `web/src/styles.css`, `App.tsx`, and `components.tsx`. This document is in `docs/` because the explicit write scope prohibits root `DESIGN.md`.

## Colors

CSS custom properties in `web/src/styles.css` are the canonical values. This implementation uses a compact hex palette and has no dark theme or theme control.

| Token | Value | Use |
| --- | --- | --- |
| `--page` | `#f7f6f0` | Page background |
| `--surface` | `#fffefa` | Forms, controls, disclosures |
| `--soft` | `#eeeee5` | Summaries, selected presets, notices |
| `--text` | `#243e35` | Main text and illustration stroke |
| `--muted` | `#60675c` | Supporting text and captions |
| `--border` | `#d7d9cc` | Structural separators |
| `--input-border` | `#818c7c` | Form boundaries and empty-state border |
| `--accent` | `#183f35` | Primary tip action |
| `--accent-hover` | `#285849` | Primary hover |
| `--on-accent` | `#fffefa` | Primary button text |
| `--lime` | `#dbe6a8` | Decorative jar disc and token mark |
| `--error` / `--error-bg` | `#963b2f` / `#fff0e9` | Persistent errors |
| `--focus` | `#386c9b` | Three-pixel keyboard focus outline |

Textual labels accompany every status. Lime is decorative, not a success signal. Measured rendered contrast and coverage limitations are in `VALIDATION.md` and the evidence files.

## Typography

Body and controls use `'Segoe UI', Helvetica, Arial, sans-serif`; headings and the wordmark use `Georgia, 'Times New Roman', serif`. These are system stacks with no font downloads. Font availability varies by platform; a CSS family declaration is not a claim that every named font exists on the worker.

- Body: `1rem`, line-height `1.6`; small UI text `0.875rem`; captions `0.75rem`.
- Hero: `clamp(3rem, 5.5vw, 4.75rem)`, weight 400, line-height 1.05, tracking `-0.045em`, with a serif italic second line.
- Section headings: `1.625rem`, weight 400, line-height 1.2; subheadings `1rem`, weight 600, line-height 1.4.
- Inputs are at least 16px; the ETH amount uses 24px. Changing figures use tabular numerals.
- Headings use balanced wrapping; supporting paragraphs use pretty wrapping. The hero description is capped at 460px. Public messages retain line breaks, wrap long content, and isolate text direction. Addresses expose full values through selectable full text, titles, copying, and explorer destinations.

## Layout

The `.shell` has a maximum width of 1160px with 40px desktop inline padding. The normal header is 100px tall. Spacing groups use 8/12/16px within a group and 24/28/36/40px between groups.

The hero has a text column and 260px illustration column. The primary `.section-grid` uses `1fr 1.05fr`, a 36px gap, and top-aligned sections. The tip card has 28px padding. `.tip-list` is capped at 610px with a stable scrollbar gutter, keyboard focus, and an explicit scrolling cue. It contains up to 20 events without pushing secondary actions through a very long empty column.

- At `58rem`, shell padding becomes 28px, navigation links collapse, the illustration column becomes 210px, and card/grid spacing tightens.
- At `44rem`, shell padding becomes 20px, grids become one column, the decorative illustration is hidden, and the redundant no-fee statistic is hidden. The no-fee explanation remains below. The header network badge is hidden; the page and wrong-chain notice still identify Sepolia.
- At `23rem`, shell padding becomes 16px, cards use 18px padding, and swap fields stack.

Controls remain in normal document flow, with no fixed overlay. Public messages, numeric amounts, addresses, summaries, and control rows can wrap. Browser widths and reflow checks are recorded in validation; native zoom and physical-device behavior have separate limitations.

## Elevation and depth

The system is flat. Tonal surfaces separate summaries from form fields; borders identify sections, controls, and selected presets. No box shadows or modal overlays exist. The decorative jar label has local stacking only; it cannot intercept a control.

## Shapes

Cards use `--radius: 18px`; inputs and buttons use 9px. Empty states and disclosures use 12px; errors use 8px. Token and sender marks are circles. The jar illustration and favicon are local SVG artwork, with decorative accessibility semantics.

## Components

`components.tsx` exports `Jar`, `AddressView`, and `TransactionStatus`. `Jar` renders a compact mark or decorative hero variant. `AddressView` checksums the address, links to the configured explorer, provides copying with feedback, and supports a full-address variant. `TransactionStatus` renders a stable polite status region, persistent error region, and transaction link.

`App.tsx` contains the form and event-list patterns plus `TokenTools`. Fields have native labels and descriptive text. The tip form focuses the first invalid field. Preset buttons use `aria-pressed`. `details`/`summary` supplies keyboard-accessible disclosure for swaps and transfers. No custom tabs or modal focus traps are introduced.

Buttons have a minimum height of 44px, with a compact 28px copy control that exceeds the 24px target baseline. Only the tip action uses a filled accent background. All transaction controls expose pending labels and native disabled states. An unresolved submitted transaction keeps further writes paused until a receipt check resolves it.

`:focus-visible` uses a 3px outline and 3px offset; forced-colors mode uses `Highlight`. A skip link leads to the main content. Hover styles apply only to hover-capable pointers. Button color/press transitions last 120ms and run only under `prefers-reduced-motion: no-preference`; reduced motion has no transitions. No page-load animation exists.

## Do's and don'ts

- Reuse `.shell`, `.card`, field labels, and semantic color tokens for new sections.
- Reserve the filled primary button for the current core task; secondary actions remain neutral.
- Keep value, unit, recipient, expected consequence, and network visible before signing.
- Render public messages as text and retain full address access. Never use `dangerouslySetInnerHTML` for events.
- Use native controls and disclosures, preserve keyboard outlines, and let content grow vertically.
- Add new actions behind the same deployment, chain, balance, simulation, and pending-transaction gates.

Design review follows the pinned Better Interface guide by Jakub Krehel (MIT). The documentation method is adapted from Paul Bakaus's Impeccable reference at `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). License notices are retained in `BETTER-INTERFACE-LICENSE.txt`; Ethereum UX guidance attribution is in `ETH-FRONTEND-UX-LICENSE.txt`.
