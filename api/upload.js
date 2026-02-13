import { createClient } from '@libsql/client';
import * as XLSX from 'xlsx';

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

// 解析日期
function parseDate(val) {
  if (!val) return null;
  
  // Excel 日期數字
  if (typeof val === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + val * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  
  const str = String(val).trim();
  
  // YYYY/MM/DD 或 YYYY-MM-DD
  const match1 = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match1) {
    return `${match1[1]}-${match1[2].padStart(2, '0')}-${match1[3].padStart(2, '0')}`;
  }
  
  // 民國年 113/07/15
  const match2 = str.match(/^(\d{2,3})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match2 && parseInt(match2[1]) < 200) {
    const year = parseInt(match2[1]) + 1911;
    return `${year}-${match2[2].padStart(2, '0')}-${match2[3].padStart(2, '0')}`;
  }
  
  return null;
}

// 解析金額
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// 從科目欄位提取科目代碼 (如 "1113-012-鹽館前投資 第一銀行竹南分行 0382" -> "1113-012")
function extractAccountCode(val) {
  if (!val) return null;
  const str = String(val).trim();
  // 匹配開頭的科目代碼 (數字和連字號)
  const match = str.match(/^(\d{4}(?:-\d+)?)/);
  return match ? match[1] : null;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = buffer.toString('binary').split('--' + boundary);
    
    let fileBuffer = null;
    for (const part of parts) {
      if (part.includes('filename=')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const content = part.slice(headerEnd + 4);
          const end = content.lastIndexOf('\r\n');
          fileBuffer = Buffer.from(content.slice(0, end), 'binary');
        }
      }
    }

    if (!fileBuffer) {
      return res.status(400).json({ error: '未找到上傳文件' });
    }

    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) {
      return res.status(400).json({ error: 'Excel 檔案沒有資料' });
    }

    // 偵測欄位
    const header = rows[0].map(h => String(h).toLowerCase());
    let companyCol = -1, dateCol = -1, descCol = -1, amountCol = -1;
    let debitAccCol = -1, creditAccCol = -1, labelCol = -1;
    let depositCol = -1, withdrawCol = -1;

    header.forEach((h, i) => {
      if (h.includes('公司') || h.includes('company')) companyCol = i;
      if (h.includes('日期') || h.includes('date')) dateCol = i;
      if (h.includes('摘要') || h.includes('說明') || h.includes('description')) descCol = i;
      if (h.includes('金額') || h.includes('amount')) amountCol = i;
      if (h.includes('借方科目') || h.includes('debit')) debitAccCol = i;
      if (h.includes('貸方科目') || h.includes('credit')) creditAccCol = i;
      if (h.includes('標籤') || h.includes('label') || h.includes('tag')) labelCol = i;
      if (h.includes('存入') || h.includes('入金')) depositCol = i;
      if (h.includes('支出') || h.includes('出金')) withdrawCol = i;
    });

    // 預設位置 (公司, 日期, 摘要, 金額, 借方, 貸方, 標籤)
    if (dateCol === -1) dateCol = (companyCol === -1) ? 0 : 1;
    if (descCol === -1) descCol = dateCol + 1;
    if (amountCol === -1 && depositCol === -1) amountCol = descCol + 1;

    const db = getDb();
    const transactions = [];
    const errors = [];

    // 建立上傳批次記錄
    const batchResult = await db.execute({
      sql: 'INSERT INTO upload_batches (filename, row_count) VALUES (?, ?)',
      args: [sheetName, rows.length - 1]
    });
    const batchId = Number(batchResult.lastInsertRowid);

    // 先載入所有科目以便匹配
    const accountsResult = await db.execute('SELECT id, code, name FROM accounts');
    const accountsByCode = {};
    for (const acc of accountsResult.rows) {
      accountsByCode[acc.code] = acc;
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const date = parseDate(row[dateCol]);
      
      if (!date) continue;

      const company = companyCol >= 0 ? String(row[companyCol] || '').trim() : '';
      const description = String(row[descCol] || '').trim();
      const label = labelCol >= 0 ? String(row[labelCol] || '').trim() : '';
      
      let amount = 0;
      if (amountCol >= 0) {
        amount = parseAmount(row[amountCol]);
      } else if (depositCol >= 0 || withdrawCol >= 0) {
        const deposit = depositCol >= 0 ? parseAmount(row[depositCol]) : 0;
        const withdraw = withdrawCol >= 0 ? parseAmount(row[withdrawCol]) : 0;
        amount = deposit - withdraw;
      }

      if (amount === 0 && !description) continue;

      // 提取借貸方科目代碼
      const debitCode = debitAccCol >= 0 ? extractAccountCode(row[debitAccCol]) : null;
      const creditCode = creditAccCol >= 0 ? extractAccountCode(row[creditAccCol]) : null;

      // 查找科目 ID
      const debitAcc = debitCode ? accountsByCode[debitCode] : null;
      const creditAcc = creditCode ? accountsByCode[creditCode] : null;

      // 存入 bank_transactions
      const result = await db.execute({
        sql: `INSERT INTO bank_transactions (date, description, amount, company, label, debit_account_code, credit_account_code, batch_id) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [date, description, amount, company, label, debitCode, creditCode, batchId]
      });

      const tx = {
        id: Number(result.lastInsertRowid),
        date,
        company,
        description,
        amount,
        label,
        debit_account_code: debitCode,
        credit_account_code: creditCode,
        debit_account_id: debitAcc?.id || null,
        credit_account_id: creditAcc?.id || null,
      };

      // 如果借貸方科目都有匹配，自動建立分錄
      if (debitAcc && creditAcc && amount !== 0) {
        try {
          const entryResult = await db.execute({
            sql: 'INSERT INTO entries (date, description) VALUES (?, ?)',
            args: [date, `${company ? company + ' ' : ''}${description}${label ? ' ' + label : ''}`]
          });
          const entryId = Number(entryResult.lastInsertRowid);

          const absAmount = Math.abs(amount);
          await db.execute({
            sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)',
            args: [entryId, debitAcc.id, absAmount, 0]
          });
          await db.execute({
            sql: 'INSERT INTO entry_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)',
            args: [entryId, creditAcc.id, 0, absAmount]
          });

          await db.execute({
            sql: 'UPDATE bank_transactions SET entry_id = ? WHERE id = ?',
            args: [entryId, tx.id]
          });

          tx.entry_id = entryId;
          tx.auto_entry = true;
        } catch (e) {
          errors.push(`Row ${i + 1}: 建立分錄失敗 - ${e.message}`);
        }
      }

      transactions.push(tx);
    }

    const autoCount = transactions.filter(t => t.auto_entry).length;
    const pendingCount = transactions.filter(t => !t.auto_entry).length;

    // 更新批次的實際筆數
    await db.execute({
      sql: 'UPDATE upload_batches SET row_count = ? WHERE id = ?',
      args: [transactions.length, batchId]
    });

    res.json({ 
      success: true, 
      batchId,
      transactions,
      summary: {
        total: transactions.length,
        autoEntry: autoCount,
        pending: pendingCount
      },
      errors: errors.length > 0 ? errors : undefined,
      message: `匯入 ${transactions.length} 筆，自動建立 ${autoCount} 筆分錄，${pendingCount} 筆待處理`
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
}
