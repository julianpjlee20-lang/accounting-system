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
    } else if (startDate) {
      dateFilter = 'AND e.date >= ?';
      args.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND e.date <= ?';
      args.push(endDate);
    }
    
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
        WHERE a.type IN ('revenue', 'expense')
        GROUP BY a.id, a.code, a.name, a.type
        HAVING total_debit > 0 OR total_credit > 0
        ORDER BY a.type DESC, a.code
      `,
      args
    });
    
    const revenues = [];
    const expenses = [];
    
    for (const row of result.rows) {
      // 收入: 貸-借 為正，費用: 借-貸 為正
      const amount = row.type === 'revenue'
        ? row.total_credit - row.total_debit
        : row.total_debit - row.total_credit;
      
      const item = { code: row.code, name: row.name, amount };
      
      if (row.type === 'revenue') revenues.push(item);
      else if (row.type === 'expense') expenses.push(item);
    }
    
    const totalRevenue = revenues.reduce((sum, r) => sum + r.amount, 0);
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
    const netIncome = totalRevenue - totalExpense;
    
    res.json({
      period: {
        start: startDate || '期初',
        end: endDate || '至今'
      },
      revenues,
      expenses,
      totals: {
        revenue: totalRevenue,
        expense: totalExpense,
        netIncome,
        profitable: netIncome >= 0
      }
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
