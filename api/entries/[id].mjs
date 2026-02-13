import { getDb, initDb } from '../_db.mjs';

export default async function handler(req, res) {
  await initDb();
  const db = getDb();
  const { id } = req.query;
  
  if (req.method === 'PUT') {
    const { date, description, lines } = req.body;
    
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({ error: '借貸不平衡' });
    }
    
    try {
      await db.execute({
        sql: 'UPDATE entries SET date = ?, description = ? WHERE id = ?',
        args: [date, description, id]
      });
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      
      for (const line of lines) {
        await db.execute({
          sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
          args: [id, line.account_id, line.debit || 0, line.credit || 0, line.memo || '']
        });
      }
      
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  
  if (req.method === 'DELETE') {
    try {
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM entries WHERE id = ?', args: [id] });
      return res.json({ success: true });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
