import { seoulDateKey } from "./operationsScheduleRepository";

export type HotelRoomBoardDateMode = "TODAY" | "PAST" | "FUTURE";

export function hotelRoomBoardDateMode(date: string, today = seoulDateKey()): HotelRoomBoardDateMode {
  return date === today ? "TODAY" : date < today ? "PAST" : "FUTURE";
}

export const hotelRoomBoardDateCopy = {
  TODAY: { title: "현재 객실 운영 현황", description: "현재 예약·배정·이용 상태를 기준으로 객실을 관리합니다." },
  PAST: { title: "선택일 운영 기록", description: "선택한 날짜와 관련된 예약·운영 기록입니다. 당시의 실제 객실 점유 상태를 완전히 복원한 화면은 아닙니다." },
  FUTURE: { title: "선택일 예약·배정 계획", description: "선택한 날짜의 예약 및 배정 계획입니다. 실제 이용 객실은 변경될 수 있습니다." },
} as const;

export const PAST_ROOM_BOARD_NOTICE = "과거 날짜에서는 현재 운영 상태를 변경할 수 없습니다. 상세와 입·퇴실 기록은 확인할 수 있습니다.";
export const FUTURE_ROOM_BOARD_NOTICE = "사전 배정·예약 관리는 선택일 계획에 적용됩니다. 이용 중인 대상의 이동·퇴실·외출 작업은 현재 운영 상태를 변경합니다.";
