export const FLOW_DECISION_STATUS = {
  SUGGESTION: 'suggestion',
  APPROVED: 'approved',
  REJECTED: 'rejected'
} as const;

export type FlowDecisionStatus = typeof FLOW_DECISION_STATUS[keyof typeof FLOW_DECISION_STATUS];

export const TAB_TYPES = {
  OVERVIEW: 'overview',
  TREE_VIEW: 'tree_view',
  BUILDER: 'builder',
  SUGGESTIONS: 'suggestions',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  ALL: 'all',
} as const;

export type TabType = typeof TAB_TYPES[keyof typeof TAB_TYPES];

export const ITEMS_PER_PAGE = 12;

export const CATEGORY_EXAMPLES = ['Engine', 'Body', 'Electrical', 'Transmission', 'Brakes', 'Suspension'];
export const SUBCATEGORY_EXAMPLES = ['Filters', 'Fluids', 'Sensors', 'Belts', 'Cooling', 'Ignition'];
export const SCHEMA_EXAMPLES = ['schema_001', 'schema_002', 'schema_003', 'schema_004'];

export const STATUS_STYLES = {
  [FLOW_DECISION_STATUS.SUGGESTION]: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  [FLOW_DECISION_STATUS.APPROVED]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  [FLOW_DECISION_STATUS.REJECTED]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
} as const;