/**
 * DirectPart type definitions (ported from jsp-chat-js).
 * Prisma's `Decimal` is replaced with `number` since the dashboard has no Prisma.
 */

export interface DirectPart {
  id: string
  flowDecisionId: string
  partId: string
  name: string
  imageUrl?: string | null
  price?: number | null
  currency: string
  supplier?: string | null
  inStock: boolean
  createdAt: Date
  updatedAt: Date
}

export interface DirectPartInfo {
  partId: string
  name: string
  imageUrl?: string
  price?: number
  currency?: string
  supplier?: string
  inStock?: boolean
}

export interface CreateDirectPartData {
  flowDecisionId: string
  partId: string
  name: string
  imageUrl?: string
  price?: number
  currency?: string
  supplier?: string
  inStock?: boolean
}

export interface UpdateDirectPartData {
  partId?: string
  name?: string
  imageUrl?: string | null
  price?: number | null
  currency?: string
  supplier?: string | null
  inStock?: boolean
}

export interface FlowDecisionWithDirectPart {
  id: string
  partDescription: string
  category: string
  subcategory: string
  schema: string
  lambdaTarget: string
  directPart: DirectPart | null
}

export interface DirectPartMatch {
  partDescription: string
  flowDecision: {
    category: string
    subcategory: string
    schema: string
  }
  directPart: {
    partId: string
    name: string
    imageUrl?: string | null
    price?: number | null
    currency: string
    supplier?: string | null
    inStock: boolean
  }
}
