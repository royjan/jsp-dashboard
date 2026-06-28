/**
 * Flow Decision Types (ported from jsp-chat-js for the integrated chat admin).
 *
 * Prisma's `JsonValue` is replaced with a local Json type since the dashboard
 * does not depend on Prisma.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

/**
 * FlowDecision for UI display — represents a single level in the flow chain
 */
export interface FlowDecision {
  id?: string
  level?: string
  name?: string
  confidence?: number
  reasoning?: string
  // Fields for storage/API
  partDescription?: string
  category?: string
  subcategory?: string
  schema?: string
  lambdaTarget?: string
}

/**
 * FlowDecisionPath — represents the full path (category/subcategory/schema)
 */
export interface FlowDecisionPath {
  category: string
  subcategory: string
  schema: string
}

/**
 * Vehicle filters used to scope flow decisions to specific vehicles
 */
export interface VehicleFilters {
  year?: string
  vinPattern?: string | null
  yearFrom?: number | null
  yearTo?: number | null
  model?: string | null
  fuelType?: string | null
  engineModel?: string | null
}

/**
 * Flow decision status enum
 */
export type FlowDecisionStatus = 'suggestion' | 'approved' | 'rejected'

/**
 * Metadata that can be attached to flow decisions
 */
export interface FlowDecisionMetadata {
  originalPartDescription?: string
  normalizedDescription?: string
  searchTermsUsed?: string[]
  vinUsed?: string
  vehicleInfo?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Full flow decision record as returned by the API (camelCase).
 */
export interface FlowDecisionRecord {
  id: string
  partDescription: string
  category: string
  subcategory: string
  schema: string
  lambdaTarget: string
  status: FlowDecisionStatus
  createdBy?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  feedbackCount: number
  isDefault: boolean
  metadata?: JsonValue | FlowDecisionMetadata | null

  // Vehicle filter fields
  vehicleYearFrom?: number | null
  vehicleYearTo?: number | null
  vehicleModel?: string | null
  vehicleFuelType?: string | null
  vehicleEngineModel?: string | null
  vinPattern?: string | null

  // Suggestion fields
  source?: string | null
  userIds?: string[]
  conversationIds?: string[]
  confidence?: number | null
  approvedAt?: Date | string | null
  approvedBy?: string | null
  rejectedAt?: Date | string | null
  rejectedBy?: string | null
  rejectionReason?: string | null

  // Computed/derived fields for UI
  flowDecision?: {
    category: string
    subcategory: string
    schema: string
  }
  vehicleFilters?: VehicleFilters

  // DirectPart relation (optional)
  directPart?: {
    id: string
    partId: string
    name: string
    imageUrl?: string | null
    price?: number | null
    currency: string
    supplier?: string | null
    inStock: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  } | null
}

/**
 * Input for creating a new flow decision
 */
export interface CreateFlowDecisionInput {
  partDescription: string
  flowDecision: {
    category: string
    subcategory: string
    schema: string
  }
  vehicleFilters?: VehicleFilters
  lambdaTarget?: string
  status?: FlowDecisionStatus
  metadata?: FlowDecisionMetadata
}

/**
 * Input for updating an existing flow decision
 */
export interface UpdateFlowDecisionInput {
  id: string
  partDescription?: string
  flowDecision?: {
    category: string
    subcategory: string
    schema: string
  }
  vehicleFilters?: VehicleFilters
  lambdaTarget?: string
  status?: FlowDecisionStatus
  metadata?: FlowDecisionMetadata
}

/**
 * Response from flow decision API endpoints
 */
export interface FlowDecisionResponse {
  items: FlowDecisionRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/**
 * Flow decision suggestion for review
 */
export interface FlowDecisionSuggestion extends FlowDecisionRecord {
  status: 'suggestion'
  source: string
  confidence: number
}
