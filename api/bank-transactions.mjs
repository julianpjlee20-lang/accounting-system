import { createClient } from '@libsql/client';

let db = null;
function getDb() {
  if (!db) db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  return db;
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    
    if (req.method === 'GET') {
      const result = await db.execute('SELECT * FROM bank_transactions ORDER BY date DESC, id DESC');
      return res.json(result.rows);
    }
    
    if (req.method === 'POST') {
      const { transactions } = req.body;
      for (const tx of transactions) {
        await db.execute({ sql: 'INSERT INTO bank_transactions (date, description, amount) VALUES (?, ?, ?)', args: [tx.date, tx.description, tx.amount] });
      }
      return res.json({ success: true, count: transactions.length });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
}
