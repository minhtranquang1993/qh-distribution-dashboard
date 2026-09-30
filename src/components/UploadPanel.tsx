import { useRef, useState } from 'react';
import type { ParseProgress } from '@/types/lead';
import { IS_PRODUCTION_BUILD } from '@/hooks/useIngest';
import type { SaveStatus } from '@/hooks/useDataSource';
import type { SaveProgress } from '@/lib/ingestApi';

interface Props {
  onFile: (file: File) => void;
  status: 'idle' | 'parsing' | 'ready' | 'error';
  progress: ParseProgress | null;
  error: string | null;
  fileName: string | null;
  onReset: () => void;
  saveStatus: SaveStatus;
  saveProgress: SaveProgress | null;
  saveError: string | null;
}

const STAGE_LABEL: Record<ParseProgress['stage'], string> = {
  reading: 'Đang đọc file',
  normalizing: 'Đang chuẩn hóa',
  scoring: 'Đang chấm điểm',
  done: 'Xong',
};

export function UploadPanel({ onFile, status, progress, error, fileName, onReset, saveStatus, saveProgress, saveError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  const rows = progress?.rowsProcessed ?? 0;

  return (
    <div className="card">
      <h2 className="card-title">Nạp dữ liệu</h2>

      {status === 'idle' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`flex flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center ${
            dragging ? 'border-sky-500 bg-sky-500/5' : 'border-slate-700'
          }`}
        >
          <p className="text-sm text-slate-400">
            Kéo thả file CSV wholesale vào đây, hoặc
          </p>
          <button className="btn-primary" onClick={() => inputRef.current?.click()}>
            Chọn file CSV
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="max-w-md text-xs text-slate-500">
            File được parse trong Web Worker nên giao diện không bị treo.
            {IS_PRODUCTION_BUILD
              ? ' Bản public đã tắt hiển thị PII (email/SĐT/tên) để bảo vệ dữ liệu khách. Upload qua UI chỉ lưu trường safe vào DB.'
              : ' Bản local giữ PII để tra cứu nhanh trong bộ nhớ; file vừa nạp tự lưu DB nhưng chỉ trường safe (muốn lưu PII dùng seed script).'}
          </p>
        </div>
      )}

      {status === 'parsing' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">{STAGE_LABEL[progress?.stage ?? 'reading']}</span>
            <span className="tabular-nums text-slate-500">{rows.toLocaleString('vi-VN')} dòng</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: progress?.totalRows ? `${(rows / progress.totalRows) * 100}%` : '60%' }}
            />
          </div>
          <p className="text-xs text-slate-500">{fileName}</p>
        </div>
      )}

      {status === 'ready' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">
              Đã nạp <span className="font-semibold">{rows.toLocaleString('vi-VN')}</span> dòng từ{' '}
              <span className="text-slate-400">{fileName}</span>
            </p>
            <button className="btn border border-slate-700 text-slate-300 hover:bg-slate-800" onClick={onReset}>
              Nạp file khác
            </button>
          </div>
          {saveStatus === 'saving' && (
            <p className="text-xs text-sky-300">
              Đang lưu DB… {(saveProgress?.saved ?? 0).toLocaleString('vi-VN')}/{(saveProgress?.total ?? 0).toLocaleString('vi-VN')} dòng
            </p>
          )}
          {saveStatus === 'saved' && (
            <p className="text-xs text-emerald-300">Đã lưu vào DB — reload trang vẫn còn dữ liệu.</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-xs text-rose-400">Lưu DB thất bại: {saveError} — dữ liệu vẫn phân tích được trong bộ nhớ.</p>
          )}
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-rose-400">Lỗi: {error}</p>
          <button className="btn border border-slate-700 text-slate-300 hover:bg-slate-800" onClick={onReset}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
