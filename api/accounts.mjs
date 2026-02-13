import { getDb, initDb } from './_db.mjs';

export default async function handler(req, res) {
  await initDb();
  const db = getDb();
  
  if (req.method === 'GET') {
    const result = await db.execute('SELECT * FROM accounts ORDER BY code');
    return res.json(result.rows);
  }
  
  if (req.method === 'POST') {
    const { code, name, type } = req.body;
    try {
      const result = await db.execute({
        sql: 'INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)',
        args: [code, name, type]
      });
      return res.json({ id: Number(result.lastInsertRowid), code, name, type });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
