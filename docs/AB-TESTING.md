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

After consent, a new random session UUID is generated. A deterministic FNV-1a 32-bit hash of `session_id|study_id|experiment_id` maps to a sorted variant ID list at **equal probability**. The experiment configuration and client-side assignment logic are public to anyone inspecting a static study page. The assignment is not tamper-resistant and is unsuitable for adversarial or production conversion-rate tests without server-side allocation. This is per-session allocation, **not guaranteed 50/50 quotas**, and a browser refresh/new session may receive another arm. Do not mistake it for a production feature flag system or a persistent identity-based experiment. This is not a cryptographic assignment scheme. Simultaneous sessions and participant reentry can bias the sample; use recruitment controls if independence is important.

### Recorded events and join keys

`task_started` includes `method: ab_test`, `experiment_id`, `variant_id`, `variant_revision`, and assignment rule. `task_ended` repeats these fields and records `time_seconds`, `click_count`, `tracker_connected`, and a nested result containing `success_signal_status` (`received`, `not_observed`, or `unavailable`). It also captures `self_report` (`completed` or `unable`).

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

### Dashboard metric definitions

- **Exposed / assigned**: logged `task_started` records per variant. This is a task-exposure count, not unique human respondents.
- **Submitted**: `task_ended` event received for that activity/session.
- **Not submitted**: exposed minus submitted. Could indicate withdrawal, closing the browser, connectivity issues, or a technical problem; do not label it a failed task.
- **Signal received / connected**: `success_signal_status === received` divided by completed activities whose tracker connected. Interpret as **instrumented signal observation**, not independently verified task correctness. `not_observed` does not necessarily establish failure. If a shared signal is not configured, the metric is **Unscored**.
- **Self-reported complete**: respondents selecting *Yes, I completed it* divided by submitted activities. This is distinct from signal observation.
- **Median time on task**: middle elapsed-time value among submitted activities; excludes not-submitted attempts and can therefore be affected by differential attrition.
- **Median tracked clicks**: middle tracked click count among completed activities where the tracker was connected. Does not necessarily equal efficiency.

The first configured variant is labeled the *descriptive baseline*. The dashboard does not calculate p-values, confidence intervals, minimum detectable effects, false-discovery corrections, sample sizes, or winners. Do not treat visually larger bars as statistically or practically conclusive evidence. For formal experimentation, plan effect sizes, sample-size requirements, stopping criteria, and multiple-comparison adjustments with your research/statistics partners before the study.

### Platform constraints and quality gates

1. **No automated external variant publishing:** Export study JSON to `studies/<id>.json` and list in `studies/index.json`. Publish each implementation via its own existing GitHub Pages deployment or a path within a pinned deployment.
2. **No implicit click access into foreign iframes:** The tracker must be included in every implementation; scripts can only message the parent when they use its explicit host origin. Iframe CSP/X-Frame-Options restrictions may prevent display.
3. **No central storage on GitHub Pages:** Use approved Supabase or adapted authorized storage and verify authorization, RLS, anti-abuse, consent, access, retention/deletion and raw-event integrity. v0.3 uses existing event kinds; **no database schema migration is required from v0.2**.
4. **No reliable cross-session identity:** A reload/reentry can allocate a new arm. If that threatens study validity, recruit unique participant links and implement authorized identity-based assignment before fielding.
5. **No confirmed browser end-to-end QA in this release:** The build environment blocks Chromium navigation even when requests are intercepted. Validate a complete A and B participant session on supported browsers (especially macOS Safari), plus missing tracker/unavailable design cases, before collecting real responses.
