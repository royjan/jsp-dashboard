import React, { useState } from 'react'
import { X, Download, Database, FileJson, Code, Table } from 'lucide-react'

// Nested export shape this modal consumes. The Flow Decisions page adapts its
// flat records into this shape via `toExportShape` before passing them in.
interface ExportVehicleFilters {
  yearFrom?: number | null
  yearTo?: number | null
  model?: string | null
  fuelType?: string | null
  engineModel?: string | null
  vinPattern?: string | null
}
interface FlowDecisionRecord {
  id: string
  partDescription: string
  flowDecision: { category: string; subcategory: string; schema: string }
  lambdaTarget: string
  status?: string
  createdBy?: string | null
  feedbackCount?: number
  confidence?: number | string | null
  isDefault?: boolean
  source?: string | null
  feedbackType?: string | null
  createdAt?: string | Date
  updatedAt?: string | Date
  vehicleFilters?: ExportVehicleFilters
}

interface ExportFlowDecisionsModalProps {
  isOpen: boolean
  onClose: () => void
  decisions: FlowDecisionRecord[]
}

type ExportFormat = 'json' | 'sql' | 'csv' | 'prisma'

export function ExportFlowDecisionsModal({ isOpen, onClose, decisions }: ExportFlowDecisionsModalProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('sql')
  const [includeMetadata, setIncludeMetadata] = useState(true)
  const [includeTimestamps, setIncludeTimestamps] = useState(true)

  if (!isOpen) return null

  const exportAsJSON = () => {
    const exportData = decisions.map(decision => ({
      id: decision.id,
      part_description: decision.partDescription,
      category: decision.flowDecision.category,
      subcategory: decision.flowDecision.subcategory,
      schema: decision.flowDecision.schema,
      lambda_target: decision.lambdaTarget,
      status: decision.status || 'approved',
      created_by: decision.createdBy || 'system',
      feedback_count: decision.feedbackCount || 0,
      confidence: decision.confidence || 0.9,
      is_default: decision.isDefault || false,
      ...(decision.vehicleFilters && {
        vehicle_year_from: decision.vehicleFilters.yearFrom || null,
        vehicle_year_to: decision.vehicleFilters.yearTo || null,
        vehicle_model: decision.vehicleFilters.model || null,
        vehicle_fuel_type: decision.vehicleFilters.fuelType || null,
        vehicle_engine_model: decision.vehicleFilters.engineModel || null,
        vin_pattern: decision.vehicleFilters.vinPattern || null
      }),
      ...(includeMetadata && {
        metadata: {
          source: decision.source || 'admin',
          feedbackType: decision.feedbackType || 'manual',
          vehicleFilters: decision.vehicleFilters || {}
        }
      }),
      ...(includeTimestamps && {
        created_at: decision.createdAt || new Date().toISOString(),
        updated_at: decision.updatedAt || new Date().toISOString()
      })
    }))

    const jsonData = JSON.stringify(exportData, null, 2)
    downloadFile(jsonData, 'application/json', `flow-decisions-${new Date().toISOString().split('T')[0]}.json`)
  }

  const exportAsSQL = () => {
    let sql = '-- Flow Decisions Export\n'
    sql += `-- Generated on ${new Date().toISOString()}\n`
    sql += `-- Total records: ${decisions.length}\n\n`
    
    sql += '-- Insert flow decisions\n'
    sql += 'INSERT INTO flow_decisions_v2 (id, part_description, category, subcategory, schema, lambda_target, status, created_by, feedback_count, confidence, is_default'
    
    if (decisions.some(d => d.vehicleFilters)) {
      sql += ', vehicle_year_from, vehicle_year_to, vehicle_model, vehicle_fuel_type, vehicle_engine_model, vin_pattern'
    }
    
    if (includeMetadata) {
      sql += ', metadata'
    }
    
    if (includeTimestamps) {
      sql += ', created_at, updated_at'
    }
    
    sql += ') VALUES\n'

    const values = decisions.map((decision, index) => {
      let valueStr = '('
      valueStr += `'${decision.id}', `
      valueStr += `'${escapeSql(decision.partDescription)}', `
      valueStr += `'${escapeSql(decision.flowDecision.category)}', `
      valueStr += `'${escapeSql(decision.flowDecision.subcategory)}', `
      valueStr += `'${escapeSql(decision.flowDecision.schema)}', `
      valueStr += `'${escapeSql(decision.lambdaTarget)}', `
      valueStr += `'${decision.status || 'approved'}', `
      valueStr += `'${decision.createdBy || 'system'}', `
      valueStr += `${decision.feedbackCount || 0}, `
      valueStr += `${decision.confidence || 0.9}, `
      valueStr += `${decision.isDefault ? 'TRUE' : 'FALSE'}`
      
      if (decisions.some(d => d.vehicleFilters)) {
        const vf = decision.vehicleFilters
        valueStr += `, ${vf?.yearFrom || 'NULL'}`
        valueStr += `, ${vf?.yearTo || 'NULL'}`
        valueStr += `, ${vf?.model ? `'${escapeSql(vf.model)}'` : 'NULL'}`
        valueStr += `, ${vf?.fuelType ? `'${escapeSql(vf.fuelType)}'` : 'NULL'}`
        valueStr += `, ${vf?.engineModel ? `'${escapeSql(vf.engineModel)}'` : 'NULL'}`
        valueStr += `, ${vf?.vinPattern ? `'${escapeSql(vf.vinPattern)}'` : 'NULL'}`
      }
      
      if (includeMetadata) {
        const metadata = {
          source: decision.source || 'admin',
          feedbackType: decision.feedbackType || 'manual',
          vehicleFilters: decision.vehicleFilters || {}
        }
        valueStr += `, '${JSON.stringify(metadata).replace(/'/g, "''")}'::jsonb`
      }
      
      if (includeTimestamps) {
        valueStr += `, '${decision.createdAt || new Date().toISOString()}'`
        valueStr += `, '${decision.updatedAt || new Date().toISOString()}'`
      }
      
      valueStr += ')'
      return valueStr
    }).join(',\n')

    sql += values
    sql += '\nON CONFLICT (id) DO UPDATE SET\n'
    sql += '  category = EXCLUDED.category,\n'
    sql += '  subcategory = EXCLUDED.subcategory,\n'
    sql += '  schema = EXCLUDED.schema,\n'
    sql += '  updated_at = CURRENT_TIMESTAMP;\n'

    downloadFile(sql, 'text/plain', `flow-decisions-${new Date().toISOString().split('T')[0]}.sql`)
  }

  const exportAsCSV = () => {
    const headers = [
      'id',
      'part_description',
      'category',
      'subcategory',
      'schema',
      'lambda_target',
      'status',
      'created_by',
      'feedback_count',
      'confidence',
      'is_default',
      'vehicle_year_from',
      'vehicle_year_to',
      'vehicle_model',
      'vehicle_fuel_type',
      'vehicle_engine_model',
      'vin_pattern'
    ]
    
    if (includeTimestamps) {
      headers.push('created_at', 'updated_at')
    }

    let csv = headers.join(',') + '\n'

    decisions.forEach(decision => {
      const vf = decision.vehicleFilters
      const row = [
        decision.id,
        csvCell(decision.partDescription),
        csvCell(decision.flowDecision.category),
        csvCell(decision.flowDecision.subcategory),
        csvCell(decision.flowDecision.schema),
        csvCell(decision.lambdaTarget),
        decision.status || 'approved',
        csvCell(decision.createdBy || 'system'),
        decision.feedbackCount || 0,
        decision.confidence || 0.9,
        decision.isDefault || false,
        vf?.yearFrom || '',
        vf?.yearTo || '',
        csvCell(vf?.model || ''),
        csvCell(vf?.fuelType || ''),
        csvCell(vf?.engineModel || ''),
        csvCell(vf?.vinPattern || '')
      ]
      
      if (includeTimestamps) {
        row.push(
          String(decision.createdAt || new Date().toISOString()),
          String(decision.updatedAt || new Date().toISOString())
        )
      }
      
      csv += row.join(',') + '\n'
    })

    downloadFile(csv, 'text/csv', `flow-decisions-${new Date().toISOString().split('T')[0]}.csv`)
  }

  const exportAsPrisma = () => {
    let prismaData = '// Prisma seed data for flow decisions\n'
    prismaData += `// Generated on ${new Date().toISOString()}\n\n`
    prismaData += 'const flowDecisions = [\n'
    
    const dataArray = decisions.map(decision => {
      const vf = decision.vehicleFilters
      return `  {
    id: '${decision.id}',
    partDescription: '${escapeSql(decision.partDescription)}',
    category: '${escapeSql(decision.flowDecision.category)}',
    subcategory: '${escapeSql(decision.flowDecision.subcategory)}',
    schema: '${escapeSql(decision.flowDecision.schema)}',
    lambdaTarget: '${escapeSql(decision.lambdaTarget)}',
    status: '${decision.status || 'approved'}',
    createdBy: '${decision.createdBy || 'system'}',
    feedbackCount: ${decision.feedbackCount || 0},
    confidence: ${decision.confidence || 0.9},
    isDefault: ${decision.isDefault || false},
    vehicleYearFrom: ${vf?.yearFrom || null},
    vehicleYearTo: ${vf?.yearTo || null},
    vehicleModel: ${vf?.model ? `'${escapeSql(vf.model)}'` : null},
    vehicleFuelType: ${vf?.fuelType ? `'${escapeSql(vf.fuelType)}'` : null},
    vehicleEngineModel: ${vf?.engineModel ? `'${escapeSql(vf.engineModel)}'` : null},
    vinPattern: ${vf?.vinPattern ? `'${escapeSql(vf.vinPattern)}'` : null},
    metadata: ${JSON.stringify({
      source: decision.source || 'admin',
      feedbackType: decision.feedbackType || 'manual',
      vehicleFilters: decision.vehicleFilters || {}
    }, null, 4).split('\n').map((line, i) => i === 0 ? line : '    ' + line).join('\n')}
  }`
    })
    
    prismaData += dataArray.join(',\n')
    prismaData += '\n]\n\n'
    prismaData += '// Usage in seed.ts:\n'
    prismaData += '// for (const fd of flowDecisions) {\n'
    prismaData += '//   await prisma.flowDecisionV2.upsert({\n'
    prismaData += '//     where: { id: fd.id },\n'
    prismaData += '//     update: fd,\n'
    prismaData += '//     create: fd\n'
    prismaData += '//   })\n'
    prismaData += '// }\n'

    downloadFile(prismaData, 'text/plain', `flow-decisions-seed-${new Date().toISOString().split('T')[0]}.ts`)
  }

  const handleExport = () => {
    switch (exportFormat) {
      case 'json':
        exportAsJSON()
        break
      case 'sql':
        exportAsSQL()
        break
      case 'csv':
        exportAsCSV()
        break
      case 'prisma':
        exportAsPrisma()
        break
    }
    onClose()
  }

  const escapeSql = (str: string) => {
    return str.replace(/'/g, "''")
  }

  // Quote + escape an arbitrary value for a CSV cell so embedded commas, quotes
  // and newlines can't break the column layout.
  const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const downloadFile = (content: string, mimeType: string, filename: string) => {
    // Prepend a UTF-8 BOM for CSV so Excel renders Hebrew/Chinese correctly
    // instead of mojibake, and pin the charset.
    const isCsv = mimeType.startsWith('text/csv')
    const blob = isCsv
      ? new Blob(['﻿', content], { type: 'text/csv;charset=utf-8' })
      : new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Export Flow Decisions
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Export Format
            </h3>
            <div className="space-y-2">
              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input
                  type="radio"
                  value="sql"
                  checked={exportFormat === 'sql'}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="mr-3"
                />
                <Database className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" />
                <div>
                  <div className="font-medium">SQL (PostgreSQL)</div>
                  <div className="text-sm text-gray-500">Direct database import with ON CONFLICT handling</div>
                </div>
              </label>

              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input
                  type="radio"
                  value="json"
                  checked={exportFormat === 'json'}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="mr-3"
                />
                <FileJson className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" />
                <div>
                  <div className="font-medium">JSON</div>
                  <div className="text-sm text-gray-500">Structured data for programmatic import</div>
                </div>
              </label>

              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input
                  type="radio"
                  value="csv"
                  checked={exportFormat === 'csv'}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="mr-3"
                />
                <Table className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" />
                <div>
                  <div className="font-medium">CSV</div>
                  <div className="text-sm text-gray-500">Spreadsheet compatible format</div>
                </div>
              </label>

              <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input
                  type="radio"
                  value="prisma"
                  checked={exportFormat === 'prisma'}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  className="mr-3"
                />
                <Code className="w-5 h-5 mr-2 text-gray-600 dark:text-gray-400" />
                <div>
                  <div className="font-medium">Prisma Seed</div>
                  <div className="text-sm text-gray-500">TypeScript seed file for Prisma</div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Export Options
            </h3>
            <div className="space-y-2">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={includeMetadata}
                  onChange={(e) => setIncludeMetadata(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Include metadata</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={includeTimestamps}
                  onChange={(e) => setIncludeTimestamps(e.target.checked)}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Include timestamps</span>
              </label>
            </div>
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400">
            <p>Exporting {decisions.length} flow decision{decisions.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-sp-sm p-sp-lg border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-sp-lg py-sp-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-sp-lg py-sp-sm text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg flex items-center gap-sp-sm min-h-[44px]"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>
    </div>
  )
}