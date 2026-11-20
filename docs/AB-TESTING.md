# A/B/n implementation testing — researcher setup and analysis

## Intended use

Compare the **usability of two or more implemented, interactive designs** using a between-participants design. Examples: alternative navigation layouts, form workflows, or payment-step organization. This is different from the separate **Preference** method, where one participant reviews multiple static concepts and chooses a favorite.

### Study definition

- Define a research question and primary outcome **before** launching. Example: *Does the navigation implementation affect the proportion of participants who reach the requested account record?*
- Use identical participant-facing tasks and follow-up questions across variants. Hide variant labels and specific success destinations from the instructions.
- Keep target devices, task data, recruitment criteria, and measurement instrumentation comparable. Stratify or segment by device where warranted.
- Choose 2+ variants, each an HTTPS (or localhost development) URL, and record a stable revision identifier. Every GitHub Pages implementation should include the same bridge script and emit a success event after an **equivalent** end state.
- Give related activities the same `experimentId` and the same set of variant IDs. A session remains assigned to one arm for every such activity. Different experiment IDs are independently hashed.
- Describe the experiment and data capture in the consent screen, then pilot with fictional data.

### Session assignment

After consent, a new random session UUID is generated. A deterministic FNV-1a 32-bit hash of `session_id|study_id|experiment_id` maps to a sorted variant ID list at **equal probability**. The experiment configuration and client-side assignment logic are public to anyone inspecting a static study page. The assignment is not tamper-resistant and is unsuitable for adversarial or production conversion-rate tests without server-side allocation. This is per-session allocation, **not guaranteed 50/50 quotas**, and a new session (new tab, browser or device) may receive another arm. Since v0.3.3 a refresh in the same tab resumes the same session and keeps its arm. Do not mistake it for a production feature flag system or a persistent identity-based experiment. This is not a cryptographic assignment scheme. Simultaneous sessions and participant reentry can bias the sample; use recruitment controls if independence is important.

### Recorded events and join keys

`task_started` includes `method: ab_test`, `experiment_id`, `variant_id`, `variant_revision`, and assignment rule. `task_ended` repeats these fields and records `time_seconds`, `success_at_seconds` (time to the first success signal, v0.3.10), `finished_at_seconds`, `click_count`, `tracker_connected`, and a nested result containing `success_signal_status` (`received`, `not_observed`, or `unavailable`). It also captures `self_report` (`completed` or `unable`).

CSV exports:

| Export | Purpose |
| --- | --- |
| A/B exposures CSV | **One row per task start**, with variant, revision, joined task end and `status` = submitted/not_submitted. Includes missing submissions. |
| Method CSV | One row per completed activity, nested outcome JSON, version and variant. |
| Task CSV | Completed activity metrics by session and variant. |
| Survey CSV | Pre-/post-study responses; post-task answers include the task's variant and experiment IDs. |
| Clicks CSV | Tracked click coordinates/element IDs tagged with participant variant. |
| Full JSON | Append-only source events, suitable for further reconciliation and analysis. |

Study-level pre/post questions have no single `variant_id` when a study has multiple experiments; join using `session_id` plus exposure records for the experiment of interest.

### Comparing the two designs at the end (v0.3.26)

For a two-design experiment, an optional `comparison` block shows each participant the design they didn't use, then asks which they prefer. It comes after the final questions, so it can't affect the task results.

```json
"comparison": {
  "experimentId": "iola-current-vs-new",
  "explore": { "title": "Look at the other design", "instructions": "…look over the home screen, then open the Payments and Notices areas…", "doneLabel": "Done looking →" },
  "labels": { "used": "The design you used for the tasks", "explored": "The design you just looked at" },
  "snapshots": {
    "iola-current": [{ "label": "Home", "imageUrl": "studies/assets/iola/current-home.webp" }, …],
    "iola-new": [{ "label": "Home", "imageUrl": "studies/assets/iola/new-home.webp" }, …]
  },
  "question": { "id": "design-preference", "title": "Which design do you prefer?", "intro": "…", "text": "Which design would you rather use?" },
  "why": { "id": "design-preference-why", "text": "What made you prefer one design over the other, or neither?" }
}
```

- `experimentId` must name an A/B experiment with exactly two designs. Every design needs at least one snapshot with a label and an image address; use the same screens in the same order for both. Only `experimentId` and `snapshots` are required.
- The explored design opens at its first `prototypeUrl` in the same frame as the tasks, so both are seen at the same size. Take snapshots at that size (1,348×640 on a 1366-wide laptop) and retake them whenever a design changes.
- Left/right order is random per session (`comparison_answered.left_variant`). Since v0.3.29 each column is an answer ("I'd rather use this one"), with "No preference" below; choosing a design then asks "How strong is your preference?" (Slightly / Strongly). Columns are named by what the person did with each design, never by number or side, because the order is random (v0.3.30). An optional `usedNote`/`exploredNote` adds a line under each name. `design-preference` stores the preferred design's ID (or `none`), so analysis doesn't need the order; `scale_value` keeps the earlier 1–5 coding (1 = strongly the left column … 5 = strongly the right).
- Seeing the second design only after the tasks means the explored design gets a shorter, task-free look; read the preference as a first impression of it, not a usability comparison.

### Dashboard metric definitions (v0.3.7)

- **Assigned**: people with a `task_started` record for that design, counted once per session. For imported Qualtrics data, people assigned in Survey 1 who never reached Survey 2 are included.
- **Finished**: a `task_ended` record for that activity and session. **Dropped out** = assigned − finished. This can mean withdrawal, a closed browser or a technical problem.
- **Main measure: success signal, everyone assigned.** Successes ÷ everyone assigned. People who dropped out, or whose success could not be measured, count as not successful. This keeps the randomised groups intact, so drop-out or tracking that differs by design cannot quietly flip the comparison. Without a success signal, self-reported completion ÷ everyone assigned is used instead.
- **Secondary: success signal, measured finishers.** Successes ÷ finishers whose tracker connected and reported `received` or `not_observed`. When this and the main measure point to different conclusions, a **Ways of counting disagree** check appears; rely on the main measure.
- **Self-reported complete**: *Yes, I completed it* ÷ finishers. A different question from observed success.
- **Median active time**: elapsed time minus time away after a reload, among finishers with a recorded time (missing times are left out, never treated as 0). Includes unsuccessful attempts; **Median time, successful attempts** is shown beside it.
- **Median clicks**: among finishers whose tracker connected.

#### Ranges and comparisons

- Each design's rate has a 95% Wilson score interval. Differences from the first design (the baseline) use Newcombe's hybrid score interval. With 3 designs, difference ranges are widened to 97.5% (Bonferroni over the two comparisons with the baseline). Medians use a fixed-seed percentile bootstrap (2,000 resamples, needs at least 5 values; "range not estimable" when values tie).
- Comparisons are shown only when each design has at least 10 people assigned.
- Wording is deliberately cautious. A range that excludes zero means a gap that large would be unusual if the designs performed the same. A range that includes zero is **not** evidence that they perform the same. Overlapping per-design ranges are not a test; use the difference range. Secondary measures are not adjusted for multiple looks.
- **No winner is declared.** Practical importance is the research team's judgement.

#### Data checks

- **Group sizes**: chi-square sample-ratio check; flagged when p < 0.01. Not run when drop-out is unknown.
- **Drop-out**: per design; flagged when the drop-out difference between designs has a 95% range excluding zero. "Unknown" for imported data without Survey 1.
- **Tracking**: flagged when under 90% of a design's finishers were measurable, or when the unmeasured share differs between designs.
- **Devices**: share on phones per design; flagged when the difference's range excludes zero.

#### Planning

- **Provisional banner**: while the smallest group is below the planned size, shows the smallest difference that would reliably show up at the current size (80% power).
- **Sample-size planner**: two-proportion normal approximation (Fleiss, no continuity correction), people *assigned* per design, with significance divided across comparisons for 3 designs. If baseline + difference passes 100%, it plans the equivalent drop instead. Fix the size before fielding and judge results once it is reached; stopping when results look good raises false positives.

### Platform constraints and quality gates

1. **No automated external variant publishing:** Export study JSON to `studies/<id>.json` and list in `studies/index.json`. Publish each implementation via its own existing GitHub Pages deployment or a path within a pinned deployment.
2. **No implicit click access into foreign iframes:** The tracker must be included in every implementation; scripts can only message the parent when they use its explicit host origin. Iframe CSP/X-Frame-Options restrictions may prevent display.
3. **No central storage on GitHub Pages:** Use approved Supabase or adapted authorized storage and verify authorization, RLS, anti-abuse, consent, access, retention/deletion and raw-event integrity. v0.3 uses existing event kinds; **no database schema migration is required from v0.2**.
4. **No reliable cross-session identity:** A reload/reentry can allocate a new arm. If that threatens study validity, recruit unique participant links and implement authorized identity-based assignment before fielding.
5. **No confirmed browser end-to-end QA in this release:** The build environment blocks Chromium navigation even when requests are intercepted. Validate a complete A and B participant session on supported browsers (especially macOS Safari), plus missing tracker/unavailable design cases, before collecting real responses.
