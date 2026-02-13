import { createClient } from '@libsql/client';

let db = null;
function getDb() {
  if (!db) db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN });
  return db;
}

export default async function handler(req, res) {
  try {
    const db = getDb();
    const { id } = req.query;
    
    if (req.method === 'PUT') {
      const { date, description, lines } = req.body;
      const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) return res.status(400).json({ error: '借貸不平衡' });
      
      await db.execute({ sql: 'UPDATE entries SET date = ?, description = ? WHERE id = ?', args: [date, description, id] });
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      for (const line of lines) {
        await db.execute({ sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit, memo) VALUES (?, ?, ?, ?, ?)', args: [id, line.account_id, line.debit || 0, line.credit || 0, line.memo || ''] });
      }
      return res.json({ success: true });
    }
    
    if (req.method === 'DELETE') {
      // 防呆 1：先查詢分錄詳細資訊
      const entryResult = await db.execute({ sql: 'SELECT * FROM entries WHERE id = ?', args: [id] });
      if (entryResult.rows.length === 0) {
        return res.status(404).json({ error: '分錄不存在' });
      }
      const entry = entryResult.rows[0];
      
      // 查詢明細
      const linesResult = await db.execute({
        sql: 'SELECT el.*, a.code, a.name FROM entry_lines el LEFT JOIN accounts a ON el.account_id = a.id WHERE el.entry_id = ?',
        args: [id]
      });
      
      const totalDebit = linesResult.rows.reduce((sum, l) => sum + (l.debit || 0), 0);
      const totalCredit = linesResult.rows.reduce((sum, l) => sum + (l.credit || 0), 0);
      
      // 防呆 2：檢查是否有關聯的銀行交易
      const bankTxResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM bank_transactions WHERE entry_id = ?',
        args: [id]
      });
      const hasBankTx = bankTxResult.rows[0].count > 0;
      
      // 防呆 3：如果金額很大（> 100萬），需要特別警告
      const isLargeAmount = Math.max(totalDebit, totalCredit) > 1000000;
      
      // 執行刪除
      await db.execute({ sql: 'DELETE FROM entry_lines WHERE entry_id = ?', args: [id] });
      await db.execute({ sql: 'DELETE FROM entries WHERE id = ?', args: [id] });
      
      // 如果有關聯的銀行交易，清除 entry_id
      if (hasBankTx) {
        await db.execute({ sql: 'UPDATE bank_transactions SET entry_id = NULL WHERE entry_id = ?', args: [id] });
      }
      
      return res.json({ 
        success: true,
        deletedEntry: {
          id: entry.id,
          date: entry.date,
          description: entry.description,
          amount: Math.max(totalDebit, totalCredit),
          lines: linesResult.rows.map(l => `${l.code} ${l.name}: ${l.debit > 0 ? l.debit : l.credit}`)
        },
        warnings: {
          hasBankTransaction: hasBankTx,
          isLargeAmount,
          affectedTransactions: hasBankTx ? bankTxResult.rows[0].count : 0
        }
      });
    }
    
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) { 
    console.error('Error:', err);
    res.status(500).json({ error: err.message }); 
  }
}
