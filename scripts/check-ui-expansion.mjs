import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const out=mkdtempSync(join(tmpdir(),'sas-ui-'));
try {
 await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import CRM from './app/crm/workspace';export const admin=renderToStaticMarkup(<CRM role="admin"/>);export const sales=renderToStaticMarkup(<CRM role="sales"/>);export const supervisor=renderToStaticMarkup(<CRM role="supervisor"/>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(out,'ui.cjs'),bundle:true,platform:'node',format:'cjs'});
 const {admin,sales,supervisor}=createRequire(import.meta.url)(join(out,'ui.cjs'));
 assert.match(admin,/إعدادات Google Sheets/,'admin can reach Sheets configuration');
 assert.match(admin,/استيراد Excel/,'admin can reach import');
 assert.match(supervisor,/استيراد Excel/);
 assert.doesNotMatch(sales,/استيراد Excel|إعدادات Google Sheets/);
 for(const html of [admin,sales,supervisor])assert.match(html,/المساعد الداخلي/,'all authorized roles can reach read-only AI');
 console.log('PASS rendered workspace navigation: Sheets admin-only, import managers-only, AI all CRM roles');
 await build({stdin:{contents:`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import HrPanel from './app/crm/hr-panel';export const html=renderToStaticMarkup(<HrPanel admin={false}/>);`,resolveDir:process.cwd(),loader:'tsx'},outfile:join(out,'hr-ui.cjs'),bundle:true,platform:'node',format:'cjs'});
 const {html}=createRequire(import.meta.url)(join(out,'hr-ui.cjs'));
 assert.match(html,/hr=attendance/,'calendar destination available');
 assert.match(html,/hr=requests/,'dated requests destination available; forms exercised in check-crm-browser');
 assert.match(html,/hr=profile/,'employee profile destination available');
 console.log('PASS HR calendar/request/profile destinations rendered; browser suite exercises their forms');
} finally {rmSync(out,{recursive:true,force:true});}
