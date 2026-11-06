# Product Interface Redesign

## Direction

A quiet desktop workspace: neutral surfaces, blue actions, system typography, and readable information density. Data and conversation are the visual anchors; no decorative hero or dashboard card mosaic.

## Information Architecture

- Overview: today's usage, recent main sessions, annual activity, account limits, and secondary historical analysis.
- Token: one time range, headline usage, trend and composition, attribution tables, then audit and budgets.
- Stream: explicit dialogue search, compact filters, related sessions, and a stable result viewport.
- Sessions: compact grouped library beside an independently scrolling conversation/detail workspace; subagents remain linked and opt-in.
- Service state: a persistent diagnostics entry, with RSS still visible in the overview's service strip.

Remove unsupported throughput projections derived from lifetime totals. Preserve historical search, parent/child identity, full-text hydration, quota expiry warnings, attribution, recalculation, and bounded memory behavior.

## Verification Inventory

- Desktop 1280 x 900 and 1440 x 1000: all four views, first viewport and lower sections, light and dark themes.
- Navigation and refresh: URL state, theme switching, source refresh status, diagnostics.
- Search: button submission, loading/cancel, empty results, long highlighted hit, historical context, return to results, saved views.
- Sessions: grouped list, active main sessions, main/all/subagent scope, parent-child navigation, detail close, directory tree, conversation collapse, replay, usage, outcomes, comparison, bookmarks.
- Token: today/week/month, Token/cost trend, scope-consistent attribution, recalculation and historical audit.
- Overview: real KPI scope, heatmap metric switching and hover, active session navigation, manual quota refresh and cached error/expiry states.
- Visual defects: clipped controls, inconsistent type sizes, text overflow, empty stretched sections, ambiguous selection, nested scrolling, and contrast.
- Resource safety: full unit/core/build checks, desktop E2E, and the existing 400 MiB memory acceptance harness.

Motion is limited to selection feedback, disclosure expansion, and loading states; respect reduced-motion preferences.

## Verified on 2026-11-06

- Strict lint, 125 frontend tests, 151 core tests, and the production build passed.
- All 16 desktop E2E cases passed at 1280 x 900 and 1440 x 1000. Screenshots cover all four views in light and dark mode; layout checks cover overflow, session reading height, and fixed dialogue typography.
- Real local data verified keyword search, highlighted results, navigation to the matching conversation, and return to the retained search results.
- The 400.3 MiB log acceptance harness reached a combined server/child-process RSS peak of 176.5 MiB across summary, search, replay, analysis, recalculation, restart, and cancellation scenarios. This is a measured scenario, not a universal memory bound; browser memory is excluded.
- The existing service remained available on port 8787. No backend scans, polling intervals, account-query schedule, or source-log mutations were introduced by the redesign.

## Data Presentation

- Today's cache coverage uses today's input, not lifetime input.
- Nonzero usage without pricing coverage is shown as unpriced, not free. This applies to the headline, model, workspace, and session breakdowns.
- Cache read/write ratios without a denominator are unavailable, not zero.
- Token composition and attribution bars use their actual proportions without minimum decorative widths.
- Initial loading and failure states do not render fabricated zero totals; failures provide a retry action.

## Component and Motion Foundation

- Motion supplies shared view-entry and Tabler icon feedback through `LazyMotion`. Optional features are split from the vendor bundle; no new animation framework runs on the server.
- Mantine Progress replaces the hand-built quota meter. Skeleton and Alert handle first-load and cached-error states. Querying preserves previous values and timestamps and disables repeated submissions.
- Search uses the same bounded refresh glyph with a visible pending label. Submit/cancel/clear controls keep their positions and height; the old forced three-column rule no longer wraps the clear action onto a separate row.
- Reduced-motion preferences and document visibility share one policy: rotating icons, skeleton animation, and progress transitions stop when motion is disabled. View transitions do not remount controls or conversation content.
- The quota resolver now recognizes the nested CodexCLI bundle in current ChatGPT/Codex desktop installations, including per-user Applications directories. Explicit `CODEX_BIN` and PATH installations retain priority.

### Quota and Motion Verification

- Manual query succeeded against the installed CLI from both the backend endpoint and the live browser. Only quota reads were performed; no reset credit was consumed. Reload restores the persisted result without another query.
- Strict lint, 130 frontend tests, 153 core tests, and the production build passed. All 20 desktop E2E cases passed, including real animation changes, reduced-motion/hidden-page cancellation, failure/retry, initial skeletons, retained cached data, and stable search-control geometry.
- Desktop visual review covers 1280 x 900 and 1440 x 1000, all navigation destinations, light/dark quota display, pending/error/success states, control alignment, and overflow.
- Live diagnostics after querying measured 116.1 MiB combined server/worker RSS. This is a point-in-time reading, excludes browser memory, and is not a peak-memory guarantee.

## Charts and animated symbols — 2026-11-07

- Apache ECharts replaces the prior chart implementation. Overview uses separate
  event and Token axes with a shared time axis. Usage provides platform-stacked
  Token bars, a cost trend, a composition ring and exact-value tables.
- `react-useanimations` supplies real animated SVG paths for navigation, KPI
  headings and workspace states. Hover and keyboard feedback preserve navigation;
  reduced motion and document visibility use the shared motion policy.
- Chart instances resize with their containers and release resources when
  switching to table mode or leaving the view. Unknown costs remain unavailable.
- Browser checks cover SVG path changes on hover, reduced-motion suppression,
  exact values, metric/table/theme switching, and all four workspace destinations
  at 1280 and 1440. Visual screenshots disable motion to capture completed frames.
- Session Usage now includes [response performance](agent-speed-reference.md)
  with explicit sample coverage, timing limitations and source-record navigation.
- The production build still reports the ECharts chunk at roughly 563 kB
  minified / 192 kB gzip. It is split from the main application; this is a known
  download-size tradeoff of the chart upgrade.
