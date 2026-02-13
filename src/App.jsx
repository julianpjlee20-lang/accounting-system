import { useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

function App() {
  const [tab, setTab] = useState('journal');
  const [accounts, setAccounts] = useState([]);
  const [entries, setEntries] = useState([]);
  const [bankTxs, setBankTxs] = useState([]);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadAccounts();
    loadEntries();
    loadBankTxs();
  }, []);

  const loadAccounts = async () => {
    const res = await axios.get(`${API}/accounts`);
    setAccounts(res.data);
  };

  const loadEntries = async () => {
    const res = await axios.get(`${API}/entries`);
    setEntries(res.data);
  };

  const loadBankTxs = async () => {
    const res = await axios.get(`${API}/bank-transactions`);
    setBankTxs(res.data);
  };

  const showMsg = (msg) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await axios.post(`${API}/upload`, formData);
      showMsg(`已匯入 ${res.data.transactions.length} 筆交易`);
      loadBankTxs();
    } catch (err) {
      showMsg('上傳失敗: ' + (err.response?.data?.error || err.message));
    }
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">銀行對帳單會計系統</h1>
      </header>

      {/* Message */}
      {message && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-2 text-center">
          {message}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto flex">
          {[
            { id: 'journal', label: '日記帳' },
            { id: 'upload', label: '上傳對帳單' },
            { id: 'reports', label: '財務報表' },
            { id: 'accounts', label: '科目管理' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-6 py-3 font-medium ${
                tab === t.id 
                  ? 'text-blue-600 border-b-2 border-blue-600' 
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto p-4">
        {tab === 'journal' && (
          <JournalTab 
            entries={entries} 
            accounts={accounts}
            onAdd={() => { setEditingEntry(null); setShowEntryModal(true); }}
            onEdit={(e) => { setEditingEntry(e); setShowEntryModal(true); }}
            onDelete={async (id) => {
              if (confirm('確定刪除此分錄？')) {
                await axios.delete(`${API}/entries/${id}`);
                loadEntries();
                showMsg('已刪除');
              }
            }}
          />
        )}
        
        {tab === 'upload' && (
          <UploadTab 
            bankTxs={bankTxs} 
            accounts={accounts}
            onUpload={() => { loadBankTxs(); loadEntries(); }}
            onCreateEntry={async (txId, debitId, creditId) => {
              try {
                await axios.post(`${API}/bank-transactions/${txId}/create-entry`, {
                  debit_account_id: debitId,
                  credit_account_id: creditId
                });
                showMsg('已建立分錄');
                loadBankTxs();
                loadEntries();
              } catch (err) {
                showMsg('失敗: ' + (err.response?.data?.error || err.message));
              }
            }}
          />
        )}

        {tab === 'reports' && (
          <ReportsTab />
        )}

        {tab === 'accounts' && (
          <AccountsTab 
            accounts={accounts} 
            onAdd={async (acc) => {
              try {
                await axios.post(`${API}/accounts`, acc);
                loadAccounts();
                showMsg('已新增科目');
              } catch (err) {
                showMsg('失敗: ' + (err.response?.data?.error || err.message));
              }
            }}
          />
        )}
      </main>

      {/* Entry Modal */}
      {showEntryModal && (
        <EntryModal
          entry={editingEntry}
          accounts={accounts}
          onClose={() => setShowEntryModal(false)}
          onSave={async (data) => {
            try {
              if (editingEntry) {
                await axios.put(`${API}/entries/${editingEntry.id}`, data);
                showMsg('已更新');
              } else {
                await axios.post(`${API}/entries`, data);
                showMsg('已新增');
              }
              loadEntries();
              setShowEntryModal(false);
            } catch (err) {
              showMsg('失敗: ' + (err.response?.data?.error || err.message));
            }
          }}
        />
      )}
    </div>
  );
}

function JournalTab({ entries, accounts, onAdd, onEdit, onDelete }) {
  const totalDebit = entries.reduce((sum, e) => 
    sum + e.lines.reduce((s, l) => s + l.debit, 0), 0
  );
  const totalCredit = entries.reduce((sum, e) => 
    sum + e.lines.reduce((s, l) => s + l.credit, 0), 0
  );

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">日記帳</h2>
        <button
          onClick={onAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          + 新增分錄
        </button>
      </div>

      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">日期</th>
              <th className="px-4 py-2 text-left">摘要</th>
              <th className="px-4 py-2 text-left">科目</th>
              <th className="px-4 py-2 text-right">借方</th>
              <th className="px-4 py-2 text-right">貸方</th>
              <th className="px-4 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              entry.lines.map((line, idx) => (
                <tr key={`${entry.id}-${idx}`} className="border-t">
                  {idx === 0 ? (
                    <>
                      <td className="px-4 py-2" rowSpan={entry.lines.length}>{entry.date}</td>
                      <td className="px-4 py-2" rowSpan={entry.lines.length}>{entry.description}</td>
                    </>
                  ) : null}
                  <td className="px-4 py-2">
                    <span className="text-gray-500 mr-2">{line.account_code}</span>
                    {line.account_name}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {line.debit > 0 ? line.debit.toLocaleString() : ''}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {line.credit > 0 ? line.credit.toLocaleString() : ''}
                  </td>
                  {idx === 0 ? (
                    <td className="px-4 py-2 text-center" rowSpan={entry.lines.length}>
                      <button 
                        onClick={() => onEdit(entry)}
                        className="text-blue-600 hover:underline mr-2"
                      >
                        編輯
                      </button>
                      <button 
                        onClick={() => onDelete(entry.id)}
                        className="text-red-600 hover:underline"
                      >
                        刪除
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  尚無分錄
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-gray-50 font-bold">
            <tr>
              <td colSpan={3} className="px-4 py-2 text-right">合計</td>
              <td className="px-4 py-2 text-right">{totalDebit.toLocaleString()}</td>
              <td className="px-4 py-2 text-right">{totalCredit.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function UploadTab({ bankTxs, accounts, onUpload, onCreateEntry }) {
  const [selectedTx, setSelectedTx] = useState(null);
  const [debitAccId, setDebitAccId] = useState('');
  const [creditAccId, setCreditAccId] = useState('');
  
  // 上傳流程狀態
  const [uploadStep, setUploadStep] = useState('idle'); // idle, loading, preview, importing, done
  const [previewData, setPreviewData] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const pendingTxs = bankTxs.filter(tx => !tx.entry_id && !tx.transfer_pair_id);
  const pairedTxs = bankTxs.filter(tx => tx.transfer_pair_id && !tx.entry_id);
  
  // 內部轉帳配對
  const [matchSuggestions, setMatchSuggestions] = useState([]);
  const [loadingMatch, setLoadingMatch] = useState(false);
  
  // 批次管理
  const [batches, setBatches] = useState([]);
  const [showBatches, setShowBatches] = useState(false);

  const loadBatches = async () => {
    try {
      const res = await axios.get('/api/batches');
      setBatches(res.data.batches || []);
    } catch (err) {
      console.error('Load batches error:', err);
    }
  };

  const migrateBatches = async () => {
    if (!confirm('確定要為歷史資料建立批次記錄？\n（這會將沒有批次的舊交易按日期分組）')) return;
    try {
      const res = await axios.post('/api/batches');
      alert(res.data.message || `成功建立 ${res.data.batchesCreated} 個批次，更新 ${res.data.txsUpdated} 筆交易`);
      loadBatches();
      onUpload();
    } catch (err) {
      alert('遷移失敗: ' + (err.response?.data?.error || err.message));
    }
  };

  const deleteBatch = async (batchId, filename) => {
    if (!confirm(`確定要刪除批次「${filename}」及其所有交易？\n\n注意：已建立的分錄不會被刪除。`)) return;
    try {
      const res = await axios.delete(`/api/batches?id=${batchId}`);
      if (res.data.warning) alert(res.data.warning);
      onUpload();
      loadBatches();
    } catch (err) {
      alert('刪除失敗: ' + (err.response?.data?.error || err.message));
    }
  };

  const loadMatchSuggestions = async () => {
    setLoadingMatch(true);
    try {
      const res = await axios.get('/api/transfer-match');
      setMatchSuggestions(res.data.suggestions || []);
    } catch (err) {
      console.error('Load match error:', err);
    }
    setLoadingMatch(false);
  };

  const confirmMatch = async (tx1_id, tx2_id) => {
    try {
      await axios.post('/api/transfer-match', { tx1_id, tx2_id });
      onUpload(); // 重新載入
      loadMatchSuggestions();
    } catch (err) {
      alert('配對失敗: ' + (err.response?.data?.error || err.message));
    }
  };

  // 步驟 1: 選擇檔案並預覽
  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setUploadFile(file);
    setUploadStep('loading');
    setPreviewData(null);
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const res = await axios.post('/api/upload-preview', formData);
      setPreviewData(res.data);
      setUploadStep('preview');
    } catch (err) {
      alert('預覽失敗: ' + (err.response?.data?.error || err.message));
      setUploadStep('idle');
    }
    e.target.value = '';
  };

  // 步驟 2: 確認匯入
  const handleConfirmImport = async () => {
    if (!uploadFile) return;
    
    setUploadStep('importing');
    
    const formData = new FormData();
    formData.append('file', uploadFile);
    
    try {
      const res = await axios.post('/api/upload', formData);
      setImportResult(res.data);
      setUploadStep('done');
      onUpload(); // 重新載入交易列表
    } catch (err) {
      alert('匯入失敗: ' + (err.response?.data?.error || err.message));
      setUploadStep('preview');
    }
  };

  // 取消/重置
  const handleCancel = () => {
    setUploadStep('idle');
    setPreviewData(null);
    setUploadFile(null);
    setImportResult(null);
  };

  return (
    <div>
      {/* 上傳區域 */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-bold">上傳銀行對帳單</h2>
          <button
            onClick={() => { setShowBatches(!showBatches); if (!showBatches) loadBatches(); }}
            className="text-sm text-blue-600 hover:underline"
          >
            {showBatches ? '隱藏批次記錄' : '📁 查看上傳批次'}
          </button>
        </div>

        {/* 批次記錄列表 */}
        {showBatches && (
          <div className="bg-white rounded shadow p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium">上傳批次記錄</h3>
              <button
                onClick={migrateBatches}
                className="text-sm text-purple-600 hover:underline"
              >
                🔄 遷移歷史資料
              </button>
            </div>
            {batches.length === 0 ? (
              <p className="text-gray-500 text-sm">尚無上傳記錄</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">檔案名稱</th>
                    <th className="px-3 py-2 text-center">筆數</th>
                    <th className="px-3 py-2 text-center">已處理</th>
                    <th className="px-3 py-2 text-center">待處理</th>
                    <th className="px-3 py-2 text-left">上傳時間</th>
                    <th className="px-3 py-2 text-center">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-t">
                      <td className="px-3 py-2">{b.filename}</td>
                      <td className="px-3 py-2 text-center">{b.tx_count}</td>
                      <td className="px-3 py-2 text-center text-green-600">{b.processed_count}</td>
                      <td className="px-3 py-2 text-center text-amber-600">{b.pending_count}</td>
                      <td className="px-3 py-2 text-gray-500">{b.created_at?.replace('T', ' ').slice(0, 16)}</td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => deleteBatch(b.id, b.filename)}
                          className="text-red-600 hover:underline"
                        >
                          刪除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        
        {uploadStep === 'idle' && (
          <div className="bg-white rounded shadow p-6">
            <p className="text-gray-600 text-sm mb-4">
              支援 Excel 格式 (.xlsx)，可自動偵測欄位：公司、日期、摘要、金額、借方科目、貸方科目、標籤
            </p>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>
        )}

        {uploadStep === 'loading' && (
          <div className="bg-white rounded shadow p-6 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-2"></div>
            <p className="text-gray-600">正在讀取檔案...</p>
          </div>
        )}

        {uploadStep === 'preview' && previewData && (
          <div className="bg-white rounded shadow p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-green-600">✓ 檔案讀取完成</h3>
                <p className="text-sm text-gray-600">共偵測到 {previewData.totalRows} 筆資料</p>
              </div>
              <button onClick={handleCancel} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            
            {/* 欄位偵測結果 */}
            <div className="mb-4 p-3 bg-gray-50 rounded">
              <p className="text-sm font-medium mb-2">欄位偵測結果：</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(previewData.detectedColumns).map(([key, val]) => (
                  <div key={key} className="flex">
                    <span className="text-gray-500 w-20">{key}：</span>
                    <span className={val === '未偵測' ? 'text-gray-400' : 'text-green-600'}>{val}</span>
                  </div>
                ))}
              </div>
              {!previewData.hasDebitCredit && (
                <p className="mt-2 text-sm text-amber-600">
                  ⚠ 未偵測到借方/貸方科目欄位，匯入後需手動建立分錄
                </p>
              )}
            </div>
            
            {/* 資料預覽 */}
            <div className="mb-4">
              <p className="text-sm font-medium mb-2">資料預覽（前 {previewData.preview.length} 筆）：</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1 text-left">日期</th>
                      <th className="px-2 py-1 text-left">摘要</th>
                      <th className="px-2 py-1 text-right">金額</th>
                      {previewData.hasDebitCredit && (
                        <>
                          <th className="px-2 py-1 text-left">借方</th>
                          <th className="px-2 py-1 text-left">貸方</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.preview.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{row.date}</td>
                        <td className="px-2 py-1">{row.company ? `[${row.company}] ` : ''}{row.description}</td>
                        <td className={`px-2 py-1 text-right ${row.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {row.amount.toLocaleString()}
                        </td>
                        {previewData.hasDebitCredit && (
                          <>
                            <td className="px-2 py-1 text-gray-500">{row.debit_code || '-'}</td>
                            <td className="px-2 py-1 text-gray-500">{row.credit_code || '-'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* 確認按鈕 */}
            <div className="flex justify-end gap-2">
              <button onClick={handleCancel} className="px-4 py-2 border rounded hover:bg-gray-50">
                取消
              </button>
              <button 
                onClick={handleConfirmImport}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                確認匯入 {previewData.totalRows} 筆
              </button>
            </div>
          </div>
        )}

        {uploadStep === 'importing' && (
          <div className="bg-white rounded shadow p-6 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent mb-2"></div>
            <p className="text-gray-600">正在匯入資料...</p>
          </div>
        )}

        {uploadStep === 'done' && importResult && (
          <div className="bg-white rounded shadow p-6">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">✅</div>
              <h3 className="font-bold text-green-600">匯入完成！</h3>
            </div>
            <div className="bg-gray-50 rounded p-4 mb-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">{importResult.summary?.total || importResult.transactions?.length || 0}</div>
                  <div className="text-sm text-gray-500">總筆數</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-600">{importResult.summary?.autoEntry || 0}</div>
                  <div className="text-sm text-gray-500">自動建立分錄</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-amber-600">{importResult.summary?.pending || 0}</div>
                  <div className="text-sm text-gray-500">待處理</div>
                </div>
              </div>
            </div>
            <button 
              onClick={handleCancel}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              完成
            </button>
          </div>
        )}
      </div>

      {/* 內部轉帳配對區塊 */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-bold">🔄 內部轉帳配對</h3>
          <button
            onClick={loadMatchSuggestions}
            disabled={loadingMatch}
            className="text-sm text-blue-600 hover:underline"
          >
            {loadingMatch ? '偵測中...' : '偵測可能的配對'}
          </button>
        </div>
        
        {matchSuggestions.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
            <p className="text-sm text-yellow-800 mb-2">
              發現 {matchSuggestions.length} 組可能的內部轉帳，請確認：
            </p>
            {matchSuggestions.map((match, i) => (
              <div key={i} className="bg-white rounded p-3 mb-2 border">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium">{match.tx1.date}</div>
                    <div className="text-gray-600">{match.tx1.company} {match.tx1.description}</div>
                    <div className={match.tx1.amount < 0 ? 'text-red-600' : 'text-green-600'}>
                      {match.tx1.amount.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium">{match.tx2.date}</div>
                    <div className="text-gray-600">{match.tx2.company} {match.tx2.description}</div>
                    <div className={match.tx2.amount < 0 ? 'text-red-600' : 'text-green-600'}>
                      {match.tx2.amount.toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-between items-center">
                  <span className="text-xs text-gray-500">
                    信心度 {Math.round(match.confidence * 100)}% - {match.reason}
                    {match.amountDiff > 0 && ` (差額 ${match.amountDiff} 元)`}
                  </span>
                  <button
                    onClick={() => confirmMatch(match.tx1.id, match.tx2.id)}
                    className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                  >
                    確認配對
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {pairedTxs.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
            <p className="text-sm text-green-800">
              ✓ 已配對 {pairedTxs.length / 2} 組內部轉帳（{pairedTxs.length} 筆交易）
            </p>
          </div>
        )}
      </div>

      {/* 待處理交易列表 */}
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold">待處理交易 ({pendingTxs.length})</h3>
        {pendingTxs.length > 0 && (
          <button
            onClick={async () => {
              if (confirm(`確定要刪除所有 ${pendingTxs.length} 筆待處理交易？\n刪除後可重新上傳新檔案。`)) {
                try {
                  await axios.delete('/api/bank-transactions/clear');
                  onUpload(); // 重新載入
                } catch (err) {
                  alert('刪除失敗: ' + (err.response?.data?.error || err.message));
                }
              }
            }}
            className="text-sm text-red-600 hover:underline"
          >
            🗑️ 清除全部
          </button>
        )}
      </div>
      <div className="bg-white rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">日期</th>
              <th className="px-4 py-2 text-left">摘要</th>
              <th className="px-4 py-2 text-right">金額</th>
              <th className="px-4 py-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {pendingTxs.map(tx => (
              <tr key={tx.id} className="border-t">
                <td className="px-4 py-2">{tx.date}</td>
                <td className="px-4 py-2">{tx.description}</td>
                <td className={`px-4 py-2 text-right ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {tx.amount.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-center">
                  <button
                    onClick={() => {
                      setSelectedTx(tx);
                      setDebitAccId('');
                      setCreditAccId('');
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    建立分錄
                  </button>
                </td>
              </tr>
            ))}
            {pendingTxs.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                  無待處理交易
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Entry Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="font-bold mb-4">建立分錄</h3>
            <p className="text-sm text-gray-600 mb-2">
              {selectedTx.date} - {selectedTx.description}
            </p>
            <p className="font-bold mb-4">金額: {selectedTx.amount.toLocaleString()}</p>
            
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">借方科目</label>
              <select
                value={debitAccId}
                onChange={e => setDebitAccId(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">選擇科目</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">貸方科目</label>
              <select
                value={creditAccId}
                onChange={e => setCreditAccId(e.target.value)}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">選擇科目</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSelectedTx(null)}
                className="px-4 py-2 border rounded"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (debitAccId && creditAccId) {
                    onCreateEntry(selectedTx.id, debitAccId, creditAccId);
                    setSelectedTx(null);
                  }
                }}
                disabled={!debitAccId || !creditAccId}
                className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportsTab() {
  const [reportType, setReportType] = useState('trial-balance');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('type', reportType);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      if (endDate && reportType === 'balance-sheet') params.append('asOfDate', endDate);
      const url = '/api/reports?' + params.toString();
      
      const res = await axios.get(url);
      setReportData({ type: reportType, data: res.data });
    } catch (err) {
      alert('報表產生失敗: ' + (err.response?.data?.error || err.message));
    }
    setLoading(false);
  };

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">財務報表</h2>
      
      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">報表類型</label>
            <select
              value={reportType}
              onChange={e => { setReportType(e.target.value); setReportData(null); }}
              className="border rounded px-3 py-2"
            >
              <option value="trial-balance">試算表</option>
              <option value="balance-sheet">資產負債表</option>
              <option value="income-statement">損益表</option>
            </select>
          </div>
          
          {reportType !== 'balance-sheet' && (
            <div>
              <label className="block text-sm font-medium mb-1">起始日期</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="border rounded px-3 py-2"
              />
            </div>
          )}
          
          <div>
            <label className="block text-sm font-medium mb-1">
              {reportType === 'balance-sheet' ? '截止日期' : '結束日期'}
            </label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
          
          <button
            onClick={generateReport}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '產生中...' : '產生報表'}
          </button>
        </div>
      </div>

      {/* 報表內容 */}
      {reportData && (
        <div className="bg-white rounded shadow p-4">
          {reportData.type === 'trial-balance' && <TrialBalanceReport data={reportData.data} />}
          {reportData.type === 'balance-sheet' && <BalanceSheetReport data={reportData.data} />}
          {reportData.type === 'income-statement' && <IncomeStatementReport data={reportData.data} />}
        </div>
      )}
    </div>
  );
}

function TrialBalanceReport({ data }) {
  return (
    <div>
      <h3 className="text-lg font-bold mb-4 text-center">試算表</h3>
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left">科目代碼</th>
            <th className="px-4 py-2 text-left">科目名稱</th>
            <th className="px-4 py-2 text-right">借方餘額</th>
            <th className="px-4 py-2 text-right">貸方餘額</th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map(acc => (
            <tr key={acc.id} className="border-t">
              <td className="px-4 py-2 text-gray-500">{acc.code}</td>
              <td className="px-4 py-2">{acc.name}</td>
              <td className="px-4 py-2 text-right">{acc.debit_balance > 0 ? acc.debit_balance.toLocaleString() : ''}</td>
              <td className="px-4 py-2 text-right">{acc.credit_balance > 0 ? acc.credit_balance.toLocaleString() : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td colSpan={2} className="px-4 py-2 text-right">合計</td>
            <td className="px-4 py-2 text-right">{data.totals.debit.toLocaleString()}</td>
            <td className="px-4 py-2 text-right">{data.totals.credit.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      <p className={`mt-2 text-center ${data.totals.balanced ? 'text-green-600' : 'text-red-600'}`}>
        {data.totals.balanced ? '✓ 借貸平衡' : '✗ 借貸不平衡'}
      </p>
    </div>
  );
}

function BalanceSheetReport({ data }) {
  return (
    <div>
      <h3 className="text-lg font-bold mb-2 text-center">資產負債表</h3>
      <p className="text-sm text-gray-500 text-center mb-4">截至 {data.asOfDate}</p>
      
      <div className="grid grid-cols-2 gap-4">
        {/* 左側：資產 */}
        <div>
          <h4 className="font-bold mb-2 text-blue-700">資產</h4>
          <table className="w-full text-sm">
            <tbody>
              {data.assets.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1">{item.code} {item.name}</td>
                  <td className="py-1 text-right">{item.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-bold border-t-2">
              <tr>
                <td className="py-2">資產合計</td>
                <td className="py-2 text-right">{data.totals.assets.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        
        {/* 右側：負債及權益 */}
        <div>
          <h4 className="font-bold mb-2 text-red-700">負債</h4>
          <table className="w-full text-sm">
            <tbody>
              {data.liabilities.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1">{item.code} {item.name}</td>
                  <td className="py-1 text-right">{item.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-bold border-t">
              <tr>
                <td className="py-1">負債小計</td>
                <td className="py-1 text-right">{data.totals.liabilities.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
          
          <h4 className="font-bold mt-4 mb-2 text-green-700">權益</h4>
          <table className="w-full text-sm">
            <tbody>
              {data.equity.map((item, i) => (
                <tr key={i} className="border-t">
                  <td className="py-1">{item.code} {item.name}</td>
                  <td className="py-1 text-right">{item.balance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-bold border-t-2">
              <tr>
                <td className="py-2">負債及權益合計</td>
                <td className="py-2 text-right">{data.totals.liabilitiesAndEquity.toLocaleString()}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      
      <p className={`mt-4 text-center ${data.totals.balanced ? 'text-green-600' : 'text-red-600'}`}>
        {data.totals.balanced ? '✓ 資產 = 負債 + 權益' : '✗ 資產 ≠ 負債 + 權益'}
      </p>
    </div>
  );
}

function IncomeStatementReport({ data }) {
  return (
    <div>
      <h3 className="text-lg font-bold mb-2 text-center">損益表</h3>
      <p className="text-sm text-gray-500 text-center mb-4">{data.period.start} 至 {data.period.end}</p>
      
      <div className="max-w-md mx-auto">
        <h4 className="font-bold mb-2 text-green-700">收入</h4>
        <table className="w-full text-sm mb-4">
          <tbody>
            {data.revenues.map((item, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{item.code} {item.name}</td>
                <td className="py-1 text-right">{item.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-bold border-t">
            <tr>
              <td className="py-1">收入合計</td>
              <td className="py-1 text-right">{data.totals.revenue.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
        
        <h4 className="font-bold mb-2 text-red-700">費用</h4>
        <table className="w-full text-sm mb-4">
          <tbody>
            {data.expenses.map((item, i) => (
              <tr key={i} className="border-t">
                <td className="py-1">{item.code} {item.name}</td>
                <td className="py-1 text-right">{item.amount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-bold border-t">
            <tr>
              <td className="py-1">費用合計</td>
              <td className="py-1 text-right">{data.totals.expense.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
        
        <div className={`text-center p-4 rounded ${data.totals.profitable ? 'bg-green-100' : 'bg-red-100'}`}>
          <p className="text-lg font-bold">
            本期{data.totals.profitable ? '淨利' : '淨損'}
          </p>
          <p className={`text-2xl font-bold ${data.totals.profitable ? 'text-green-600' : 'text-red-600'}`}>
            {Math.abs(data.totals.netIncome).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

function AccountsTab({ accounts, onAdd }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('expense');

  const typeLabels = {
    asset: '資產',
    liability: '負債',
    equity: '權益',
    revenue: '收入',
    expense: '費用'
  };

  const grouped = accounts.reduce((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {});

  return (
    <div>
      <h2 className="text-lg font-bold mb-4">科目管理</h2>
      
      <div className="bg-white rounded shadow p-4 mb-4">
        <h3 className="font-medium mb-2">新增科目</h3>
        <div className="flex gap-2">
          <input
            placeholder="代碼"
            value={code}
            onChange={e => setCode(e.target.value)}
            className="border rounded px-3 py-2 w-24"
          />
          <input
            placeholder="名稱"
            value={name}
            onChange={e => setName(e.target.value)}
            className="border rounded px-3 py-2 flex-1"
          />
          <select
            value={type}
            onChange={e => setType(e.target.value)}
            className="border rounded px-3 py-2"
          >
            {Object.entries(typeLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button
            onClick={() => {
              if (code && name) {
                onAdd({ code, name, type });
                setCode('');
                setName('');
              }
            }}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            新增
          </button>
        </div>
      </div>

      {Object.entries(typeLabels).map(([typeKey, typeLabel]) => (
        <div key={typeKey} className="mb-4">
          <h3 className="font-medium mb-2">{typeLabel}</h3>
          <div className="bg-white rounded shadow">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left w-24">代碼</th>
                  <th className="px-4 py-2 text-left">名稱</th>
                </tr>
              </thead>
              <tbody>
                {(grouped[typeKey] || []).map(acc => (
                  <tr key={acc.id} className="border-t">
                    <td className="px-4 py-2 text-gray-500">{acc.code}</td>
                    <td className="px-4 py-2">{acc.name}</td>
                  </tr>
                ))}
                {(!grouped[typeKey] || grouped[typeKey].length === 0) && (
                  <tr>
                    <td colSpan={2} className="px-4 py-2 text-gray-400 text-center">無</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function EntryModal({ entry, accounts, onClose, onSave }) {
  const [date, setDate] = useState(entry?.date || new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(entry?.description || '');
  const [lines, setLines] = useState(
    entry?.lines?.length > 0 
      ? entry.lines.map(l => ({ account_id: l.account_id, debit: l.debit, credit: l.credit }))
      : [{ account_id: '', debit: 0, credit: 0 }, { account_id: '', debit: 0, credit: 0 }]
  );

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const addLine = () => setLines([...lines, { account_id: '', debit: 0, credit: 0 }]);
  const removeLine = (idx) => {
    if (lines.length > 2) setLines(lines.filter((_, i) => i !== idx));
  };

  const updateLine = (idx, field, value) => {
    const newLines = [...lines];
    newLines[idx][field] = field === 'account_id' ? value : parseFloat(value) || 0;
    setLines(newLines);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto">
        <h3 className="font-bold text-lg mb-4">{entry ? '編輯分錄' : '新增分錄'}</h3>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">日期</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">摘要</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <table className="w-full mb-4">
          <thead>
            <tr className="text-sm text-gray-600">
              <th className="text-left pb-2">科目</th>
              <th className="text-right pb-2 w-28">借方</th>
              <th className="text-right pb-2 w-28">貸方</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx}>
                <td className="pr-2 pb-2">
                  <select
                    value={line.account_id}
                    onChange={e => updateLine(idx, 'account_id', e.target.value)}
                    className="w-full border rounded px-2 py-1"
                  >
                    <option value="">選擇科目</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                    ))}
                  </select>
                </td>
                <td className="pb-2">
                  <input
                    type="number"
                    value={line.debit || ''}
                    onChange={e => updateLine(idx, 'debit', e.target.value)}
                    className="w-full border rounded px-2 py-1 text-right"
                    placeholder="0"
                  />
                </td>
                <td className="pb-2">
                  <input
                    type="number"
                    value={line.credit || ''}
                    onChange={e => updateLine(idx, 'credit', e.target.value)}
                    className="w-full border rounded px-2 py-1 text-right"
                    placeholder="0"
                  />
                </td>
                <td className="pb-2 text-center">
                  <button
                    onClick={() => removeLine(idx)}
                    className="text-red-500 hover:text-red-700"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td className="pt-2 text-right">合計</td>
              <td className="pt-2 text-right">{totalDebit.toLocaleString()}</td>
              <td className="pt-2 text-right">{totalCredit.toLocaleString()}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <button
          onClick={addLine}
          className="text-blue-600 text-sm mb-4"
        >
          + 新增明細
        </button>

        {!isBalanced && (
          <p className="text-red-600 text-sm mb-4">借貸不平衡</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded"
          >
            取消
          </button>
          <button
            onClick={() => onSave({ date, description, lines })}
            disabled={!isBalanced || lines.some(l => !l.account_id)}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
