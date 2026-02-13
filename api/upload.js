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

// 解析日期（支援多種格式）
function parseDate(val) {
  if (!val) return null;
  
  // 如果是 Excel 日期數字（Excel 日期是從 1900-01-01 起算的天數）
  if (typeof val === 'number') {
    // Excel epoch: 1900-01-01, 但 Excel 有個 bug 認為 1900 是閏年
    const excelEpoch = new Date(1899, 11, 30); // 1899-12-30
    const date = new Date(excelEpoch.getTime() + val * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  
  // 如果是字串
  const str = String(val).trim();
  
  // YYYY/MM/DD 或 YYYY-MM-DD
  const match1 = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match1) {
    return `${match1[1]}-${match1[2].padStart(2, '0')}-${match1[3].padStart(2, '0')}`;
  }
  
  // MM/DD/YYYY
  const match2 = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match2) {
    return `${match2[3]}-${match2[1].padStart(2, '0')}-${match2[2].padStart(2, '0')}`;
  }
  
  // 民國年 111/01/01 -> 2022-01-01
  const match3 = str.match(/^(\d{2,3})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match3 && parseInt(match3[1]) < 200) {
    const year = parseInt(match3[1]) + 1911;
    return `${year}-${match3[2].padStart(2, '0')}-${match3[3].padStart(2, '0')}`;
  }
  
  return null;
}

// 解析金額
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  
  // 移除千分位逗號和空白
  const str = String(val).replace(/,/g, '').replace(/\s/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

export const config = {
  api: {
    bodyParser: false, // 關閉內建 body parser 以處理 multipart
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 讀取 multipart form data
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // 從 multipart 提取文件
    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = buffer.toString('binary').split('--' + boundary);
    
    let fileBuffer = null;
    for (const part of parts) {
      if (part.includes('filename=')) {
        // 找到文件內容
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const content = part.slice(headerEnd + 4);
          // 移除結尾的 \r\n
          const end = content.lastIndexOf('\r\n');
          fileBuffer = Buffer.from(content.slice(0, end), 'binary');
        }
      }
    }

    if (!fileBuffer) {
      return res.status(400).json({ error: '未找到上傳文件' });
    }

    // 解析 Excel
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) {
      return res.status(400).json({ error: 'Excel 檔案沒有資料' });
    }

    // 嘗試自動偵測欄位
    const header = rows[0].map(h => String(h).toLowerCase());
    let dateCol = -1, descCol = -1, amountCol = -1, depositCol = -1, withdrawCol = -1;

    header.forEach((h, i) => {
      if (h.includes('日期') || h.includes('date') || h.includes('交易日')) dateCol = i;
      if (h.includes('摘要') || h.includes('說明') || h.includes('description') || h.includes('備註')) descCol = i;
      if (h.includes('金額') || h.includes('amount') || h.includes('交易金額')) amountCol = i;
      if (h.includes('存入') || h.includes('入金') || h.includes('deposit') || h.includes('收入')) depositCol = i;
      if (h.includes('支出') || h.includes('出金') || h.includes('withdraw') || h.includes('提款')) withdrawCol = i;
    });

    // 如果找不到，用預設位置（A=日期, B=摘要, C=金額 或 C=存入, D=支出）
    if (dateCol === -1) dateCol = 0;
    if (descCol === -1) descCol = 1;
    if (amountCol === -1 && depositCol === -1 && withdrawCol === -1) {
      amountCol = 2;
    }

    const db = getDb();
    const transactions = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const date = parseDate(row[dateCol]);
      
      if (!date) continue; // 跳過無效日期

      const description = String(row[descCol] || '').trim();
      
      let amount = 0;
      if (amountCol !== -1) {
        amount = parseAmount(row[amountCol]);
      } else {
        // 存入為正，支出為負
        const deposit = parseAmount(row[depositCol]);
        const withdraw = parseAmount(row[withdrawCol]);
        amount = deposit - withdraw;
      }

      if (amount === 0 && !description) continue; // 跳過空行

      // 存入資料庫
      const result = await db.execute({
        sql: 'INSERT INTO bank_transactions (date, description, amount) VALUES (?, ?, ?)',
        args: [date, description, amount]
      });

      transactions.push({
        id: Number(result.lastInsertRowid),
        date,
        description,
        amount
      });
    }

    res.json({ 
      success: true, 
      transactions,
      message: `成功匯入 ${transactions.length} 筆交易`
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
}
