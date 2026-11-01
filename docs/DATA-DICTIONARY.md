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
| first_click | `click` `{x_pct,y_pct,at_ms}` or `null`, `hit_target` boolean or null, `scored`, optional `participant_could_not_choose` | First image click, with target correctness only if rectangles are configured |
| preference | `selected_id` or null, `no_preference`, `display_order` | Design order is randomized but not quota-balanced |
| survey | `answered_question_ids`, `response_count` | Actual response values reside in `answers` events at stage `activity` |
| prototype | `success_signal_received`, plus event-level `observed_success`, `self_report`, `tracker_connected` | Signal fired by instrumented prototype, not independently verified completion |

## Method events
- `card_assignment`: `card_id`, assigned `category_id` or null (moving back to Unsorted).
- `category_created`: stable category ID and participant-created label.
- `tree_open`, `tree_back`, `tree_selected`, `tree_unable`: path choices with elapsed milliseconds.
- `first_click`: first recorded percentage coordinates and elapsed milliseconds.
- `preference_selected`: selected variant ID or `__none__`.

## Calculation definitions
- **A/B exposure:** each `task_started` for an A/B/n activity counts once as an exposure; unfinished starts are retained. Compare rates at the experiment and activity level with denominators and missingness explicitly stated.
- **Card similarity:** `matched pair assignments / sorts where both cards were placed` × 100. The dashboard currently uses only completed sorts.
- **Tree success:** final selected destination is among `correctNodeIds`.
- **Tree direct success:** success, no recorded backtracks, and no selected detours beyond ancestors of the chosen correct destination.
- **Correct first branch:** first opened root node is on the path of *any* predefined correct destination; this does not require a successful final selection.
- **First-click target hit:** first selected position lies within any configured target rectangle. No rectangle means **unscored**, not wrong.
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
