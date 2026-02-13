import { createClient } from '@libsql/client';

let db = null;

export function getDb() {
  if (!db) {
    db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_TOKEN
    });
  }
  return db;
}

export async function initDb() {
  const db = getDb();
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS entry_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      memo TEXT,
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      description TEXT,
      amount REAL,
      entry_id INTEGER,
      FOREIGN KEY (entry_id) REFERENCES entries(id)
    )
  `);

  // 預設科目
  const defaultAccounts = [
    { code: '1101', name: '現金', type: 'asset' },
    { code: '1102', name: '銀行存款', type: 'asset' },
    { code: '1103', name: '零用金', type: 'asset' },
    { code: '1131', name: '應收帳款', type: 'asset' },
    { code: '1141', name: '應收票據', type: 'asset' },
    { code: '1211', name: '預付款項', type: 'asset' },
    { code: '1411', name: '辦公設備', type: 'asset' },
    { code: '2101', name: '應付帳款', type: 'liability' },
    { code: '2111', name: '應付票據', type: 'liability' },
    { code: '2151', name: '預收款項', type: 'liability' },
    { code: '2171', name: '應付費用', type: 'liability' },
    { code: '3101', name: '股本', type: 'equity' },
    { code: '3351', name: '保留盈餘', type: 'equity' },
    { code: '4101', name: '營業收入', type: 'revenue' },
    { code: '4111', name: '服務收入', type: 'revenue' },
    { code: '4191', name: '其他收入', type: 'revenue' },
    { code: '5101', name: '營業成本', type: 'expense' },
    { code: '6101', name: '薪資費用', type: 'expense' },
    { code: '6102', name: '租金費用', type: 'expense' },
    { code: '6103', name: '水電費', type: 'expense' },
    { code: '6104', name: '電話費', type: 'expense' },
    { code: '6105', name: '保險費', type: 'expense' },
    { code: '6106', name: '折舊費用', type: 'expense' },
    { code: '6107', name: '文具用品', type: 'expense' },
    { code: '6108', name: '交通費', type: 'expense' },
    { code: '6109', name: '交際費', type: 'expense' },
    { code: '6110', name: '雜項費用', type: 'expense' },
  ];

  for (const acc of defaultAccounts) {
    try {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)',
        args: [acc.code, acc.name, acc.type]
      });
    } catch (e) {}
  }
  
  return db;
}
