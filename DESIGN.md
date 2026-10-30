# Cora — Design System

The admin panel is a **radio studio mixing desk**. Each agent is a channel strip on the desk: a fader for how chatty it is, LEDs for its state, a small monitor showing its desktop. Discord is the "ON AIR" lamp. The live activity feed is a teletype strip. Dark and tactile: one amber light on near-pure black, never brown.

## Colors (CSS custom properties in `web/styles.css`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#050505` | page background (near-pure black) |
| `--bg-grain` | radial gradients + SVG noise | atmosphere on `body` |
| `--panel` | `#0f0f0f` | cards, strips, panels |
| `--panel-2` | `#171717` | inputs, nested surfaces, hover |
| `--well` | `#000000` | wells: chat log, code, tracks |
| `--line` | `#232323` | hairlines, borders |
| `--line-strong` | `#353535` | focused borders, dividers on hover |
| `--text` | `#f5f5f3` | primary text |
| `--muted` | `#8f8f8a` | secondary text, labels |
| `--faint` | `#5c5c58` | placeholders, disabled |
| `--amber` | `#f2a93b` | primary accent: active tab, fader cap, primary button |
| `--amber-glow` | `rgba(242,169,59,.35)` | lamp/LED glow, focus ring |
| `--amber-line` / `--amber-wash` | amber at 38% / 8% | borders and fills of amber things (owner bubbles, requests, answers, switches) |
| `--red` | `#e5533d` | ON AIR lamp lit, destructive actions, errors |
| `--green` | `#8cc56a` | LED: desktop running / ok |
| `--blue` | `#6fa8dc` | tool calls in the feed |
| `--paper` | `#e9dfcc` | teletype strip background |
| `--ink` | `#1d1b18` | teletype text, text on amber buttons |

Each agent also has its own `color` (stored on the agent, default `#e8a33d`), used for its avatar ring and its name in the feed.

## Typography

Loaded from Google Fonts.

- **Display — Outfit** (600): logo, page titles, panel titles, agent names on strips. Rounded geometric, sentence case, tight tracking (`-0.02em` small, `-0.04em` large).
- **Body — Manrope** (400/500/600): forms, paragraphs, buttons.
- **Mono — DM Mono** (400/500): cron expressions, ids, timestamps, the teletype feed, small hardware-style labels (`font-size: 10–11px`, uppercase, `letter-spacing: .12em`).

Scale: 11 / 13 / 15 (base) / 17 / 20 / 38 / 44 / 56px.

## Spacing & shape

- Spacing unit 4px; common steps 8, 12, 16, 24, 32, 48.
- Radii: `--r-sm 6px` (inputs, chips), `--r-md 10px` (cards), `--r-lg 16px` (strips, panels). LEDs and avatars are circles.
- Borders are 1px `--line`; panels add an inner top highlight `inset 0 1px 0 rgba(255,255,255,.04)` and a soft drop shadow, like brushed hardware.
- Content max width 1280px, 16px side gutter on phones.

## Brand

- **Name:** Cora — Computer-Operating Resident Agents. Wordmark "Cora" in Outfit 600.
- **Mark:** a sphere in outline on black: a thin amber rim and one equator tilted −24°, its far half at 38% opacity for depth. No fill, no glow. Drawn by `bin/icons.mjs` (PNG app icons, supersampled) and `web/favicon.svg`.
- **Login:** the mark, the wordmark, the tagline, then the password card; nothing animated around it.

## App shell

The panel behaves like an installed app (web manifest, apple-touch-icon, no pinch or double-tap zoom, 16px inputs on phones so iOS never zooms).

- **Desktop (≥ 900px)**: a fixed sidebar (brand, the channel card with the ON AIR lamp, navigation, the agents with a status dot, Esci) and a scrolling content column.
- **Phone**: a top app bar (back chevron on sub-pages, page title, lamp) and a bottom tab bar (Agenti, Salotto, Banco, Impostazioni) with safe-area padding. The shell is `position: fixed` and sized to the real visible viewport via `--app-h` (set from `visualViewport` in `fitViewport()`), so iOS standalone PWAs show no dead strip at the bottom; only the content scrolls. While the keyboard is up (`.kbd-open`) the tab bar hides so the composer rests on the keyboard. Chat pages fill the screen with the composer docked above the tab bar: there the agent card is hidden (the app bar already names the agent), the working card is one line, and the tab bar keeps only the clearance the home indicator needs (`max(4px, safe-bottom - 14px)`) instead of the whole inset, so the log gets about two thirds of the screen.
- **Icons**: inline 24px stroke icons (`ICONS` in `web/app.js`, stroke 1.8, round caps), in amber icon wells (`.panel-ico`) on panel headers and stat cards; Discord is `#`, Telegram is the paper plane, Slack is four strokes turning around a centre.
- **Panels**: every section is a `.panel` with a header (icon well, title in the display font, one-line hint, actions on the right; on phones status badges drop under the title) and a body with 14px rhythm. Forms end with a sticky `.savebar`.

## Components

- **Usage heatmaps**: show the first recorded usage day through today, at most the year returned by the API. Each agent starts at its own first use. Week alignment uses invisible placeholders, never dated cells before the first record or in the future. Keep squares at 14px; show the date range with its year. Scroll long histories to the latest week only after mounting, and realign when the viewport changes. Show an explicit empty state when there is no recorded usage.
- **Home**: opening the panel at `/` or `#/` shows Agents. Global token usage comes first, followed by the agent roster and individual token usage. The lounge has its own `#/salotto` route, also used by lounge requests and push notifications. Explicit links to agent tabs still open the requested tab.
- **Skeletons**: neutral placeholders use the existing panel and line tokens with a quiet neutral pulse, never amber. Match the content shape: avatar and text rows, usage heatmaps, and alternating chat bubbles with a composer. Loading regions use `role="status"`, a translated loading label and `aria-busy="true"`; visual shapes are hidden from assistive technology. Replace placeholders with content or a concrete error, and respect reduced motion.

- **Token forms**: one password input and a «Collega» button in an `.input-row.token`. A service that needs two tokens (Slack: the bot's and the app-level one) stacks both inputs in a `.stack-sm` with the button on its own row, and says in the steps which page of the provider each one comes from.
- **Manifest block**: for a provider that creates its apps from a document (Slack), a row with «Copia il manifest» and the link that opens the provider, and a `<details>` holding the JSON in the mono font. Never make someone retype what a paste can do.

- **ON AIR lamp** (`.onair`): pill in the top bar. Lit red with glow when Discord is `ready`, amber blinking while connecting, dark when off/error (error text in the tooltip and the dashboard).
- **Channel strip** (`.strip`): agent card on the dashboard. Top: monitor (desktop thumbnail, 16:10, scanline overlay, "SPENTO" when off). Middle: avatar with color ring, name (display font), model (mono). Bottom: horizontal fader showing chattiness, LEDs (`.led` on/off/warn) for *attivo*, *desktop*, *strumenti*. Whole strip is a link to the agent.
- **Fader** (`input[type=range].fader`): track with tick marks, amber cap. Used for chattiness.
- **Teletype** (`.teletype`): paper strip with perforation edges, mono text, newest on top, each line `time · who · what`; tool calls in blue, errors in red, agent messages in the agent's color.
- **Tabs** (`.tabs`): hardware buttons; active one is lit amber with a small LED dot. Scroll horizontally on phones.
- **Buttons**: `.btn` (panel-2, line border), `.btn.primary` (amber fill, ink text), `.btn.danger` (red outline), `.btn.ghost`. 36px tall, 44px on touch.
- **Toggle** (`.switch`): small rocker switch with LED.
- **Model picker** (`.model-pick`): the model list grouped by provider, and under it a mono text box for any `provider/model` id; when the box is filled it wins and the list dims. Used while an agent is being created, where there is no Brain tab yet.
- **Brain** (`.brain-main`): the agent's Cervello tab, two columns on desktop and one on phones. Left: the harnesses as `.harness-row` buttons, the chosen one lit amber, each with its one-line job and a «da installare» badge when this machine does not have it. Right (`.brain-side`, separated by a hairline): a `.segmented` switch between **Su questa macchina** and **Nel cloud** — shown only when both exist — and under it the models for that pair as `.model-row`s. Local rows carry size, the card's verdict (`entra` / `stretta` / `non entra`) or, for a model that is loaded, what the card actually took; cloud rows carry the endpoint that answers. A row that cannot be used is disabled and says why: *senza strumenti*, or *questa macchina non è collegata a Ollama Cloud*. The instance default appears as the first row only in the harness and the place it belongs to. A harness this machine cannot run shows a `.notice.warn` with what it needs instead of a model list, and the free-text id lives behind a `.brain-custom` disclosure.
- **Notice** (`.notice`, `.notice.warn`): an inline explanation inside a panel, icon left and text right; the warn variant is amber-lined on an amber wash. For a condition the reader must act on, never for status.
- **Subscription picker** (`.subscription-picker`): a quiet account card with a provider mark, identity and a text status with an LED. The default resident account is identified explicitly; **Change account** reveals selectable account rows and **Connect another account**. Browser authorization replaces the card body with two numbered steps; device codes use a dashed mono well with a copy button, while Claude's returned code goes in a password field. Show errors inline, keep entered codes across polls, and place advanced device-code help behind a disclosure. Avoid showing creation inputs, selection controls and login actions simultaneously. The same component serves agent forms and Settings, with context-appropriate copy.
- **Settings tabs**: Connections, Channels, Agents, Preferences and Access. Sticky text tabs with small icons on desktop, horizontally scrollable text tabs on phones, proper tab/tabpanel semantics and arrow-key navigation. Hide inactive panes without unmounting their form fields so draft values survive tab changes. Connections contains resident subscription discovery (provider, email, plan and availability), separately connected accounts and masked API-key fields with their own save actions. Save settings appears only for panes containing deferred settings.
- **Chips** (`.chip`): channel selection, `# name`, toggled amber when selected.
- **Desktop frame** (`.monitor-frame`): the noVNC iframe inside a bezel with the agent's name plate.

- **Chat** (`.panel.chat`): dark log well; owner bubbles amber on the right, agent bubbles with the agent's color as a left rule, a "ragionamento ›" link on each reply. While an agent works, a dashed amber card with its pulsing avatar shows the live step.
- **Requests** (`.requests`): an amber strip on top of the Salotto and the Banco listing the agents' unanswered questions; in the chat a request bubble has an amber «Richiesta» tag and its quick answers as amber buttons, which disappear once the owner answers. Web links in chat messages (bare URLs and `[label](url)`) are clickable, amber with a faint amber underline that lights up on hover, opening in a new tab.
- **Trace** (`.steps-log`): one row per step with its offset; thinking with an amber rule in italics, written text with a neutral rule, tool calls in blue as expandable `details` with arguments and result in mono wells. The answer sits in an amber box; context and system prompt are collapsed at the bottom.

## usecora.space (the cloud's pages, `cloud/`)

The radio desk at night: the same details as the panel (teletype on perforated paper, channel strips with fader and LEDs, ON AIR lamp, frequency dial, mono capitals for small labels), on near-pure black. English only. Server-rendered, no build; tokens in `cloud/web/cloud.css`, linked with `?v=<hash>` so a deploy is never hidden by the cache.

- **Color:** near-pure black (`--bg #050505`, panels `#0f0f0f`/`#171717`, hairlines `#232323`), neutral greys for text (`#f5f5f3`, `#c9c9c5`, `#8f8f8a`), never brown; the amber `#f2a93b` is the one accent; the teletype keeps its cream paper with black perforations.
- **Type:** Outfit 600 for headings (sentence case, tight tracking; the hero's second line is an outline drawn as a thick stroke under a fill the color of the page, so glyph overlaps never show), Manrope for text, DM Mono for labels (capitals with letter-spacing) and the teletype.
- **Landing:** a centered hero that says what Cora is ("AI agents that live in your team chat.", one line of explanation, the waitlist form) under the orb: the Cora sphere, its meridians turning, that beats once per agent event, a ring in that agent's color expanding from it and a chip with what the agent just did (desktop: chips around the sphere; phones: one under it). No sign-in on the landing until it opens. Below, one line per section: the broadcast console with the paper teletype (watch them work), one thread across Discord, Telegram and the app, Bring your own intelligence with every provider an agent can run on (two groups, *Your subscriptions*: Claude, ChatGPT, Grok, Meta; *Open models*: Ollama, OrcaRouter, Hermes; one row each with the brand's one-color mark, its name, how it runs and a LED that lights amber on hover — OrcaRouter has no one-color mark, so a plain router glyph), the four channel strips, a day on the 24-hour ruler, the Cora harness (four steps on an amber line with pulsing LEDs), and your space (`yourcompany.usecora.space` typing itself) with the waitlist again.
- **Sign-in and account:** one centered card with the mark; provider buttons; spaces as rows with the ON AIR lamp and an Enter button; the space request as a name field with the `.usecora.space` suffix.
- Every section is readable without JavaScript; the teletype starts complete and replays after a moment; `prefers-reduced-motion` stops all motion.

## Instance access and context

- **Access** stays in Settings. A compact identity row precedes two columns for authorized domains and individual emails. Each rule is a removable row; admission updates immediately. Users appear as readable rows with identity, first visit, last activity, role and revoke/restore actions. Members see their own identity and a read-only permissions explanation. Revocation replaces their panel with an explicit access-revoked screen; restoration is verified by a new sign-in. Email inputs use the same dark well, focus ring and mobile size as other text controls.
- **Context** is a main navigation destination alongside Agents, Lounge and Desk. Use a compact source rail and a spacious document well: provider, file name, scope, provenance badge, path and update time. On phones the source rail scrolls horizontally inside its own bounds and the five-item bottom navigation stays within the viewport. Server instruction text is read-only, selectable mono text with line wrapping and its own vertical scroll. Space files add create/upload controls in the page header and an inline editor in the document pane. Keep the rail and source identity consistent while editing. Show a name field, a generous mono text area, character count, enable switch and save/cancel actions; preserve drafts when a user attempts to switch sources. DB files get explicit edit/enable/delete actions, and their scope distinguishes them from native files. Deletion uses the existing armed action pattern. Do not render raw Markdown as HTML. Applied, available, excluded and missing sources remain visibly distinct; never imply a detected file is necessarily loaded.

The landing’s harness section ends with a short **Your context, your rules.** note: an outlined document mark, one small display heading and a plain paragraph, separated by a hairline. It inherits the dark palette and wraps naturally on phones.

## Scheduled tasks and archive

Keep routines and one-time reminders together in the agent’s **Routines and reminders** tab. A second, compact text navigation switches between **Scheduled** and **Archive**. The creation form uses two quiet, selectable task-type cards; only the relevant cron or exact date/time controls appear. Date/time fields use the same dark well, border, height and focus ring as other inputs. State updates replace only the scheduled list and preserve creation drafts.

The archive uses a compact filter bar and a vertical ledger of restrained black document cards: task name, type, agent, exact timestamp including year/timezone, explicit outcome, and verification reason. Task/output disclosures and reasoning/verification links sit below. Execution history and archived definitions are separate filter modes; search, type and agent filters are persistent while paginating. Verified success is green; blocked/unverified states remain explicit. Historical records state that verification is unavailable. On phones the mode selector spans the width, search has its own row, card metadata wraps, and the five main navigation items remain unchanged. The global archive is reached from Desk, with a clear back link.

## Motion

- Page load: strips rise in with staggered `animation-delay` (60ms steps).
- LEDs pulse softly when active; ON AIR lamp flickers once when it turns on.
- New teletype lines slide down from the top.
- Respect `prefers-reduced-motion`: no animations.

## Copy

UI language is Italian. Keep labels short and concrete ("Esegui ora", "Accendi desktop", "Ricordi").

All fixed copy, including text set after rendering, goes through the English dictionary in `web/i18n.js`. Format month names and numbers with the selected locale; translate legends, totals, daily details, loading states and errors as well as section titles. Names and authored content remain untranslated.
