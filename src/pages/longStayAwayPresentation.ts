import type { LongStayContractProjection } from "../platform/longStayHotelContract";

export function longStayAwayLabel(
  evidence: LongStayContractProjection["currentAbsence"],
) {
  if (evidence?.inventoryMode === "keep_room" && evidence.inventoryTransitionStatus === "room_retained") {
    return "외출 중 · 객실과 Capacity 유지";
  }
  if (evidence?.inventoryMode === "release_room" && evidence.inventoryTransitionStatus === "room_released") {
    return "외출 중 · 객실 반납 · 현재 객실 미보유";
  }
  return "외출 중 · 객실 보유 상태 확인 필요";
}
