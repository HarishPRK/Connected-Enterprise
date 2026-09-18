---
name: Gateway activation workspace
description: Visual guidance for the onboarding route inside Connected Enterprise.
colors:
  action: "#76ead0"
  dark-surface: "#131e2e"
  dark-raised: "#1a293c"
  dark-recessed: "#0f1928"
  dark-text: "#e7effb"
  dark-secondary: "#a9bad1"
  dark-border: "#2a394e"
  light-surface: "#ffffff"
  light-raised: "#f1f6fa"
  light-recessed: "#eaf1f7"
  light-text: "#17263c"
  light-secondary: "#52637a"
  light-border: "#dce5ed"
typography:
  heading:
    fontFamily: "Space Grotesk"
    fontSize: "26px"
    fontWeight: 600
  device-title:
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontSize: "12px"
    lineHeight: 1.65
rounded:
  workspace: "14px"
  stage: "12px"
  button: "8px"
spacing:
  related: "8px"
  group: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "#102b30"
    rounded: "{rounded.button}"
    padding: "10px 15px"
---

# Gateway activation workspace

## Overview

This document describes only `src/features/onboarding`. The global application
header, sidebar, theme preference, and zoom remain owned by the host application.
The central interaction is selecting a gateway and inspecting its activation
stages, with current evidence and relevant actions beside the visualization.

## Colors

Blue surfaces separate the selector, current device, and explanatory panels.
Mint identifies confirmed stages and primary actions. Amber identifies work
in progress. Rose identifies attention or missing confirmation. Every color
has a text equivalent; polling is not presented as evidence of device health.
`activation-workspace.css` owns the feature's scoped light and dark tokens.

## Typography

Inherit the application's Space Grotesk font. Use the 26px route heading,
22px gateway identity, 19px section headings, and compact 11–13px labels and
explanations. Use monospace for identifiers and addresses, not general copy.

## Layout

The route is at most 1560px wide. Navigation stays horizontal above the task.
Gateway and profile workspaces pair a selector with focused detail. Below an
880px container width, selectors move above detail; below 620px, the activation
map becomes a two-column layout. Phone inputs retain 16px text.

## Elevation & Depth

Use tonal differences and single thin borders to define surfaces. Avoid adding
decorative shadows to the activation map or stacking additional outer cards
around the workspace.

## Shapes

Workspaces use 14px corners, inspection tiles use 12px corners, and compact
actions use 8px corners. Connector lines communicate lifecycle sequence.

## Components

- Activation stages are buttons with `aria-pressed`; selecting one updates a
  nearby explanation. Completion comes from the current deployment generation.
- Status filters and gateway search operate on the selected site's inventory.
- Management actions live in an expandable section and retain their existing
  permission checks and serial-confirmation dialogs.
- Package preview updates from the form and explicitly states that no
  certificates have been issued yet.
- Profile network summaries render stored profile values. Read-only parameter
  groups start collapsed and support search, individual expansion, and expand all.

## Do's and Don'ts

- Do preserve the distinction between retrieval, application, and health.
- Do show actual event text and timestamps, including an honest missing-data state.
- Do retain role restrictions and package/site/profile continuity.
- Don't synthesize live device measurements or advance stages on a timer.
- Don't restore an oversized welcome hero or a second route sidebar.
