import { getDb, initDb } from './_db.js';

export default async function handler(req, res) {
  await initDb();
  const db = getDb();
  
  if (req.method === 'GET') {
    const result = await db.execute(`
      SELECT * FROM bank_transactions
      ORDER BY date DESC, id DESC
    `);
    return res.json(result.rows);
  }
  
  if (req.method === 'POST') {
    // 批量新增銀行交易
    const { transactions } = req.body;
    
    try {
      for (const tx of transactions) {
        await db.execute({
          sql: 'INSERT INTO bank_transactions (date, description, amount) VALUES (?, ?, ?)',
          args: [tx.date, tx.description, tx.amount]
        });
      }
      return res.json({ success: true, count: transactions.length });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
