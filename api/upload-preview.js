import * as XLSX from 'xlsx';

// 解析日期
function parseDate(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + val * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }
  const str = String(val).trim();
  const match1 = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match1) return `${match1[1]}-${match1[2].padStart(2, '0')}-${match1[3].padStart(2, '0')}`;
  const match2 = str.match(/^(\d{2,3})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match2 && parseInt(match2[1]) < 200) {
    const year = parseInt(match2[1]) + 1911;
    return `${year}-${match2[2].padStart(2, '0')}-${match2[3].padStart(2, '0')}`;
  }
  return null;
}

function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const str = String(val).replace(/,/g, '').trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function extractAccountCode(val) {
  if (!val) return null;
  const str = String(val).trim();
  const match = str.match(/^(\d{4}(?:-\d+)?)/);
  return match ? match[1] : null;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
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
    let cols = { company: -1, date: -1, desc: -1, amount: -1, debit: -1, credit: -1, label: -1, deposit: -1, withdraw: -1 };

    header.forEach((h, i) => {
      if (h.includes('公司')) cols.company = i;
      if (h.includes('日期')) cols.date = i;
      if (h.includes('摘要') || h.includes('說明')) cols.desc = i;
      if (h.includes('金額')) cols.amount = i;
      if (h.includes('借方科目')) cols.debit = i;
      if (h.includes('貸方科目')) cols.credit = i;
      if (h.includes('標籤')) cols.label = i;
      if (h.includes('存入')) cols.deposit = i;
      if (h.includes('支出')) cols.withdraw = i;
    });

    if (cols.date === -1) cols.date = cols.company === -1 ? 0 : 1;
    if (cols.desc === -1) cols.desc = cols.date + 1;
    if (cols.amount === -1 && cols.deposit === -1) cols.amount = cols.desc + 1;

    const detectedColumns = {
      公司: cols.company >= 0 ? header[cols.company] || `欄${cols.company + 1}` : '未偵測',
      日期: header[cols.date] || `欄${cols.date + 1}`,
      摘要: header[cols.desc] || `欄${cols.desc + 1}`,
      金額: cols.amount >= 0 ? (header[cols.amount] || `欄${cols.amount + 1}`) : (cols.deposit >= 0 ? '存入-支出' : '未偵測'),
      借方科目: cols.debit >= 0 ? header[cols.debit] || `欄${cols.debit + 1}` : '未偵測',
      貸方科目: cols.credit >= 0 ? header[cols.credit] || `欄${cols.credit + 1}` : '未偵測',
      標籤: cols.label >= 0 ? header[cols.label] || `欄${cols.label + 1}` : '未偵測',
    };

    const preview = [];
    for (let i = 1; i < Math.min(rows.length, 11); i++) { // 預覽前 10 筆
      const row = rows[i];
      const date = parseDate(row[cols.date]);
      if (!date) continue;

      let amount = 0;
      if (cols.amount >= 0) {
        amount = parseAmount(row[cols.amount]);
      } else if (cols.deposit >= 0 || cols.withdraw >= 0) {
        amount = parseAmount(row[cols.deposit]) - parseAmount(row[cols.withdraw]);
      }

      preview.push({
        company: cols.company >= 0 ? String(row[cols.company] || '').trim() : '',
        date,
        description: String(row[cols.desc] || '').trim(),
        amount,
        debit_code: cols.debit >= 0 ? extractAccountCode(row[cols.debit]) : null,
        credit_code: cols.credit >= 0 ? extractAccountCode(row[cols.credit]) : null,
        label: cols.label >= 0 ? String(row[cols.label] || '').trim() : '',
      });
    }

    // 計算總筆數
    let totalRows = 0;
    for (let i = 1; i < rows.length; i++) {
      if (parseDate(rows[i][cols.date])) totalRows++;
    }

    res.json({
      success: true,
      fileName: sheetName,
      totalRows,
      detectedColumns,
      preview,
      hasDebitCredit: cols.debit >= 0 && cols.credit >= 0,
    });

  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: err.message });
  }
}
