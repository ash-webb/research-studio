# v0.3.18 release notes — IOLA study title doesn't name the designs (draft)

## Changed
- **IOLA study 1.3.0: participant-facing title is now “IRS online account study”** (was “IRS online account: current website vs new app”). Participants see the title on the welcome page and in the browser tab, so it no longer tells them which designs are being compared. The study description, which only researchers see, still says what is compared.

# v0.3.17 release notes — device type from the browser, not window width (draft)

## Changed
- **`rs_device` and the session's `device` now record the kind of device** (desktop, tablet, phone) from what the browser reports, the same check that screens computers-only studies. Before, they came from window width, so a laptop with a browser window under 1,100 px wide was recorded as a tablet (seen in a preview run in the IRS account: `rs_device = tablet` on a desktop). The width-based class is kept as `window_size`, beside the exact `viewport_width` and `viewport_height`. Results' device breakdown follows.

# v0.3.16 release notes — a new survey response never resumes an earlier one (draft)

## Fixed
- **A new Qualtrics response in the same browser tab resumed the previous response's study session** (found during a preview run in the IRS account: a restarted preview reopened the earlier session at activity 1, with its time and design). The participant ID (the Qualtrics ResponseID, or `pid` on a study link) is now part of the resume key, so a different response always starts a fresh session, while reloading the same response still resumes it. New browser check: `newResponse` in `npm run test:embed`.

# v0.3.15 release notes — task instructions on the left (draft)

## Changed
- **During a prototype task, the instructions panel is now on the left and the design on the right** (laptops and desktops). The instructions also come first for screen readers and keyboard users, so the task is read before the design. On narrow screens they still sit above the design.

# v0.3.14 release notes — IRS Qualtrics account only; IOLA consent in the survey (draft)

## Changed
- **Only the IRS Qualtrics account receives results.** `embedHosts` and `returnUrlHosts` in `settings.js` now list `irsresearch.gov1.qualtrics.com` instead of every `qualtrics.com` address. A survey in another Qualtrics account is refused like any unlisted site.
- **IOLA study 1.2.0: consent is collected in the survey** (`consentMode: "external"`, research sign-off 4 November 2026). The study no longer shows its own consent checkbox; it shows what it collects and a Begin button. The survey's consent page must describe the data collection (design shown, clicks and screens in the practice account, task times, answers).
- IOLA study plan: ease ratings described as 1–5.

## Fixed (in the prototypes, not this repo)
- Design A's navigation menus showed white links on a white background. Fixed in design-prototypes (commit cd3fe48) and checked on the live page.

# v0.3.13 release notes — starter survey imports in Qualtrics (draft)

## Fixed
- **Starter survey (.qsf) was refused by Qualtrics** ("Data validation failure"): the owner, creator and response-set IDs didn't match Qualtrics' ID patterns and the brand was empty. Found by importing it into the IRS Qualtrics account; it now imports, and a test checks the patterns.

## Checked in real Qualtrics (preview, fictional data)
- Desktop run of the IOLA starter survey: device check set `rs_device_class = desktop`, phone/tablet branch skipped, randomizer assigned the current website, all four tasks done correctly, `rs_abN_success = received` for each, ease answers 1–5, full session restored from the export with a matching checksum.

# v0.3.12 release notes — computers-only studies, starter survey, self-report vs observed success (draft)

## Added
- **Laptops and desktops only** (study setting `allowedDevices: "desktop"`, builder: Devices). Phones and tablets are told to use a computer and nothing is recorded; recognised from what the browser reports, not window size. Inside a survey, Research Studio returns `rs_status = device_not_supported`.
- **Survey device check** (`docs/qualtrics-device-check.js`) to screen out phones and tablets before the randomizer.
- **Starter survey (.qsf)** from the setup page: fields declared, randomizer, Research Studio page and script, device screening and branches for computers-only studies.
- **A/B results:** “Said they completed it but didn't” per design (self-report against the success signal), a data check when the two differ a lot, and time to success taken from the success signal.

## Changed
- IOLA study 1.1.0: computers only; ease questions on 1–5; device question removed (recorded automatically).
- The import leaves out phone and tablet responses and counts them, rather than treating them as drop-outs.

# v0.3.11 release notes — Research Studio inside a Qualtrics survey (draft, not released)

## Added
- **Route B for Qualtrics:** a survey can show Research Studio on one of its pages (`study.html?embed=qualtrics`). A script in that question (`docs/qualtrics-embed.js`) stores the results in embedded data: the `rs_…` summary, every answer to the study's own questions (`rs_q_…`), and the full session, with every click and screen, in parts that fit Excel cells, with a checksum. Saves after the opening questions, after each activity and at the end; continues after a reload; nothing kept on the participant's device after the tab closes.
- **Only approved survey addresses get results** (`embedHosts` in `settings.js`, default `qualtrics.com`). The study waits for the survey's script to answer before it starts; without it, the participant is told not to continue. The survey script only writes `rs_` fields and only accepts messages from the Research Studio address it was given.
- **Setup page** `qualtrics-embed.html?study=<id>`: the field list (plain or `__js_` names) and the script filled in for the study and site.
- **Import** rebuilds each response's full session from the survey export and checks it against its checksum; falls back to the summary fields with a warning when data is incomplete; counts people who left during the activity as drop-outs when incomplete responses are exported.
- Browser checks (`npm run test:embed`) with a stand-in Qualtrics page at a qualtrics.com address: the IOLA study end to end in both survey layouts, full screen and inline, phone, reload, refusals, field guard, setup page and import.

## Changed
- The return link's fields come from one shared definition (`resultFields`), also used by route B.

# v0.3.10 release notes — time to success and IOLA A/B checks (draft, not released)

## Added
- **Time to success** for prototype and A/B activities: `success_at_seconds` (first matching success signal) and `finished_at_seconds` (“Finish this task”) on `task_ended`, kept across reloads. In the Task and A/B exposure CSVs, and in the survey return link as `rs_abN_tts`; Qualtrics import reads it back. `time_seconds` is unchanged.
- **IOLA A/B browser checks** (`npm run test:iola`): both designs inside Research Studio — every task right and wrong, backtracking and repeats, reloads, abandonment, a missing tracker, random assignment and the Qualtrics return link, in-frame presentation, and contrast, accessibility and fit in states other checks never open (menus, sheets, dialogs). Point it at a copy of the published prototypes (`IOLA_PROTOTYPES`) or the live site (`IOLA_LIVE=1`).

## Fixed
- The shipped-study check counted 8 studies; the IOLA study made 9.
- A builder check pressed Escape and checked the dialog before it had closed (intermittent failure).

## Docs
- Qualtrics guide: `rs_abN_tts`; `rs_abN_time` described accurately; questions written into a Research Studio study are not sent to Qualtrics.
- Data dictionary: time to success.

# v0.3.9 release notes — planners for every method (November 2, 2026)

## Added
- **Activity planners** in the Study plan for prototype, card sort, tree test, first click, preference and survey activities. Each has:
  - what it should tell you, and links to the research questions it answers;
  - a method-specific goal and success criterion (benchmarks for task success, first-click success and tree directness; agreement threshold for card sorts; smallest split worth detecting for preference tests);
  - sample-size guidance: precision-based (±points at 95%), problem-discovery rounds for prototypes, participant targets for open card sorts, and power for two-option preference tests;
  - a standard analysis, included in the study's analysis plan.
- **Sample size summary:** the plan recommends recruiting for the activity with the largest need.
- **Plan checks with results:** each planned activity's results open with its plan check:
  - rates counted over everyone who started, with 95% ranges compared with the benchmark;
  - card-sort pairs and cards against the agreement threshold;
  - the preference split against 50/50;
  - progress towards the target sample.
- The Word plan gains **Activity plans** and **Sample size** sections; headings are numbered by what the study contains.

## Fixed
- Editing a research question and then clicking a button in the plan no longer swallows the click.

## Validation
- `npm test` 108/108 (new `tests/method-plans.test.js`; planning formulas cross-checked with SciPy) · `npm run test:e2e` 344/344 (new activity planner scenario) · `npm run test:resume` 71/71 · `npm run test:keyboard` 43/43 · `npm run test:a11y` 0 violations across 96 screen states.

---

# v0.3.8 release notes — study planner (November 2, 2026)

## Added
- **Study plan** as the first step of the Study builder: background, research questions, participants, control and treatment roles per A/B experiment (with what changes in each design), hypotheses written as plain sentences, primary and secondary measures, sample size, stopping rule, a standard analysis plan generated from these choices (or your own), and how results will be used.
- **Lock plan** with a **change log**: after locking, every edit in the builder is recorded with where it happened, before and after values, time and an optional reason.
- **Download plan (.docx):** a Word document of the plan, procedure (pre-study questions, activities with follow-up questions, post-study questions), analysis plan and change log. Generated in the browser with no external libraries.
- **Save working copy (with plan)** alongside **Export study JSON**; the published study file leaves the plan out so hypotheses are not public.
- A/B results show the plan: lock status, control, primary measure, target size and each hypothesis next to its result (consistent, opposite, inconclusive or too early). The plan's primary measure and target sample size drive the main measure and the provisional banner. A default plan the researcher never edited is not shown.

## Fixed
- Absolutely positioned screen-reader labels inside scrolling tables could widen the page on phones (`.table-scroll` is now a positioning context). The builder column no longer grows past the screen at phone width.

## Validation
- `npm test` 94/94 (new `tests/plan.test.js`, including a python-docx read-back of the generated .docx) · `npm run test:e2e` 341/341 (new study plan scenario: roles, hypotheses, sample size, lock and change log, Word download, working copy round trip, results, 360px) · `npm run test:resume` 71/71 · `npm run test:keyboard` 43/43 · `npm run test:a11y` 0 violations across 96 screen states.
- The .docx was also converted to PDF with LibreOffice and checked visually. Not yet opened in Microsoft Word itself.

---

# v0.3.7 release notes — clearer, more honest A/B results (November 2, 2026)

Reworked after an independent statistical review of the v0.3.6 results.

## Changed
- **Main measure now counts everyone assigned.** People who dropped out or weren't measured count as not successful, so differences in drop-out or tracking can't flip the comparison. The rate among measured finishers is still shown, labelled secondary, and a **Ways of counting disagree** check appears when the two point to different conclusions. (On the synthetic fixture: +17 points, range −6 to +38, rather than +29 among measured finishers.)
- **Plain-language results.** Each comparison gives the difference and its range, and says what the range does and does not mean. A **Provisional** banner shows the smallest difference the current sample could detect.
- **Tables** label the main and secondary measures, add **Median time, successful attempts**, and say "range not estimable" for tied values. A note explains that overlapping ranges are not a test.
- **Data checks** use intervals: drop-out, tracking (including unmeasured share by design) and devices are flagged when the difference between designs is beyond chance. Group sizes are not checked when drop-out is unknown.
- **Planner** works in people assigned per design, plans a drop instead of an impossible target near 100%, and reminds you to fix the size before fielding.

## Fixed
- Missing times and clicks were treated as 0; they are now left out.
- Repeated task starts in one session counted as extra people.
- Qualtrics import: preview/test/spam responses are left out, duplicates removed, Survey 1's randomizer is used as the record of assignment (mismatches flagged), and drop-out is reported as unknown (not 0%) when Survey 1 is missing or rows can't be matched.
- Rounding: "1m 60s" and "+0 points" for tiny non-zero limits.

## Validation
- `npm test` 82/82 (new `tests/ab-results.test.js`) · `npm run test:e2e` 315/315 · `npm run test:resume` 71/71 · `npm run test:keyboard` 43/43 · `npm run test:a11y` 0 violations across 93 screen states.
- Statistics cross-checked against SciPy/independent Python. Still not tested against a real Qualtrics export.

---

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
