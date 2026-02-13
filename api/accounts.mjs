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
    
    // 初始化表（如果不存在）
    await db.execute(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    if (req.method === 'GET') {
      const result = await db.execute('SELECT * FROM accounts ORDER BY code');
      return res.json(result.rows);
    }
    
    if (req.method === 'POST') {
      const { code, name, type } = req.body;
      const result = await db.execute({
        sql: 'INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)',
        args: [code, name, type]
      });
      return res.json({ id: Number(result.lastInsertRowid), code, name, type });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
}
