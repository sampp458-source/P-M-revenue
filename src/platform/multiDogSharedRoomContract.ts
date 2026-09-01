export type SharedHotelOccupancyStatus = "active" | "completed" | "released";
export type SharedHotelMemberStatus = "active" | "completed" | "left";

export interface SharedHotelOccupancyMember {
  id: string;
  familyBookingMemberId: string;
  hotelStayId: string;
  dogId: string;
  dogName: string;
  status: SharedHotelMemberStatus;
  joinedAt: string;
  leftAt: string | null;
}

export interface SharedHotelOccupancy {
  id: string;
  familyBookingId: string;
  sharedRoomGroupId: string;
  customerId: string;
  roomTypeId: string;
  roomTypeCode: "DELUXE";
  roomId: string;
  roomName: string;
  occupiedFrom: string;
  occupiedUntil: string;
  status: SharedHotelOccupancyStatus;
  version: number;
  capacityReservationId: string;
  roomAllocationId: string;
  capacityUsed: 0 | 1;
  dogCount: number;
  members: readonly SharedHotelOccupancyMember[];
}

export interface UnassignedSharedRoomDogMember {
  familyBookingMemberId: string;
  hotelStayId: string;
  dogId: string;
  dogName: string;
}

export interface UnassignedSharedRoomGroup {
  sharedRoomGroupId: string;
  familyBookingId: string;
  customerId: string;
  customerName: string;
  dogMembers: readonly UnassignedSharedRoomDogMember[];
  dogCount: number;
  roomTypeId: string;
  roomTypeCode: "DELUXE";
  reservedFrom: string;
  reservedUntil: string;
  capacityReservationId: string;
  requestedCapacity: 1;
  status: "requested";
  version: number;
}

export interface SharedRoomAssignmentAttempt {
  roomId: string;
  requestId: string;
}

export function resolveSharedRoomAssignmentAttempt(
  current: SharedRoomAssignmentAttempt | undefined,
  roomId: string,
  createRequestId: () => string = () => crypto.randomUUID(),
): SharedRoomAssignmentAttempt {
  return current?.roomId === roomId
    ? current
    : { roomId, requestId: createRequestId() };
}

export interface SharedHotelMemberMutationResult {
  occupancy: SharedHotelOccupancy;
  stay: unknown;
  remainingActiveMembers?: number;
}

export interface SharedHotelRoomRepositoryContract {
  listUnassigned(date: string): Promise<readonly UnassignedSharedRoomGroup[]>;
  listForDate(date: string): Promise<readonly SharedHotelOccupancy[]>;
  get(occupancyId: string): Promise<SharedHotelOccupancy>;
  create(sharedRoomGroupId: string, roomId: string, requestId: string): Promise<SharedHotelOccupancy>;
  mergeExistingStays(hotelStayIds: readonly string[], expectedVersions: readonly number[], requestId: string): Promise<SharedHotelOccupancy>;
  checkIn(occupancyId: string, hotelStayId: string, occupancyVersion: number, stayVersion: number, completedAt: string, requestId: string): Promise<SharedHotelMemberMutationResult>;
  checkOut(occupancyId: string, hotelStayId: string, occupancyVersion: number, stayVersion: number, completedAt: string, requestId: string): Promise<SharedHotelMemberMutationResult>;
  reverseCompletion(occupancyId: string, hotelStayId: string, occupancyVersion: number, stayVersion: number, reason: string, requestId: string): Promise<SharedHotelMemberMutationResult>;
  move(occupancyId: string, roomId: string, occupancyVersion: number, reason: string, requestId: string): Promise<SharedHotelOccupancy>;
}
