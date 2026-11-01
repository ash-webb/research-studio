# Accessibility report — v0.3.1 → v0.3.2

**Date:** November 1, 2026
**Standard:** WCAG 2.2 Level A and AA (plus axe-core best-practice rules)
**Browser:** Chromium (Playwright)
**How to rerun:** `npm run test:a11y` (automated scan) and `npm run test:keyboard` (keyboard-only runs). Both need Playwright; the scan also needs axe-core (`npm install --no-save playwright axe-core`).

This is a software accessibility review, not a formal conformance audit. Automated tools and scripted keyboard runs catch many problems, but they do not replace testing with real screen readers and with disabled participants.

## Results

| Check | v0.3.1 | v0.3.2 |
| --- | --- | --- |
| Automated scan (axe-core 4.10, WCAG 2.2 A/AA + best practice): every participant and researcher screen state at desktop (1360px), phone (390px) and 400% zoom (320px), 72 states | 3 rule types failing (159 low-contrast elements, keyboard-unreachable scrolling tables, nested landmark) | **0 violations** |
| Reflow at 320px (WCAG 1.4.10): no sideways page scrolling | not checked | **Pass on all 24 screen states** |
| Keyboard-only runs: every study type completed with Tab / Shift+Tab / Enter / Space / arrows | **5 / 35 checks** | **39 / 39 checks** |
| Participant suite regression run (`npm run test:e2e`) | 218 / 218 | **All pass** (222–228 checks; the count varies with random A/B assignment) |
| Unit tests (`npm test`) | 53 / 53 | **54 / 54** |

## Problems found and fixed

### Participants

1. **Focus was lost on every screen change** (WCAG 2.4.3 Focus Order). Each step replaced the page content and dropped focus to the top of the document, so keyboard and screen-reader users had to start again from the page header on every step.
   *Fix:* focus now moves to the new screen's heading, which screen readers read out. Within an activity it moves to the next sensible control instead: the card's menu after moving a card, the group-name field after adding a group, and the first item inside a tree section after opening it.

2. **The first-click test could not be done with a keyboard** (WCAG 2.1.1 Keyboard). Only "I'm not sure where to click" was reachable.
   *Fix:* the screenshot is now focusable. Enter shows a marker in the centre, the arrow keys move it (Shift for larger steps), Enter confirms and Escape removes it. Instructions appear on screen. The recorded click carries `input: "keyboard"` or `input: "pointer"`, so researchers can separate keyboard-placed clicks in analysis.

3. **Changes inside an activity were silent to screen readers** (WCAG 4.1.3 Status Messages). Moving a card, adding a group and moving through the tree gave no feedback.
   *Fix:* a polite status region announces these, for example "Make a payment moved to Money. 1 of 8 cards grouped." and "Inside Records. 2 items." The current tree location is marked in the breadcrumb.

4. **Validation errors left focus on the Continue button** (WCAG 3.3.1 Error Identification).
   *Fix:* focus moves to the unanswered question, which is marked invalid; the error message is still announced.

5. **Focus outlines were faint or missing** (WCAG 2.4.7 Focus Visible, 1.4.11 Non-text Contrast). The answer chips used a 1.5:1 outline, and text fields a 1.4:1 outline.
   *Fix:* one consistent 3px dark-teal outline (well above 3:1) on every control, with a light version on the dark sidebar.

6. **Low-contrast grey text** (WCAG 1.4.3 Contrast). 24 grey shades, used for progress text, helper text, scale labels, timers, table headers and captions, were between 2.4:1 and 4.5:1.
   *Fix:* each shade was darkened just enough, keeping its hue, to reach at least 4.6:1 on the darkest light background it appears on. The look is the same, slightly crisper. Shades on the dark sidebar already passed and were left alone, as were decorative elements (the logo dot and the drag-grip icon).

7. **Motion:** hover lifts and progress animations now switch off when the system's "reduce motion" setting is on.

### Researcher screens

8. Wide results tables scroll sideways but could not be reached by keyboard (WCAG 2.1.1). Each is now a focusable, named region, for example "Find your most recent service request: Implementation outcomes by variant table (scrolls sideways)".
9. Added a "Skip to main content" link and marked the current section of the navigation for screen readers (`aria-current`).
10. The builder's Study overview panel was a sidebar landmark nested inside the main content; it is now a labelled section.

### Data quality issue found during keyboard testing

11. **Keyboard presses inside a prototype were recorded as clicks at the top-left corner (0%, 0%).** Pressing Enter on a button fires a click with no pointer position, and the tracker stored that as (0, 0). That skewed click maps and made keyboard users look like they clicked the corner.
    *Fix (tracker `sdk/utp-tracker.js` v0.1.1):* keyboard activations are recorded at the centre of the activated element and labelled `input: "keyboard"`; mouse and touch clicks are labelled `input: "pointer"`. The new `input` column is in the Clicks CSV, and the click timeline shows "(keyboard)". **Prototypes that load the tracker from your Research Studio site get this automatically. Any prototype with its own copy of the tracker needs that copy updated.**

## Not yet verified

- **Real screen readers:** VoiceOver on macOS and iOS, NVDA or JAWS on Windows, TalkBack on Android. The announcements and focus moves above follow standard patterns but have only been checked programmatically.
- **Safari and Firefox keyboard behaviour.** In Safari, Tab skips links and buttons unless "Press Tab to highlight each item on a webpage" is turned on in Safari settings (Advanced). That is a browser setting, not a defect in the app, but worth knowing when piloting.
- **Your prototypes themselves.** The demo prototypes are simple. Your own GitHub Pages prototypes need their own accessibility check; Research Studio can only record what they expose.
- **Drag-and-drop card sorting is pointer-only by nature.** Every card also has a category menu, which works with keyboard, switch access and screen readers.
- **Cognitive accessibility, plain-language review, and testing with disabled participants.**
- The method itself: first-click and preference tests are inherently visual. Keyboard users can now take part, but blind participants cannot meaningfully take visual first-click or preference tests. Consider this when recruiting and when interpreting results.
