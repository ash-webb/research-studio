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
