---
version: alpha
name: Sardines Reading Comics
description: A dark editorial comics library interface built around cover art, sharp utility controls, and amber reading-state accents.
colors:
  primary: "#F59E0B"
  primary-hover: "#FBBF24"
  primary-strong: "#D97706"
  on-primary: "#0F172A"
  background: "#0F172A"
  background-deep: "#020617"
  reader-background: "#000000"
  surface: "#0F172A"
  surface-raised: "#1E293B"
  surface-muted: "#334155"
  border: "#1E293B"
  border-strong: "#334155"
  text-primary: "#FFFFFF"
  text-secondary: "#CBD5E1"
  text-control: "#94A3B8"
  text-muted: "#64748B"
  text-subtle: "#475569"
  text-disabled: "#334155"
  overlay: "#000000"
  error: "#F87171"
  error-surface: "#450A0A"
  brand-warm: "#FDD575"
  brand-coral: "#F77868"
  brand-magenta: "#D22E8C"
typography:
  display-hero:
    fontFamily: Newsreader
    fontSize: 72px
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: -0.025em
  display-page:
    fontFamily: Newsreader
    fontSize: 48px
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: -0.025em
  headline-md:
    fontFamily: Newsreader
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.025em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: 0em
  body-sm-strong:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: 0em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 700
    lineHeight: 16px
    letterSpacing: 0.1em
  label-eyebrow:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 700
    lineHeight: 16px
    letterSpacing: 0.3em
  label-micro:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 700
    lineHeight: 14px
    letterSpacing: 0.1em
  badge:
    fontFamily: Inter
    fontSize: 9px
    fontWeight: 900
    lineHeight: 12px
    letterSpacing: 0.1em
rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  xl: 12px
  full: 9999px
spacing:
  px: 1px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 40px
  4xl: 48px
  5xl: 64px
  section: 64px
  container-padding: 16px
  container-max: 1600px
  control-height: 48px
  reader-control: 40px
  cover-grid-gap-x: 16px
  cover-grid-gap-y: 32px
  cover-ratio-width: "2"
  cover-ratio-height: "3"
borders:
  hairline: 1px
  accent-rule: 2px
shadows:
  none: "none"
  cover-raised: "0 25px 50px -12px #000000"
  cover-stacked: "0 20px 25px -5px #000000"
  cover-hover: "0 10px 15px -3px #F59E0B"
  popover: "0 20px 25px -5px #000000"
  dialog: "0 25px 50px -12px #000000"
elevation:
  flat: "{shadows.none}"
  cover: "{shadows.cover-raised}"
  stacked-cover: "{shadows.cover-stacked}"
  popover: "{shadows.popover}"
  dialog: "{shadows.dialog}"
motion:
  instant: "0ms"
  fast: "150ms"
  standard: "200ms"
  image-hover: "300ms"
  easing-standard: "ease-in-out"
  cover-scale-hover: "1.02"
opacity:
  header-surface: 0.95
  translucent-surface: 0.80
  backdrop: 0.70
  subtle-ring: 0.10
  faint-ring: 0.05
  accent-ring: 0.40
  accent-wash: 0.10
  hero-art-wash: 0.30
components:
  app-shell:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-md}"
  login-shell:
    backgroundColor: "{colors.background-deep}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-md}"
  header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    height: 72px
    padding: 16px
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  divider-strong:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  page-heading:
    textColor: "{colors.text-primary}"
    typography: "{typography.display-page}"
  section-heading:
    textColor: "{colors.text-primary}"
    typography: "{typography.headline-md}"
  eyebrow-label:
    textColor: "{colors.primary}"
    typography: "{typography.label-eyebrow}"
    height: 16px
  body-copy:
    textColor: "{colors.text-secondary}"
    typography: "{typography.body-sm}"
  metadata:
    textColor: "{colors.text-muted}"
    typography: "{typography.label-md}"
  metadata-subtle:
    textColor: "{colors.text-subtle}"
    typography: "{typography.label-micro}"
  disabled-control:
    textColor: "{colors.text-disabled}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    width: "{spacing.control-height}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    padding: 20px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-primary-active:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    padding: 12px
  button-secondary-hover:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.primary}"
  icon-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-control}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    width: "{spacing.control-height}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    height: 40px
    padding: 12px
  search-dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.none}"
    width: 576px
  popover-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.none}"
    padding: 16px
  cover-card:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xs}"
    width: 210px
    height: 320px
  cover-title:
    textColor: "{colors.text-primary}"
    typography: "{typography.body-sm-strong}"
  cover-meta:
    textColor: "{colors.text-muted}"
    typography: "{typography.label-md}"
  badge-accent:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.badge}"
    rounded: "{rounded.none}"
    padding: 4px
  badge-muted:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.badge}"
    rounded: "{rounded.none}"
    padding: 4px
  active-chip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    padding: 12px
  inactive-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    padding: 12px
  pagination-current:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.none}"
    height: "{spacing.control-height}"
    width: "{spacing.control-height}"
  progress-track:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.none}"
    height: 4px
  progress-fill:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.none}"
    height: 4px
  reader-page:
    backgroundColor: "{colors.reader-background}"
    textColor: "{colors.text-primary}"
  reader-hud:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body-sm-strong}"
  error-banner:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: 16px
  brand-mark-warm:
    backgroundColor: "{colors.brand-warm}"
    rounded: "{rounded.none}"
    width: 48px
    height: 48px
  brand-mark-coral:
    backgroundColor: "{colors.brand-coral}"
    rounded: "{rounded.none}"
    width: 48px
    height: 48px
  brand-mark-magenta:
    backgroundColor: "{colors.brand-magenta}"
    rounded: "{rounded.none}"
    width: 48px
    height: 48px
---

## Overview

Sardines Reading Comics feels like a private, late-night archive for a serious comics reader. The interface is dark, quiet, and editorial: most of the product recedes into deep slate surfaces so the cover art can supply color, texture, and narrative energy. The home hero may borrow a blurred, low-opacity color field from the active cover, but the base atmosphere remains black-slate rather than colorful. It should feel personal and focused rather than promotional.

The visual identity is built from three ideas: a cinematic black-slate room, a broadsheet-style display voice, and bright amber marks for reading momentum. Pages should prioritize browsing, scanning, filtering, and returning to an issue quickly. Decorative elements are restrained; the most expressive visuals are the comics themselves.

## Colors

The palette is dominated by dark slate and near-black surfaces. The main background is #0F172A, with #020617 and #000000 reserved for login atmosphere, overlays, and the full-screen reader. Raised controls use #1E293B and #334155 so they remain visible without becoming card-like.

Amber #F59E0B is the primary action and state color. Use it for reading progress, active filters, active pagination, section eyebrows, primary buttons, and the most important hover states. The hover value #FBBF24 should feel like a small flash of light, not a new brand color.

Text is high contrast but tiered: #FFFFFF for titles and core labels, #CBD5E1 for readable body content, #94A3B8 for icon-button and command text, #64748B for metadata, #475569 for quiet labels, and #334155 for disabled controls. The warm-to-magenta brand colors are supporting identity colors for the mark only; they should not replace amber as the product interaction color.

## Typography

Headlines use Newsreader to give the app its editorial comic-shop register. Use it for page titles, hero titles, and section headings. Large headings may be weighty and compact, with tight line-height, because they are usually paired with sparse metadata and large cover images.

Inter is the UI workhorse. It handles navigation, metadata, forms, buttons, search results, reader status, and body text. Labels are generally uppercase with wide tracking, creating a precise cataloging tone. Eyebrow labels use extra-wide tracking and amber color; they should feel like small shelf markers rather than marketing copy.

## Layout

The layout uses a wide maximum canvas of 1600px with compact 16px edge padding. Grids should be dense enough for browsing: cover grids use a 2:3 rhythm, horizontal gaps around 16px, and larger vertical gaps around 32px so titles and metadata have breathing room.

The home view can open with a cinematic hero, but the rest of the product should behave like an efficient library browser. Use thin dividers, compact toolbars, and clear page sections. Detail pages should pair a cover column with metadata and synopsis content; list and search pages should favor fast scanning over decorative framing.

## Elevation & Depth

Depth comes from cover art, overlays, and very selective shadows. Most interface surfaces are flat and separated by borders rather than heavy elevation. Use shadows for physical objects such as covers, stacked covers, dialogs, popovers, and the search overlay.

Cover images may receive strong dark shadows because they behave like objects on a shelf. Utility controls should stay flat. Popovers are allowed a dark shadow and an amber top rule to clarify that they are temporary command surfaces.

## Shapes

The shape language is mostly square and utilitarian. Buttons, filter chips, pagination items, badges, header icon buttons, and popover panels should use no radius. This gives the app a precise, archive-like feel and keeps interaction controls from looking playful.

Use small radii only where the object represents printed media or an overlay: comic covers use a 2px corner, search inputs may use 4px, and rare reader hints can use a larger 12px radius. Fully rounded shapes are reserved for carousel navigation or circular icon affordances, not for the main control system.

## Components

### Buttons and Controls

Primary buttons are amber blocks with dark slate text, uppercase Inter labels, and square corners. Secondary controls are dark slate blocks with borders and muted text. Hover states should change border or text color to amber before introducing more fill color.

### Covers and Grids

Cover cards are the main visual unit. Preserve the 2:3 aspect ratio, use crisp cropped imagery, and keep labels below the image. On hover, covers may scale subtly to 1.02 and gain an amber ring or amber-tinted shadow. Do not place covers inside decorative cards; the cover itself is the object.

### Navigation, Filters, and Search

Navigation is sparse and label-like, using small uppercase text. Filters, sort menus, and pagination use 48px touch targets, square borders, and amber active states. Search should feel like a command palette: dark, focused, full-width on small screens, and modestly constrained on larger screens.

### Reader

The reader is pure black with page imagery centered edge to edge. UI chrome should be temporary, translucent, and minimal. Progress indicators use amber on a thin slate track. Reader controls should never compete with the comic page.

### Motion and Interaction

Motion should be short and functional. Use 150ms for color changes, 200ms for progress-width updates, and 300ms for cover-image hover scale. Avoid decorative animation. Motion should confirm interaction or reveal controls, not add atmosphere.

## Do's and Don'ts

- Do let comic cover art carry most of the color and visual variety.
- Do use amber for active reading state, progress, selected filters, primary actions, and meaningful hover feedback.
- Do keep controls square, compact, and border-driven.
- Do use Newsreader for editorial hierarchy and Inter for all utility text.
- Do preserve dense browsing layouts with consistent 2:3 cover proportions.
- Don't introduce broad new accent colors for normal product actions.
- Don't turn every section into a card; use flat page bands, dividers, and grids.
- Don't round primary buttons, filter chips, pagination, or utility icon buttons.
- Don't use heavy decorative gradients behind ordinary library pages.
- Don't let reader controls distract from the page image.
