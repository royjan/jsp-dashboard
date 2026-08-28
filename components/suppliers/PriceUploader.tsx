'use client'

import { useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useUploadPriceList, usePriceUploads } from '@/hooks/use-suppliers'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

/*
 * A second way in, and the one nobody uses.
 *
 * This uploader parses a sheet into dashboard.supplier_price_uploads.parsedData
 * as a jsonb blob. As of 2026-08-28 that table holds ZERO completed uploads,
 * while Xpart — which has a real importer with column mapping, brand
 * resolution, change detection and price history — holds 1.16M active prices
 * for the same suppliers. The catalogue rendered above this component comes
 * from there.
 *
 * So treat this as a fallback for a list that never went through Xpart, not as
 * the normal path. If it does start being used, the thing to fix is that its
 * output lands in a blob nothing joins to, rather than in a normalized table
 * beside the mirrored prices — two ingestion paths writing different shapes is
 * how the same supplier ends up with two different prices for one part.
 */

/** A parsed row from the uploaded price list, as the API echoes it back. */
interface PreviewRow {
  itemCode: string
  description: string
  price: number
  currency: string
}

/** What the upload endpoint returns once the file has been parsed. */
interface UploadResult {
  summary: {
    validItems: number
    totalRows: number
    errors: number
    errorDetails?: string[]
  }
  preview?: PreviewRow[]
}

/** One past upload of a price list for this supplier. */
interface UploadRow {
  id: string
  fileName: string
  uploadDate: string
  itemsCount: number
  errorsCount: number
  status: string
}

const previewColumns = (itemCodeLabel: string): DataTableColumn<PreviewRow>[] => [
  {
    key: 'itemCode',
    header: itemCodeLabel,
    sortable: true,
    cell: r => <span className="font-mono">{r.itemCode}</span>,
    exportValue: r => r.itemCode,
  },
  {
    key: 'description',
    header: 'Description',
    sortable: true,
    truncate: 'max-w-[280px]',
    title: r => r.description,
    cell: r => r.description,
  },
  {
    key: 'price',
    header: 'Price',
    align: 'end',
    sortable: true,
    cell: r => formatNumber(r.price),
    // The raw number, so a spreadsheet can sum the file you just uploaded.
    exportValue: r => r.price,
  },
  { key: 'currency', header: 'Currency', align: 'end', sortable: true, cell: r => r.currency },
]

interface PriceUploaderProps {
  supplierCode: string
}

export function PriceUploader({ supplierCode }: PriceUploaderProps) {
  const { t } = useLocale()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
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
                  <Badge variant="warning">{formatNumber(uploadResult.summary.errors)} {t('suppliers.errors')}</Badge>
                )}
              </div>
              {(uploadResult.summary.errorDetails?.length ?? 0) > 0 && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {uploadResult.summary.errorDetails?.map((err: string, i: number) => (
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
              <DataTable<PreviewRow>
                rows={preview}
                columns={previewColumns(t('suppliers.itemCode'))}
                getRowKey={(r, i) => `${r.itemCode}-${i}`}
                pageSize={25}
                minWidth="min-w-[420px]"
                density="compact"
                exportFileName="price-list-preview"
                mobileCard={{
                  title: r => r.itemCode,
                  subtitle: r => r.description,
                  accent: r => `${formatNumber(r.price)} ${r.currency}`,
                }}
              />
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
            <DataTable<UploadRow>
              rows={uploadsData.uploads}
              columns={[
                { key: 'fileName', header: t('suppliers.fileName'), sortable: true, truncate: true, cell: u => u.fileName },
                {
                  key: 'uploadDate',
                  header: t('suppliers.uploadDate'),
                  sortable: true,
                  // Sort on the ISO string, not the he-IL rendering — dd/mm/yyyy
                  // sorts by day-of-month, which is not chronological.
                  sortValue: u => u.uploadDate,
                  cell: u => new Date(u.uploadDate).toLocaleDateString('he-IL'),
                  exportValue: u => u.uploadDate,
                },
                { key: 'itemsCount', header: t('suppliers.itemsProcessed'), align: 'end', sortable: true, cell: u => formatNumber(u.itemsCount), exportValue: u => u.itemsCount },
                { key: 'errorsCount', header: t('suppliers.errors'), align: 'end', sortable: true, cell: u => formatNumber(u.errorsCount), exportValue: u => u.errorsCount },
                {
                  key: 'status',
                  header: t('suppliers.status'),
                  align: 'center',
                  sortable: true,
                  cell: u => (
                    <Badge variant={u.status === 'completed' ? 'success' : u.status === 'error' ? 'destructive' : 'secondary'}>
                      {u.status}
                    </Badge>
                  ),
                  exportValue: u => u.status,
                },
              ]}
              getRowKey={u => u.id}
              defaultSort={{ field: 'uploadDate', dir: 'desc' }}
              pageSize={10}
              minWidth="min-w-[480px]"
              density="compact"
              exportFileName="price-upload-history"
              mobileCard={{
                title: u => u.fileName,
                subtitle: u => new Date(u.uploadDate).toLocaleDateString('he-IL'),
                accent: u => u.status,
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
