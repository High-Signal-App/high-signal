---
name: High Signal
description: Evidence-first intelligence in a restrained public ledger.
colors:
  background: "oklch(0.16 0 0)"
  foreground: "oklch(0.96 0 0)"
  muted: "oklch(0.67 0 0)"
  muted-readable: "oklch(0.67 0 0)"
  line: "oklch(0.27 0 0)"
  accent: "oklch(0.78 0.18 195)"
  up: "oklch(0.78 0.18 145)"
  down: "oklch(0.7 0.21 25)"
typography:
  display:
    fontFamily: "GeistSans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "GeistSans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "GeistMono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.625rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.18em"
rounded:
  indicator: "9999px"
spacing:
  compact: "0.75rem"
  section: "2.5rem"
  page: "3.5rem"
components:
  button-command:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "0"
    padding: "0.5rem 1rem"
  panel:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "0"
    padding: "1.25rem"
---

# Design System: High Signal

## Overview

**Creative North Star: "The Evidence Terminal"**

High Signal looks like a calm public ledger built for sustained reading. It
combines the information density of a market terminal with the restraint of a
modern research product: strong hierarchy, generous separation, and precise
lines instead of ornamental containers. The interface earns attention through
evidence and typography rather than decorative effects.

The system is futurist and very clean. It is dark by default, monochrome except
for one cyan directional accent, and explicit about state. Data can be dense;
explanatory copy stays measured and readable.

**Key Characteristics:**

- Dark zinc field with high-contrast foreground type.
- Cyan used sparingly for direction, focus, and meaningful navigation state.
- Flat, square, one-pixel boundaries with no decorative shadow.
- Geist Sans for reading and Geist Mono for labels, routes, and measurements.
- Motion only when product state changes.

## Colors

The palette is deliberately narrow so evidence, state, and direction remain the
only sources of visual emphasis.

### Primary

- **Signal Cyan** (`oklch(0.78 0.18 195)`): directional emphasis, focus, and
  high-value navigation feedback.

### Neutral

- **Terminal Black** (`oklch(0.16 0 0)`): page and panel background.
- **Ledger White** (`oklch(0.96 0 0)`): primary text.
- **Quiet Zinc** (`oklch(0.55 0 0)`): secondary copy and metadata.
- **Readable Zinc** (`oklch(0.67 0 0)`): sustained secondary prose on public
  reading and audit surfaces.
- **Rule Zinc** (`oklch(0.27 0 0)`): dividers, fields, and boundaries.

### Named Rules

**The One Signal Rule.** Cyan is rare and directional. It does not become a
decorative wash, gradient, or default card treatment.

## Typography

**Display Font:** Geist Sans with system sans-serif fallback

**Body Font:** Geist Sans with system sans-serif fallback
**Label/Mono Font:** Geist Mono with system monospace fallback

**Character:** Compact, modern headings lead into quiet, highly legible body
copy. Mono is functional: it labels evidence, routes, states, and metrics.

### Hierarchy

- **Display** (500, 2.25–3rem, tight): primary page purpose.
- **Headline** (500, 1.875–2.25rem, tight): major section entry.
- **Title** (500, 1.125–1.5rem): records and grouped evidence.
- **Body** (400, 0.875–1rem, 1.5–1.75): explanations with a 65–75 character
  measure.
- **Label** (400, 0.625–0.75rem, 0.18em tracking, uppercase): routes, data
  labels, states, and terse navigation.

## Layout

Pages use centered reading shells of roughly 4xl or 5xl width with 1.25–1.5rem
side padding and 3.5–4rem vertical page padding. Major sections are separated by
2.5–3rem, not by stacked decorative cards. Lists and data grids use one-pixel
dividers and collapse to a single readable column at narrow widths. Explanatory
body copy stays within 65–75 characters while tables and evidence records may
use the wider shell.

## Elevation & Depth

The system is flat. It uses no shadows. Depth comes from hierarchy, spacing,
thin rules, and slight tonal state changes on hover.

**The Flat Ledger Rule.** A surface may have a one-pixel border or a tonal
background change; it does not combine those with decorative elevation.

## Shapes

Containers, controls, and tables are square. One-pixel borders establish
boundaries. The only fully rounded primitive is a small status indicator dot or
compact status chip whose shape communicates state.

## Components

### Buttons

- **Shape:** square, one-pixel border.
- **Primary:** transparent background, foreground text, compact mono label.
- **Hover / Focus:** cyan border and text with an explicit focus-visible state.
- **Disabled:** quiet zinc text and rule-zinc boundary; never color alone.

### Cards / Containers

- **Corner Style:** square.
- **Background:** terminal black or a very slight white tonal lift on hover.
- **Shadow Strategy:** none.
- **Border:** one-pixel rule zinc when a boundary is necessary.
- **Internal Padding:** typically 1–1.25rem.

### Inputs / Fields

- **Style:** transparent square field with a one-pixel rule-zinc border.
- **Focus:** signal-cyan border plus a visible focus outline.
- **Error / Disabled:** state label and copy accompany any color change.

### Navigation

Navigation uses concise labels, quiet default color, cyan or foreground active
state, and visible keyboard focus. Links remain recognizable through position,
copy, and interaction, not color alone.

## Do's and Don'ts

### Do:

- **Do** use 1px rules and spacing to organize dense evidence.
- **Do** keep explanatory copy within a readable measure.
- **Do** use tabular numerals for metrics and outcome history.
- **Do** preserve the dark monochrome field and restrained cyan accent.
- **Do** expose hover, focus, loading, error, and empty states where applicable.

### Don't:

- **Don't** add gradients, glass, decorative glow, or ornamental motion.
- **Don't** structure editorial pages as repeated icon-card grids.
- **Don't** use large rounded containers or pill shapes for ordinary controls.
- **Don't** use mono type as decoration for prose.
- **Don't** hide evidence limitations behind visual polish.
