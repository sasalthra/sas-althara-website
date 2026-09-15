// Optional local browser suite: real workspace + real report GET + SQLite synthetic data.
// No Next auth bypass, production fixture flag, .env access, external calls or database network.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {reportsFixture,syntheticProperties} from './reports-fixture.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/moudd/AppData/Local/Temp/sas-crm-browser/node_modules/playwright');
const out=resolve('test-output/reports-browser');mkdirSync(out,{recursive:true});
const fixture=await reportsFixture();
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import CRM from './app/crm/workspace';createRoot(document.getElementById('root')).render(<CRM role={new URLSearchParams(location.search).get('role')||'admin'}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},platform:'browser',outfile:resolve(out,'app.js'),plugins:[{name:'synthetic-catalog',setup(b){b.onLoad({filter:/data[\\/]properties\.json$/},()=>({contents:JSON.stringify(syntheticProperties),loader:'json'}));}}]});
const css=['globals.css','site.css','sas-brand.css','crm/crm.css'].filter(p=>existsSync('app/'+p)).map(p=>readFileSync('app/'+p,'utf8')).join('\n');
writeFileSync(resolve(out,'app.css'),(await postcss([tailwind()]).process(css,{from:resolve('app/globals.css')})).css);
const server=createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/api/reports'){
  const role=new URL(req.headers.referer||'http://localhost').searchParams.get('role')||'admin';fixture.actor({userId:role==='admin'?'root':'alice',role,name:'حساب اصطناعي'});
  const r=await fixture.get(url.searchParams.toString());res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;
 }
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end('[]');return;}
 if(url.pathname==='/app.js'||url.pathname==='/app.css'){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':'text/css');res.end(readFileSync(resolve(out,url.pathname.slice(1))));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ar" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Reports Fixture</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><div style="position:fixed;bottom:0;left:0;background:#fff;padding:4px;z-index:9999;font:11px sans-serif">SYNTHETIC TEST DATA ONLY</div><script src="/app.js"></script></body></html>');
 }catch(e){res.statusCode=500;res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
async function ready(){await page.locator('.reports-center').waitFor();await page.getByText('جارٍ تحميل التقارير…',{exact:true}).waitFor({state:'hidden'});assert.equal(await page.locator('.reports-center [role=alert]').count(),0);}
async function noOverflow(){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'horizontal page overflow');}
async function shot(name){await page.screenshot({path:resolve(out,name+'.png'),fullPage:true});}
try{
 await page.goto(base+'/crm');await page.getByRole('link',{name:'تقارير',exact:true}).click();await ready();assert.equal(await page.locator('.report-overview tbody tr').count(),15);await noOverflow();await shot('desktop-overview');checks.push('sidebar + all 15 overview modules');
 await page.locator('.report-overview tbody tr').first().getByRole('link').click();await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),25);
 await page.getByRole('link',{name:'التالي',exact:true}).click();await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),6);assert.ok(page.url().includes('page=2'));await page.reload();await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),6);await page.goBack();await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),25);checks.push('server pagination, reload, browser Back');
 await page.getByLabel('من تاريخ — الرياض',{exact:true}).fill('2026-09-01');await page.getByLabel('إلى تاريخ — الرياض',{exact:true}).fill('2026-09-30');await page.getByLabel('مصدر العميل',{exact:true}).fill('website');await page.getByRole('button',{name:'تطبيق المرشحات'}).click();await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),15);assert.ok(page.url().includes('source=website'));await page.reload();await ready();assert.equal(await page.getByLabel('مصدر العميل',{exact:true}).inputValue(),'website');await shot('desktop-filtered-leads');checks.push('shareable date/source filters applied to real SQL');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'تصدير CSV لكل النتائج'}).click();const download=await downloadPromise;await download.saveAs(resolve(out,'filtered-leads.csv'));const csv=readFileSync(resolve(out,'filtered-leads.csv'),'utf8');assert.equal(csv.trim().split('\r\n').length,16);checks.push('actual authorized CSV download contains filtered complete rows');
 await page.getByRole('button',{name:'طباعة الصفحة الحالية'}).evaluate(el=>{window.__printCalls=0;window.print=()=>window.__printCalls++;el.click();});assert.equal(await page.evaluate(()=>window.__printCalls),1);
 await page.emulateMedia({media:'print'});assert.equal(await page.locator('.crm-sidebar').isVisible(),false);assert.equal(await page.locator('.report-filters').isVisible(),false);await page.pdf({path:resolve(out,'synthetic-report.pdf'),printBackground:true});await page.emulateMedia({media:'screen'});checks.push('print button + print CSS + real PDF generation');
 await page.getByRole('link',{name:'إعادة ضبط المرشحات',exact:true}).click();await ready();assert.ok(!page.url().includes('source='));assert.equal(await page.locator('.report-overview tbody tr').count(),15);checks.push('reset returns to bounded overview state');
 for(const id of ['followups','activity','properties','transactions','attendance','profiles','requests','announcements','users','audit','imports','importRows','sheets','ai']){await page.goto(base+'/crm?tab=reports&module='+id);await ready();assert.ok(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count()>0,id);await noOverflow();if(['transactions','attendance','sheets'].includes(id))await shot('desktop-'+id);}checks.push('all 15 real module tables rendered without page overflow');
 await page.setViewportSize({width:360,height:800});await page.goto(base+'/crm?tab=reports&module=leads');await ready();await noOverflow();await shot('mobile-leads-360');await page.getByRole('button',{name:'فتح القائمة'}).click();await page.getByRole('link',{name:'تقارير',exact:true}).click();await ready();await noOverflow();await shot('mobile-overview-360');checks.push('mobile drawer navigation + 360px no page overflow');
 await page.goto(base+'/crm?tab=reports&module=attendance&role=sales');await ready();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"] tbody tr').count(),1);assert.equal(await page.getByRole('button',{name:'تصدير CSV لكل النتائج'}).count(),0);assert.equal(await page.locator('select[name=module] option[value=transactions]').count(),0);await noOverflow();await shot('mobile-self-attendance');checks.push('self-only HR UI, no admin choices or export controls');
 await page.goto(base+'/crm?tab=reports&module=transactions&role=sales');await page.getByRole('alert').waitFor();assert.equal(await page.locator('[aria-label="تفاصيل التقرير"]').count(),0);checks.push('forged financial URL denied by real API');
 fixture.fail('hr_attendance');await page.goto(base+'/crm?tab=reports');await ready();assert.ok(await page.locator('.report-overview').innerText().then(t=>t.includes('غير متاح')));await shot('mobile-unavailable-source');fixture.fail('');checks.push('source failure shown as unavailable, not zero');
 assert.deepEqual(errors,[]);writeFileSync(resolve(out,'results.json'),JSON.stringify({checks,errors,sqlQueries:fixture.count,synthetic:true},null,2));console.log(JSON.stringify({checks,errors,evidence:out},null,2));
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));fixture.close();}
