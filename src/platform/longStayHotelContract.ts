/**
 * Long Stay Hotel domain contract.
 *
 * Design-only types for the Long Stay UX sprint. This module deliberately has
 * no repository calls, persistence implementation, RPC names, or SQL schema.
 * Existing Hotel Stay, Capacity, Allocation, Finance, and Family Booking
 * contracts remain the source of truth for their respective responsibilities.
 */

export type LongStayContractStatus =
  | "pending"
  | "active"
  | "completed"
  | "cancelled";

export type LongStayRoomTypeCode = "STANDARD" | "DELUXE";
export type LongStayTerminationKind = "scheduled" | "early_termination";
export type LongStayAbsenceRoomPolicy = "retain";
export type LongStayProrationPolicy = "fixed_monthly" | "daily_prorated";
export type LongStayPaymentMethod = "card" | "transfer" | "cash" | "other";
export type LongStayMonthlyOccupancyStatus =
  | "confirmed"
  | "cancelled";
export type LongStayMonthlyOccupancyViewState =
  | "unassigned"
  | "upcoming"
  | "active"
  | "completed"
  | "cancelled"
  | "overstay";

export type LongStayOperationKind =
  | "create_contract"
  | "activate_contract"
  | "confirm_monthly_room"
  | "move_room_same_type"
  | "change_room_type_before_check_in"
  | "change_room_type_after_check_in"
  | "update_planned_checkout"
  | "start_absence"
  | "complete_absence"
  | "complete_check_out"
  | "cancel_contract";

export interface LongStayContractDraft {
  customerId: string;
  dogId: string;
  startsOn: string;
  plannedCheckOutDate: string | null;
  preferredRoomTypeId: string;
  preferredRoomTypeCode: LongStayRoomTypeCode;
  preferredRoomId: string | null;
  monthlyRate: number;
  billingDay: number;
  firstBillingDate: string;
  depositAmount: number | null;
  discountAmount: number | null;
  firstMonthPolicy: LongStayProrationPolicy;
  lastMonthPolicy: LongStayProrationPolicy;
  defaultPaymentMethod: LongStayPaymentMethod | null;
  memo: string | null;
}

export interface LongStayContractCreateInput
  extends Omit<
    LongStayContractDraft,
    "preferredRoomTypeId" | "preferredRoomTypeCode"
  > {
  preferredRoomTypeId: string | null;
  preferredRoomTypeCode: LongStayRoomTypeCode | null;
}

export interface LongStayContract extends LongStayContractCreateInput {
  id: string;
  status: LongStayContractStatus;
  version: number;
  hotelStayId: string | null;
  requestId: string;
  latestAssignedMonth: string | null;
  nextBillingDate: string | null;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
}

export interface LongStayContractStatusTransition {
  contractId: string;
  from: LongStayContractStatus;
  to: LongStayContractStatus;
  expectedVersion: number;
  effectiveAt: string;
  reason: string;
  requestId: string;
}

export type LongStayBillingCycleStatus =
  | "planned"
  | "issued"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "voided";

export interface LongStayBillingPolicySnapshot {
  monthlyRate: number;
  billingDay: number;
  firstMonthPolicy: LongStayProrationPolicy;
  lastMonthPolicy: LongStayProrationPolicy;
  discountAmount: number;
  defaultPaymentMethod: LongStayPaymentMethod | null;
}

export interface LongStayBillingCycle {
  id: string;
  contractId: string;
  cycleKey: string;
  serviceFrom: string;
  serviceUntil: string;
  dueOn: string;
  policySnapshot: LongStayBillingPolicySnapshot;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  status: LongStayBillingCycleStatus;
  saleId: string | null;
  paymentGroupId: string | null;
}

export type LongStayAbsenceStatus =
  | "scheduled"
  | "away"
  | "returned"
  | "cancelled";

export interface LongStayAbsence {
  id: string;
  contractId: string;
  hotelStayId: string;
  leavesAt: string;
  expectedReturnAt: string;
  returnedAt: string | null;
  roomPolicy: LongStayAbsenceRoomPolicy;
  billingContinues: boolean;
  status: LongStayAbsenceStatus;
  reason: string | null;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface LongStayMonthlyOccupancy {
  id: string;
  contractId: string;
  hotelStayId: string;
  calendarMonth: string;
  plannedOccupiedFrom: string;
  plannedOccupiedUntilExclusive: string;
  roomTypeId: string;
  roomTypeCode: LongStayRoomTypeCode;
  capacityReservationId: string;
  status: LongStayMonthlyOccupancyStatus;
  version: number;
  requestId: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface LongStayMonthlyOccupancyAllocationReference {
  monthlyOccupancyId: string;
  capacityReservationId: string;
  roomAllocationId: string;
  roomId: string;
  roomName: string;
  allocatedFrom: string;
  allocatedUntil: string;
}

export interface LongStayMonthlyAssignmentCandidate {
  contractId: string;
  dogId: string;
  dogName: string;
  calendarMonth: string;
  occupancyFrom: string;
  occupancyUntilExclusive: string;
  plannedCheckOutDate: string | null;
  previousRoomId: string | null;
  previousRoomName: string | null;
  previousRoomTypeCode: LongStayRoomTypeCode | null;
  recommendedRoomId: string | null;
  recommendationReason: "previous_room" | "same_type_empty" | null;
}

export interface LongStayMonthlyOccupancyProjection {
  contractId: string;
  hotelStayId: string | null;
  calendarMonth: string;
  viewState: LongStayMonthlyOccupancyViewState;
  occupancy: LongStayMonthlyOccupancy | null;
  allocations: readonly LongStayMonthlyOccupancyAllocationReference[];
  plannedCheckOutDate: string | null;
  checkedOutAt: string | null;
  overstayAlert: boolean;
  runtimeHeldUntilExclusive: string | null;
}

export interface LongStayOperationAuditEvent {
  id: string;
  contractId: string;
  monthlyOccupancyId: string | null;
  absenceId: string | null;
  operationKind: LongStayOperationKind;
  requestId: string;
  canonicalPayloadHash: string;
  beforeState: Readonly<Record<string, unknown>> | null;
  afterState: Readonly<Record<string, unknown>>;
  linkedHotelRequestIds: readonly string[];
  changedBy: string;
  changeReason: string;
  createdAt: string;
}

export interface LongStayReplayContract {
  operationKind: LongStayOperationKind;
  requestId: string;
  canonicalPayloadHash: string;
  contractId: string | null;
}

export interface LongStayVersionContract {
  expectedContractVersion: number;
  expectedHotelStayVersion: number | null;
  expectedMonthlyOccupancyVersion: number | null;
}

export interface ConfirmLongStayMonthlyRoomCommand
  extends LongStayVersionContract {
  contractId: string;
  calendarMonth: string;
  roomTypeId: string;
  roomId: string;
  reason: string;
  requestId: string;
}

export interface UpdateLongStayPlannedCheckoutCommand
  extends LongStayVersionContract {
  contractId: string;
  plannedCheckOutDate: string | null;
  reason: string;
  requestId: string;
}

export interface CompleteLongStayCheckoutCommand
  extends LongStayVersionContract {
  contractId: string;
  completedAt: string;
  reason: string;
  requestId: string;
}

export interface LongStayTerminationDraft {
  contractId: string;
  kind: LongStayTerminationKind;
  plannedCheckoutAt: string;
  finalBillingPolicy: LongStayProrationPolicy;
  reason: string;
}

export interface LongStayRoomBoardPresentation {
  contractId: string;
  hotelStayId: string;
  dogName: string;
  roomName: string;
  roomTypeCode: LongStayRoomTypeCode;
  stayDayCount: number;
  contractStatus: LongStayContractStatus;
  monthlyOccupancyStatus: LongStayMonthlyOccupancyViewState;
  plannedCheckOutDate: string | null;
  nextBillingDate: string | null;
  absenceStatus: LongStayAbsenceStatus | null;
}

export interface LongStayRoomRecommendation {
  roomId: string;
  roomName: string;
  roomTypeId: string;
  roomTypeCode: LongStayRoomTypeCode;
  reason: "previous_room" | "preferred_room" | "same_type_candidate";
  availabilityConfirmed: false;
}

export interface LongStayRoomBoardContext {
  businessDate: string;
  contracts: readonly LongStayRoomBoardPresentation[];
  unassigned: readonly LongStayMonthlyAssignmentCandidate[];
  recommendations: Readonly<
    Record<string, readonly LongStayRoomRecommendation[]>
  >;
  generatedAt: string;
}

export interface LongStayCustomerSummary {
  contractId: string;
  dogId: string;
  dogName: string;
  roomLabel: string;
  stayDayCount: number;
  status: LongStayContractStatus;
  nextBillingDate: string | null;
}

/** Public RPC read projection. Runtime infinity values are intentionally null. */
export interface LongStayContractProjection {
  id: string;
  customerId: string;
  customerName: string | null;
  dogId: string;
  dogName: string | null;
  storedStatus: LongStayContractStatus;
  derivedStatus: LongStayContractStatus | "overstay";
  startedOn: string;
  plannedCheckOutDate: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  hotelStayId: string | null;
  version: number;
  isOpenEnded: boolean;
  runtimeCapacityUntil: null;
  runtimeAllocationUntil: null;
  currentRoom: {
    id: string;
    name: string;
    roomTypeId: string;
  } | null;
  isAway: boolean;
  replayed?: boolean;
  monthlyOccupancyId?: string;
}

export type LongStayMonthState =
  | "unassigned"
  | "cancelled"
  | "upcoming"
  | "completed"
  | "active";

export interface LongStayMonthOccupancyProjection {
  id: string;
  status: LongStayMonthlyOccupancyStatus;
  roomTypeId: string;
  roomId: string;
  plannedOccupiedFrom: string;
  plannedOccupiedUntilExclusive: string;
  /** Preserved for the future Finance boundary; it is not a payment id. */
  billingSourceId: string;
}

export interface LongStayMonthContractProjection
  extends LongStayContractProjection {
  monthlyOccupancy: LongStayMonthOccupancyProjection | null;
  monthlyState: LongStayMonthState;
}

export interface LongStayMonthProjection {
  serviceMonth: string;
  contracts: LongStayMonthContractProjection[];
}

export type LongStayRoomConflictSource =
  | "hotel"
  | "shared_room"
  | "long_stay"
  | "daycare"
  | "other";

export type LongStayRoomConflictPhase =
  | "current"
  | "future"
  | "effective_start_overlap"
  | "effective_period_history";

export interface LongStayRoomAvailability {
  roomId: string;
  roomName: string;
  roomTypeId: string;
  roomTypeCode: string;
  roomTypeName: string;
  assignable: boolean;
  nextConflictFrom: string | null;
  nextConflictUntil: string | null;
  conflictSource: LongStayRoomConflictSource | null;
  conflictPhase: LongStayRoomConflictPhase | null;
  reason: string;
}

export interface LongStayRoomAvailabilityProjection {
  contractId: string;
  serviceMonth: string;
  availabilityFrom: string;
  isOpenEnded: true;
  rooms: LongStayRoomAvailability[];
}

export interface GetLongStayRoomAvailabilityInput {
  contractId: string;
  serviceMonth: string;
  checkInTime: string | null;
  checkInTimeUnspecified: boolean;
}

export interface CreateLongStayContractInput {
  customerId: string;
  dogId: string;
  startedOn: string;
  plannedCheckOutDate: string | null;
  preferredRoomTypeId: string | null;
  preferredRoomId: string | null;
  monthlyRate: number;
  billingAnchorDay: number;
  memo: string;
}

export interface ConfirmLongStayMonthInput {
  contractId: string;
  expectedContractVersion: number;
  serviceMonth: string;
  calendarId: string;
  scheduleTypeId: string;
  checkInTime: string | null;
  checkInTimeUnspecified: boolean;
  roomTypeId: string;
  roomId: string;
  assigneeIds: string[];
  reason: string;
}

export interface CompleteLongStayCheckInInput {
  contractId: string;
  expectedContractVersion: number;
  expectedStayVersion: number;
  completedAt: string;
  reason: string;
}

export interface StartLongStayAbsenceInput {
  contractId: string;
  expectedContractVersion: number;
  leftAt: string;
  expectedReturnAt: string | null;
  memo: string;
  reason: string;
}

export interface CompleteLongStayAbsenceInput {
  contractId: string;
  expectedContractVersion: number;
  returnedAt: string;
  memo: string;
  reason: string;
}

export interface SetLongStayPlannedCheckoutInput {
  contractId: string;
  expectedContractVersion: number;
  plannedCheckOutDate: string | null;
  calendarId: string;
  scheduleTypeId: string;
  checkOutTime: string | null;
  timeUnspecified: boolean;
  assigneeIds: string[];
  reason: string;
}

export interface CompleteLongStayCheckOutInput {
  contractId: string;
  expectedContractVersion: number;
  expectedStayVersion: number;
  completedAt: string;
  reason: string;
}

export interface ReverseLongStayCompletionInput {
  contractId: string;
  expectedContractVersion: number;
  expectedStayVersion: number;
  reason: string;
}

export interface LongStayFamilyBookingReference {
  familyBookingId: string;
  familyBookingMemberId: string;
  longStayContractId: string;
  dogId: string;
}

export interface LongStayFinanceReference {
  longStayContractId: string;
  billingCycleId: string;
  saleId: string | null;
  paymentGroupId: string | null;
}

export interface LongStayContractValidatorContract {
  validateDraft(draft: LongStayContractDraft): readonly string[];
  validateCreateInput(input: LongStayContractCreateInput): readonly string[];
  validateTransition(
    transition: LongStayContractStatusTransition,
  ): readonly string[];
  validateAbsence(absence: LongStayAbsence): readonly string[];
  validateTermination(termination: LongStayTerminationDraft): readonly string[];
}

export type LongStayValidatorSource =
  | "customers"
  | "dogs"
  | "long_stay_contracts"
  | "long_stay_monthly_occupancies"
  | "long_stay_absences"
  | "hotel_stays"
  | "hotel_room_types"
  | "hotel_rooms"
  | "hotel_capacity_reservations"
  | "hotel_room_allocations"
  | "operation_memberships"
  | "long_stay_operation_audit_events";

export interface LongStayValidatorDefinition {
  code: string;
  sourceOfTruth: readonly LongStayValidatorSource[];
  failureSqlState: "22023" | "23505" | "23514" | "23P01" | "40001" | "PT409" | "42501" | "P0002";
  mutationMustNotHaveStarted: boolean;
}

export interface LongStayContractAggregate {
  contract: LongStayContract;
  monthlyOccupancies: readonly LongStayMonthlyOccupancy[];
  allocations: readonly LongStayMonthlyOccupancyAllocationReference[];
  absences: readonly LongStayAbsence[];
  hotelStay: Readonly<Record<string, unknown>> | null;
  derivedState: {
    overstay: boolean;
    away: boolean;
    selectedMonthUnassigned: boolean;
  };
}

export interface LongStayReadRepositoryContract {
  getContract(contractId: string): Promise<LongStayContractAggregate>;
  getCustomerContracts(customerId: string): Promise<readonly LongStayContractAggregate[]>;
  getRoomBoardContext(businessDate: string): Promise<LongStayRoomBoardContext>;
}
