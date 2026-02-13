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
      
      // 一次查詢取得分錄和明細行（JOIN），加上 LIMIT 避免超時
      const result = await db.execute({
        sql: `
          SELECT 
            e.id as entry_id,
            e.date as entry_date,
            e.description as entry_description,
            e.created_at as entry_created_at,
            el.id as line_id,
            el.account_id,
            el.debit,
            el.credit,
            el.memo,
            a.code as account_code,
            a.name as account_name
          FROM entries e
          LEFT JOIN entry_lines el ON el.entry_id = e.id
          LEFT JOIN accounts a ON el.account_id = a.id
          WHERE e.id IN (
            SELECT id FROM entries ORDER BY date DESC, id DESC LIMIT ? OFFSET ?
          )
          ORDER BY e.date DESC, e.id DESC, el.id ASC
        `,
        args: [limit, offset]
      });
      
      // 在記憶體中組裝成巢狀結構
      const entriesMap = {};
      for (const row of result.rows) {
        if (!entriesMap[row.entry_id]) {
          entriesMap[row.entry_id] = {
            id: row.entry_id,
            date: row.entry_date,
            description: row.entry_description,
            created_at: row.entry_created_at,
            lines: []
          };
        }
        if (row.line_id) {
          entriesMap[row.entry_id].lines.push({
            id: row.line_id,
            entry_id: row.entry_id,
            account_id: row.account_id,
            debit: row.debit,
            credit: row.credit,
            memo: row.memo,
            account_code: row.account_code,
            account_name: row.account_name
          });
        }
      }
      
      const entries = Object.values(entriesMap);
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
