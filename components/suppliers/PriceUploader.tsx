'use client'

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { useUploadPriceList, usePriceUploads } from '@/hooks/use-suppliers'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'

interface PriceUploaderProps {
  supplierCode: string
}

export function PriceUploader({ supplierCode }: PriceUploaderProps) {
  const { t } = useLocale()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any[] | null>(null)
  const [uploadResult, setUploadResult] = useState<any>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadMutation = useUploadPriceList()
  const { data: uploadsData } = usePriceUploads(supplierCode)

  const handleFile = useCallback((f: File) => {
    setFile(f)
    setPreview(null)
    setUploadResult(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleUpload = async () => {
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('supplier_code', supplierCode)

    try {
      const result = await uploadMutation.mutateAsync(formData)
      setUploadResult(result)
      setPreview(result.preview || null)
    } catch {
      // Error is handled by mutation
    }
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <Card>
        <CardContent className="p-4">
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/20 hover:border-primary/50'}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('suppliers.dropFile')}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{t('suppliers.supportedFormats')}</p>
          </div>

          {/* Selected file */}
          {file && (
            <div className="mt-3 flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="text-sm">{file.name}</span>
                <span className="text-xs text-muted-foreground">
                  ({Math.round(file.size / 1024)} KB)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleUpload}
                  disabled={uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin me-1" />
                  ) : (
                    <Upload className="h-3 w-3 me-1" />
                  )}
                  {uploadMutation.isPending ? t('suppliers.processing') : t('suppliers.confirmUpload')}
                </Button>
                <button onClick={() => { setFile(null); setPreview(null); setUploadResult(null) }}>
                  <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            </div>
          )}

          {/* Upload result */}
          {uploadResult?.summary && (
            <div className="mt-3 p-3 rounded-lg border space-y-2">
              <div className="flex items-center gap-2">
                {uploadResult.summary.errors === 0 ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                )}
                <span className="text-sm font-medium">
                  {uploadResult.summary.validItems} / {uploadResult.summary.totalRows} {t('suppliers.itemsProcessed')}
                </span>
                {uploadResult.summary.errors > 0 && (
                  <Badge variant="warning">{uploadResult.summary.errors} {t('suppliers.errors')}</Badge>
                )}
              </div>
              {uploadResult.summary.errorDetails?.length > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {uploadResult.summary.errorDetails.map((err: string, i: number) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Preview table */}
          {preview && preview.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground mb-2">{t('suppliers.preview')}</p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-2 py-1 text-start">{t('suppliers.itemCode')}</th>
                      <th className="px-2 py-1 text-start">Description</th>
                      <th className="px-2 py-1 text-end">Price</th>
                      <th className="px-2 py-1 text-end">Currency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1 font-mono">{row.itemCode}</td>
                        <td className="px-2 py-1">{row.description}</td>
                        <td className="px-2 py-1 text-end">{row.price}</td>
                        <td className="px-2 py-1 text-end">{row.currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload history */}
      {uploadsData?.uploads?.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-0">
            <CardTitle className="text-sm">{t('suppliers.uploadHistory')}</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="rounded border overflow-hidden">
              <table className="w-full text-xs">
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
                  {uploadsData.uploads.map((upload: any) => (
                    <tr key={upload.id} className="border-t">
                      <td className="px-2 py-1">{upload.fileName}</td>
                      <td className="px-2 py-1">
                        {new Date(upload.uploadDate).toLocaleDateString('he-IL')}
                      </td>
                      <td className="px-2 py-1 text-end">{upload.itemsCount}</td>
                      <td className="px-2 py-1 text-end">{upload.errorsCount}</td>
                      <td className="px-2 py-1 text-center">
                        <Badge
                          variant={upload.status === 'completed' ? 'success' : upload.status === 'error' ? 'destructive' : 'secondary'}
                        >
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
