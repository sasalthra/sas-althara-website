// Never loads .env. Default invocation only prints the migration plan.
import {readFileSync} from 'node:fs';
const columns={assigned_to:"VARCHAR(255) NOT NULL DEFAULT ''",field_assigned_to:"VARCHAR(255) NOT NULL DEFAULT ''",created_by:"VARCHAR(255) NOT NULL DEFAULT ''",source:"VARCHAR(80) NOT NULL DEFAULT 'manual'",property_other:"VARCHAR(500) NOT NULL DEFAULT ''"};
const files=['db/mysql/001_leads.sql','db/mysql/002_expansion.sql'];
if(!process.argv.includes('--apply-local')){
 console.log(JSON.stringify({mode:'PLAN ONLY: no connection',files,leadColumns:columns,stage:'VARCHAR(40), preserving legacy and new stages',apply:'--apply-local with MIGRATION_HOST=127.0.0.1, MIGRATION_DATABASE ending _test, MIGRATION_USER, MIGRATION_PASSWORD, optional MIGRATION_PORT'},null,2));
}else{
 const {MIGRATION_HOST:host,MIGRATION_DATABASE:database,MIGRATION_USER:user,MIGRATION_PASSWORD:password,MIGRATION_PORT:port}=process.env;
 if(!['127.0.0.1','localhost','::1'].includes(host)||!/^sas_[a-z0-9_]+_test$/.test(database||'')||!user||!password)throw Error('Refusing migration: explicit local test database configuration required');
 const {default:mysql}=await import('mysql2/promise');
 const connection=await mysql.createConnection({host,database,user,password,port:Number(port||3306),multipleStatements:false});
 try{
 for(const file of files){const text=readFileSync(file,'utf8').replace(/^--.*$/gm,'');for(const statement of text.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(statement);}
 const [existing]=await connection.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[database,'leads']);
 for(const [name,definition] of Object.entries(columns))if(!existing.some(c=>c.COLUMN_NAME===name))await connection.query(`ALTER TABLE leads ADD COLUMN ${name} ${definition}`);
 await connection.query('ALTER TABLE leads MODIFY COLUMN stage VARCHAR(40) NOT NULL DEFAULT \'new\'');
 console.log('Local test schema applied. No production access is supported by this script.');
 }finally{await connection.end();}
}
