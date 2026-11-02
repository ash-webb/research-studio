# v0.3.6 release notes — A/B testing with Qualtrics (November 1, 2026)

## Added
- **Design assignment from the study link.** `variant=design-b` (or `variant.<experiment-id>=…`) sets the design, so a Qualtrics randomizer with *Evenly Present Elements* can assign designs in equal groups and record who saw what. Without it, the built-in random assignment is used; an unrecognised design ID falls back to it and is flagged in the results. The assignment is kept through refreshes.
- **Participant ID from the link** (`pid=`, e.g. Qualtrics `${e://Field/ResponseID}`), stored with the session and in the Task and A/B exposures CSVs.
- **Return to the survey.** `return=` (https, allow-listed hosts only, default `qualtrics.com`; see `returnUrlHosts` in `settings.js`) adds a **Return to the survey** button that carries `rs_pid`, `rs_session`, `rs_status`, the design and each A/B task's success signal, self-report, time and clicks. Qualtrics stores these as embedded data with no custom JavaScript.
- **Consent collected in the survey:** a study setting that replaces the consent checkbox with a short **Begin** screen (consent recorded as `external`).
- **Design rows** in the builder replace the `id | label | URL | revision` text box: one row per design, add/remove (2–6), inline plain-language checks; preview/export errors now name the problem.
- **Check designs:** a pre-launch check that loads each design, confirms tracking connects, and confirms the success signal arrives when you complete the task inside it.
- A/B results say how designs were assigned (study link vs built-in) and warn about unrecognised link values.
- `docs/QUALTRICS-AB-SETUP.md`: step-by-step two-survey setup, field list, test checklist and analysis notes.

## Validation
- `npm test` 62/62 · `npm run test:e2e` all pass (new: link assignment and return link, builder rows and Check designs) · `npm run test:resume` 71/71 · `npm run test:keyboard` 43/43 · `npm run test:a11y` 0 violations across 93 screen states.
- Not yet tested against a real Qualtrics survey.

---

# v0.3.5 release notes — first-click zoom (November 1, 2026)

From hands-on testing on an Android phone: at phone width the first-click screenshot was too small to read, so the tap was effectively blind.

## Added
- **Zoom for first-click tests:** −, + and **Fit to screen** (fit, 150%, 200%, 300%). The test still opens at Fit so the whole screen is seen first. When zoomed, participants drag (touch) or scroll to look around; panning never records a click, only a tap/click does. Keyboard: + and − zoom when the screenshot has focus; the arrow-key marker scrolls into view.
- Recorded with the click: `zoom` and `display_width_px`; zoom changes as `first_click_zoom` method events. Positions stay relative to the whole image, so heatmaps and target scoring are unaffected.
- On touch screens the long keyboard instructions are hidden visually (still read by screen readers).

## Validation
- `npm test` 55/55 · `npm run test:e2e` 252/252 (new phone zoom scenario with real touch input: pan does not record, tap at 200% lands at the right image position and scores a hit) · `npm run test:resume` 71/71 · `npm run test:keyboard` 43/43 · `npm run test:a11y` 0 violations across 87 screen states.

---

# v0.3.4 release notes — drag-first card sorting (November 1, 2026)

Based on hands-on feedback: participants expected to start dragging cards into groups straight away, not to name a group first.

## Changed
- **Group first, name later.** Drop a card on **New group** to start a group; name groups whenever you like by typing in the group's heading. Names (unique, case-insensitive) are required only to finish, and the page says what is still missing ("2 cards still to sort, name 1 group").
- **Just drag.** Cards can be dragged between groups and back to “Cards to sort”. Dragging is rebuilt on pointer events, so it now works with touch as well as mouse and pen (the old browser drag-and-drop did not work on iPhones). On touch screens: press and hold, then drag; a quick swipe still scrolls; dragging near the screen edge auto-scrolls to off-screen groups.
- The per-card dropdowns and the “New category name” form are gone. Selecting a card (click, tap, Enter/Space) opens a **Move to** list instead, which keeps the activity fully usable by keyboard, screen reader and switch.
- Empty participant-created groups are removed automatically. Predefined (hybrid/closed) group names stay fixed.

## Data
- New method events `category_renamed` and `category_removed`; `via` (`drag`, `touch`, `menu`) on `card_assignment` and `category_created`. `category_created` labels are usually empty now (named later). Final names remain in `result.categories`. See `docs/DATA-DICTIONARY.md`.
- Sorts saved mid-way by v0.3.3 still resume (same saved state shape).

## Validation
- `npm test` 55/55 · `npm run test:e2e` 233/233 (new touch scenario: swipe scrolls, press-and-hold drags, auto-scroll) · `npm run test:resume` 71/71 · `npm run test:keyboard` 41/41 · `npm run test:a11y` 0 violations across 84 screen states.
- Touch dragging was tested with Chrome's touch input emulation, not on a physical iPhone yet.

---

# v0.3.3 release notes — resume after refresh (November 1, 2026)

## Added
- **Resume after refresh:** reloading the participant page (or a restored crashed tab) continues the same session at the same point: current step, card placements and groups, tree position and path, recorded first click, randomised design order, prototype clicks/success signal, and half-typed answers. Prototypes restart from their first screen, with a note to the participant.
- No duplicate records: `session_resumed` event per reload; `interruptions` and `interrupted_seconds` on interrupted activities (Task and Method CSVs); "Resumed ×n" in the session list.
- Reloading after finishing shows "You have already completed this study"; **Start a new session** is offered only in local demo and preview mode.
- Safeguards: tab-only storage cleared on tab close; no resume if the study changed, after 24 hours, or while the session is open in another tab.
- `npm run test:resume`: 71 browser checks reloading at every stage of every study type plus the safeguards.

## Changed
- A same-tab refresh now keeps the participant's A/B design (it is the same session). New tabs, browsers or devices still start new sessions.

## Validation
- `npm test` 55/55 · `npm run test:e2e` all pass · `npm run test:resume` 71/71 · `npm run test:keyboard` 39/39 · `npm run test:a11y` 0 violations across 78 screen states.
- Not tested: remote (Supabase) mode with resume. The outbox for unsent records already lives in the same tab storage and is retried after a reload, but this has not been exercised against a live database.

---

# v0.3.2 release notes — accessibility pass (November 1, 2026)

Accessibility review against WCAG 2.2 A/AA. Automated scan of 72 screen states (desktop, phone, 400% zoom): **0 violations** (was 3 rule types). Keyboard-only runs through every study type: **39/39 checks** (was 5/35). Details: `docs/ACCESSIBILITY-REPORT-v0.3.2.md`.

## Fixed
- Focus moves into each new screen (heading) instead of being lost; within activities it stays on the relevant control (card menu, group field, tree items).
- First-click test can be taken by keyboard (Enter for a marker, arrows to move, Enter to confirm). Clicks record `input: "keyboard"` or `"pointer"`.
- Screen-reader announcements for card moves, new groups and tree navigation; current tree location marked.
- Validation errors move focus to the unanswered question.
- Strong, consistent focus outline on every control; 24 low-contrast grey text shades darkened to ≥4.6:1.
- Results tables that scroll sideways are keyboard-reachable, named regions; skip link and `aria-current` on the researcher side; builder overview landmark fixed.
- Reduced-motion support.
- **Tracker (sdk v0.1.1):** keyboard activations inside prototypes were recorded at (0%, 0%). They are now recorded at the element centre and labelled `input: "keyboard"`. New `input` column in the Clicks CSV.

## Added
- `npm run test:a11y` (axe-core scan of every screen, including 320px reflow) and `npm run test:keyboard` (keyboard-only runs). `npm run test:all` runs every suite.

## Data compatibility
- Additive only: `input` on interaction items and on first-click `click`. Older records have no `input` value (blank in CSV).

---

# v0.3.1 release notes — browser QA fixes (November 1, 2026)

First full real-browser QA pass of v0.3. Every example study was completed end to end in Chromium (desktop and phone width), with the stored events, dashboard and all seven exports checked against the scripted runs: **218/218 checks pass**. Details: `docs/QA-REPORT-v0.3.1.md`.

## Fixed
- "Preview locally" runs were counted as participant sessions. They are now labelled, hidden from results and exports by default, and can be included with a checkbox on the Results tab.
- First-click hit rate disagreed between the Activity outcomes table and the Method analysis when a participant chose "not sure". Both now count it as an attempt without a hit, and a "Not sure" count is shown.
- "I'm not sure where to click" is withdrawn once the first click is made.
- `observed_success` was exported as `false` when there was no evidence either way (unscored methods, untracked prototypes). It is now blank/omitted. Prototype tasks record `success_signal_status` like A/B tasks.
- Spacing under tree-test actions.

## Added
- `npm run test:e2e`: browser end-to-end suite (`tests/e2e/participant-flows.cjs`) covering all examples plus closed and hybrid card sorts, an unscored first-click test and a prototype without the tracker.
- `tests/qa-fixes.test.js`: 5 regression unit tests (`npm test`: 53/53).

## Data compatibility
- Event format is unchanged apart from additive fields (`preview`, prototype `success_signal_status`, `first_click_unsure` event). Sessions recorded with v0.3 are still read and counted. Treat v0.3 `observed_success=false` values for unscored methods as unknown.

---

# v0.3 release notes — interactive A/B/n experiments

## Added
- **A/B implementation test** in the study builder: configure 2+ interactive, independently hosted variants, shared task instructions, experiment ID, optional shared success signal, and revision labels.
- Session-level **equal-probability** allocation via a deterministic hash of a random UUID, study ID, and experiment ID; stable across multiple activities sharing the same experiment ID.
- The participant sees only their assigned variant inside the existing tracked prototype frame, not a side-by-side preference selection.
- Origin-validated tracking messages and task outcomes for A/B/n runs; logs clicks, navigation, tracker availability, elapsed time, signal observation, and completion self-report separately.
- A/B comparison tables with variant exposure, submitted/not-submitted tasks, tracker signal rate among connected sessions, task timing, and clicks.
- Dedicated A/B exposure CSV including **started but unfinished** tasks; variant/experiment/revision keys added to task, click, answer, and method event exports.
- Two fictional interactive portal implementations and a two-task example; both variants use the same success criteria.
- A/B setup and analysis notes in `docs/AB-TESTING.md`.

## Validation
- Node unit tests for 2+ variants, multi-task assignment stability, unsafe URLs, malformed configurations, data joins and exports, and backward compatibility.
- JavaScript parse checks, shipped JSON configuration validation, and static HTTP asset checks.
- **Browser navigation is blocked by the development environment**, including local server and intercepted-request attempts; participant journey and dashboard were **not** verified by live browser automation. Test on Mac Safari and Chrome before conducting real studies.

## Unchanged limitations
- GitHub Pages cannot centrally store responses; an approved remote data store must be configured and verified. Publishing the JSON file and researcher database registration remain separate operations.
- Cross-origin prototype tracking requires the JS bridge and successful iframe embedding; uninstrumented or blocked variants are not automatically measured.
- Not authorized for federal/sensitive data without organizational review; no recruitment, replay, production hardening, quotas, effect-size power planning, guaranteed session resume or automatic statistical significance testing.
- All bundled studies and designs are fictional; no participant findings are included.
