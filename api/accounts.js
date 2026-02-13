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
      // 支援分頁：?limit=100&offset=0
      const limit = parseInt(req.query.limit) || 500;
      const offset = parseInt(req.query.offset) || 0;
      const search = req.query.search || '';
      
      let sql, args;
      if (search) {
        sql = 'SELECT * FROM accounts WHERE code LIKE ? OR name LIKE ? ORDER BY code LIMIT ? OFFSET ?';
        args = [`%${search}%`, `%${search}%`, limit, offset];
      } else {
        sql = 'SELECT * FROM accounts ORDER BY code LIMIT ? OFFSET ?';
        args = [limit, offset];
      }
      
      const result = await db.execute({ sql, args });
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
    res.status(500).json({ error: err.message });
  }
}
