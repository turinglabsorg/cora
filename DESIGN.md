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
| `--kind-client` … `--kind-topic` | amber `#f2a93b`, blue `#6fa8dc`, green `#8cc56a`, rose `#e0789a`, lavender `#b39ddb`, teal `#5cbfb0` | the six kinds of brain page (client, project, person, decision, procedure, topic): the nodes of the brain map and their legend |

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
- **Phone**: a top app bar (back chevron on sub-pages, page title, lamp) and a bottom tab bar (Agenti, Salotto, Banco, Contesto, Brain, Impostazioni: one row, as many equal columns as there are sections) with safe-area padding. The shell is `position: fixed` and sized to the real visible viewport via `--app-h` (set from `visualViewport` in `fitViewport()`), so iOS standalone PWAs show no dead strip at the bottom; only the content scrolls. While the keyboard is up (`.kbd-open`) the tab bar hides so the composer rests on the keyboard. Chat pages fill the screen with the composer docked above the tab bar: there the agent card is hidden (the app bar already names the agent), the working card is one line, and the tab bar keeps only the clearance the home indicator needs (`max(4px, safe-bottom - 14px)`) instead of the whole inset, so the log gets about two thirds of the screen.
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
- **Settings tabs**: Connections, Channels, Agents, Permissions, Controls, Preferences and Access. Sticky text tabs with small icons on desktop, horizontally scrollable text tabs on phones, proper tab/tabpanel semantics and arrow-key navigation. Hide inactive panes without unmounting their form fields so draft values survive tab changes. Connections contains resident subscription discovery (provider, email, plan and availability), separately connected accounts and masked API-key fields with their own save actions. Save settings appears only for panes containing deferred settings.
- **Brain** (`#/brain`, `.brain-*`): a main section with the bulb icon. The list page: a row of stat cards (pages, to review, searchable messages, the librarian's last run; three columns plus a full-width one on phones), a search field and kind chips (*Tutte*, Clienti, Progetti, Persone, Decisioni, Procedure, Temi), then `.brain-row`s between hairlines (title in the display font, summary muted, kind badge and an amber *Da rivedere* badge on the right), then the owner's *Il bibliotecario* panel (model picker, embedding model, the two hours). The page header carries *Rivedi (N)* (primary while something waits, ghost otherwise) and *Aggiorna adesso*. A page: the title as page head with kind, review and updated-at, the summary as lead, the text rendered as markdown (see **Markdown**; `[[slug]]` as amber mono links; never HTML), and *Storia*: each revision with action, review badge, author and time, its note, a conflict as `.notice.warn`, and its sources as quotes with an amber left rule (who in amber mono, channel and date faint). The review: one `.brain-change` card per change (amber border when flagged), the line diff in a mono well (added lines on a faint green wash with `+`, removed ones struck through on a faint red wash with `−`), the sources, and *Annulla* (ghost) · *Approva* (primary); *Approva tutto* in the header. Nothing on the review blocks anything: the copy says changes already count. Above the search a `.segmented` switch *Elenco* · *Mappa* (`#/brain` · `#/brain/mappa`).
- **Markdown** (`.md`, `markdown()` in `web/app.js`): chat messages (panel rooms, Salotto) and brain pages are rendered as markdown, built as DOM nodes (never HTML from the text): headings from `#` as h3…h6 in the display font (19/17/15/13px), paragraphs keeping their line breaks, lists with amber markers (numbers in mono), nested lists, `- [ ]`/`- [x]` as disabled amber checkboxes, quotes with a 2px amber-line rule in muted text, inline code in DM Mono on `--panel-2` with a hairline, fenced code in a `--well` block with a mono language label and a copy button in its header strip, tables in a hairline frame that scrolls sideways on phones (mono muted headers on `--panel-2`, column alignment from `:---:`), `---` as a hairline, links amber with a soft underline (web and mail only; `javascript:` and the like stay text), bare web addresses linked without their final punctuation, `[[slug]]` as amber mono brain links in brain pages only. Underscores inside a word (snake_case) are never emphasis, and a line like "2026. Poi…" stays a sentence.
- **Brain map** (`#/brain/mappa`, `.brain-map`): the pages as a graph in a black well (`--well`, a faint 24px dot grid, `--r-lg`), as tall as the screen allows (`clamp(420px, 100dvh − 300px, 860px)`; on phones `100dvh − 330px`, at least 360px). Each page is a node like a desk LED: a disc tinted with its kind's colour at 22% on the well, a 1.5px rim in that colour, sized by how many pages it touches; a page waiting for review wears a dashed amber ring. Its title sits under it in Manrope 12px with a `--well` halo; names keep their size on screen whatever the zoom, and where two would overlap only the better-linked page keeps its name (the chosen page and its neighbours always show theirs). A `[[link]]` is a 1.2px `--line-strong` line, a title named without a link a dashed `--line` one. The layout is a small force simulation (no library) that settles in about two seconds, fitted to the well until the viewer touches it (with reduced motion it is computed at once). Drag the background to pan, a node to move it; wheel or pinch to zoom; the top-right buttons zoom in, out and refit. Selecting a node lights it, its neighbours and their lines in amber and dims the rest to 18%; its card (bottom left; the full width at the bottom on phones) shows kind, *Da rivedere*, title, summary, the linked pages as chips to hop to, and *Apri la pagina*; a double click opens the page at once; Esc or a click on the background lets go. The kind chips and the search dim what does not match instead of moving anything. Top left, the legend: one dot per kind with its count, then the two line styles. Nodes are focusable buttons (Enter selects, Enter again opens).
- **Permissions** (Settings → Permessi, `.permissions` / `.permission` / `.permission-who`): one panel, *Chi può far lavorare gli agenti*. Each authorized person is a row between hairlines: the round user mark, the name in 15px, under it the platform's icon and name with the last message date in muted 12px, a ghost trash button on the right; below, indented under the name (flush on phones), a chip row: *Tutti gli agenti* first, then one chip per agent, lit amber when the person may put that agent to work (all lit with *Tutti*). A chip saves at once and confirms with a toast; turning off the last agent removes the person. Under the rows, an `.access-add` line: a select of the people who wrote and hold nothing yet (`name · platform`) and a primary *Autorizza*. With nobody authorized a faint line says the agents ask the owner for anyone else. Members see the rows with disabled chips and an info note that only the owner changes them. No savebar on this tab.
- **Voice** (`voicePanel`, `.voice-row` / `.voice-listen` / `.voice-preview`): a panel in the agent's Profile with the mic icon. Two selects side by side (one column on phones): *Lingua* (the instance's, or one of six) and *Voce*, Soniox's voices for that language with *Automatica* first; one muted line under them with the picked voice's description. *Ascolta* (ghost, play icon) plays a short sample in a native `<audio>` that appears next to it. Without the Soniox key both selects and the button are disabled and the line links to Settings → Connections. There is no switch for spoken answers: a voice message always gets one.
- **Voice messages in chat** (`.chat-file.audio`): a native `<audio>` with controls, at most 320px wide, under the bubble's text, like a picture.
- **Chips** (`.chip`): channel selection, `# name`, toggled amber when selected.
- **Desktop frame** (`.monitor-frame`): the noVNC iframe inside a bezel with the agent's name plate.

- **Chat** (`.panel.chat`): dark log well; owner bubbles amber on the right, agent bubbles with the agent's color as a left rule, a "ragionamento ›" link on each reply. While an agent works, a dashed amber card with its pulsing avatar shows the live step.
- **Requests** (`.requests`): an amber strip on top of the Salotto and the Banco listing the agents' unanswered questions; in the chat a request bubble has an amber «Richiesta» tag and its quick answers as amber buttons, which disappear once the owner answers. Web links in chat messages (bare URLs and `[label](url)`) are clickable, amber with a faint amber underline that lights up on hover, opening in a new tab.
- **Goals** (`.goal-row`, Reasoning tab, above the turns): one `details` row per goal: a mono-labelled token box on the left (the total in amber), the goal on two lines, then its status tag, turns, tokens in · out, where and when; opening it lists that goal's turns. Each turn row carries an amber `tokens` tag.
- **Trace** (`.steps-log`): one row per step with its offset; thinking with an amber rule in italics, written text with a neutral rule, tool calls in blue as expandable `details` with arguments and result in mono wells. The answer sits in an amber box; context and system prompt are collapsed at the bottom.

## usecora.space (the cloud's pages, `cloud/`)

The radio desk at night: the same details as the panel (teletype on perforated paper, channel strips with fader and LEDs, ON AIR lamp, frequency dial, mono capitals for small labels), on near-pure black. English only. Server-rendered, no build; tokens in `cloud/web/cloud.css`, linked with `?v=<hash>` so a deploy is never hidden by the cache.

- **Color:** near-pure black (`--bg #050505`, panels `#0f0f0f`/`#171717`, hairlines `#232323`), neutral greys for text (`#f5f5f3`, `#c9c9c5`, `#8f8f8a`), never brown; the amber `#f2a93b` is the one accent; the teletype keeps its cream paper with black perforations.
- **Type:** Outfit 600 for headings (sentence case, tight tracking; the hero's second line is an outline drawn as a thick stroke under a fill the color of the page, so glyph overlaps never show), Manrope for text, DM Mono for labels (capitals with letter-spacing) and the teletype.
- **Landing:** a centered hero that says what Cora is ("AI agents that live in your team chat.", one line of explanation, the waitlist form) under the orb: the Cora sphere, its meridians turning, that beats once per agent event, a ring in that agent's color expanding from it and a chip with what the agent just did (desktop: chips around the sphere; phones: one under it). No sign-in on the landing until it opens. Below, one line per section: the broadcast console with the paper teletype (watch them work), one thread across Discord, Telegram and the app, *Talk to them* (a Slack thread in a `.place`-style card: the owner's voice note as a black pill with a play button, a grey waveform and its length, the transcript under it in mono; the agent's written answer, then its own voice note in an amber-washed pill whose amber bars breathe while the section is in view; the waveform is drawn by `waveform()` in `cloud/src/views.js`, the same every time), Bring your own intelligence with every provider an agent can run on (two groups, *Your subscriptions*: Claude, ChatGPT, Grok, Meta; *Open models*: Ollama, OrcaRouter, Hermes, DeepSeek; one row each with the brand's one-color mark, its name, how it runs and a LED that lights amber on hover — OrcaRouter has no one-color mark, so a plain router glyph), the four channel strips, a day on the 24-hour ruler, the Cora harness (four steps on an amber line with pulsing LEDs), and your space (`yourcompany.usecora.space` typing itself) with the waitlist again.
- **Sign-in and account:** one centered card with the mark; provider buttons; spaces as rows with the ON AIR lamp and an Enter button; the space request as a name field with the `.usecora.space` suffix.
- Every section is readable without JavaScript; the teletype starts complete and replays after a moment; `prefers-reduced-motion` stops all motion.

## Instance access and context

- **Access** stays in Settings. A compact identity row precedes two columns for authorized domains and individual emails. Each rule is a removable row; admission updates immediately. Users appear as readable rows with identity, first visit, last activity, role and revoke/restore actions. Members see their own identity and a read-only permissions explanation. Revocation replaces their panel with an explicit access-revoked screen; restoration is verified by a new sign-in. Email inputs use the same dark well, focus ring and mobile size as other text controls.
- **Context** is a main navigation destination alongside Agents, Lounge and Desk. Use a compact source rail and a spacious document well: provider, file name, scope, provenance badge, path and update time. On phones the source rail scrolls horizontally inside its own bounds and the five-item bottom navigation stays within the viewport. Server instruction text is read-only, selectable mono text with line wrapping and its own vertical scroll. Space files add create/upload controls in the page header and an inline editor in the document pane. Keep the rail and source identity consistent while editing. Show a name field, a generous mono text area, character count, enable switch and save/cancel actions; preserve drafts when a user attempts to switch sources. DB files get explicit edit/enable/delete actions, and their scope distinguishes them from native files. Deletion uses the existing armed action pattern. Do not render raw Markdown as HTML. Applied, available, excluded and missing sources remain visibly distinct; never imply a detected file is necessarily loaded.

- **doc's checks** (Settings → Controls, `.doc-group` / `.doc-check` / `.doc-editor` / `.doc-trial`): two groups, *Messaggi in chat* and *Commenti pubblicati*, each a well-backed list of rows with a rocker, a label and one muted line; doc's own checks carry a small `doc` badge, the owner's carry an amber inset rule on the left and edit/delete icon buttons. "Aggiungi un controllo" sits in the body, not the panel head, so the hint keeps its width on phones. The editor is a dashed amber-washed card: name and keywords side by side, the question for Jev, what to tell the agent, two rockers for where it applies, then *Prova con tutti gli harness* · *Annulla* · *Salva controllo* (amber, right, disabled until a trial of this very draft finishes; any edit locks it again). Each harness gets a trial row: its label and agents, a green *Funziona* or amber warning badge with the scores in the locale's decimals, and a *Cosa ha scritto* disclosure with the example and the rewrite.

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
