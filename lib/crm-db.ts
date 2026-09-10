import mysql, {type Pool, type RowDataPacket, type ResultSetHeader} from 'mysql2/promise';
let pool: Pool | undefined;
function database() {
  if (!pool) {
    const {DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT} = process.env;
    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) throw new Error('Database configuration missing');
    pool = mysql.createPool({host: DB_HOST, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
      port: Number(DB_PORT || 3306), charset: 'utf8mb4', connectionLimit: 5, queueLimit: 20,
      connectTimeout: 10000, multipleStatements: false,
      ...(process.env.DB_SSL === 'true' ? {ssl: {rejectUnauthorized: true}} : {}),
    });
  }
  return pool;
}
export function crmDb() {
  return {prepare(sql: string) {
    let values: (string | number)[] = [];
    return {
      bind(...args: (string | number)[]) { values = args; return this; },
      async all() {const [rows] = await database().execute<RowDataPacket[]>(sql, values); return {results: rows};},
      async first<T>() {const [rows] = await database().execute<RowDataPacket[]>(sql, values); return (rows[0] as T) || null;},
      async run() {const [result] = await database().execute<ResultSetHeader>(sql, values); return {meta: {changes: result.affectedRows}};},
    };
  }};
}
