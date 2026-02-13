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
  const db = getDb();

  if (req.method === 'POST') {
    // Migration: 為舊交易建立批次
    try {
      const result = await db.execute(`
        SELECT * FROM bank_transactions 
        WHERE batch_id IS NULL 
        ORDER BY created_at, id
      `);
      
      if (result.rows.length === 0) {
        return res.json({ success: true, message: '沒有需要遷移的資料' });
      }

      // 按日期分組
      const groupedByDate = {};
      for (const tx of result.rows) {
        const dateKey = tx.created_at ? tx.created_at.slice(0, 10) : 'unknown';
        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
        groupedByDate[dateKey].push(tx);
      }

      let batchesCreated = 0, txsUpdated = 0;

      for (const [dateKey, txs] of Object.entries(groupedByDate)) {
        const batchResult = await db.execute({
          sql: 'INSERT INTO upload_batches (filename, row_count, created_at) VALUES (?, ?, ?)',
          args: [`歷史資料 ${dateKey}`, txs.length, txs[0].created_at || new Date().toISOString()]
        });
        const batchId = Number(batchResult.lastInsertRowid);
        batchesCreated++;

        const txIds = txs.map(t => t.id);
        const placeholders = txIds.map(() => '?').join(',');
        await db.execute({
          sql: `UPDATE bank_transactions SET batch_id = ? WHERE id IN (${placeholders})`,
          args: [batchId, ...txIds]
        });
        txsUpdated += txs.length;
      }

      return res.json({ success: true, batchesCreated, txsUpdated });
    } catch (err) {
      console.error('Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'GET') {
    // 取得所有批次及其交易統計
    try {
      const result = await db.execute(`
        SELECT 
          b.id,
          b.filename,
          b.row_count,
          b.created_at,
          COUNT(bt.id) as tx_count,
          SUM(CASE WHEN bt.entry_id IS NOT NULL THEN 1 ELSE 0 END) as processed_count,
          SUM(CASE WHEN bt.entry_id IS NULL THEN 1 ELSE 0 END) as pending_count
        FROM upload_batches b
        LEFT JOIN bank_transactions bt ON bt.batch_id = b.id
        GROUP BY b.id
        ORDER BY b.created_at DESC
      `);
      
      res.json({ batches: result.rows });
    } catch (err) {
      console.error('Error:', err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  if (req.method === 'DELETE') {
    // 刪除指定批次及其所有交易
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: '缺少批次 ID' });
    }

    try {
      // 先檢查是否有已處理的交易
      const checkResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM bank_transactions WHERE batch_id = ? AND entry_id IS NOT NULL',
        args: [id]
      });
      
      const processedCount = checkResult.rows[0]?.count || 0;
      
      // 刪除交易
      const deleteResult = await db.execute({
        sql: 'DELETE FROM bank_transactions WHERE batch_id = ?',
        args: [id]
      });
      
      // 刪除批次記錄
      await db.execute({
        sql: 'DELETE FROM upload_batches WHERE id = ?',
        args: [id]
      });
      
      res.json({ 
        success: true, 
        deleted: deleteResult.rowsAffected,
        warning: processedCount > 0 ? `注意：已刪除 ${processedCount} 筆已處理的交易，相關分錄仍保留` : undefined,
        message: `已刪除批次及 ${deleteResult.rowsAffected} 筆交易`
      });
    } catch (err) {
      console.error('Error:', err);
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
