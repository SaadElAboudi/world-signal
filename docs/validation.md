# Phase 1 validation

Verified locally on 16 September 2026:

- Production build and TypeScript: passed.
- ESLint and Git whitespace checks: passed.
- Seven unit tests: ratio and percentage arithmetic, population z-scores, unknown/degenerate baselines, severity boundaries, replay chronology, combined filters and demo provenance.
- Nine Playwright cases: three each at desktop (1440 × 1000), tablet (768 × 1024) and mobile (390 × 844) viewport sizes. All passed.
- Browser journeys cover WebGL initialization, explicit demo labels, signal details, evidence and methodology, layer/time filters, search and empty states, replay controls, the information dialog, reduced-motion preferences and replay dates.
- Browser tests assert no uncaught page errors in the main journey and no horizontal document overflow. Screenshots were manually reviewed at all three viewport sizes.
- Production dependency audit: no known vulnerabilities reported at validation time.

The local machine uses macOS 12. The latest Playwright browser installer does not support this OS, so tests used an already installed Chromium 149 executable through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, with software WebGL. The full browser suite took 8.3 minutes. These tests establish functional behavior in emulated Chromium viewports, not measured frame rates or tests on physical iOS/Android devices.

CI repeats lint, unit tests, production build and browser journeys on Linux. Runtime source integration, provider freshness, stored historical baselines and AI behavior are outside this release and have not been claimed or tested.
