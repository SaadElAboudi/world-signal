# WORLD SIGNAL

## 1. Vision

Build a polished web application called **WORLD SIGNAL**.

WORLD SIGNAL is a real-time global situational-awareness platform that answers one simple question:

> **What's unusual in the world right now?**

It should feel like a combination of **Google Earth, an intelligence terminal, and an AI research assistant**.

The application aggregates multiple public real-world data sources, establishes what “normal” activity looks like, detects significant deviations, displays them geographically, and explains unusual events using evidence.

This is NOT primarily a news aggregator.

The core product primitive is:

**Observed activity → Baseline → Anomaly → Evidence → Explanation**

The interface should make complex global systems understandable at a glance.

---

# 2. Product principles

The application must prioritize:

1. **Signal over noise**
2. **Observed data over speculation**
3. **Sources over unsupported AI claims**
4. **Changes/anomalies over raw event volume**
5. **Excellent visualization over dashboard clutter**
6. **Progressive disclosure**
7. **Near-real-time information where technically possible**

The product must clearly distinguish:

- observed fact
- statistical anomaly
- reported event
- AI-generated interpretation

Never present AI inference as confirmed fact.

---

# 3. Main experience

The landing page immediately displays an interactive globe.

Dark, minimal, intelligence-terminal aesthetic.

Example:

WORLD SIGNAL

**GLOBAL STATUS — LIVE**

`23 significant signals detected`

Below or beside the globe:

`Last updated 42 sec ago`

The globe contains animated signal markers.

Markers represent detected events/anomalies rather than every raw datapoint.

Example:

🔴 Significant
🟠 Elevated
🟡 Notable

Do not overload the map.

---

# 4. Initial data layers

MVP should support four primary layers.

## Earthquakes

Source:
USGS Earthquake Hazards Program.

Display:

- magnitude
- depth
- location
- timestamp
- historical activity baseline
- abnormal clustering if detected

Example:

**Japan**

Magnitude 6.4 earthquake

`Seismic activity: +2.7σ vs 30-day baseline`

---

## Wildfires

Source:
NASA FIRMS.

Display:

- active fire detections
- geographic clusters
- intensity where available
- comparison with recent/seasonal baseline

Example:

**Northern Brazil**

`Fire detections: 4.2× expected level`

---

## Internet disruptions

Prefer publicly accessible data from sources such as:

- Cloudflare Radar
- RIPE Atlas
- IODA

Display:

- country/region
- connectivity change
- outage/disruption indicators
- baseline comparison

Example:

**Iran**

`Internet activity: −38% vs baseline`

---

## Aviation

Use a legally/publicly accessible source such as OpenSky Network.

Display aggregated aviation activity rather than unnecessarily exposing individual sensitive movements.

Metrics can include:

- aircraft count
- departures/arrivals where available
- regional traffic
- abnormal reductions/increases

Example:

**Eastern Mediterranean**

`Air traffic: −27% vs expected`

---

# 5. Globe

Use a performant 3D globe implementation.

Possible technologies:

- Mapbox GL
- deck.gl
- CesiumJS
- react-globe.gl

Choose whichever gives the best combination of:

- performance
- maintainability
- visual quality
- geographic layers
- animations

The globe should support:

- zoom
- rotation
- country selection
- marker clustering
- layer filtering
- animated anomalies
- timeline navigation

Markers should visually communicate severity without becoming visually noisy.

---

# 6. Signal object

Normalize every detected event into a common internal schema.

Example:

```typescript
interface WorldSignal {
  id: string;

  type: "earthquake" | "wildfire" | "internet" | "aviation";

  title: string;
  description?: string;

  latitude: number;
  longitude: number;

  country?: string;
  region?: string;

  observedValue?: number;
  expectedValue?: number;

  deviation?: number;
  deviationType: "percentage" | "ratio" | "zscore" | "absolute";

  severity: "notable" | "elevated" | "significant";

  timestamp: string;

  source: {
    name: string;
    url: string;
  };

  evidence?: Evidence[];

  aiSummary?: string;
}
```

The exact schema can evolve, but all data providers must normalize into a common signal model.

---

# 7. Baseline engine

The application should not simply display raw events.

It should calculate what is normally expected.

Possible baselines:

- previous 24 hours
- 7-day moving average
- 30-day moving average
- same weekday historical average
- seasonal baseline where relevant

Example:

Current fire detections:

`472`

30-day expected level:

`102`

Therefore:

`4.63× baseline`

Different signals may require different baseline methods.

Keep the baseline architecture modular.

---

# 8. Anomaly detection

Start simple.

Do NOT introduce ML unnecessarily.

Possible techniques:

### Percentage deviation

```text
(current - baseline) / baseline
```

### Ratio

```text
current / baseline
```

### Z-score

```text
(current - mean) / standardDeviation
```

Signals become visible when configurable thresholds are crossed.

Example:

Notable:

`1.5σ`

Elevated:

`2σ`

Significant:

`3σ`

Thresholds should be configurable per signal type.

---

# 9. Signal detail panel

Clicking a signal opens a side panel.

Example:

## INTERNET DISRUPTION

**Iran**

SIGNIFICANT

Internet activity

`↓ 38%`

Baseline

`Normal range ±7%`

Detected

`18:42 UTC`

Then display:

### What changed

A factual description based directly on the underlying data.

### Evidence

Graph showing:

`NOW vs BASELINE`

Example:

```text
Internet traffic

100 ┤────────baseline────────
 80 ┤
 60 ┤              ╲
 40 ┤               ╲____
    └──────────────────────
      12h      6h      now
```

### Sources

Always show original sources.

---

# 10. AI Brief

For each meaningful signal, allow the user to request:

**Explain this signal**

The LLM receives structured evidence.

It should answer using sections such as:

### What happened

Explain the observed anomaly.

### Why it matters

Explain potential significance.

### Related signals

Identify other detected signals nearby or temporally correlated.

### Confidence

HIGH / MEDIUM / LOW

The model must NEVER invent causality.

Example:

Bad:

> Internet traffic dropped because protests started.

Good:

> Internet traffic declined 38% beginning around 18:40 UTC. Increased reporting of protests occurred during a similar period. The available data does not establish whether the two events are causally related.

---

# 11. Multi-signal correlation

This is an important long-term differentiator.

Detect when several independent signals occur:

- geographically close
- temporally close

Example:

Iran:

```text
Internet       ↓38%
Flights        ↓12%
News volume    ↑240%
```

Generate a meta-signal:

**MULTIPLE ANOMALIES DETECTED**

The system should emphasize that correlation does not imply causation.

---

# 12. Global feed

Alongside the globe, display:

## LIVE SIGNALS

Example:

`21:43 — 🇯🇵 Japan`

**M6.4 earthquake**

SIGNIFICANT

---

`21:38 — 🇧🇷 Brazil`

**Fire activity 3.8× baseline**

ELEVATED

---

`21:31 — 🇮🇷 Iran`

**Internet activity −38%**

SIGNIFICANT

Clicking an item focuses the globe on the corresponding region.

---

# 13. Filters

Users should be able to enable/disable:

🔥 Wildfires

🌎 Earthquakes

🌐 Internet

✈️ Aviation

Later:

🚢 Shipping

🌡 Climate

⚡ Energy

🌋 Volcanoes

🌊 Ocean

🛰 Satellite

Filters must update both the globe and the live feed.

---

# 14. Time machine

Provide a timeline control.

Options:

LIVE

1H

6H

24H

7D

30D

Eventually allow historical replay.

Example:

User selects:

`24 February 2022`

Then presses:

▶ PLAY

Signals appear chronologically.

The architecture should support historical replay even if MVP history is limited.

---

# 15. Ask Earth

Provide a natural-language interface.

Placeholder:

**Ask the world something…**

Examples:

> Where are the strongest anomalies right now?

> Show major Internet disruptions.

> What changed in the Middle East during the last six hours?

> Where has wildfire activity increased this week?

The system should translate the query into filters/search operations over WORLD SIGNAL data.

The globe should update accordingly.

Do not use the LLM as the source of truth.

The LLM interprets the query.

WORLD SIGNAL's database provides the evidence.

---

# 16. Country / region view

Clicking a country displays:

## JAPAN

**CURRENT SIGNALS**

Earthquakes
`HIGH`

Wildfires
`NORMAL`

Internet
`NORMAL`

Aviation
`NORMAL`

Avoid producing an arbitrary universal “danger score”.

Instead display observable dimensions independently.

Optionally compute:

**Activity level**

based on anomaly volume, but clearly label its methodology.

---

# 17. Search

Search should support:

- countries
- cities
- regions
- signal types
- detected events

Example:

Search:

`Japan`

→ globe zooms to Japan.

---

# 18. Data architecture

Recommended conceptual pipeline:

```text
PUBLIC DATA SOURCES
        ↓
INGESTION WORKERS
        ↓
NORMALIZATION
        ↓
TIME SERIES STORAGE
        ↓
BASELINE ENGINE
        ↓
ANOMALY DETECTION
        ↓
WORLD SIGNAL DATABASE
        ↓
API
        ↓
WEB APPLICATION
```

Keep providers modular.

Example:

```text
/providers

usgs.ts
nasaFirms.ts
cloudflare.ts
opensky.ts
```

Each provider should expose a normalized interface.

---

# 19. Suggested stack

Codex can adapt where justified.

Frontend:

- Next.js
- React
- TypeScript
- Tailwind
- Mapbox / deck.gl / Cesium
- Recharts or another lightweight visualization library

Backend:

- Next.js API routes or separate Node service

Database:

- PostgreSQL

Prefer PostGIS if useful for geographic queries.

Time-series requirements can initially remain in PostgreSQL.

Cache:

- Redis optional

Background jobs:

- cron / queue workers

AI:

- OpenAI API

Architecture must make it easy to replace individual providers.

---

# 20. Repository architecture

Prefer something similar to:

```text
/apps
  /web

/packages
  /core
  /providers
  /signals
  /ai
  /database
```

or a simpler structure if appropriate for MVP.

Avoid premature microservices.

---

# 21. Demo mode

This is essential.

The application must remain impressive even if external APIs:

- fail
- rate-limit
- require unavailable credentials
- temporarily return no significant events

Create a realistic demo dataset containing historical or synthetic-but-clearly-labelled signals.

Demo mode should reproduce the complete UX.

Never present synthetic demo events as live real-world information.

---

# 22. Visual direction

The interface should feel premium and cinematic.

References:

- intelligence operations center
- Bloomberg Terminal
- NASA visualization
- modern command center
- Google Earth

Avoid generic SaaS aesthetics.

Avoid:

- giant rounded cards everywhere
- excessive gradients
- marketing landing-page design
- excessive text
- dashboard clutter

Prefer:

- dark interface
- globe as dominant visual
- typography hierarchy
- subtle borders
- restrained animations
- monospace for measurements/data
- strong information density
- smooth geographic transitions

The product should feel like:

> **a window into the live state of Earth.**

---

# 23. Landing experience

The product itself IS the landing page.

No traditional marketing page.

Opening WORLD SIGNAL immediately shows:

```text
WORLD SIGNAL

LIVE                              21:43 UTC

        [INTERACTIVE EARTH]

23 significant signals detected

🔥 7    🌎 5    🌐 4    ✈️ 7
```

Live feed on the side.

Timeline at bottom.

Filters accessible immediately.

---

# 24. MVP scope

Do not attempt the full vision immediately.

## Phase 1

Build the visual prototype with demo data:

- globe
- signal markers
- live feed
- filters
- signal panel
- charts
- timeline
- responsive layout

The experience should already look production-quality.

## Phase 2

Connect:

- USGS earthquakes
- NASA FIRMS

Build normalization.

## Phase 3

Implement:

- historical storage
- baseline calculation
- anomaly detection

## Phase 4

Add:

- Internet data
- aviation data

## Phase 5

Add:

- AI Brief
- Ask Earth
- correlation engine

---

# 25. Future expansion

Do NOT implement all of these initially, but keep architecture extensible.

Possible future layers:

### Maritime

AIS / shipping activity.

### Energy

Electricity generation, grids, oil, gas.

### Weather

Extreme weather anomalies.

### Climate

Temperature anomalies, droughts, sea temperatures.

### Satellites

Earth observation imagery.

### News

Geolocated reporting used as contextual evidence.

### Live cameras

Public webcams / legitimate live streams.

### Supply chains

Map dependencies for:

- oil
- wheat
- coffee
- cocoa
- semiconductors
- lithium

Example:

User selects:

**COFFEE**

WORLD SIGNAL displays:

production regions → ports → shipping routes → destination markets

and overlays current anomalies.

---

# 26. Core differentiation

WORLD SIGNAL should NOT become:

- another news map
- another weather map
- another disaster tracker
- another flight tracker
- another AI chatbot

Its differentiation is:

> **Detecting meaningful deviations across independent real-world systems and making those deviations understandable.**

The key question is always:

# WHAT CHANGED?

not:

# WHAT EXISTS?

---

# 27. Trust

Trust is a product feature.

Every signal must expose:

**Source**

**Timestamp**

**Observed value**

**Baseline**

**Methodology**

**Confidence**

AI-generated content must be explicitly identified.

Where data is incomplete, say so.

Never fabricate missing values.

---

# 28. Performance

The globe must remain fluid.

Requirements:

- lazy-load heavy layers
- cluster markers where appropriate
- avoid unnecessary React rerenders
- cache external API responses
- limit raw data transferred to browser
- aggregate server-side when appropriate

Target smooth interaction on modern desktop hardware.

Mobile can use a simplified visualization if necessary.

---

# 29. First implementation task

Do NOT start by integrating every API.

First:

1. scaffold the project;
2. create the application shell;
3. build the globe;
4. create realistic demo data;
5. implement signal markers;
6. implement live signal feed;
7. implement signal detail panel;
8. implement filters;
9. implement timeline;
10. ensure clicking a signal smoothly moves the globe to its location.

Once the visual product is convincing, proceed to real data ingestion.

Before implementation, inspect the repository and existing code.

Reuse existing infrastructure where appropriate.

Do not rewrite working components unnecessarily.

Document architectural decisions.

If requirements conflict, prioritize:

**trust → usability → performance → visual polish → feature breadth.**

---

# 30. Definition of success

The first version succeeds if someone can open WORLD SIGNAL without explanation and within 30 seconds understand:

> something unusual is happening somewhere on Earth,

click it,

see exactly **what changed**,

understand **how unusual it is**,

see **the underlying evidence**,

and understand **why it may matter**.

The emotional reaction should be:

> **“I didn't know you could see the world like this.”**
