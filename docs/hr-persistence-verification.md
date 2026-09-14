# HR persistence investigation — local regression

## Proven cause and scope

Starting tree was clean at `42e0c4d`. Reproduced with the actual CRM/HR React components, actual `/api/hr` route and `crmTransaction`, disposable SQLite, and a real loopback browser. Only the session, MySQL driver and server clock are substituted; other workspace read endpoints have synthetic fixtures. No application auth bypass was added.

1. Select a local employee from the directory, enter profile/schedule, confirm and save.
2. POST returns 200 **after SQL commit**. Direct SQL and subsequent GET both contain the saved profile (including fractional leave balance and schedule JSON).
3. Navigate to Leads. Assert `.hr-workspace` is absent (actual unmount). Return to HR and employee directory.
4. Before fix the job field was `''` instead of `مسؤول متابعة`, despite SQL and fresh GET still containing the correct record. Directory selection lived only in `choice`; it was not written to the URL. `CrmLink` also removed an explicitly supplied `employee` query on subsequent navigation. The editor therefore initialized for no employee, not the saved employee.
5. A second red regression showed the attendance selector resetting to `''` instead of the selected UUID after HR unmount. For a Google administrator that means selecting the unlinked Google identity and showing no calendar, not loss of attendance SQL rows.

These are proven **view-selection loss**, not proven database data deletion. They can explain the reported appearance of missing data, but do not prove the live installation has no additional failure.

## Minimal change

- `app/crm/navigation.tsx`: share existing navigation logic through `navigateCrm`; preserve explicitly selected `employee` across workspace navigation.
- `app/crm/employee-admin.tsx`: use URL selection instead of mount-local `choice`; directory/select controls update the URL. No automatic first employee or Google-to-UUID linking.
- `app/crm/hr-panel.tsx`: keep explicitly selected calendar employee in separate `attendanceEmployee` query state, honored only for admin. Self-service identity still comes from API `userId`.
- `scripts/check-hr-persistence.mjs`: regression suite below.
- This document.

No CSS/design, API, DB schema, authorization, CSRF, ownership, or storage implementation was changed. No localStorage/sessionStorage. Bare HR URLs without an explicit selection still represent the directory/self-service, not an inferred employee. Month filters and unsaved drafts are not persisted by this fix.

## Executed checks

From `C:/sasalthra/sas-althara-github`:

- `node scripts/check-hr-persistence.mjs`: red before each corresponding fix, then PASS. Tests browser profile create/update, exact SQL/GET readback, actual unmount/remount, full reload, all schedule fields and working days, employee switching/browser Back, reset confirmation, Google identity separation, calendar selection, failed-audit rollback/no fake success, missing-column GET failure and recovery, request/announcement UI saves, geolocated checkout and reload, review authorization, CSRF, anonymous rejection and employee isolation.
- `node scripts/check-crm-browser.mjs`: PASS existing synthetic design/browser suite.
- `npm test`: PASS all existing suites including actual isolated SQL. Expected deliberate DB-unavailable logs and experimental SQLite warnings remain.
- `npx tsc --noEmit`: PASS before and after build.
- `npm run build`: PASS Next 16.3.5 webpack compilation, TypeScript and route generation.
- `npx eslint app/crm/navigation.tsx app/crm/employee-admin.tsx app/crm/hr-panel.tsx scripts/check-hr-persistence.mjs`: PASS.
- `git diff --check`: PASS (line-ending notices only).

Generated ignored evidence: `test-output/hr-persistence/traffic.json` (synthetic route readback and browser errors) and `after-remount.png`. Screenshot inspection confirms selected synthetic employee, saved profile/schedule and intact RTL. Existing `test-output/crm-browser` contains the broader design screenshots. Playwright uses `PLAYWRIGHT_MODULE` or the existing local path documented in `crm-ui-verification.md`; Chrome is required. This optional browser suite is run explicitly, not included in `npm test`.

## Missing-schema and production boundary

A real isolated SQL probe dropped `hr_requests.end_date`: profile POST could still commit, but the combined HR GET returned 503, not empty successful data. The UI correctly displayed `تم الحفظ؛ تعذر تحديث العرض...`; after full reload it displayed the load error. Restoring the test column and refreshing recovered the committed profile. An injected audit failure rolled back the profile transaction and produced 503 with no fake success. This is existing behavior, not a schema repair.

No real database connection, migration, deployment, commit, push, environment-file read, or website-directory synchronization was performed. SQLite upsert translation and removed `FOR UPDATE` do **not** validate MySQL locks, migrations or restart durability. The browser server invokes the real route but is not a real Next authentication session.

If the live symptom persists, capture (with sensitive contents redacted) POST status/error, immediate and re-entry GET status, whether the same employee UUID is selected, and whether login is Google admin or local CRM. With separately authorized access, verify deployed revision and actual MySQL schema, especially `hr_requests.start_date/end_date`, `hr_profiles`, `hr_attendance`, `hr_announcements`, and `crm_audit`; verify origin configuration if writes return 403. Do not run `CREATE TABLE IF NOT EXISTS` as a guessed upgrade or relink Google identities. Independent parent-agent review and MySQL staging acceptance remain release gates.
