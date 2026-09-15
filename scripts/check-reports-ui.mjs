import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
assert.match(readFileSync('app/crm/navigation.tsx','utf8'),/id: ["']reports["']/,'Reports must be reachable from central sidebar');
assert.match(readFileSync('app/crm/workspace.tsx','utf8'),/ReportsPanel/,'Workspace must render actual reports component');
assert.match(readFileSync('app/crm/reports-panel.tsx','utf8'),/\/api\/reports/,'Reports must use server-authorized API');
assert.match(readFileSync('app/crm/reports-panel.tsx','utf8'),/\/properties\//,'Property report must expose catalog deep links');
console.log('PASS reports navigation wiring, API boundary and deep links');
