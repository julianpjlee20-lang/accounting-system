import express from 'express';
import cors from 'cors';
import multer from 'multer';
import * as XLSX from 'xlsx';
import initSqlJs from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

// Serve static frontend
const frontendDist = join(__dirname, '../frontend/dist');
if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

const dbPath = join(__dirname, 'accounting.db');
let db;

// 初始化資料庫
async function initDb() {
  const SQL = await initSqlJs();
  
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS bank_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bank_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER,
      date TEXT,
      description TEXT,
      amount REAL,
      entry_id INTEGER,
      FOREIGN KEY (import_id) REFERENCES bank_imports(id),
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
      db.run('INSERT OR IGNORE INTO accounts (code, name, type) VALUES (?, ?, ?)', [acc.code, acc.name, acc.type]);
    } catch (e) {}
  }
  
  saveDb();
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
}

// API: 取得所有科目
app.get('/api/accounts', (req, res) => {
  const accounts = queryAll('SELECT * FROM accounts ORDER BY code');
  res.json(accounts);
});

// API: 新增科目
app.post('/api/accounts', (req, res) => {
  const { code, name, type } = req.body;
  try {
    const result = run('INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)', [code, name, type]);
    res.json({ id: result.lastInsertRowid, code, name, type });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: 取得所有分錄（日記帳）
app.get('/api/entries', (req, res) => {
  const entries = queryAll('SELECT * FROM entries ORDER BY date DESC, id DESC');
  
  for (const entry of entries) {
    const lines = queryAll(`
      SELECT el.*, a.code as account_code, a.name as account_name
      FROM entry_lines el
      LEFT JOIN accounts a ON el.account_id = a.id
      WHERE el.entry_id = ?
    `, [entry.id]);
    entry.lines = lines;
  }
  
  res.json(entries);
});

// API: 新增分錄
app.post('/api/entries', (req, res) => {
  const { date, description, lines } = req.body;
  
  // 驗證借貸平衡
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: '借貸不平衡' });
  }
  
  try {
    const result = run('INSERT INTO entries (date, description) VALUES (?, ?)', [date, description]);
    const entryId = result.lastInsertRowid;
    
    for (const line of lines) {
      run('INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
        [entryId, line.account_id, line.debit || 0, line.credit || 0, line.memo || '']);
    }
    
    res.json({ id: entryId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: 更新分錄
app.put('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  const { date, description, lines } = req.body;
  
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return res.status(400).json({ error: '借貸不平衡' });
  }
  
  try {
    run('UPDATE entries SET date = ?, description = ? WHERE id = ?', [date, description, id]);
    run('DELETE FROM entry_lines WHERE entry_id = ?', [id]);
    
    for (const line of lines) {
      run('INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
        [id, line.account_id, line.debit || 0, line.credit || 0, line.memo || '']);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: 刪除分錄
app.delete('/api/entries/:id', (req, res) => {
  const { id } = req.params;
  try {
    run('DELETE FROM entry_lines WHERE entry_id = ?', [id]);
    run('DELETE FROM entries WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// API: 上傳銀行對帳單
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '請上傳檔案' });
  }
  
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    // 儲存匯入記錄
    const importResult = run('INSERT INTO bank_imports (filename) VALUES (?)', [req.file.originalname]);
    const importId = importResult.lastInsertRowid;
    
    // 解析交易（假設格式：日期, 摘要, 金額）
    const transactions = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row.length >= 3 && row[0] && row[2]) {
        let dateVal = row[0];
        // 處理 Excel 日期格式
        if (typeof dateVal === 'number') {
          const date = XLSX.SSF.parse_date_code(dateVal);
          dateVal = `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        
        const tx = {
          date: dateVal,
          description: row[1] || '',
          amount: parseFloat(row[2]) || 0
        };
        
        run('INSERT INTO bank_transactions (import_id, date, description, amount) VALUES (?, ?, ?, ?)',
          [importId, tx.date, tx.description, tx.amount]);
        transactions.push(tx);
      }
    }
    
    res.json({ 
      importId,
      filename: req.file.originalname,
      transactions 
    });
  } catch (err) {
    res.status(400).json({ error: '檔案解析失敗: ' + err.message });
  }
});

// API: 取得銀行交易
app.get('/api/bank-transactions', (req, res) => {
  const transactions = queryAll(`
    SELECT bt.*, bi.filename
    FROM bank_transactions bt
    LEFT JOIN bank_imports bi ON bt.import_id = bi.id
    ORDER BY bt.date DESC, bt.id DESC
  `);
  res.json(transactions);
});

// API: 將銀行交易轉為分錄
app.post('/api/bank-transactions/:id/create-entry', (req, res) => {
  const { id } = req.params;
  const { debit_account_id, credit_account_id } = req.body;
  
  const tx = queryOne('SELECT * FROM bank_transactions WHERE id = ?', [id]);
  if (!tx) {
    return res.status(404).json({ error: '交易不存在' });
  }
  
  if (tx.entry_id) {
    return res.status(400).json({ error: '此交易已有分錄' });
  }
  
  try {
    const result = run('INSERT INTO entries (date, description) VALUES (?, ?)', [tx.date, tx.description]);
    const entryId = result.lastInsertRowid;
    
    const amount = Math.abs(tx.amount);
    run('INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
      [entryId, debit_account_id, amount, 0, '']);
    run('INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
      [entryId, credit_account_id, 0, amount, '']);
    
    run('UPDATE bank_transactions SET entry_id = ? WHERE id = ?', [entryId, id]);
    
    res.json({ entryId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = join(__dirname, '../frontend/dist/index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

const PORT = process.env.PORT || 8093;

initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`會計系統運行於 http://localhost:${PORT}`);
  });
});
