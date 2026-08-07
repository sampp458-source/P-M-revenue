import { supabase } from "../lib/supabase";
import { fetchOperationSettings } from "../pages/operationsSettingsRepository";
import type { FamilyBookingDraft } from "../pages/customerDogArchitecture";
import type {
  CreateFamilyBookingInput,
  CreateFamilyBookingMemberInput,
  FamilyBookingRecord,
  FamilyBookingRepositoryContract,
} from "./familyBookingRepositoryContract";

type RoomTypeRow = { id: string; code: "STANDARD" | "DELUXE" };

const kstIso = (date: string, time: string) =>
  new Date(`${date}T${time}:00+09:00`).toISOString();

const operationTimes = (startsOn: string, endsOn: string) => ({
  startsAt: kstIso(startsOn, "09:00"),
  endsAt: kstIso(endsOn, startsOn === endsOn ? "10:00" : "18:00"),
});

const requiredServiceContract = async () => {
  const [settings, roomTypesResult, userResult] = await Promise.all([
    fetchOperationSettings(),
    supabase
      .from("hotel_room_types")
      .select("id, code")
      .in("code", ["STANDARD", "DELUXE"])
      .eq("is_active", true)
      .is("archived_at", null),
    supabase.auth.getUser(),
  ]);

  if (roomTypesResult.error) throw roomTypesResult.error;
  if (userResult.error || !userResult.data.user) {
    throw userResult.error ?? new Error("로그인이 필요합니다.");
  }

  const calendars = new Map(
    (["hotel", "training", "daycare"] as const).map((serviceType) => {
      const calendar = settings.calendars.find(
        (candidate) => candidate.businessUnitCode === serviceType,
      );
      if (!calendar) throw new Error(`${serviceType} Calendar를 찾을 수 없습니다.`);
      const scheduleType = settings.scheduleTypes.find((candidate) =>
        candidate.calendarIds?.includes(calendar.id),
      );
      if (!scheduleType) throw new Error(`${serviceType} 일정 유형을 찾을 수 없습니다.`);
      return [serviceType, { calendarId: calendar.id, scheduleTypeId: scheduleType.id }];
    }),
  );

  return {
    calendars,
    roomTypes: new Map(
      ((roomTypesResult.data ?? []) as RoomTypeRow[]).map((row) => [row.code, row.id]),
    ),
    actorId: userResult.data.user.id,
  };
};

export async function familyBookingInputFromDraft(
  draft: FamilyBookingDraft,
  requestId: string = crypto.randomUUID(),
): Promise<CreateFamilyBookingInput> {
  const contract = await requiredServiceContract();
  const members: CreateFamilyBookingMemberInput[] = draft.dogs.map((dog) => {
    const service = contract.calendars.get(dog.serviceType);
    if (!service) throw new Error(`${dog.serviceType} 서비스 계약을 찾을 수 없습니다.`);
    const assigneeIds = dog.assigneeIds.length ? dog.assigneeIds : [contract.actorId];
    const base = {
      stableMemberKey: dog.dogId,
      dogId: dog.dogId,
      assigneeIds,
      memo: dog.memo?.trim() || null,
      sharedRoomGroupKey: dog.sharedRoomGroupKey,
      calendarId: service.calendarId,
      scheduleTypeId: service.scheduleTypeId,
    };

    if (dog.serviceType === "hotel") {
      const roomTypeCode = dog.roomType === "standard"
        ? "STANDARD"
        : dog.roomType === "deluxe"
          ? "DELUXE"
          : null;
      return {
        ...base,
        serviceType: "hotel",
        checkInDate: dog.startsOn,
        checkInTime: dog.checkInTimeUnspecified ? null : dog.checkInTime,
        checkInTimeUnspecified: dog.checkInTimeUnspecified,
        checkOutDate: dog.endsOn,
        checkOutTime: dog.checkOutTimeUnspecified ? null : dog.checkOutTime,
        checkOutTimeUnspecified: dog.checkOutTimeUnspecified,
        roomTypeId: roomTypeCode ? contract.roomTypes.get(roomTypeCode) ?? null : null,
      };
    }

    const times = operationTimes(dog.startsOn, dog.endsOn);
    return {
      ...base,
      serviceType: dog.serviceType,
      title: `${dog.dogName} · ${dog.serviceType === "training" ? "교육" : "유치원"}`,
      ...times,
      allDay: false,
      timeUnspecified: false,
    };
  });

  return {
    customerId: draft.customerId,
    commonMemo: [draft.commonRequest, draft.commonMemo]
      .map((value) => value?.trim())
      .filter(Boolean)
      .join("\n") || null,
    paymentBundleRequested: draft.combinePayment,
    members,
    requestId,
  };
}

const rpcArgs = (input: CreateFamilyBookingInput) => ({
  p_customer_id: input.customerId,
  p_common_memo: input.commonMemo,
  p_payment_bundle_requested: input.paymentBundleRequested,
  p_members: input.members,
  p_request_id: input.requestId,
});

export const familyBookingRepository: FamilyBookingRepositoryContract = {
  async create(input) {
    const result = await supabase.rpc("create_family_booking", rpcArgs(input));
    if (result.error) throw result.error;
    return result.data as FamilyBookingRecord;
  },
  async getById(familyBookingId) {
    const result = await supabase.rpc("get_family_booking", {
      p_family_booking_id: familyBookingId,
    });
    if (result.error) throw result.error;
    return result.data as FamilyBookingRecord;
  },
  async listByCustomer(customerId) {
    const result = await supabase.rpc("get_customer_family_bookings", {
      p_customer_id: customerId,
    });
    if (result.error) throw result.error;
    return (result.data ?? []) as FamilyBookingRecord[];
  },
};

export async function createFamilyBookingFromDraft(
  draft: FamilyBookingDraft,
  requestId: string = draft.requestId ?? crypto.randomUUID(),
) {
  const input = await familyBookingInputFromDraft(draft, requestId);
  return familyBookingRepository.create(input);
}

export function familyBookingErrorMessage(error: unknown) {
  const source = error as { code?: string; message?: string } | null;
  const code = source?.code ?? "";
  const message = source?.message ?? "";

  if (code === "23514" || message.includes("Capacity")) {
    return "선택한 기간의 호텔 객실이 부족합니다. 날짜 또는 객실 유형을 확인해 주세요.";
  }
  if (code === "23P01" || message.includes("겹치") || message.includes("충돌")) {
    return "선택한 시간에 이미 등록된 예약이 있습니다. 반려견별 일정을 확인해 주세요.";
  }
  if (message.includes("동일 request_id")) {
    return "이미 처리된 예약 요청과 입력 내용이 다릅니다. 새 가족 예약으로 다시 시작해 주세요.";
  }
  if (code === "42501" || code === "PGRST301") {
    return "Family Booking을 처리할 권한이 없습니다.";
  }
  if (code === "40001") {
    return "예약 정보가 변경되었습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.";
  }
  return message || "Family Booking을 생성하지 못했습니다.";
}
