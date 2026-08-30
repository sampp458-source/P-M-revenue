import type { JournalTeacherCommentPresentation } from "./journalCustomFont";
import { measureJournalTeacherCommentGeometry } from "./journalTeacherCommentGeometry";
import { journalTeacherCommentLength } from "./journalTextNormalization";
import type { JournalPreviewViewModel } from "./journalPreviewViewModel";

export type JournalExportPresentationIssue = {
  ordinal: number;
  entryId: string;
  dogId: string;
  dogName: string;
  fontSource: "DEFAULT" | "FILE" | "SYSTEM";
  fontFingerprint: string;
  fontSize: number;
  commentLength: number;
  measuredLines: number;
  maxLines: number;
  requiredHeight: number;
  availableHeight: number;
  overflowAmount: number;
  recommendedSize: number | null;
};

const fingerprint = (presentation: JournalTeacherCommentPresentation) => {
  if (presentation.fontFingerprint) return presentation.fontFingerprint;
  const internalFamily = presentation.fontFamily.match(/pnm-journal-(?:system-)?font-[a-f0-9-]+/i)?.[0];
  return internalFamily ?? (presentation.source === "DEFAULT" ? "DEFAULT" : "SESSION_FONT");
};

export function inspectJournalExportPresentation({
  ordinal,
  entryId,
  dogId,
  viewModel,
  presentation,
}: {
  ordinal: number;
  entryId: string;
  dogId: string;
  viewModel: JournalPreviewViewModel;
  presentation: JournalTeacherCommentPresentation;
}): JournalExportPresentationIssue | null {
  const geometry = measureJournalTeacherCommentGeometry(
    viewModel.teacherComment,
    presentation.fontFamily,
    presentation.fontSize,
  );
  if (geometry.available && !geometry.overflow) return null;
  return {
    ordinal,
    entryId,
    dogId,
    dogName: viewModel.dogName,
    fontSource: presentation.source ?? "DEFAULT",
    fontFingerprint: fingerprint(presentation),
    fontSize: presentation.fontSize,
    commentLength: journalTeacherCommentLength(viewModel.teacherComment),
    measuredLines: geometry.lineCount,
    maxLines: geometry.maxLines,
    requiredHeight: geometry.requiredHeight,
    availableHeight: geometry.availableHeight,
    overflowAmount: Math.ceil(Math.max(0, -geometry.bottomRemaining)),
    recommendedSize: geometry.recommendedSize,
  };
}

export function journalExportOverflowMessage(issue: JournalExportPresentationIssue) {
  if (issue.recommendedSize !== null && issue.recommendedSize !== issue.fontSize) {
    return `${issue.recommendedSize}px로 줄이면 이미지를 저장할 수 있습니다.`;
  }
  return "현재 내용은 18px에서도 영역을 초과합니다. 내용을 조금 줄이거나 다른 글꼴을 선택해 주세요.";
}
