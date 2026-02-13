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
    const { startDate, endDate } = req.query;
    
    let dateFilter = '';
    const args = [];
    
    if (startDate && endDate) {
      dateFilter = 'AND e.date BETWEEN ? AND ?';
      args.push(startDate, endDate);
    } else if (endDate) {
      dateFilter = 'AND e.date <= ?';
      args.push(endDate);
    }
    
    // 計算各科目的借貸合計
    const result = await db.execute({
      sql: `
        SELECT 
          a.id,
          a.code,
          a.name,
          a.type,
          COALESCE(SUM(el.debit), 0) as total_debit,
          COALESCE(SUM(el.credit), 0) as total_credit
        FROM accounts a
        LEFT JOIN entry_lines el ON el.account_id = a.id
        LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
        GROUP BY a.id, a.code, a.name, a.type
        HAVING total_debit > 0 OR total_credit > 0
        ORDER BY a.code
      `,
      args
    });
    
    // 計算餘額（資產/費用: 借-貸為正，負債/權益/收入: 貸-借為正）
    const accounts = result.rows.map(row => {
      const isDebitNormal = ['asset', 'expense'].includes(row.type);
      const balance = isDebitNormal 
        ? row.total_debit - row.total_credit 
        : row.total_credit - row.total_debit;
      
      return {
        ...row,
        balance,
        debit_balance: balance > 0 && isDebitNormal ? balance : (balance < 0 && !isDebitNormal ? -balance : 0),
        credit_balance: balance > 0 && !isDebitNormal ? balance : (balance < 0 && isDebitNormal ? -balance : 0),
      };
    });
    
    const totalDebit = accounts.reduce((sum, a) => sum + a.debit_balance, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.credit_balance, 0);
    
    res.json({
      accounts,
      totals: {
        debit: totalDebit,
        credit: totalCredit,
        balanced: Math.abs(totalDebit - totalCredit) < 0.01
      }
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
