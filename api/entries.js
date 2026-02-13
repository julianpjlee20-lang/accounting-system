import { getDb, initDb } from './_db.js';

export default async function handler(req, res) {
  await initDb();
  const db = getDb();
  
  if (req.method === 'GET') {
    const entriesResult = await db.execute('SELECT * FROM entries ORDER BY date DESC, id DESC');
    const entries = entriesResult.rows;
    
    for (const entry of entries) {
      const linesResult = await db.execute({
        sql: `SELECT el.*, a.code as account_code, a.name as account_name
              FROM entry_lines el
              LEFT JOIN accounts a ON el.account_id = a.id
              WHERE el.entry_id = ?`,
        args: [entry.id]
      });
      entry.lines = linesResult.rows;
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
    
    try {
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
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
