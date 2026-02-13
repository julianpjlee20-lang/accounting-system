import { createClient } from '@libsql/client';

let db = null;

function getDb() {
  if (!db) {
    db = createClient({
      url: process.env.TURSO_URL,
      authToken: process.env.TURSO_TOKEN
    });
  }
  return db;
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    
    if (req.method === 'GET') {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      
      // 第一次查詢：取得分錄（有 LIMIT）
      const entriesResult = await db.execute({
        sql: 'SELECT * FROM entries ORDER BY date DESC, id DESC LIMIT ? OFFSET ?',
        args: [limit, offset]
      });
      const entries = entriesResult.rows;
      
      if (entries.length === 0) {
        return res.json([]);
      }
      
      // 收集所有分錄 ID
      const entryIds = entries.map(e => e.id);
      const placeholders = entryIds.map(() => '?').join(',');
      
      // 第二次查詢：取得這些分錄的所有明細行
      const linesResult = await db.execute({
        sql: `SELECT el.*, a.code as account_code, a.name as account_name
              FROM entry_lines el
              LEFT JOIN accounts a ON el.account_id = a.id
              WHERE el.entry_id IN (${placeholders})
              ORDER BY el.entry_id, el.id`,
        args: entryIds
      });
      
      // 組裝資料
      const linesMap = {};
      for (const line of linesResult.rows) {
        if (!linesMap[line.entry_id]) {
          linesMap[line.entry_id] = [];
        }
        linesMap[line.entry_id].push(line);
      }
      
      for (const entry of entries) {
        entry.lines = linesMap[entry.id] || [];
      }
      
      return res.json(entries);
    }
    
    if (req.method === 'POST') {
      const { date, description, lines } = req.body;
      
      const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
      
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        return res.status(400).json({ error: '借貸不平衡' });
      }
      
      const result = await db.execute({
        sql: 'INSERT INTO entries (date, description) VALUES (?, ?)',
        args: [date, description]
      });
      const entryId = Number(result.lastInsertRowid);
      
      for (const line of lines) {
        await db.execute({
          sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
          args: [entryId, line.account_id, line.debit || 0, line.credit || 0, line.memo || '']
        });
      }
      
      return res.json({ id: entryId });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
