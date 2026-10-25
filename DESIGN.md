# Cora — Design System

The admin panel is a **radio studio mixing desk**. Each agent is a channel strip on the desk: a fader for how chatty it is, LEDs for its state, a small monitor showing its desktop. Discord is the "ON AIR" lamp. The live activity feed is a teletype strip. Dark, warm, tactile; amber tungsten light on charcoal.

## Colors (CSS custom properties in `web/styles.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#14110e` | page background (warm near-black) |
| `--bg-grain` | radial gradients + SVG noise | atmosphere on `body` |
| `--panel` | `#1d1915` | cards, strips, panels |
| `--panel-2` | `#26211b` | inputs, nested surfaces, hover |
| `--line` | `#3a3229` | hairlines, borders |
| `--line-strong` | `#57493a` | focused borders, dividers on hover |
| `--text` | `#efe6d8` | primary text (warm paper) |
| `--muted` | `#a39580` | secondary text, labels |
| `--faint` | `#6f6455` | placeholders, disabled |
| `--amber` | `#f2a93b` | primary accent: active tab, fader cap, primary button |
| `--amber-glow` | `rgba(242,169,59,.35)` | lamp/LED glow, focus ring |
| `--red` | `#e5533d` | ON AIR lamp lit, destructive actions, errors |
| `--green` | `#8cc56a` | LED: desktop running / ok |
| `--blue` | `#6fa8dc` | tool calls in the feed |
| `--paper` | `#e9dfcc` | teletype strip background |
| `--ink` | `#2b241c` | teletype text |

Each agent also has its own `color` (stored on the agent, default `#e8a33d`), used for its avatar ring and its name in the feed.

## Typography

Loaded from Google Fonts.

- **Display — Big Shoulders Display** (700/800): logo, page titles, agent names on strips. Uppercase with `letter-spacing: .04em` for labels on the desk.
- **Body — Instrument Sans** (400/500/600): forms, paragraphs, buttons.
- **Mono — Martian Mono** (400/500): cron expressions, ids, timestamps, the teletype feed, small hardware-style labels (`font-size: 10–11px`, uppercase, `letter-spacing: .12em`).

Scale: 11 / 13 / 15 (base) / 18 / 24 / 40 / 64px.

## Spacing & shape

- Spacing unit 4px; common steps 8, 12, 16, 24, 32, 48.
- Radii: `--r-sm 6px` (inputs, chips), `--r-md 10px` (cards), `--r-lg 16px` (strips, panels). LEDs and avatars are circles.
- Borders are 1px `--line`; panels add an inner top highlight `inset 0 1px 0 rgba(255,255,255,.04)` and a soft drop shadow, like brushed hardware.
- Content max width 1280px, 16px side gutter on phones.

## Brand

- **Name:** Cora — Computer-Operating Resident Agents. Wordmark in Big Shoulders Display 800, uppercase.
- **Mark:** a sphere in outline on charcoal: a thin amber rim and one equator tilted −24°, its far half at 38% opacity for depth. No fill, no glow. Drawn by `bin/icons.mjs` (PNG app icons, supersampled) and `web/favicon.svg`.
- **Login:** the mark, the wordmark, the tagline, then the password card; nothing animated around it.

## App shell

The panel behaves like an installed app (web manifest, apple-touch-icon, no pinch or double-tap zoom, 16px inputs on phones so iOS never zooms).

- **Desktop (≥ 900px)**: a fixed sidebar (brand, the channel card with the ON AIR lamp, navigation, the agents with a status dot, Esci) and a scrolling content column.
- **Phone**: a top app bar (back chevron on sub-pages, page title, lamp) and a bottom tab bar (Banco, Salotto, Agenti, Impostazioni) with safe-area padding. The shell is `position: fixed`; only the content scrolls. Chat pages fill the screen with the composer docked above the tab bar.
- **Icons**: inline 24px stroke icons (`ICONS` in `web/app.js`, stroke 1.8, round caps), in amber icon wells (`.panel-ico`) on panel headers and stat cards; Discord is `#`, Telegram is the paper plane.
- **Panels**: every section is a `.panel` with a header (icon well, title in the display font, one-line hint, actions on the right; on phones status badges drop under the title) and a body with 14px rhythm. Forms end with a sticky `.savebar`.

## Components

- **ON AIR lamp** (`.onair`): pill in the top bar. Lit red with glow when Discord is `ready`, amber blinking while connecting, dark when off/error (error text in the tooltip and the dashboard).
- **Channel strip** (`.strip`): agent card on the dashboard. Top: monitor (desktop thumbnail, 16:10, scanline overlay, "SPENTO" when off). Middle: avatar with color ring, name (display font), model (mono). Bottom: horizontal fader showing chattiness, LEDs (`.led` on/off/warn) for *attivo*, *desktop*, *strumenti*. Whole strip is a link to the agent.
- **Fader** (`input[type=range].fader`): track with tick marks, amber cap. Used for chattiness.
- **Teletype** (`.teletype`): paper strip with perforation edges, mono text, newest on top, each line `time · who · what`; tool calls in blue, errors in red, agent messages in the agent's color.
- **Tabs** (`.tabs`): hardware buttons; active one is lit amber with a small LED dot. Scroll horizontally on phones.
- **Buttons**: `.btn` (panel-2, line border), `.btn.primary` (amber fill, ink text), `.btn.danger` (red outline), `.btn.ghost`. 36px tall, 44px on touch.
- **Toggle** (`.switch`): small rocker switch with LED.
- **Chips** (`.chip`): channel selection, `# name`, toggled amber when selected.
- **Desktop frame** (`.monitor-frame`): the noVNC iframe inside a bezel with the agent's name plate.

- **Chat** (`.panel.chat`): dark log well; owner bubbles amber on the right, agent bubbles with the agent's color as a left rule, a "ragionamento ›" link on each reply. While an agent works, a dashed amber card with its pulsing avatar shows the live step.
- **Requests** (`.requests`): an amber strip on top of the Salotto and the Banco listing the agents' unanswered questions; in the chat a request bubble has an amber «Richiesta» tag and its quick answers as amber buttons, which disappear once the owner answers. Web links in chat messages (bare URLs and `[label](url)`) are clickable, amber with a faint amber underline that lights up on hover, opening in a new tab.
- **Trace** (`.steps-log`): one row per step with its offset; thinking with an amber rule in italics, written text with a neutral rule, tool calls in blue as expandable `details` with arguments and result in mono wells. The answer sits in an amber box; context and system prompt are collapsed at the bottom.

## usecora.space (the cloud's pages, `cloud/`)

The same desk, as a late-night broadcast. English only. Server-rendered, no build; `cloud/web/cloud.css` repeats the panel's tokens.

- **Landing:** the hero headline "Lives where your company is" in Big Shoulders Display 900 (second line outlined, last word amber with a glow), beside a broadcast console: ON AIR lamp, clock, a paper teletype that replays one exchange (routine, request with Yes/Not yet, answer) and a frequency dial with the agents as stations. Then: where it lives (one thread moving across Discord, Telegram and the app, as three tilted windows), Bring your own intelligence (the biggest statement on the page, with a patch bay: brains on the left, agents on the right, a cable for each choice), the desk (four channel strips with fader and LEDs), a day in the life (a 24-hour ruler with the real time as a red line), the call-in line (a phone with the request), and your space (`yourcompany.usecora.space` typing itself).
- **Sign-in and account:** one centered card with the mark; provider buttons; spaces as rows with the ON AIR lamp and an Enter button; the space request as a name field with the `.usecora.space` suffix.
- Every section is readable without JavaScript; the teletype starts complete and replays after a moment; `prefers-reduced-motion` stops all motion.

## Motion

- Page load: strips rise in with staggered `animation-delay` (60ms steps).
- LEDs pulse softly when active; ON AIR lamp flickers once when it turns on.
- New teletype lines slide down from the top.
- Respect `prefers-reduced-motion`: no animations.

## Copy

UI language is Italian. Keep labels short and concrete ("Esegui ora", "Accendi desktop", "Ricordi").
