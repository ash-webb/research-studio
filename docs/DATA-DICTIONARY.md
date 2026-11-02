# Data dictionary and validation notes

## Join keys
- `study_id`: lowercase slug from published study JSON. Do not reuse between unrelated studies.
- `session_id`: randomly generated browser session UUID; not a real-world participant identifier.
- `task_id`: activity ID. Studies may contain several methods.
- `study_version`: record of the published configuration version on `session_started`, also included in the flattened method export; pin source JSON by commit SHA externally for reproducibility.
- `experiment_id`: logical A/B/n experiment (may have several activities); is stable when the same allocation is intended.
- `variant_id`: design-arm ID assigned to a session within an experiment, recorded in task starts/ends and joined onto per-task answers/interactions.
- `variant_revision`: optional declared build/revision label for the exact implementation used.

## Method outcome fields (`task_ended.payload.result`)

| Method | Fields | Interpretation |
| --- | --- | --- |
| ab_test | `experiment_id`, `variant_id`, `variant_revision`, `success_signal_received`, `success_signal_status` (`received`, `not_observed`, `unavailable`) | Per-session allocation; a successful signal being observed is not proof of comprehension or a universally accurate success measure. See `AB-TESTING.md` |
| card_sort | `sort_mode`, `groups` `{cardId:categoryId}`, `categories` array of IDs/names, `move_count`, `completed`, optional `participant_could_not_finish` | Raw group assignments; `completed` means every card was assigned, not that the grouping was correct |
| tree_test | `success`, `direct`, `first_selection`, `first_branch_correct`, `backtracks`, `selected_node`, `selected_path`, `navigation_event_count`, `navigation_events`, `history_truncated`, optional `participant_could_not_find` | Rules-based navigation scoring against destination node IDs; no inference of user intention |
| first_click | `click` `{x_pct,y_pct,at_ms,input,zoom,display_width_px}` or `null` (`input`: `pointer` or `keyboard`, v0.3.2; `zoom`: 1 = fit, 1.5, 2 or 3 at the moment of the click, and `display_width_px`: on-screen width of the screenshot then, v0.3.5), `hit_target` boolean or null, `scored`, optional `participant_could_not_choose` | First image click, with target correctness only if rectangles are configured. “Not sure” is only offered before a click; on a scored test it records `observed_success: false` (v0.3.1) |
| preference | `selected_id` or null, `no_preference`, `display_order` | Design order is randomized but not quota-balanced |
| survey | `answered_question_ids`, `response_count` | Actual response values reside in `answers` events at stage `activity` |
| prototype | `success_signal_received`, `success_signal_status` (v0.3.1; same values as A/B), plus event-level `observed_success`, `self_report`, `tracker_connected` | Signal fired by instrumented prototype, not independently verified completion. `observed_success` is omitted when no signal is configured or the tracker never connected |

## Method events
- `card_assignment`: `card_id`, assigned `category_id` or null (moving back to Cards to sort); `via` (v0.3.4): `drag` (mouse/pen), `touch` (press-and-hold drag) or `menu` (the card's Move-to list; keyboard, screen reader or tap).
- `category_created`: stable category ID (`created-N`) and label. Since v0.3.4 groups are created by dropping a card on “New group” (or choosing it from the Move-to list), so `label` is usually empty at creation; `via` says how.
- `category_renamed` (v0.3.4): `category_id`, new `label`, `previous_label`; written when a participant names or renames a group.
- `category_removed` (v0.3.4): `category_id`, `label`, `reason: "empty"`; participant-created groups are removed automatically when their last card leaves.
- Final group names are in `task_ended.result.categories`. A completed sort always has a non-empty, unique name for every group; a sort ended with “I cannot finish grouping” can contain unnamed groups (`label: ""`, shown as “(unnamed group)” in the dashboard).
- `tree_open`, `tree_back`, `tree_selected`, `tree_unable`: path choices with elapsed milliseconds.
- `first_click`: first recorded percentage coordinates and elapsed milliseconds.
- `preference_selected`: selected variant ID or `__none__`.
- `first_click_unsure` (v0.3.1): participant chose “I'm not sure where to click” before clicking.
- `first_click_zoom` (v0.3.5): participant changed the zoom (`zoom`: 1 = fit, 1.5, 2, 3) before clicking. `x_pct`/`y_pct` are always relative to the whole image, whatever the zoom.

## Interaction items (`interaction_batch.payload.items[]`, Clicks CSV)
- `input` (v0.3.2): `pointer` for mouse/touch clicks, `keyboard` for Enter/Space activations. Keyboard activations are positioned at the centre of the activated element (they have no pointer position). Blank for records made with tracker v0.1 or earlier, where keyboard activations appear at 0%, 0%.

## Session fields
- `session_started.payload.external_id` (v0.3.6): the `pid` the participant arrived with (e.g. a Qualtrics ResponseID); only letters, digits and `_.:-`, up to 80 characters. Included in the Task CSV and A/B exposures CSV as `external_id`.
- `session_started.payload.assignments` (v0.3.6): `{experiment_id: {variant_id, source}}` decided at session start. `source`: `link` (from `variant=` / `variant.<experiment>=` in the study link, e.g. a Qualtrics randomizer), `stable-hash-equal` (built-in random), or `stable-hash-equal (link value not recognised)`. The same value is on each A/B `task_started` as `assignment` and in the A/B exposures CSV.
- `session_started.payload.consent` (v0.3.6): `true`, or `"external"` when the study is set to *Consent is collected in the survey before this study*.
- `session_started.payload.return_host` (v0.3.6): host of an allow-listed return address, when present. Values sent back in the return link are listed in `docs/QUALTRICS-AB-SETUP.md`.
- `session_resumed` (v0.3.3): written each time the participant page is reloaded (or a crashed tab restored) and the session continues. Payload: `stage` (`pre`, `start`, `activity`, `reflection`, `followup`, `post`, `finish`), `order` (activity number), `gap_seconds` (time between leaving and returning), viewport size. `task_id` is set when the reload happened during an activity or its follow-up.
- `session_started.payload.preview` (v0.3.1): `true` for a researcher “Preview locally” run. Such sessions are excluded from the dashboard and all exports unless “Include my ‘Preview locally’ runs” is ticked. Sessions recorded before v0.3.1 carry no flag and are always counted.

## Interruptions (v0.3.3)
- `task_ended.payload.interruptions`: number of reloads during that activity (omitted when none; 0 in CSVs).
- `task_ended.payload.interrupted_seconds`: total time away during those reloads.
- `time_seconds` remains wall-clock from activity start to end, including time away. Active time ≈ `time_seconds − interrupted_seconds`.
- Task CSV and Method CSV include `interruptions` and `interrupted_seconds`.

## Observed success (`observed_success`)
- `true` / `false` only when the method produced evidence (tree destination, scored first click, connected tracker with a configured signal).
- Absent in stored events, and a **blank cell** in the Task CSV, when there is no evidence either way (unscored methods, card sorts, preferences, surveys, untracked prototypes). Before v0.3.1 the Task CSV showed `false` in these cases; treat older `false` values for those methods as unknown.

## Calculation definitions
- **A/B exposure:** each `task_started` for an A/B/n activity counts once as an exposure; unfinished starts are retained. Compare rates at the experiment and activity level with denominators and missingness explicitly stated.
- **Card similarity:** `matched pair assignments / sorts where both cards were placed` × 100. The dashboard currently uses only completed sorts.
- **Tree success:** final selected destination is among `correctNodeIds`.
- **Tree direct success:** success, no recorded backtracks, and no selected detours beyond ancestors of the chosen correct destination.
- **Correct first branch:** first opened root node is on the path of *any* predefined correct destination; this does not require a successful final selection.
- **First-click target hit:** first selected position lies within any configured target rectangle. No rectangle means **unscored**, not wrong.
- **First-click hit rate (v0.3.1):** hits ÷ all scored attempts, where “not sure” answers count as attempts without a hit. The Activity outcomes table and the method analysis now use the same denominator (previously the analysis left “not sure” out).
- **Preference results:** share of completed comparisons selecting each option or no preference. These are descriptive, not significance tests.
- **A/B signal status:** `received` = success event received from the instrumented design; `not_observed` = tracker connected but the event was not received; `unavailable` = no configured signal or no tracker connection. Do not assume `not_observed` means definite failure.
- **Unfinished activity:** a `task_started` with no corresponding `task_ended` for that session/activity. Browser crashes and temporary sync failures could produce this condition.

## Deployment acceptance checklist
- Confirm browser/device embedding rules with the actual published prototype.
- Create and verify an approved remote data environment; never use local demo records for real participant collection.
- Configure and verify row-level permissions, abuse protection and study closure.
- Test at least one session of each method end to end; compare raw event exports with dashboard values.
- Verify Mac Safari, keyboard behavior and mobile touch interactions with participants using supported devices.
- Review consent language, free-text PII risk, recruitment/participant authentication, accessibility, retention and deletion controls.
