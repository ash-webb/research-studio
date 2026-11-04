# Running an A/B test with Qualtrics

There are two ways to connect a Research Studio A/B test to Qualtrics. In both, **Qualtrics assigns the design and stores the results**, and Research Studio needs no database.

| | **Route A: two surveys and links** | **Route B: Research Studio inside the survey** (v0.3.11) |
| --- | --- | --- |
| How it works | Survey 1 sends people to Research Studio; Research Studio sends them on to Survey 2 with the results in the link | One survey shows Research Studio on one of its pages; a short script on that page stores the results |
| Qualtrics stores | Design, task outcomes, self-report, times, clicks (counts) | All of route A, **plus** answers to the study's own questions and the full click-by-click record |
| Needs | Nothing beyond standard Qualtrics | Custom JavaScript allowed in the account (your test showed it is), and about 60 embedded data fields declared |
| Drop-out during the activity | Counted (Survey 1 rows with no Survey 2 row) | Counted when the export includes incomplete responses |

Route A is described first; route B is [further down](#route-b-research-studio-inside-the-survey).

```
Route A
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
| `rs_ab1_time` | Seconds from the start of the activity until the participant answered “Were you able to complete the task?” (includes time away during reloads) | `41` |
| `rs_ab1_tts` | Seconds from the start of the activity to the first success signal; blank when there was none (v0.3.10) | `23` |
| `rs_ab1_clicks` | Clicks inside the design | `5` |

`rs_ab2_…`, `rs_ab3_…` follow for further A/B activities, in study order. With several experiments in one study, `rs_variant_<experiment-id>` replaces `rs_variant`. Nothing that identifies the participant is included.

**Not sent to Qualtrics in route A:** the click-by-click history and screen paths, and the answers to any questions written into the Research Studio study (opening questions, questions after each activity, closing questions). They stay in the participant's browser. Ask those questions in Survey 1 or Survey 2 instead, or use route B.

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

1. In **Survey Flow**, make the first element an **Embedded Data** element listing these field names exactly as written (capitalisation matters) with no values: `rs_pid`, `rs_session`, `rs_status`, `rs_variant`, `rs_device`, and for each A/B activity `rs_ab1_task`, `rs_ab1_variant`, `rs_ab1_success`, `rs_ab1_self`, `rs_ab1_time`, `rs_ab1_tts`, `rs_ab1_clicks` (then `rs_ab2_…`).
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

## Route B: Research Studio inside the survey

```
One survey (Qualtrics)
consent, PRA notice,  →  page with Research Studio (full screen while it runs):  →  follow-up
screener, randomizer     the A/B tasks; results saved into embedded data            questions; thank you
sets rs_variant          after every activity and at the end
```

### What the survey stores

Everything in the route A table (same `rs_…` names), plus:

| Field | Meaning |
| --- | --- |
| `rs_embed_ok` | `yes` once the page's script answered Research Studio. Blank means the script didn't run |
| `rs_q_<question>` | The answer to each question in the Research Studio study, for example `rs_q_one_time_payment_ease`. Several choices are joined with `\|`. Long answers are cut at 5,000 characters |
| `rs_data_1` … `rs_data_8` | The whole Research Studio session (every event, click and screen), in parts of up to 30,000 characters so each fits an Excel cell. Unused parts are blank |
| `rs_data_parts`, `rs_data_chars`, `rs_data_sha256` | How many parts, the total length and a checksum, so the import can confirm nothing was lost |
| `rs_data_truncated` | `yes` if a very long session (more than about 1,500 clicks) had its oldest click records left out to fit; outcomes and answers are always kept |

`rs_status` is `in_progress` until the last save, then `complete`. Research Studio saves after the opening questions, after every activity and at the end.

### Setting it up

1. **Research Studio.** In the study builder tick **Consent is collected in the survey before this study**, then publish the study as usual. Open **`qualtrics-embed.html?study=STUDY-ID`** on the Research Studio site: it gives the exact field list and the script for that study.
2. **Fields.** In **Survey Flow**, add an **Embedded Data** element near the top with every name from the setup page (no values). Newer survey layouts store values set by JavaScript under `__js_` names, older ones under the plain names; your JavaScript test showed which (whether `__js_rs_small` or `rs_small` had the value). The setup page lists either set; declare both if unsure.
3. **Randomizer.** As in route A, but set `rs_variant` (not `Variant`) in each branch: `rs_variant` = `design-a`, and so on, with **Evenly Present Elements** ticked. Without a randomizer, Research Studio assigns designs itself.
4. **The page.** After consent and screening, add a page with one **Text / Graphic** question (“Please complete the activity.”). Paste the script from the setup page into that question's **JavaScript**. The script:
   - opens Research Studio full screen (or inside the question, if you chose that), passing `rs_variant` and the response ID;
   - hides the survey's Next button until the activity is finished;
   - saves only fields whose names start with `rs_`, and only when the message comes from the Research Studio address in the script;
   - goes to the next page by itself when Research Studio has finished and saved (you can turn this off).
5. **Follow-up and thank-you pages** after it. You can branch on `rs_variant`.
6. **Approved survey addresses.** Research Studio only sends results to a page on a host listed in `embedHosts` in `settings.js` (default `qualtrics.com`, which includes `irsresearch.gov1.qualtrics.com`). A page anywhere else that embeds the study gets nothing, and the participant is told not to continue. The same happens if the survey page's script is missing. `qualtrics.com` admits any Qualtrics account; to accept only yours, list its address instead, for example `embedHosts: ['irsresearch.gov1.qualtrics.com']`.

### Test before launch

- [ ] Preview the survey several times with made-up answers: you should land on each design, see **Begin** (no second consent), and return to the survey automatically at the end.
- [ ] In **Data & Analysis** (with previews shown), `rs_embed_ok` is `yes`, `rs_status` is `complete`, and `rs_data_parts` is filled.
- [ ] Reload the page in the middle of the activity once: Research Studio continues where it was, and the saved data still has everything.
- [ ] Try once on a phone and once on an iPhone (Safari).
- [ ] Export the responses and import them into Research Studio (below): the status line should say every response came **with the full session record**.

### Results

Export the survey as CSV, **including incomplete responses** if you want drop-out counted, and select **Results & insights ▸ Import Qualtrics results**. The import rebuilds each participant's full Research Studio session from `rs_data_…` and checks it against `rs_data_sha256`, so the dashboard, click maps, paths, answers and every CSV export work as if the data had been collected by Research Studio itself. A response whose data is incomplete (for example a part that wasn't declared) is shown from its summary fields, with a warning. People assigned a design who left during the activity are counted as drop-outs. Survey previews and tests are left out.

### Limits to know

- **Qualtrics keeps what was saved on pages people submitted.** Someone who closes the survey during the activity has an incomplete response with their assigned design, but not the activity results; they count as drop-outs.
- **Inside the survey, nothing is kept on the participant's device** after the tab closes: Research Studio holds the session only for the open tab, so it can continue after a reload.
- **Field limits.** Each value is kept under Excel's 32,767-character cell limit. Qualtrics' own limit for embedded data is larger; your JavaScript test stored 100,000 characters intact.
- **About 60 fields** to declare for a four-task study with 13 questions. The setup page lists them in order, so they can be added one after another.

## Checking whether custom JavaScript works in your Qualtrics account

Build a two-page test survey with `qualtrics-test.html` (served by this site) shown in an iframe and the script in `docs/qualtrics-js-test.js` added to that question. The test page reports whether the survey's script answered, and the embedded data fields `rs_js_ran`, `rs_frame_ok`, `rs_small`, `rs_large` and `rs_huge` (declared with and without the `__js_` prefix) show what Qualtrics stored. The test data is synthetic.
