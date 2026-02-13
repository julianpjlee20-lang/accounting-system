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

// 金額容差（考慮匯費）
const AMOUNT_TOLERANCE = 100;
// 日期容差（天）
const DATE_TOLERANCE_DAYS = 3;

export default async function handler(req, res) {
  const db = getDb();

  if (req.method === 'GET') {
    // 取得可能的配對建議
    return await getSuggestions(db, res);
  }

  if (req.method === 'POST') {
    // 確認配對
    const { tx1_id, tx2_id } = req.body;
    return await confirmPair(db, tx1_id, tx2_id, res);
  }

  if (req.method === 'DELETE') {
    // 取消配對
    const { pair_id } = req.body;
    return await cancelPair(db, pair_id, res);
  }

  res.status(405).json({ error: 'Method not allowed' });
}

async function getSuggestions(db, res) {
  try {
    // 取得所有未處理且未配對的交易
    const result = await db.execute(`
      SELECT * FROM bank_transactions 
      WHERE entry_id IS NULL AND transfer_pair_id IS NULL
      ORDER BY date, id
    `);

    const txs = result.rows;
    const suggestions = [];
    const used = new Set();

    for (let i = 0; i < txs.length; i++) {
      if (used.has(txs[i].id)) continue;
      
      const tx1 = txs[i];
      
      for (let j = i + 1; j < txs.length; j++) {
        if (used.has(txs[j].id)) continue;
        
        const tx2 = txs[j];
        
        // 檢查是否可能是配對
        const match = checkMatch(tx1, tx2);
        if (match.isMatch) {
          suggestions.push({
            tx1: { id: tx1.id, date: tx1.date, description: tx1.description, amount: tx1.amount, company: tx1.company },
            tx2: { id: tx2.id, date: tx2.date, description: tx2.description, amount: tx2.amount, company: tx2.company },
            confidence: match.confidence,
            reason: match.reason,
            amountDiff: match.amountDiff
          });
          used.add(tx1.id);
          used.add(tx2.id);
          break;
        }
      }
    }

    // 按信心度排序
    suggestions.sort((a, b) => b.confidence - a.confidence);

    res.json({ suggestions });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}

function checkMatch(tx1, tx2) {
  // 必須一正一負
  if ((tx1.amount > 0 && tx2.amount > 0) || (tx1.amount < 0 && tx2.amount < 0)) {
    return { isMatch: false };
  }

  // 金額差異（取絕對值比較）
  const amountDiff = Math.abs(Math.abs(tx1.amount) - Math.abs(tx2.amount));
  if (amountDiff > AMOUNT_TOLERANCE) {
    return { isMatch: false };
  }

  // 日期差異
  const date1 = new Date(tx1.date);
  const date2 = new Date(tx2.date);
  const daysDiff = Math.abs((date1 - date2) / (1000 * 60 * 60 * 24));
  if (daysDiff > DATE_TOLERANCE_DAYS) {
    return { isMatch: false };
  }

  // 計算信心度
  let confidence = 0.5;
  const reasons = [];

  // 金額完全相同
  if (amountDiff === 0) {
    confidence += 0.3;
    reasons.push('金額完全相同');
  } else {
    confidence += 0.1;
    reasons.push(`金額差 ${amountDiff} 元（可能是匯費）`);
  }

  // 日期相同
  if (daysDiff === 0) {
    confidence += 0.15;
    reasons.push('同一天');
  } else {
    reasons.push(`日期差 ${daysDiff} 天`);
  }

  // 摘要包含轉帳關鍵字
  const keywords = ['轉帳', '匯款', '轉提', '網轉', '內轉', '調撥'];
  const desc1 = tx1.description || '';
  const desc2 = tx2.description || '';
  if (keywords.some(k => desc1.includes(k) || desc2.includes(k))) {
    confidence += 0.05;
    reasons.push('摘要含轉帳關鍵字');
  }

  // 不同公司/帳戶（更可能是內部轉帳）
  if (tx1.company && tx2.company && tx1.company !== tx2.company) {
    confidence += 0.05;
    reasons.push('不同公司帳戶');
  }

  return {
    isMatch: true,
    confidence: Math.min(confidence, 1),
    reason: reasons.join('、'),
    amountDiff
  };
}

async function confirmPair(db, tx1_id, tx2_id, res) {
  try {
    // 產生配對 ID（使用較小的 id）
    const pairId = Math.min(tx1_id, tx2_id);

    // 更新兩筆交易
    await db.execute({
      sql: 'UPDATE bank_transactions SET transfer_pair_id = ?, is_internal_transfer = 1 WHERE id IN (?, ?)',
      args: [pairId, tx1_id, tx2_id]
    });

    // 取得兩筆交易的詳細資料
    const result = await db.execute({
      sql: 'SELECT * FROM bank_transactions WHERE id IN (?, ?)',
      args: [tx1_id, tx2_id]
    });

    res.json({ 
      success: true, 
      pairId,
      transactions: result.rows,
      message: '已配對為內部轉帳'
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function cancelPair(db, pair_id, res) {
  try {
    await db.execute({
      sql: 'UPDATE bank_transactions SET transfer_pair_id = NULL, is_internal_transfer = 0 WHERE transfer_pair_id = ?',
      args: [pair_id]
    });

    res.json({ success: true, message: '已取消配對' });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
}
