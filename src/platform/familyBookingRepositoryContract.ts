import type {
  FamilyBookingMemberStatus,
  FamilyBookingRoomTypeCode,
  FamilyBookingServiceType,
  FamilyBookingStatus,
} from "./familyBookingPlatformContract";

/**
 * Frontend-to-RPC contract only. No Supabase client or runtime behavior lives
 * in this module.
 */

export interface CreateFamilyBookingInput {
  customerId: string;
  commonMemo: string | null;
  paymentBundleRequested: boolean;
  members: readonly CreateFamilyBookingMemberInput[];
  requestId: string;
}

export type CreateFamilyBookingMemberInput =
  | CreateFamilyHotelMemberInput
  | CreateFamilyTrainingMemberInput
  | CreateFamilyDaycareMemberInput;

interface CreateFamilyMemberBase {
  stableMemberKey: string;
  dogId: string;
  assigneeIds: readonly string[];
  memo: string | null;
  sharedRoomGroupKey: string | null;
}

export interface CreateFamilyHotelMemberInput extends CreateFamilyMemberBase {
  serviceType: "hotel";
  calendarId: string;
  scheduleTypeId: string;
  checkInDate: string;
  checkInTime: string | null;
  checkInTimeUnspecified: boolean;
  checkOutDate: string;
  checkOutTime: string | null;
  checkOutTimeUnspecified: boolean;
  roomTypeId: string | null;
}

interface CreateFamilyOperationMemberInput extends CreateFamilyMemberBase {
  calendarId: string;
  scheduleTypeId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeUnspecified: boolean;
}

export interface CreateFamilyTrainingMemberInput
  extends CreateFamilyOperationMemberInput {
  serviceType: "training";
}

export interface CreateFamilyDaycareMemberInput
  extends CreateFamilyOperationMemberInput {
  serviceType: "daycare";
}

export interface CreateFamilyBookingRpcArgs {
  p_customer_id: string;
  p_common_memo: string | null;
  p_payment_bundle_requested: boolean;
  p_members: readonly CreateFamilyBookingMemberInput[];
  p_request_id: string;
}

export interface CreateSharedRoomFamilyBookingInput
  extends CreateFamilyBookingInput {
  roomTypeId: string;
  roomId: string;
  sharedRoomIntent: true;
}

export interface CreateUnassignedSharedRoomFamilyBookingInput
  extends CreateFamilyBookingInput {
  roomTypeId: string;
  sharedRoomIntent: true;
}

export interface CreateUnassignedSharedRoomFamilyBookingRpcArgs {
  p_customer_id: string;
  p_common_memo: string | null;
  p_payment_bundle_requested: boolean;
  p_members: readonly CreateFamilyBookingMemberInput[];
  p_room_type_id: string;
  p_shared_room_intent: true;
  p_request_id: string;
}

export interface CreateSharedRoomFamilyBookingRpcArgs {
  p_customer_id: string;
  p_common_memo: string | null;
  p_payment_bundle_requested: boolean;
  p_members: readonly CreateFamilyBookingMemberInput[];
  p_room_type_id: string;
  p_room_id: string;
  p_shared_room_intent: true;
  p_request_id: string;
}

export interface FamilyBookingMemberRecord {
  id: string;
  stableMemberKey: string;
  dogId: string;
  serviceType: FamilyBookingServiceType;
  status: FamilyBookingMemberStatus;
  hotelStayId: string | null;
  operationScheduleId: string | null;
  sharedRoomGroupId: string | null;
  version: number;
  serviceVersion: number;
  dogName?: string;
  service?: {
    startsAt: string | null;
    endsAt: string | null;
    checkedInAt?: string | null;
    checkedOutAt?: string | null;
    roomTypeCode?: FamilyBookingRoomTypeCode | null;
    scheduleStatus?: string | null;
    calendarId?: string | null;
    scheduleTypeId?: string | null;
  };
}

export interface FamilySharedRoomGroupRecord {
  id: string;
  stableGroupKey: string;
  leaderMemberId: string;
  roomTypeId: string;
  normalizedStartsAt: string;
  normalizedEndsAt: string;
  requestedCapacity: number;
  status: "requested" | "allocated" | "released" | "cancelled";
  version: number;
}

export interface FamilyBookingRecord {
  id: string;
  customerId: string;
  customerName?: string | null;
  status: FamilyBookingStatus;
  storedStatus: FamilyBookingStatus;
  commonMemo: string | null;
  paymentBundleRequested: boolean;
  requestId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  members: readonly FamilyBookingMemberRecord[];
  sharedRoomGroups: readonly FamilySharedRoomGroupRecord[];
}

export interface FamilyBookingRepositoryContract {
  create(input: CreateFamilyBookingInput): Promise<FamilyBookingRecord>;
  getById(familyBookingId: string): Promise<FamilyBookingRecord>;
  listByCustomer(customerId: string): Promise<readonly FamilyBookingRecord[]>;
}

export interface FamilyBookingRepositoryError {
  code: string;
  message: string;
  detail?: string;
  retryable: boolean;
  category:
    | "validation"
    | "permission"
    | "replay_conflict"
    | "capacity"
    | "concurrency"
    | "unknown";
}

export interface FamilyBookingRoomIntent {
  roomTypeId: string | null;
  roomTypeCode: FamilyBookingRoomTypeCode | null;
  sharedRoomGroupKey: string | null;
  allocatesPhysicalRoom: false;
}
