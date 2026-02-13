import { createClient } from '@libsql/client';

let db = null;
function getDb() {
  if (!db) db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  return db;
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    const { id } = req.query;
    
    if (req.method === 'PUT') {
      const { date, description, lines } = req.body;
      const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) return res.status(400).json({ error: '借貸不平衡' });
      
      await db.execute({ sql: 'UPDATE entries SET date = ?, description = ? WHERE id = ?', args: [date, description, id] });
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      for (const line of lines) {
        await db.execute({ sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)', args: [id, line.account_id, line.debit || 0, line.credit || 0, line.memo || ''] });
      }
      return res.json({ success: true });
    }
    
    if (req.method === 'DELETE') {
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM entries WHERE id = ?', args: [id] });
      return res.json({ success: true });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
