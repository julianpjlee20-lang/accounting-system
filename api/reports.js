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
  const { type, startDate, endDate, asOfDate } = req.query;
  
  try {
    const db = getDb();
    
    if (type === 'trial-balance') {
      return res.json(await getTrialBalance(db, startDate, endDate));
    } else if (type === 'balance-sheet') {
      return res.json(await getBalanceSheet(db, asOfDate || endDate));
    } else if (type === 'income-statement') {
      return res.json(await getIncomeStatement(db, startDate, endDate));
    } else {
      return res.status(400).json({ error: 'Invalid report type' });
    }
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function getTrialBalance(db, startDate, endDate) {
  let dateFilter = '';
  const args = [];
  if (startDate && endDate) {
    dateFilter = 'AND e.date BETWEEN ? AND ?';
    args.push(startDate, endDate);
  } else if (endDate) {
    dateFilter = 'AND e.date <= ?';
    args.push(endDate);
  }
  
  const result = await db.execute({
    sql: `SELECT a.id, a.code, a.name, a.type,
          COALESCE(SUM(el.debit), 0) as total_debit,
          COALESCE(SUM(el.credit), 0) as total_credit
          FROM accounts a
          LEFT JOIN entry_lines el ON el.account_id = a.id
          LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
          GROUP BY a.id, a.code, a.name, a.type
          HAVING total_debit > 0 OR total_credit > 0
          ORDER BY a.code`,
    args
  });
  
  const accounts = result.rows.map(row => {
    const isDebitNormal = ['asset', 'expense'].includes(row.type);
    const balance = isDebitNormal ? row.total_debit - row.total_credit : row.total_credit - row.total_debit;
    return {
      ...row, balance,
      debit_balance: balance > 0 && isDebitNormal ? balance : (balance < 0 && !isDebitNormal ? -balance : 0),
      credit_balance: balance > 0 && !isDebitNormal ? balance : (balance < 0 && isDebitNormal ? -balance : 0),
    };
  });
  
  const totalDebit = accounts.reduce((sum, a) => sum + a.debit_balance, 0);
  const totalCredit = accounts.reduce((sum, a) => sum + a.credit_balance, 0);
  
  return { accounts, totals: { debit: totalDebit, credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 }};
}

async function getBalanceSheet(db, asOfDate) {
  let dateFilter = '';
  const args = [];
  if (asOfDate) { dateFilter = 'AND e.date <= ?'; args.push(asOfDate); }
  
  const result = await db.execute({
    sql: `SELECT a.id, a.code, a.name, a.type,
          COALESCE(SUM(el.debit), 0) as total_debit,
          COALESCE(SUM(el.credit), 0) as total_credit
          FROM accounts a
          LEFT JOIN entry_lines el ON el.account_id = a.id
          LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
          WHERE a.type IN ('asset', 'liability', 'equity')
          GROUP BY a.id, a.code, a.name, a.type
          HAVING total_debit > 0 OR total_credit > 0
          ORDER BY a.type, a.code`,
    args
  });
  
  const assets = [], liabilities = [], equity = [];
  for (const row of result.rows) {
    const isDebitNormal = row.type === 'asset';
    const balance = isDebitNormal ? row.total_debit - row.total_credit : row.total_credit - row.total_debit;
    const item = { code: row.code, name: row.name, balance };
    if (row.type === 'asset') assets.push(item);
    else if (row.type === 'liability') liabilities.push(item);
    else if (row.type === 'equity') equity.push(item);
  }
  
  // 本期損益
  const incomeResult = await db.execute({
    sql: `SELECT a.type, COALESCE(SUM(el.debit), 0) as total_debit, COALESCE(SUM(el.credit), 0) as total_credit
          FROM accounts a LEFT JOIN entry_lines el ON el.account_id = a.id
          LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
          WHERE a.type IN ('revenue', 'expense') GROUP BY a.type`,
    args
  });
  
  let revenue = 0, expense = 0;
  for (const row of incomeResult.rows) {
    if (row.type === 'revenue') revenue = row.total_credit - row.total_debit;
    if (row.type === 'expense') expense = row.total_debit - row.total_credit;
  }
  const netIncome = revenue - expense;
  if (netIncome !== 0) equity.push({ code: '本期損益', name: '本期淨利（損）', balance: netIncome });
  
  const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
  const totalLiabilities = liabilities.reduce((sum, a) => sum + a.balance, 0);
  const totalEquity = equity.reduce((sum, a) => sum + a.balance, 0);
  
  return {
    asOfDate: asOfDate || '至今', assets, liabilities, equity,
    totals: { assets: totalAssets, liabilities: totalLiabilities, equity: totalEquity,
      liabilitiesAndEquity: totalLiabilities + totalEquity,
      balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01 }
  };
}

async function getIncomeStatement(db, startDate, endDate) {
  let dateFilter = '';
  const args = [];
  if (startDate && endDate) { dateFilter = 'AND e.date BETWEEN ? AND ?'; args.push(startDate, endDate); }
  else if (startDate) { dateFilter = 'AND e.date >= ?'; args.push(startDate); }
  else if (endDate) { dateFilter = 'AND e.date <= ?'; args.push(endDate); }
  
  const result = await db.execute({
    sql: `SELECT a.id, a.code, a.name, a.type,
          COALESCE(SUM(el.debit), 0) as total_debit,
          COALESCE(SUM(el.credit), 0) as total_credit
          FROM accounts a LEFT JOIN entry_lines el ON el.account_id = a.id
          LEFT JOIN entries e ON el.entry_id = e.id ${dateFilter}
          WHERE a.type IN ('revenue', 'expense')
          GROUP BY a.id, a.code, a.name, a.type
          HAVING total_debit > 0 OR total_credit > 0
          ORDER BY a.type DESC, a.code`,
    args
  });
  
  const revenues = [], expenses = [];
  for (const row of result.rows) {
    const amount = row.type === 'revenue' ? row.total_credit - row.total_debit : row.total_debit - row.total_credit;
    const item = { code: row.code, name: row.name, amount };
    if (row.type === 'revenue') revenues.push(item);
    else if (row.type === 'expense') expenses.push(item);
  }
  
  const totalRevenue = revenues.reduce((sum, r) => sum + r.amount, 0);
  const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
  const netIncome = totalRevenue - totalExpense;
  
  return {
    period: { start: startDate || '期初', end: endDate || '至今' },
    revenues, expenses,
    totals: { revenue: totalRevenue, expense: totalExpense, netIncome, profitable: netIncome >= 0 }
  };
}
