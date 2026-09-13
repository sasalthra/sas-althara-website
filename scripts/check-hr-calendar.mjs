import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const out=mkdtempSync(join(tmpdir(),'sas-hr-calendar-'));
try{
 await build({entryPoints:['lib/hr-policy.ts'],outfile:join(out,'hr.cjs'),bundle:true,platform:'node',format:'cjs'});
 const {serviceSchema,attendanceCalendar}=createRequire(import.meta.url)(join(out,'hr.cjs'));
 const request={id:crypto.randomUUID(),type:'leave',details:'Synthetic leave request',startDate:'2026-09-14',endDate:'2026-09-15'};
 assert.equal(serviceSchema.safeParse(request).success,true,'leave accepts structured valid date range');
 assert.equal(serviceSchema.safeParse({...request,startDate:'2026-02-30'}).success,false);
 assert.equal(serviceSchema.safeParse({...request,endDate:'2026-09-12'}).success,false);
 assert.equal(serviceSchema.safeParse({...request,startDate:undefined}).success,false);
 assert.equal(serviceSchema.safeParse({id:request.id,type:'loan',details:request.details}).success,true);
 assert.equal(typeof attendanceCalendar,'function');
 const rows=[{work_day:'2026-09-13',check_in:'2026-09-13T06:15:00Z',check_out:null,late_minutes:5}];
 const leaves=[{type:'leave',status:'approved',start_date:'2026-09-14',end_date:'2026-09-15'},{type:'leave',status:'pending',start_date:'2026-09-16',end_date:'2026-09-16'}];
 const days=attendanceCalendar('2026-09',rows,leaves,[0,1,2,3,4],'2026-09-16');
 assert.equal(days.length,30);
 assert.equal(days[12].status,'late');assert.equal(days[12].lateMinutes,5);
 assert.equal(days[13].status,'leave');assert.equal(days[14].status,'leave');
 assert.equal(days[15].status,'no_record');assert.equal(days[16].status,'scheduled');assert.equal(days[17].status,'off');
 assert.equal(attendanceCalendar('2024-02',[],[],[0],'2024-02-01').length,29);
 assert.throws(()=>attendanceCalendar('2026-13',[],[],[],''));
 console.log('PASS leave date validation and real monthly attendance/late/approved-leave/off-day calendar');
}finally{rmSync(out,{recursive:true,force:true});}
