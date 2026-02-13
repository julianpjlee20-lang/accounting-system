import { createClient } from '@libsql/client';
import XLSX from 'xlsx';

const db = createClient({
  url: 'libsql://accounting-system-julianpjlee.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzA5Njk3NjYsImlkIjoiZjQ3NmNhODMtNTVkZS00NGI5LTk5ZDctYjY0MjBkYTQyYWE1IiwicmlkIjoiZTA3Zjk4YjgtNTNiYy00ZTVjLWI5NjMtYzk2ZGE3NjQwMDNlIn0.CcuNiSo6gUHdd_R-x-JOLbaQ4OFTWKEJ8jt7bR6g2XGDuMauCuWKIB4RhzBW76LmqoPbN6H7VyOp6Om-SKvhCw'
});

// 讀取 Excel
const workbook = XLSX.readFile('/home/ubuntu/.openclaw/media/inbound/f4e9ef5d-41b6-42b3-ab14-4dcb85d05cbd.xlsx');
const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

// 類型對照
const typeMap = {
  '資產': 'asset',
  '負債': 'liability',
  '權益': 'equity',
  '收入': 'revenue',
  '費用': 'expense'
};

async function main() {
  // 清空現有科目
  await db.execute('DELETE FROM accounts');
  console.log('已清空現有科目');
  
  let count = 0;
  for (const row of data) {
    const code = row['科目代碼'];
    const name = row['科目名稱'];
    const typeZh = row['科目類型'];
    const type = typeMap[typeZh];
    
    if (code && name && type) {
      try {
        await db.execute({
          sql: 'INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)',
          args: [code, name, type]
        });
        count++;
      } catch (e) {
        console.error(`跳過: ${code} ${name} - ${e.message}`);
      }
    }
  }
  
  console.log(`已新增 ${count} 個科目`);
}

main().catch(console.error);
