# Research Studio v0.3.6 — multi-method unmoderated UX research

**Mac / Windows / Linux · GitHub Pages-ready · No front-end build step**

This is a runnable **demonstration and researcher-controlled starter**, not a production-authorized participant research service. It extends the original prototype-testing package with **A/B/n testing of multiple live implementations**, card sorts, tree tests, first-click tests, preference comparisons, and standalone surveys. It retains instrumented GitHub Pages prototype usability testing. One study can contain several different activity types, connected by the same randomly generated session ID.

**Research integrity:** All included examples use fictional portal designs and prompts. No synthetic participants, fabricated responses, or simulated results are provided as observed findings. The software reports captured behavior without interpreting participants' intent.

## What the new version does

| Method | Participant experience | Stored output and analysis |
| --- | --- | --- |
| Prototype usability | Prototype beside instructions; post-task self-report | Interaction stream, time, click coordinates, tracker connection and separately signaled success |
| A/B/n implementation testing | One randomly assigned interactive design per participant, shared tasks and follow-up | Variant assignment, exposure/attrition, tracker signals, self-report, median task time, click count, responses by arm |
| Open card sort | Create named groups and assign cards | Card-to-group assignments, group names, moves, co-placement similarity matrix |
| Closed card sort | Assign cards into predefined groups | Assignment counts, per-participant sorting and similarity matrix |
| Hybrid card sort | Use predefined groups or create your own | Same as above, with participant-created categories retained |
| Tree testing | Navigate a text-only hierarchy to select a destination | Full path, first branch, direct/indirect outcome, backtracks and success against configured destination(s) |
| First-click test | Click once on an image/screen | Exact first x/y percent, image, optional target hit and researcher click-position overlay |
| Preference test | View 2+ design images with randomized order | Chosen option, no-preference choice, randomized presentation order, counts |
| Standalone survey | Single/multiple choice, five/seven-point rating, short/long text | Answers linked to study, activity, session, and stage |

Every activity has its own introduction and may include follow-up questions. Each study can also include pre-study and post-study questions. Exports include task outcomes CSV, survey answers CSV, prototype click events CSV, **method outcomes CSV**, **method events CSV**, **A/B exposure CSV (including incomplete tasks)**, and full event JSON.

**Not included yet:** full screen recordings or replay, participant recruitment, personalized invitation links, branching logic, resume on a different device or browser, authoring images via a built-in upload tool, automated significance/sample-size testing, allocation quotas, multi-session identity-based assignment, automatic clustering/dendrograms, automated transcription, and one-click GitHub publishing.

## Run on a Mac

1. Download and unzip the ZIP. Open Terminal.
2. Type `cd ` (with the trailing space) and drag the unzipped `research-studio` folder into Terminal. Press Return.
3. Start the local server:
   ```bash
   sh START-DEMO-MAC-LINUX.sh
   ```
   If `python3` is not available, install Python 3 from python.org. The included script uses the built-in static server.
4. Open **http://localhost:8000/**. Select a demo from **Load a built-in example**, then click **Load example** and **Preview locally**.
5. On another tab, go to **Results & insights**. In *local demo mode*, results are visible only in the browser/profile that completed the studies, on the same site origin.
6. Press **Control + C** in Terminal to stop the server.

On Windows, double-click `START-DEMO-WINDOWS.bat` or run `python -m http.server 8000`. JavaScript requires no npm install to run. To run unit tests with Node.js, use `npm test`. To run the browser end-to-end checks (needs Playwright with Chromium, and axe-core for the accessibility scan: `npm install --no-save playwright axe-core && npx playwright install chromium`), use `npm run test:e2e`.

### Built-in example participant links

The starter includes eight separate studies, selectable in the study builder:

- `study.html?study=demo-ab-implementation` — interactive A/B experiment with two designs and two tasks
- `study.html?study=demo-mixed` — a sequence combining five methods
- `study.html?study=demo-card-sort` — open card sort
- `study.html?study=demo-tree-test` — tree test
- `study.html?study=demo-first-click` — screenshot first click
- `study.html?study=demo-preference` — randomized design comparison
- `study.html?study=demo-survey` — standalone survey
- `study.html?study=demo-portal` — original instrumented prototype tasks

Open these relative URLs after the server is running. The included graphic designs and tasks are fictional examples.

> **IMPORTANT:** Local demonstration mode does **not** send results from a participant's browser back to you. Do not distribute local-demo links expecting centralized collection. See remote configuration below.

## Create a new study from the interface

1. Select **+ New study**, or load and modify a fictional example. Enter a unique lowercase study ID, version, title, welcome and consent statements.
2. Under **Study activities**, choose a method from the dropdown and click **+ Add activity**. Edit its participant instructions.
3. Configure the method as explained below. Add follow-up, pre-study or post-study questions as appropriate.
4. Click **Preview locally**. This runs the current editor draft, without requiring a GitHub commit.
5. Click **Export study JSON**. Save the downloaded file at `studies/YOUR-STUDY-ID.json` in the project. Add a corresponding line to `studies/index.json`.
6. Push the changed site to a new GitHub repository. GitHub Pages can publish these static study pages, but **remote collection still requires an approved backend**.

### A/B/n implementation testing

**Using Qualtrics?** See [`docs/QUALTRICS-AB-SETUP.md`](docs/QUALTRICS-AB-SETUP.md): Qualtrics assigns the design evenly and receives each task's results through the return link, with no custom JavaScript and no separate database.

In the builder (v0.3.6), each design is a row (name, ID, prototype link, version) with inline checks, and **Check designs** confirms before launch that every design loads the tracker and sends the success signal.

Use **A/B implementation test** (not Preference testing) to compare how people complete *identical tasks* using different **interactive** implementations.

1. Create an activity and select **A/B implementation test**. Enter neutral participant-facing task instructions.
2. Enter an **Experiment ID** (e.g., `portal-navigation-v1`) and **two or more variants** as separate lines:

   ```text
   design-a | Sidebar navigation | https://YOURNAME.github.io/portal-a/ | git-7bc2
   design-b | Dashboard navigation | https://YOURNAME.github.io/portal-b/ | git-58df
   design-c | Compact navigation | https://YOURNAME.github.io/portal-c/ | git-91aa
   ```

   Columns are `variant-id | Researcher-only label | Live prototype URL | Optional revision`. Revision can be a commit SHA/tag or other immutable build ID. Use stable, version-pinned deployments: GitHub Pages sites can otherwise change mid-study.
3. Add `sdk/utp-tracker.js` to **every** implementation and use a common success condition. Optionally provide a **Shared success signal** (e.g., `request-viewed`). Each implementation should call `window.UTP?.markSuccess('request-viewed')` on equivalent successful outcomes. If not instrumented, timing and self-report are still recorded, but signal-based success is unscored.
4. Add the same follow-up questions for all arms. For additional tasks in the **same experiment**, set the **same Experiment ID** and **same variant IDs**. URLs can differ by activity, but participants stay on their assigned design arm.
5. Preview with the fictional sample. Export the study JSON, publish it with the prototypes, and configure an approved response database before distributing real participant links.

**How assignment works:** A random session UUID is generated after consent. A deterministic hash of session ID, study ID, and experiment ID allocates **one of N arms with equal probability**. No participant is shown all options, and variant labels are hidden from the participant experience. Assignments stay consistent within the same study session, but they are **not** fixed quotas or stable identifiers for repeat visitors who start a new session. Do not assume samples are balanced, and do not use this for experiments that require account-level stickiness or production feature flags.

**Researcher results:** The A/B comparison summarizes allocated task exposures (including non-submissions), submitted tasks, self-reported completion, confirmed *success signals* among tracker-connected sessions, median completion time, and tracked click counts by variant. **A missing signal is not automatically a failed task.** The A/B exposure CSV, task outcome CSV, click CSV, question-answer CSV and full events JSON all retain session/task/variant identifiers, allowing comparison of the same wording and behavior metrics across alternatives. No automatic statistical significance or winner declarations are performed. Because this is a public static page, participants could inspect the source to discover arm URLs and assignment rules; use a server-managed experiment service for tamper-resistant or production tests. See `docs/AB-TESTING.md` for definitions and an analysis checklist.

### Card-sort authoring

Select **Card sorting** and a sort type:

- **Open:** participants create and name all groups.
- **Closed:** define at least two groups; participants cannot create others.
- **Hybrid:** define initial groups, and participants can also create their own.

What participants do (v0.3.4): drag cards straight into groups. In open and hybrid sorts they drop a card on **New group** to start a group and can name groups whenever they like; every group needs a unique name before **Finish card sort** is enabled, and the page says what is still missing. Dragging works with mouse, pen and touch (on touch screens: press and hold a card, then drag; a quick swipe still scrolls). Selecting a card (click, tap, or Enter/Space) opens a **Move to** list as an alternative to dragging, for keyboard, screen-reader and switch users. Empty participant-created groups disappear automatically.

Under **Cards**, enter one item per line: `card-id | Card label`. Under **Predefined categories**, enter `category-id | Category label`, one per line. For example:

```text
payment-history | Payment history
notices | Notices and letters
records | Tax records
```

Participants can drag a card into a group or use its category selector (which is more reliable for keyboards and touch devices). Cards are recorded with stable IDs, and participant-created category names are captured intentionally as study responses.

**Analysis details:** Co-placement is the percentage of *completed* sorts that put a pair of cards together. It does not automatically merge differently named participant categories or infer their meanings. Incomplete sorts remain in the underlying data export.

### Tree-test authoring

Under **Navigation tree**, enter one item per line, with two spaces of indentation for each level:

```text
payments | Payments
  make-payment | Make a payment
  payment-history | Payment history
records | Records
  tax-transcripts | Tax transcripts
  tax-documents | Tax documents
```

Then enter **Correct destination IDs** as a comma-separated list, such as `tax-transcripts`. The correct destination is hidden from participants.

The participant moves through a text-only hierarchy and selects the destination where they expect to find the requested information. **Success** means the final selected node matched an author-defined destination. **Direct success** additionally requires a route without backtracking or detours. **Correct first branch** is evaluated independently of final success. The system retains both outcome summaries and a navigation event stream.

### First-click authoring

Enter a public HTTPS image URL or a relative file under `demo/assets/`. The participant's initial click is recorded as `x_pct` and `y_pct` relative to the displayed image.

Optional success areas are described one per line as `x, y, width, height | Label` where values are percentages from 0 to 100; for example:

```text
2, 35, 18, 10 | Records navigation item
```

If you leave success areas blank, results are **unscored** rather than classified as incorrect. The author-defined target is never displayed to participants. Click plots are approximate when screenshot layout or scaling changes. The current click-on-image task requires pointer/touch input; a keyboard-accessible equivalent and formal accessibility review remain outstanding.

What participants see (v0.3.5): the screenshot opens at **Fit** (the whole screen visible) with **−**, **+** and **Fit to screen** controls (up to 300%). When zoomed they can drag or scroll to look around; only a tap or click records the answer. The zoom level at the moment of the click is saved with it, so you can see who zoomed in. Use screenshots wide enough to be legible when zoomed (the demo image is 980px wide).

### Preference-test authoring

Enter at least two variants, one per line:

```text
layout-a | List view | demo/assets/design-a.svg
layout-b | Tile view | demo/assets/design-b.svg
```

Participants can select an option or **I do not have a preference**. The ordering is randomized independently per participant session (not balanced across a quota). The export preserves that display order for possible order-effect analysis.

### Survey authoring

Select the **Survey** activity type, and add questions under **Survey questions**. Available answer types are short text, long text, single choice, multiple choice, five-point scale, and seven-point scale. Questions can be marked required. Pre-/post-study sections use the same question editor.

## Resume after refresh (v0.3.3)

If a participant reloads the page, or the browser restores a crashed tab, they continue the **same session** from where they were:

- **What is kept:** the current step, card placements and new groups, tree position and path so far, a recorded first click, the randomised design order, prototype click count and success signal, and half-typed answers on any question page.
- **Prototypes restart from their first screen** after a reload (the app cannot restore the inside of someone else's page). The participant sees a note saying so; time and clicks so far are kept.
- **Nothing is recorded twice.** Each reload adds a `session_resumed` event. Activities interrupted by a reload record `interruptions` and `interrupted_seconds` (time away). `time_seconds` stays wall-clock, so subtract `interrupted_seconds` if you need active time. The session list marks resumed sessions ("Resumed ×2").
- **Reloading after finishing** shows "You have already completed this study" and records nothing. In local demo and preview mode only, a **Start a new session** button lets you pilot again in the same tab.
- **Safeguards:** progress is kept in the tab's own storage (sessionStorage), so it is cleared when the tab is closed and is never shared with other tabs or people on the same computer. It is not restored if the study configuration changed, after 24 hours, or if the same session is still open in another tab (a duplicated tab is told to continue in the original).
- **Not covered:** switching device or browser, or reopening the link in a new tab after closing the old one. Those start a new session.

## Connect a GitHub Pages prototype

For prototype usability **and A/B/n experiments**, enter your own prototype URL (`https://USERNAME.github.io/REPO/index.html`) at the study level or within that activity. Add the provided tracking script to each prototype HTML page you control:

```html
<script src="https://USERNAME.github.io/RESEARCH-PLATFORM/sdk/utp-tracker.js"
        data-parent-origin="https://USERNAME.github.io"></script>
```

Use the exact hosting origin (protocol + host, **without** repo path) as `data-parent-origin`. Add `data-ut-id` to relevant clickable controls for stable click identifiers, and call `window.UTP?.markSuccess('your-success-signal')` when your task-defined successful end state is actually reached. The prototype and the surrounding platform exchange `postMessage` events, with origin and sender checks. The platform cannot observe an unmodified cross-origin iframe.

**Caution:** HTML `iframe` embedding may be blocked by the other site, and tracking is not automatically supported in unrelated Figma or third-party prototypes. Tracker data excludes input values, page text and URL query strings by default. Never put personal data in `data-ut-id` fields.

## Database collection (optional)

A separate database is required for participants to submit responses from different devices. The starter includes a Supabase example; it is **not inherently authorized for federal, taxpayer, or otherwise regulated participant information**.

1. Create an organization-approved Supabase project or adapt the storage layer to an approved equivalent.
2. On a **new** database, execute `supabase/schema.sql`. If you already deployed v0.1, instead execute `supabase/migration-v0.2.sql` to permit the new `method_event` record kind. Do not run the migration blindly against production.
3. Set the Supabase URL and **publishable key only** in public `settings.js`. Never put a secret or service-role key in GitHub Pages.
4. Invite/create a researcher account through Supabase Auth. Turn off unrestricted account signup for researcher-only access.
5. In Research Studio, go to **Setup & security** and sign in; then **Publish to response database** on a validated study. Also commit the JSON to your GitHub Pages site (the button does *not* publish GitHub files).
6. Open a participant study link from another browser/device, submit fictional test responses, sign back in as the study owner, and verify rows and exports. Check RLS for anonymous read denial before any real deployment.
7. Close collection by changing `studies.published` to `false` using the database administrator UI. The current interface does not manage enrollment, study closure, deletion, or study owners.

**Before real research:** perform consent/privacy review, security authorization, accessible interaction testing, data minimization, retention/deletion design, invitation security, anti-abuse/rate limiting and reliability/restore tests. The anonymous insert endpoint is deliberately write-only but is susceptible to spam/fabricated events. Local browser data is not durable central storage. Resume after refresh (v0.3.3) works within the same browser tab only; the outbox is not a guaranteed offline mechanism.

## GitHub Pages deployment

Use a **separate repository** for Research Studio. Commit the extracted `research-studio` folder contents at repository root, push to `main`, then in **Settings → Pages**, select **GitHub Actions** as the source. `.github/workflows/pages.yml` deploys the static site. Add your prototype links or tracker script to *your own existing prototype repo* separately.

The platform was built as a standalone ZIP because the connected GitHub account did not expose an accessible repository in this session. No GitHub commits or published URLs are claimed.

## Research data model and interpretation

`study_events` is append-only. All rows include `study_id`, random `session_id`, `kind`, `task_id` (activity ID), timestamp, and JSON payload. Record kinds:

| Kind | What it records |
| --- | --- |
| `session_started` | Consent, study version, viewport |
| `task_started` | Activity ID, method, activity order |
| `method_event` | Card moves, added categories, tree navigation and selections, first click or preference choice |
| `interaction_batch` | Instrumented prototype click, scroll and screen events |
| `task_ended` | Method, outcome/result object, time, optional observed/self-reported success |
| `answers` | Questions, response values and stage (pre, post_task, activity, post) |
| `session_completed` | Session completion marker |

All CSV exports retain `study_id`, `session_id`, and activity IDs, and the method-outcomes CSV also includes `study_version`. Data can be joined for Power BI or qualitative analysis. Method results stored as JSON in a CSV field are intentionally lossless. Use the full event JSON export when performing richer replays or participant-level path analysis.

An observed success event is evidence that a **configured detection rule fired**, not proof of participant comprehension, satisfaction, or task understanding. When a success rule or tracker is missing, report the result as **unscored** rather than failed. Directness, branch selection and self-report answer different research questions and should not be merged into one measure without an explicit analysis plan.

## Quality checks and limitations

- Run `npm test` to execute the deterministic validation, A/B assignment/scoring/export, parsing and legacy method tests.
- Run `npm run test:e2e` to drive scripted, clearly synthetic participants through every example study (plus closed/hybrid card sorts, an unscored first-click test and an untracked prototype) in Chromium and check the stored events, dashboard and all seven exports against what the script did. Screenshots and `e2e-report.json` are written to `tests/e2e/output/`. See `docs/QA-REPORT-v0.3.1.md`.
- Run `npm run test:resume` to reload the participant page at every kind of point in every study type and check that the session continues without duplicate records.
- Run `npm run test:keyboard` to complete every study type with the keyboard only, and `npm run test:a11y` for an automated WCAG 2.2 A/AA scan (axe-core) of every screen at desktop, phone and 400% zoom width. `npm run test:all` runs every suite. See `docs/ACCESSIBILITY-REPORT-v0.3.2.md`.
- “Preview locally” runs are labelled as previews and hidden from results and exports unless **Include my “Preview locally” runs** is ticked on the Results tab.
- Source scripts are checked for JavaScript syntax. The included example JSON is validated.
- This package has **not passed an end-to-end browser or production browser compatibility, accessibility or security audit**. Test real Safari, Chrome and mobile devices with actual prototype URLs before sharing externally.
- Performance with very large trees or 100+ cards, researcher session authentication expiry, concurrent upload failure, offline resume and the optional Supabase integration have not been fully load-tested.
- Raw feedback may contain voluntarily entered personal data even though prototype keystroke logging is disabled.

For deeper schema details and a sample deployment checklist, review `docs/DATA-DICTIONARY.md`.
