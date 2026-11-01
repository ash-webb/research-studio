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
