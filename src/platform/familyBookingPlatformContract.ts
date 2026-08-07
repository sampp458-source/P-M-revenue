/**
 * Family Booking Platform contract.
 *
 * This module intentionally contains types only. It does not create records,
 * call RPCs, validate at runtime, or define a database schema.
 */

export type FamilyBookingStatus =
  | "draft"
  | "pending"
  | "active"
  | "partially_completed"
  | "completed"
  | "partially_cancelled"
  | "cancelled";

export type FamilyBookingMemberStatus =
  | "draft"
  | "pending"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled";

export type SharedRoomGroupStatus =
  | "requested"
  | "allocated"
  | "released"
  | "cancelled";

export type FamilyBookingServiceType = "hotel" | "training" | "daycare";
export type FamilyBookingRoomTypeCode = "STANDARD" | "DELUXE";

export interface FamilyBookingAggregate {
  id: string;
  customerId: string;
  status: FamilyBookingStatus;
  version: number;
  commonRequest?: string;
  commonMemo?: string;
  paymentBundleRequested: boolean;
  discountPolicyCode?: string;
  members: readonly FamilyBookingMember[];
  sharedRoomGroups: readonly SharedRoomGroup[];
}

export interface FamilyBookingDraft {
  customerId: string;
  commonRequest?: string;
  commonMemo?: string;
  paymentBundleRequested: boolean;
  discountPolicyCode?: string;
  members: readonly FamilyBookingMemberDraft[];
  sharedRoomGroups: readonly SharedRoomGroupDraft[];
}

export type FamilyBookingMemberDraft =
  | HotelBookingMemberDraft
  | TrainingBookingMemberDraft
  | DaycareBookingMemberDraft;

interface BaseFamilyBookingMemberDraft {
  clientMemberKey: string;
  dogId: string;
  assigneeIds: readonly string[];
  memo?: string;
}

export interface HotelBookingMemberDraft
  extends BaseFamilyBookingMemberDraft {
  serviceType: "hotel";
  calendarId: string;
  scheduleTypeId: string;
  checkInDate: string;
  checkOutDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInTimeUnspecified: boolean;
  checkOutTimeUnspecified: boolean;
  roomTypeId: string | null;
  roomTypeCode: FamilyBookingRoomTypeCode | null;
  roomTypeUnspecified: boolean;
  sharedRoomGroupKey: string | null;
}

interface OperationScheduleMemberDraft
  extends BaseFamilyBookingMemberDraft {
  calendarId: string;
  scheduleTypeId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeUnspecified: boolean;
}

export interface TrainingBookingMemberDraft
  extends OperationScheduleMemberDraft {
  serviceType: "training";
}

export interface DaycareBookingMemberDraft
  extends OperationScheduleMemberDraft {
  serviceType: "daycare";
}

export type FamilyBookingMember =
  | HotelFamilyBookingMember
  | TrainingFamilyBookingMember
  | DaycareFamilyBookingMember;

interface BaseFamilyBookingMember {
  id: string;
  familyBookingId: string;
  dogId: string;
  status: FamilyBookingMemberStatus;
  version: number;
  sortOrder: number;
  sharedRoomGroupId: string | null;
}

export interface HotelFamilyBookingMember extends BaseFamilyBookingMember {
  serviceType: "hotel";
  hotelStayId: string;
  operationScheduleId: null;
}

export interface TrainingFamilyBookingMember
  extends BaseFamilyBookingMember {
  serviceType: "training";
  hotelStayId: null;
  operationScheduleId: string;
}

export interface DaycareFamilyBookingMember extends BaseFamilyBookingMember {
  serviceType: "daycare";
  hotelStayId: null;
  operationScheduleId: string;
}

export interface SharedRoomGroupDraft {
  clientGroupKey: string;
  leaderClientMemberKey: string;
  memberClientKeys: readonly string[];
  roomTypeId: string;
  roomTypeCode: "DELUXE";
  normalizedStartsAt: string;
  normalizedEndsAt: string;
}

export interface SharedRoomGroup {
  id: string;
  familyBookingId: string;
  leaderMemberId: string;
  leaderDogId: string;
  memberIds: readonly string[];
  memberDogIds: readonly string[];
  roomTypeId: string;
  roomTypeCode: "DELUXE";
  normalizedStartsAt: string;
  normalizedEndsAt: string;
  requestedCapacity: number;
  status: SharedRoomGroupStatus;
  version: number;
}

export type FamilyBookingValidationCode =
  | "CUSTOMER_REQUIRED"
  | "CUSTOMER_INACTIVE"
  | "DOG_NOT_FOUND"
  | "DOG_INACTIVE"
  | "DOG_CUSTOMER_MISMATCH"
  | "DUPLICATE_DOG"
  | "DUPLICATE_SERVICE_MEMBER"
  | "INVALID_DATE_RANGE"
  | "INVALID_TIME_RANGE"
  | "ASSIGNEE_REQUIRED"
  | "ASSIGNEE_INACTIVE"
  | "SHARED_ROOM_MEMBER_NOT_HOTEL"
  | "SHARED_ROOM_CUSTOMER_MISMATCH"
  | "SHARED_ROOM_BOOKING_MISMATCH"
  | "SHARED_ROOM_STANDARD_FORBIDDEN"
  | "SHARED_ROOM_DELUXE_REQUIRED"
  | "SHARED_ROOM_PERIOD_MISMATCH"
  | "SHARED_ROOM_CAPACITY_EXCEEDED"
  | "PAYMENT_GROUP_OVERLAP"
  | "PAYMENT_MEMBER_NOT_IN_BOOKING";

export interface FamilyBookingValidationIssue {
  code: FamilyBookingValidationCode;
  message: string;
  memberKey?: string;
  groupKey?: string;
  field?: string;
}

export interface FamilyBookingCapacityPolicy {
  roomTypeId: string;
  roomTypeCode: FamilyBookingRoomTypeCode;
  occupancyCapacity: number;
  sharedOccupancySupported: boolean;
}

export interface FamilyBookingPaymentPolicy {
  paymentGroupId?: string;
  includedMemberIds: readonly string[];
  allowMemberInMultipleActiveGroups: false;
}

export interface FamilyBookingValidationContext {
  customer: {
    id: string;
    isActive: boolean;
  } | null;
  dogs: ReadonlyMap<
    string,
    { id: string; customerId: string | null; isActive: boolean }
  >;
  activeAssigneeIds: ReadonlySet<string>;
  roomCapacityPolicies: ReadonlyMap<string, FamilyBookingCapacityPolicy>;
  paymentPolicies: readonly FamilyBookingPaymentPolicy[];
}

export interface FamilyBookingValidatorContract {
  validateDraft(
    draft: FamilyBookingDraft,
    context: FamilyBookingValidationContext,
  ): readonly FamilyBookingValidationIssue[];
  validateTransition(
    transition: FamilyBookingStatusTransition,
  ): readonly FamilyBookingValidationIssue[];
  validateMemberTransition(
    transition: FamilyBookingMemberStatusTransition,
  ): readonly FamilyBookingValidationIssue[];
}

export interface FamilyBookingStatusTransition {
  familyBookingId: string;
  from: FamilyBookingStatus;
  to: FamilyBookingStatus;
  expectedVersion: number;
}

export interface FamilyBookingMemberStatusTransition {
  familyBookingId: string;
  memberId: string;
  from: FamilyBookingMemberStatus;
  to: FamilyBookingMemberStatus;
  expectedMemberVersion: number;
  expectedServiceVersion: number;
}

export type FamilyBookingAtomicStrategy =
  | "existing_rpc_orchestrator"
  | "internal_helper"
  | "service_adapter_rpc"
  | "aggregate_rpc";

export interface FamilyBookingReplayContract {
  requestId: string;
  action: "create" | "update" | "cancel" | "member_update" | "member_cancel";
  familyBookingId?: string;
  canonicalPayloadFingerprint: string;
  replayOnlyWhenFingerprintMatches: true;
  rootOwnsRequestId: true;
  membersOwnRequestId: false;
}

export type FamilyBookingAuditScope =
  | "family_booking_root"
  | "family_booking_member"
  | "service_record"
  | "room_allocation"
  | "payment";

export interface FamilyBookingAuditContract {
  scope: FamilyBookingAuditScope;
  aggregateId: string;
  entityId: string;
  actorId: string;
  reason: string;
  requestId: string | null;
  rootRequestIdRecordedExactlyOnce: boolean;
}

export interface FamilyBookingPaymentIntent {
  familyBookingId: string;
  includedMemberIds: readonly string[];
  discountPolicyCode?: string;
}

export interface FamilyBookingPaymentLink {
  familyBookingId: string;
  paymentGroupId: string;
  includedMemberIds: readonly string[];
}

export interface FamilyBookingLongStayLink {
  familyBookingId: string;
  memberId: string;
  longStayContractId: string;
  hotelStayId: string;
}

export type FamilyBookingPreflightCheckId =
  | "CUSTOMER_DOG_OWNERSHIP_READY"
  | "OPERATIONS_MEMBERSHIP_READY"
  | "OPERATIONS_SCHEDULE_CONTRACT_READY"
  | "HOTEL_FLEXIBLE_CREATE_READY"
  | "HOTEL_STAY_JSON_READY"
  | "HOTEL_CAPACITY_SOURCE_XOR_READY"
  | "AUDIT_REQUEST_ID_NULLABLE"
  | "FAMILY_BOOKING_OBJECTS_CLEAN"
  | "EXISTING_CONTRACT_FINGERPRINTS_UNCHANGED"
  | "FINANCE_READ_ONLY_BASELINE_CAPTURED";

export interface FamilyBookingPreflightCheckContract {
  id: FamilyBookingPreflightCheckId;
  required: boolean;
  blocksApplyOnFailure: boolean;
  readOnly: true;
}

export interface FamilyBookingPreflightContract {
  readOnly: true;
  expectedStatus: "READY_TO_APPLY_FAMILY_BOOKING_PLATFORM";
  checks: readonly FamilyBookingPreflightCheckContract[];
  executesSqlMutation: false;
  modifiesExistingContract: false;
}

export type FamilyBookingPackageStepKind =
  | "preflight"
  | "migration"
  | "postflight"
  | "rollback"
  | "rollback_qa"
  | "concurrency_qa";

export interface FamilyBookingPackageStepContract {
  id: string;
  kind: FamilyBookingPackageStepKind;
  readOnly: boolean;
  expectedStatus: string;
  stopOnFailure: true;
}

export interface FamilyBookingMigrationPackageContract {
  appendOnly: true;
  modifiesExistingRpc: false;
  modifiesExistingTrigger: false;
  modifiesExistingRls: false;
  steps: readonly FamilyBookingPackageStepContract[];
}
