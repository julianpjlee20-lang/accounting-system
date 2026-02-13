import { getDb, initDb } from '../../_db.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  await initDb();
  const db = getDb();
  const { id } = req.query;
  const { debit_account_id, credit_account_id } = req.body;
  
  const txResult = await db.execute({ sql: 'SELECT * FROM bank_transactions WHERE id = ?', args: [id] });
  const tx = txResult.rows[0];
  
  if (!tx) {
    return res.status(404).json({ error: '交易不存在' });
  }
  
  if (tx.entry_id) {
    return res.status(400).json({ error: '此交易已有分錄' });
  }
  
  try {
    const result = await db.execute({
      sql: 'INSERT INTO entries (date, description) VALUES (?, ?)',
      args: [tx.date, tx.description]
    });
    const entryId = Number(result.lastInsertRowid);
    
    const amount = Math.abs(tx.amount);
    await db.execute({
      sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
      args: [entryId, debit_account_id, amount, 0, '']
    });
    await db.execute({
      sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)',
      args: [entryId, credit_account_id, 0, amount, '']
    });
    
    await db.execute({ sql: 'UPDATE bank_transactions SET entry_id = ? WHERE id = ?', args: [entryId, id] });
    
    return res.json({ entryId });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
