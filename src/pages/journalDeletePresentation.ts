import type { JournalStatus } from "./journalRepository";

export const journalDeleteConfirmationDetail = (status: JournalStatus) => {
  if (status === "IN_PROGRESS") return "작성 중인 내용이 함께 삭제되며 복구할 수 없습니다.";
  if (status === "COMPLETED") return "완료된 일지가 삭제되며 복구할 수 없습니다.";
  return "등록된 일지가 삭제되며 복구할 수 없습니다.";
};
