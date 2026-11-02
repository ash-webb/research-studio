# Running an A/B test with Qualtrics

This guide connects a Research Studio A/B test to Qualtrics so that **Qualtrics assigns the design and stores the results**. It needs no custom JavaScript in Qualtrics and no database for Research Studio.

```
Survey 1 (Qualtrics)            Research Studio                      Survey 2 (Qualtrics)
consent, PRA notice,      →     the A/B task(s) on the design   →    results arrive in the link;
screener, randomizer            Qualtrics chose                      follow-up questions; thank you
picks the design
```

Survey 1 and Survey 2 are joined on the Survey 1 response ID. Qualtrics records link values only when a survey **starts**, so the results go to a second survey rather than back into the first.

## What Qualtrics receives

Per participant, in Survey 2:

| Field | Meaning | Example |
| --- | --- | --- |
| `rs_pid` | Survey 1 response ID the participant arrived with | `R_3abcDEF123` |
| `rs_session` | Research Studio session ID | `9f1c…` |
| `rs_status` | `complete` when they finished the Research Studio part | `complete` |
| `rs_device` | `phone`, `tablet` or `desktop`, from screen width at the start | `phone` |
| `rs_variant` | Design shown (one experiment) | `design-b` |
| `rs_ab1_task` | ID of the first A/B activity | `find-service-request` |
| `rs_ab1_variant` | Design shown in that activity | `design-b` |
| `rs_ab1_success` | Success signal: `received`, `not_observed` (tracking worked, signal never sent) or `unavailable` (no tracking or no signal set) | `received` |
| `rs_ab1_self` | Participant's own answer: `completed` or `unable` | `completed` |
| `rs_ab1_time` | Seconds from start to “Finish this task” | `41` |
| `rs_ab1_clicks` | Clicks inside the design | `5` |

`rs_ab2_…`, `rs_ab3_…` follow for further A/B activities, in study order. With several experiments in one study, `rs_variant_<experiment-id>` replaces `rs_variant`. Nothing that identifies the participant is included.

**Not sent to Qualtrics in this setup:** the click-by-click history and screen paths. They stay in the participant's browser. Sending them needs the custom-JavaScript integration (a later step).

## 1. Prepare the study in Research Studio

1. In **Study builder**, fill in the **Study plan** (control design, hypotheses, measures, sample size), then **Lock plan** before launch. **Download plan (.docx)** gives you a document for review.
1. Add an **A/B implementation test** activity. Give each design a short ID such as `design-a`, `design-b`, `design-c`: these IDs are what Qualtrics will send.
2. Set a **success signal** and select **Check designs**. Every design should show “Tracking connected” and, after you complete the task inside it, “Success signal received”.
3. Tick **Consent is collected in the survey before this study**, so participants are not asked to consent twice.
4. Select **Preview locally** to try it. Add `&variant=design-b` to the preview address to see a specific design.
5. Select **Save working copy (with plan)** to keep your plan, then **Export study JSON** (the plan is left out of this file). Add the file to the `studies/` folder of the site's repository, add an entry to `studies/index.json`, and publish. Note the **study ID**.
6. If your Qualtrics links are not on `qualtrics.com` (for example a custom domain), add that host to `returnUrlHosts` in `settings.js`. The “Return to the survey” button only appears for those hosts.

## 2. Survey 1 (intake)

1. Put the consent statement, the Paperwork Reduction Act notice and any screening questions here, as you normally would.
2. In **Survey Flow**, add a **Randomizer** after the screener:
   - choose **Randomly present 1 of the following elements**,
   - tick **Evenly Present Elements** (keeps the groups the same size),
   - inside it, add one **Embedded Data** element per design: `Variant` = `design-a`, `Variant` = `design-b` (and `design-c` if you have three).
3. Add an **End of Survey** element after the randomizer with **Redirect to a URL**:

   ```
   https://YOUR-SITE/study.html?study=STUDY-ID&variant=${e://Field/Variant}&pid=${e://Field/ResponseID}&return=SURVEY-2-LINK-ENCODED
   ```

   - `YOUR-SITE`: the address of the approved GitHub Pages site.
   - `STUDY-ID`: from step 1.5.
   - `SURVEY-2-LINK-ENCODED`: Survey 2's anonymous link, URL-encoded (`:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `&` → `%26`). For example `https://example.qualtrics.com/jfe/form/SV_abc` becomes `https%3A%2F%2Fexample.qualtrics.com%2Fjfe%2Fform%2FSV_abc`.

## 3. Survey 2 (follow-up)

1. In **Survey Flow**, make the first element an **Embedded Data** element listing these field names exactly as written (capitalisation matters) with no values: `rs_pid`, `rs_session`, `rs_status`, `rs_variant`, `rs_device`, and for each A/B activity `rs_ab1_task`, `rs_ab1_variant`, `rs_ab1_success`, `rs_ab1_self`, `rs_ab1_time`, `rs_ab1_clicks` (then `rs_ab2_…`).
2. Add your follow-up questions. You can branch on `rs_variant` if questions differ by design.
3. End with a thank-you message.

## 4. Test before launch

- [ ] **Check designs** shows every design ready.
- [ ] Take Survey 1 at least four times. You should land on each design at least once, and see the Research Studio welcome with a **Begin** button (no second consent).
- [ ] After finishing, **Return to the survey** opens Survey 2.
- [ ] In Survey 2's responses, the `rs_…` fields are filled and `rs_pid` matches a Survey 1 response ID.
- [ ] Try once on a phone: the designs must work at phone width.

## 5. See the results in Research Studio

1. In Qualtrics, export **Survey 2** as CSV (and **Survey 1**, so people who never came back are counted). The default CSV export with the three header rows is fine.
2. In Research Studio, open **Results & insights**, choose the study, select **Import Qualtrics results** and pick both files.
3. The A/B section then shows, from your Qualtrics data: each design's success rate counting everyone assigned (drop-outs count as not successful) with its 95% range, the difference from the baseline design with its range, the rate among measured finishers as a secondary figure, drop-out, self-reported completion and median times per design, data checks (group sizes, drop-out, tracking, devices) and a sample-size planner. Without Survey 1, drop-out is shown as unknown. The CSV export buttons work on the imported data too.

The files are read in your browser only; nothing is uploaded or stored. Select **Show browser data instead** to leave the imported view.

## 6. Analysis in your own tools

1. Export Survey 1 (with `ResponseID` and `Variant`) and Survey 2 (with the `rs_…` fields).
2. Join them: Survey 1 `ResponseID` = Survey 2 `rs_pid`.
3. **Compare drop-off by design before comparing outcomes.** People who start a design but never reach Survey 2 appear in Survey 1 with that `Variant` and no Survey 2 row. If one design loses more people, that is itself a finding, and it can bias the outcome comparison.
4. Treat `rs_ab1_success = received` as the observed success measure and `rs_ab1_self` as the participant's own view. They answer different questions. `not_observed` and `unavailable` are not proof of failure.

## Good to know

- **Refreshes are safe.** A participant who reloads Research Studio continues in the same session with the same design.
- **Values in links are visible.** A participant could, in principle, edit the address bar. Keep design IDs neutral (`design-a`, not `new-improved`) and treat odd values with care. A design ID that the study doesn't have is replaced by a random design and flagged in the Research Studio results.
- **Without Qualtrics** (for example when piloting), Research Studio assigns designs at random itself. Group sizes are then not guaranteed to be even.
