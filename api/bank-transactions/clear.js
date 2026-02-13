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
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getDb();
    
    // 刪除所有還沒建立分錄的交易
    const result = await db.execute('DELETE FROM bank_transactions WHERE entry_id IS NULL');
    
    res.json({ 
      success: true, 
      deleted: result.rowsAffected,
      message: `已刪除 ${result.rowsAffected} 筆待處理交易`
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
