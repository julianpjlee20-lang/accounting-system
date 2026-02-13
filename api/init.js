import { createClient } from '@libsql/client';

export default async function handler(req, res) {
  const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  
  await db.execute(`CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, description TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS entry_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL, account_id INTEGER NOT NULL, debit REAL DEFAULT 0, credit REAL DEFAULT 0, memo TEXT)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS bank_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, description TEXT, amount REAL, entry_id INTEGER, company TEXT, label TEXT, debit_account_code TEXT, credit_account_code TEXT, batch_id INTEGER)`);
  
  await db.execute(`CREATE TABLE IF NOT EXISTS upload_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, row_count INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  
  // 為舊表加欄位（如果不存在）
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN company TEXT'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN label TEXT'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN debit_account_code TEXT'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN credit_account_code TEXT'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN transfer_pair_id INTEGER'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN is_internal_transfer INTEGER DEFAULT 0'); } catch(e) {}
  try { await db.execute('ALTER TABLE bank_transactions ADD COLUMN batch_id INTEGER'); } catch(e) {}
  
  const defaultAccounts = [
    ['1101','現金','asset'],['1102','銀行存款','asset'],['1103','零用金','asset'],['1131','應收帳款','asset'],['1141','應收票據','asset'],['1211','預付款項','asset'],['1411','辦公設備','asset'],
    ['2101','應付帳款','liability'],['2111','應付票據','liability'],['2151','預收款項','liability'],['2171','應付費用','liability'],
    ['3101','股本','equity'],['3351','保留盈餘','equity'],
    ['4101','營業收入','revenue'],['4111','服務收入','revenue'],['4191','其他收入','revenue'],
    ['5101','營業成本','expense'],['6101','薪資費用','expense'],['6102','租金費用','expense'],['6103','水電費','expense'],['6104','電話費','expense'],['6105','保險費','expense'],['6106','折舊費用','expense'],['6107','文具用品','expense'],['6108','交通費','expense'],['6109','交際費','expense'],['6110','雜項費用','expense']
  ];
  
  for (const [code, name, type] of defaultAccounts) {
    try { await db.execute({ sql: 'INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)', args: [code, name, type] }); } catch(e) {}
  }
  
  res.json({ status: 'initialized' });
}
