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
    const { asOfDate } = req.query;
    
    let dateFilter = '';
    const args = [];
    if (asOfDate) {
      dateFilter = 'AND e.date <= ?';
      args.push(asOfDate);
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
        WHERE a.type IN ('asset', 'liability', 'equity')
        GROUP BY a.id, a.code, a.name, a.type
        HAVING total_debit > 0 OR total_credit > 0
        ORDER BY a.type, a.code
      `,
      args
    });
    
    const assets = [];
    const liabilities = [];
    const equity = [];
    
    for (const row of result.rows) {
      const isDebitNormal = row.type === 'asset';
      const balance = isDebitNormal 
        ? row.total_debit - row.total_credit 
        : row.total_credit - row.total_debit;
      
      const item = { code: row.code, name: row.name, balance };
      
      if (row.type === 'asset') assets.push(item);
      else if (row.type === 'liability') liabilities.push(item);
      else if (row.type === 'equity') equity.push(item);
    }
    
    // 計算本期損益（收入-費用）加入權益
    const incomeResult = await db.execute({
      sql: `
        SELECT 
          a.type,
          COALESCE(SUM(el.debit), 0) as total_debit,
          COALESCE(SUM(el.credit), 0) as total_credit
        FROM accounts a
        LEFT JOIN entry_lines el ON el.account_id = a.id
        LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
        WHERE a.type IN ('revenue', 'expense')
        GROUP BY a.type
      `,
      args
    });
    
    let revenue = 0, expense = 0;
    for (const row of incomeResult.rows) {
      if (row.type === 'revenue') revenue = row.total_credit - row.total_debit;
      if (row.type === 'expense') expense = row.total_debit - row.total_credit;
    }
    const netIncome = revenue - expense;
    
    if (netIncome !== 0) {
      equity.push({ code: '本期損益', name: '本期淨利（損）', balance: netIncome });
    }
    
    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
    const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);
    
    res.json({
      asOfDate: asOfDate || '至今',
      assets,
      liabilities,
      equity,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilitiesAndEquity: totalLiabilities + totalEquity,
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01
      }
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
