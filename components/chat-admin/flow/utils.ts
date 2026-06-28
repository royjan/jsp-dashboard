import { FlowDecisionRecord } from '@/types/chat-admin/flow-decision';
import { FLOW_DECISION_STATUS, TabType, TAB_TYPES } from './constants';

export function filterFlowDecisionsByTab(
  flowDecisions: FlowDecisionRecord[],
  tab: TabType
): FlowDecisionRecord[] {
  // Ensure flowDecisions is an array
  const decisions = Array.isArray(flowDecisions) ? flowDecisions : [];
  
  switch (tab) {
    case TAB_TYPES.APPROVED:
      return decisions.filter(fd => fd.status === FLOW_DECISION_STATUS.APPROVED || !fd.status);
    case TAB_TYPES.REJECTED:
      return decisions.filter(fd => fd.status === FLOW_DECISION_STATUS.REJECTED);
    default:
      return decisions;
  }
}

export function filterFlowDecisionsBySearch(
  flowDecisions: FlowDecisionRecord[],
  searchQuery: string
): FlowDecisionRecord[] {
  // Ensure flowDecisions is an array
  const decisions = Array.isArray(flowDecisions) ? flowDecisions : [];

  if (!searchQuery.trim()) return decisions;

  const query = searchQuery.toLowerCase().trim();
  return decisions.filter(fd => {
    // Search by flow decision ID
    if (fd.id.toLowerCase().includes(query)) return true;

    // Search in part description
    if (fd.partDescription.toLowerCase().includes(query)) return true;

    // Search in vehicle filters
    if (fd.vehicleFilters) {
      const filters = fd.vehicleFilters;
      if (filters.vinPattern?.toLowerCase().includes(query)) return true;
      if (filters.model?.toLowerCase().includes(query)) return true;
      if (filters.fuelType?.toLowerCase().includes(query)) return true;
      if (filters.engineModel?.toLowerCase().includes(query)) return true;
    }

    return false;
  });
}

export function calculateAnalytics(flowDecisions: FlowDecisionRecord[]) {
  // Ensure flowDecisions is an array
  const decisions = Array.isArray(flowDecisions) ? flowDecisions : [];
  
  const total = decisions.length;
  const approved = decisions.filter(fd => fd.status === FLOW_DECISION_STATUS.APPROVED || !fd.status).length;
  const rejected = decisions.filter(fd => fd.status === FLOW_DECISION_STATUS.REJECTED).length;
  const autoLearned = decisions.filter(fd => !fd.createdBy || fd.createdBy === 'system').length;
  const manual = decisions.filter(fd => fd.createdBy && fd.createdBy !== 'system').length;
  const withHighFeedback = decisions.filter(fd => fd.feedbackCount >= 5).length;

  return { total, approved, rejected, autoLearned, manual, withHighFeedback };
}

export function isDuplicateFlowDecision(
  flowDecisions: FlowDecisionRecord[],
  partDescription: string,
  vehicleFilters?: any,
  lambdaTarget?: string,
  excludeId?: string
): boolean {
  if (!partDescription) return false;

  // Ensure flowDecisions is an array
  const decisions = Array.isArray(flowDecisions) ? flowDecisions : [];

  return decisions.some(flow => {
    // Skip the flow decision being edited/approved (by ID) - you can't be a duplicate of yourself
    if (excludeId && flow.id === excludeId) {
      return false;
    }

    if (flow.partDescription?.toLowerCase() !== partDescription.toLowerCase()) {
      return false;
    }

    // Check if lambdaTarget matches (critical for uniqueness constraint)
    if (lambdaTarget && flow.lambdaTarget !== lambdaTarget) {
      return false;
    }

    // Check if filters match
    if (!vehicleFilters && !flow.vehicleFilters) return true;
    if (!vehicleFilters || !flow.vehicleFilters) return false;

    // Compare filters (all 6 fields match the Prisma unique constraint)
    return (
      flow.vehicleFilters.vinPattern === vehicleFilters.vinPattern &&
      flow.vehicleFilters.yearFrom === vehicleFilters.yearFrom &&
      flow.vehicleFilters.yearTo === vehicleFilters.yearTo &&
      flow.vehicleFilters.model === vehicleFilters.model &&
      flow.vehicleFilters.fuelType === vehicleFilters.fuelType &&
      flow.vehicleFilters.engineModel === vehicleFilters.engineModel
    );
  });
}