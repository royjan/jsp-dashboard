import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

const PSA_BRANDS = ['PEUGEOT', 'CITROEN', 'CITROËN', 'OPEL', 'DS', 'DS AUTOMOBILES']

const PSA_VIN_PREFIXES = ['VF3', 'VR3', 'VF7', 'VR7', 'W0V', 'VXE', 'VSX', 'VXK', 'W0L', 'VR1']

function isPSABrand(make: string | undefined): boolean {
  if (!make) return false
  return PSA_BRANDS.some(b => make.toUpperCase().includes(b))
}

function isPSAVin(vin: string): boolean {
  if (!vin || vin.length < 3) return false
  const prefix = vin.toUpperCase().substring(0, 3)
  return PSA_VIN_PREFIXES.includes(prefix)
}

function detectInputType(input: string): 'vin' | 'plate' {
  const cleaned = input.replace(/[\s-]/g, '')
  // VIN is 17 alphanumeric characters
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(cleaned)) return 'vin'
  // Israeli license plate is 5-8 digits
  if (/^\d{5,8}$/.test(cleaned)) return 'plate'
  // Default to plate for short numeric-ish inputs
  return cleaned.length <= 8 ? 'plate' : 'vin'
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const input = searchParams.get('q')?.trim()

    if (!input) {
      return NextResponse.json({ error: 'Missing q parameter' }, { status: 400 })
    }

    const inputType = detectInputType(input)
    let vehicleInfo: any = null
    let vin: string = ''

    if (inputType === 'plate') {
      // Lookup by Israeli license plate via gov.il API
      const numericPlate = input.replace(/[^0-9]/g, '')
      const govParams = new URLSearchParams({
        resource_id: '053cea08-09bc-40ec-8f7a-156f0677aff3',
        q: numericPlate,
        limit: '1',
      })

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      try {
        const govResponse = await fetch(
          `https://data.gov.il/api/3/action/datastore_search?${govParams}`,
          { signal: controller.signal }
        )
        clearTimeout(timeoutId)

        if (govResponse.ok) {
          const govData = await govResponse.json()
          if (govData?.success && govData?.result?.records?.length > 0) {
            const record = govData.result.records[0]
            vin = record.vin || record.misgeret || ''
            vehicleInfo = {
              vin,
              licensePlate: numericPlate,
              manufacturer: record.tozeret_nm || '',
              model: record.kinuy_mishari || '',
              year: parseInt(record.shnat_yitzur || '0', 10) || null,
              fuelType: record.sug_delek_nm || '',
              color: record.tseva_rechev || '',
              trim: record.ramat_gimur || '',
            }
          }
        }
      } catch {
        clearTimeout(timeoutId)
      }

      // If gov API failed, try car_records table
      if (!vehicleInfo) {
        try {
          const dbResult = await query(
            `SELECT vin, license_plate, year_of_manufacture, fuel_type, model_name, engine_model, trade_name, country_brand
             FROM car_records
             WHERE license_plate = $1 OR license_plate = $2
             LIMIT 1`,
            [input, numericPlate]
          )
          if (dbResult.rows.length > 0) {
            const r = dbResult.rows[0]
            vin = r.vin || ''
            vehicleInfo = {
              vin,
              licensePlate: r.license_plate,
              manufacturer: r.country_brand || '',
              model: r.trade_name || r.model_name || '',
              year: r.year_of_manufacture || null,
              fuelType: r.fuel_type || '',
              color: '',
              trim: '',
            }
          }
        } catch {
          // DB not available, continue
        }
      }
    } else {
      // Direct VIN lookup
      vin = input.toUpperCase()

      // Try car_records first
      try {
        const dbResult = await query(
          `SELECT vin, license_plate, year_of_manufacture, fuel_type, model_name, engine_model, trade_name, country_brand
           FROM car_records
           WHERE vin = $1
           LIMIT 1`,
          [vin]
        )
        if (dbResult.rows.length > 0) {
          const r = dbResult.rows[0]
          vehicleInfo = {
            vin: r.vin,
            licensePlate: r.license_plate || '',
            manufacturer: r.country_brand || '',
            model: r.trade_name || r.model_name || '',
            year: r.year_of_manufacture || null,
            fuelType: r.fuel_type || '',
            color: '',
            trim: '',
          }
        }
      } catch {
        // DB not available
      }

      // Fallback: decode from VIN prefix
      if (!vehicleInfo) {
        const wmiMap: Record<string, string> = {
          VF3: 'PEUGEOT', VR3: 'PEUGEOT',
          VF7: 'CITROEN', VR7: 'CITROEN',
          W0L: 'OPEL', W0V: 'OPEL',
          VR1: 'DS',
        }
        const prefix = vin.substring(0, 3)
        vehicleInfo = {
          vin,
          licensePlate: '',
          manufacturer: wmiMap[prefix] || '',
          model: '',
          year: null,
          fuelType: '',
          color: '',
          trim: '',
        }
      }
    }

    if (!vehicleInfo || !vehicleInfo.vin) {
      return NextResponse.json({
        success: false,
        error: 'Vehicle not found',
      }, { status: 404 })
    }

    // Determine if PSA vehicle
    const isPSA = isPSABrand(vehicleInfo.manufacturer) || isPSAVin(vehicleInfo.vin)

    // If PSA, query partly's catalog for available categories
    let catalogData: any = null
    if (isPSA && vehicleInfo.vin) {
      try {
        // Find project by VIN in partly schema
        const projectResult = await query(
          `SELECT p.id, p.name, p.vin, p.make, p.model, p.year
           FROM partly.projects p
           WHERE p.vin = $1
           LIMIT 1`,
          [vehicleInfo.vin]
        )

        if (projectResult.rows.length > 0) {
          const project = projectResult.rows[0]

          // Get categories with counts
          const catResult = await query(
            `SELECT c.id, c.code, c.name, COUNT(DISTINCT sc.id) as subcategory_count
             FROM partly.categories c
             LEFT JOIN partly.subcategories sc ON sc.category_id = c.id
             WHERE c.project_id = $1
             GROUP BY c.id, c.code, c.name
             ORDER BY c.code`,
            [project.id]
          )

          catalogData = {
            projectId: project.id,
            projectName: project.name,
            categories: catResult.rows.map((c: any) => ({
              id: c.id,
              code: c.code,
              name: c.name,
              subcategoryCount: parseInt(c.subcategory_count || '0'),
            })),
          }
        }
      } catch (e) {
        console.error('[VIN Catalog] Error querying partly schema:', e)
      }
    }

    return NextResponse.json({
      success: true,
      vehicle: vehicleInfo,
      isPSA,
      catalog: catalogData,
    })
  } catch (error) {
    console.error('[VIN Catalog] Lookup error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lookup failed' },
      { status: 500 }
    )
  }
}
