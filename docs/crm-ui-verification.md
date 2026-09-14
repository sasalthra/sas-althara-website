# CRM UI redesign — local verification

## Scope and outcome

The interrupted redesign was preserved, not restarted. The workspace now uses a grouped Arabic RTL sidebar and compact operational header rather than a marketing hero. HR provides attendance-led self service, month/day details, categorized requests, profile data and mobile bottom navigation. Admin-only employee directory/schedule configuration remains separate and is reachable from Users through an explicit employee link. A required confirmation and validated schedule/location precede profile save; linking does not grant roles or guess a Google user's employee identity.

This resumption changed the browser harness and this verification document. The application changes below were inherited, inspected and exercised without overwriting them.

## Change manifest (relative to repository)

- `app/crm/workspace.tsx`
- `app/crm/crm.css` (new)
- `app/crm/navigation.tsx` (new)
- `app/crm/hr-panel.tsx`
- `app/crm/employee-admin.tsx` (new)
- `app/crm/users-panel.tsx`
- `app/crm/transactions-panel.tsx`
- `app/crm/leads/[id]/page.tsx` (admin transaction deep link only)
- `scripts/check-ui-expansion.mjs`
- `scripts/check-crm-browser.mjs` (new)
- `docs/crm-ui-verification.md` (new)

## Executed verification

- `npm test`: PASS, including auth/owner isolation, financial and HR policy, API checks, monthly calendar, SSR navigation and actual SQL persistence in isolated in-memory SQLite. Deliberate database-unavailable logs and Node's experimental SQLite warning are expected test output.
- `npx tsc --noEmit`: PASS, also rerun after build.
- `npm run build`: PASS, Next 16.3.5 webpack production build and route generation.
- `npx eslint app/crm/workspace.tsx app/crm/hr-panel.tsx app/crm/employee-admin.tsx app/crm/navigation.tsx app/crm/users-panel.tsx app/crm/transactions-panel.tsx scripts/check-crm-browser.mjs scripts/check-ui-expansion.mjs`: PASS.
- Lead detail targeted lint: existing two `react-hooks/set-state-in-effect` errors and one `exhaustive-deps` warning. Reproduced identically with `git show HEAD:app/crm/leads/[id]/page.tsx | npx eslint --stdin --stdin-filename 'app/crm/leads/[id]/page.tsx'`. Not concealed or introduced by the one-line deep link. Do not describe all changed-file lint as clean.
- `git diff --check`: PASS (Git emits line-ending normalization notices only).
- `node scripts/check-crm-browser.mjs`: PASS in local headless Chrome with real React components and synthetic HTTP fixtures. No Next auth bypass, real database, customer records or external provider requests are involved.

The browser suite verifies sidebar navigation/reload/back, users-to-employee selection, required confirmation and blank schedule rejection, explicit profile save/read-back, unlinked Google explanation, mobile drawer/Escape, no horizontal page overflow, categorized leave validation and valid leave submit/read-back, denied geolocation with no punch, permitted synthetic geolocation checkout/read-back and disabled repeat action, selected-month isolation from today's punch, employee admin-URL denial, and lead-to-transaction selection. The resumption added successful request persistence, denied-location interaction and final calendar scroll clearance tests. A first denial-message assertion timed out because exact text included a nested radius note; the selector was corrected to target the location container. Application behavior was not changed to satisfy the fixture.

## Browser harness and evidence

Run from `C:/sasalthra/sas-althara-github`. The harness uses esbuild and PostCSS from repository dev dependencies. Playwright is supplied via `PLAYWRIGHT_MODULE`, falling back to the existing local installation `C:/Users/moudd/AppData/Local/Temp/sas-crm-browser/node_modules/playwright`; Chrome must be installed. This is an optional local verification script, not a production route or auth flag. The temporary HTTP server binds only 127.0.0.1 and closes after the run.

Evidence directory: `C:/sasalthra/sas-althara-github/test-output/crm-browser/` (generated, ignored by Git).

- `results.json`: successful interaction checks and synthetic write actions.
- `desktop-leads.png`, `desktop-hr.png`, `desktop-calendar.png`: desktop operating surfaces.
- `desktop-employee-admin.png`, `employee-form-full.png`, `desktop-unlinked.png`: explicit account/schedule administration.
- `mobile-employee-home-360.png`, `mobile-hr.png`, `mobile-hr-scrolled.png`: attendance-led self service and quick-action clearance.
- `mobile-calendar.png`, `mobile-calendar-scrolled.png`, `mobile-day-detail.png`: month selection and day details.
- `mobile-requests.png`, `mobile-request-readback.png`, `mobile-profile.png`: requests and profile.
- `mobile-location-denied.png`, `mobile-clocked-out.png`: location refusal and successful synthetic checkout.
- `mobile-leads.png`: mobile workspace/table.

Actual screenshot inspection was performed for desktop leads/admin and mobile employee home, requests, profile, denied location, calendar and scrolled states. Sidebar/table alignment and RTL were intact. Initial viewport captures show content continuing underneath the fixed bottom navigation; scroll-position assertions and the inspected scrolled screenshots establish that quick actions and day details are fully reachable above it. Small secondary text and dense mobile calendar labels remain a polish consideration, not a claim of WCAG certification. Viewport screenshots carry an explicit synthetic-fixture watermark injected only by the harness; element screenshots depict the same synthetic data.

## Remaining boundaries

No commit, push, deployment, environment/secret change, real DB mutation or synchronization to the website folder was performed. Browser fixture tests do not validate production sessions, real MySQL locks/migrations, GPS spoof resistance, device permissions across browsers, real Sheets/AI integrations or the entire CRM workflow. Staging/account-based acceptance and the outstanding security/finance/HR policy gates in `docs/crm-expansion.md` remain open. This is a verified local UI deliverable, not a production-readiness declaration.
