'use client'

import { useCallback, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useUploadCompetitorFile, useCompetitorUploads, DuplicateUploadError } from '@/hooks/use-competitors'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'

interface SheetSummary {
  sheet: string
  competitor: string
  rawRows: number
  storedRows: number
  skippedRows: number
  errors: string[]
}

export function CompetitorUploader() {
  const { t } = useLocale()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<{ sheets: SheetSummary[] } | null>(null)
  const [duplicate, setDuplicate] = useState<DuplicateUploadError | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadMutation = useUploadCompetitorFile()
  const { data: uploadsData } = useCompetitorUploads()

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setResult(null)
    setDuplicate(null)
  }, [])

  const handleUpload = async (force = false) => {
    if (!file) return
    setDuplicate(null)
    try {
      const res = await uploadMutation.mutateAsync({ file, force })
      setResult(res)
    } catch (err) {
      if (err instanceof DuplicateUploadError) setDuplicate(err)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onClick={() => inputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('suppliers.dropFile')}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Excel (xlsx)</p>
          </div>

          {file && (
            <div className="mt-3 flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">({Math.round(file.size / 1024)} KB)</span>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => handleUpload(false)} disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin me-1" />
                  ) : (
                    <Upload className="h-3 w-3 me-1" />
                  )}
                  {uploadMutation.isPending ? t('suppliers.processing') : t('suppliers.confirmUpload')}
                </Button>
                <button onClick={() => { setFile(null); setResult(null); setDuplicate(null) }}>
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Duplicate file — offer forced re-upload */}
          {duplicate && (
            <div className="mt-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                <span>
                  {t('competitors.reUploadConfirm')}
                  {duplicate.uploadedAt && (
                    <span className="text-muted-foreground ms-1">
                      ({new Date(duplicate.uploadedAt).toLocaleDateString('he-IL')})
                    </span>
                  )}
                </span>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleUpload(true)} disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin me-1" /> : null}
                {t('suppliers.confirmUpload')}
              </Button>
            </div>
          )}

          {uploadMutation.isError && !duplicate && !(uploadMutation.error instanceof DuplicateUploadError) && (
            <div className="mt-3 p-3 rounded-lg border border-destructive/40 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              {uploadMutation.error instanceof Error ? uploadMutation.error.message : 'Upload failed'}
            </div>
          )}

          {/* Per-sheet result summary */}
          {result?.sheets && (
            <div className="mt-3 p-3 rounded-lg border space-y-2">
              {result.sheets.map(s => (
                <div key={s.sheet} className="flex items-center gap-2 text-sm">
                  {s.errors.length === 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
                  )}
                  <span className="font-medium">{s.competitor}</span>
                  <span className="text-muted-foreground">
                    {formatNumber(s.storedRows)} / {formatNumber(s.rawRows)}
                  </span>
                  {s.errors.length > 0 && (
                    <Badge variant="warning">{formatNumber(s.errors.length)} {t('suppliers.errors')}</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload history */}
      {uploadsData?.uploads?.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-0">
            <CardTitle className="text-sm">{t('competitors.uploadHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="rounded border overflow-x-auto">
              <table className="w-full text-xs min-w-[480px]">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-2 py-1 text-start">{t('suppliers.fileName')}</th>
                    <th className="px-2 py-1 text-start">{t('suppliers.uploadDate')}</th>
                    <th className="px-2 py-1 text-end">{t('suppliers.itemsProcessed')}</th>
                    <th className="px-2 py-1 text-end">{t('suppliers.errors')}</th>
                    <th className="px-2 py-1 text-center">{t('suppliers.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {uploadsData.uploads.map((upload: { id: string; fileName: string; uploadedAt: string; totalRows: number; errorsCount: number; status: string }) => (
                    <tr key={upload.id} className="border-t">
                      <td className="px-2 py-1">{upload.fileName}</td>
                      <td className="px-2 py-1">{new Date(upload.uploadedAt).toLocaleDateString('he-IL')}</td>
                      <td className="px-2 py-1 text-end">{formatNumber(upload.totalRows)}</td>
                      <td className="px-2 py-1 text-end">{formatNumber(upload.errorsCount)}</td>
                      <td className="px-2 py-1 text-center">
                        <Badge variant={upload.status === 'completed' ? 'success' : upload.status === 'error' ? 'destructive' : 'secondary'}>
                          {upload.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
