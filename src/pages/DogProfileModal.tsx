import {
  Clock3,
  MapPin,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import {
  ProfileContent,
  ProfileField,
  ProfileHeader,
  ProfileInfoGrid,
  ProfileSection,
  ProfileTimeline,
  ProfileTimelineItem,
} from "../components/profile";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  StatusBadge,
} from "../components/ui";
import { koDate } from "../lib/format";
import { formatPhone } from "../lib/phone";
import {
  dashboardThemeCode,
  dashboardThemeStyle,
} from "./dashboard/dashboardTheme";
import {
  activeDogActivities,
  dogUsageDateRange,
  summarizeDogUsage,
  type DogProfileActivity,
} from "./dogProfile";

export interface DogProfileDog {
  id: string;
  customerId: string | null;
  name: string;
  breed: string | null;
  sex: "male" | "female" | null;
  birthDate: string | null;
  weight: number | null;
  neutered: boolean | null;
  memo: string | null;
  active: boolean;
}

export interface DogProfileOwner {
  id: string;
  name: string | null;
  phone: string | null;
  address: string | null;
  memo: string | null;
  is_active: boolean;
}

const detailValue = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "미등록" : value;

export function DogProfileModal({
  dog,
  owner,
  activities,
  loading,
  error,
  canEditDog,
  onClose,
  onEditDog,
  onEditOwner,
  onRetry,
}: {
  dog: DogProfileDog | null;
  owner: DogProfileOwner | null;
  activities: DogProfileActivity[];
  loading: boolean;
  error: string;
  canEditDog: boolean;
  onClose: () => void;
  onEditDog: () => void;
  onEditOwner: () => void;
  onRetry: () => void;
}) {
  if (!dog) return null;
  const activeActivities = activeDogActivities(activities);
  const usage = summarizeDogUsage(activities);
  const dates = dogUsageDateRange(activities);
  const recentUsageLabel = loading
    ? "최근 이용 확인 중"
    : error
      ? "최근 이용 확인 불가"
      : dates.recentDate
        ? `최근 이용 ${koDate(dates.recentDate)}`
        : "최근 이용 없음";

  return (
    <Modal
      open
      title="반려견 프로필"
      onClose={onClose}
      resetKey={dog.id}
      wide
    >
      <ProfileContent className="pt-1">
        <ProfileHeader
          className="pt-1"
          title={dog.name}
          status={<StatusBadge status={dog.active ? "active" : "inactive"} />}
          summary={
            <>
              {dog.breed || "품종 미등록"} · 보호자 {owner?.name || "미등록"} ·{" "}
              {recentUsageLabel}
            </>
          }
          actions={
            canEditDog ? (
            <Button variant="secondary" onClick={onEditDog}>
              <Pencil size={16} />
              반려견 정보 수정
            </Button>
            ) : null
          }
        />

        <div className="grid items-start gap-7 lg:grid-cols-2">
          <div className="space-y-7">
        <ProfileSection id="dog-profile-basic-title" title="반려견 정보">
          <ProfileInfoGrid className="sm:grid-cols-2 lg:!grid-cols-2">
            <ProfileField
              label="성별"
              value={dog.sex === "male" ? "수컷" : dog.sex === "female" ? "암컷" : "미등록"}
            />
            <ProfileField
              label="생년월일"
              value={dog.birthDate ? koDate(dog.birthDate) : "미등록"}
            />
            <ProfileField
              label="몸무게"
              value={dog.weight === null ? "미등록" : `${dog.weight}kg`}
            />
            <ProfileField
              label="중성화"
              value={dog.neutered === null ? "미등록" : dog.neutered ? "완료" : "미완료"}
            />
          </ProfileInfoGrid>
        </ProfileSection>

        <ProfileSection
          id="dog-profile-owner-title"
          title="보호자 정보"
          action={
            owner ? (
              <Button variant="secondary" onClick={onEditOwner}>
                <Pencil size={15} />
                수정
              </Button>
            ) : null
          }
        >
          {owner ? (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <UserRound size={19} />
                </span>
                <span>
                  <strong className="block text-base text-text-primary">
                    {owner.name || "이름 미등록"}
                  </strong>
                  <span className="text-xs text-text-muted">보호자 프로필 보기</span>
                </span>
              </div>
              <dl className="mt-4 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                <ProfileField
                  icon={<Phone size={15} />}
                  label="전화번호"
                  value={owner.phone ? formatPhone(owner.phone) : "미등록"}
                />
                <ProfileField
                  icon={<MapPin size={15} />}
                  label="주소"
                  value={detailValue(owner.address)}
                />
                <ProfileField
                  className="sm:col-span-2"
                  label="메모"
                  value={detailValue(owner.memo)}
                />
              </dl>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-text-secondary">
              연결된 보호자가 없습니다.
            </div>
          )}
        </ProfileSection>
          </div>

          <div className="space-y-7">
        <ProfileSection
          id="dog-profile-usage-title"
          title="이용 정보"
          action={
            loading ? (
              <span className="text-xs text-text-muted">확인 중</span>
            ) : error ? (
              <span className="text-xs font-medium text-error">조회 실패</span>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                <span>첫 이용 {dates.firstDate ? koDate(dates.firstDate) : "-"}</span>
                <span>최근 이용 {dates.recentDate ? koDate(dates.recentDate) : "-"}</span>
              </div>
            )
          }
        >
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : usage.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {usage.map((item) => {
                const themeCode = dashboardThemeCode(
                  item.businessUnitId,
                  item.businessUnitName,
                );
                return (
                  <div
                    key={item.businessUnitId || item.businessUnitName}
                    style={dashboardThemeStyle(themeCode)}
                    className="rounded-2xl border [border-color:rgb(var(--pm-theme-rgb)/0.18)] bg-[var(--pm-theme-tint-1)] p-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--pm-theme-accent)]" />
                      <span className="text-sm font-semibold text-text-secondary">
                        {item.businessUnitName}
                      </span>
                    </div>
                    <strong className="mt-3 block text-2xl font-bold tabular-nums text-[var(--pm-theme-accent)]">
                      {item.unitLabel
                        ? `${item.quantity.toLocaleString("ko-KR")}${item.unitLabel}`
                        : `${item.count.toLocaleString("ko-KR")}건`}
                    </strong>
                    <span className="mt-1 block text-xs text-text-muted">
                      이용 기록 {item.count.toLocaleString("ko-KR")}건
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="아직 이용 기록이 없습니다." />
          )}
        </ProfileSection>

        <ProfileSection
          id="dog-profile-memo-title"
          title="메모"
          action={
            canEditDog ? (
              <Button variant="ghost" onClick={onEditDog}>
                <Pencil size={15} />
                수정
              </Button>
            ) : null
          }
        >
          <p className="min-h-20 whitespace-pre-wrap rounded-2xl bg-amber-50/70 p-5 text-sm leading-7 text-text-secondary">
            {dog.memo || "등록된 주의사항이나 특이사항이 없습니다."}
          </p>
        </ProfileSection>
          </div>
        </div>

        <ProfileSection
          id="dog-profile-timeline-title"
          title="Timeline"
          description="확인된 이용 기록을 최신순으로 표시합니다."
        >
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : activeActivities.length ? (
            <ProfileTimeline
              countLabel={`총 ${activeActivities.length.toLocaleString("ko-KR")}건`}
            >
              {activeActivities.map((activity, index) => {
                const themeCode = dashboardThemeCode(
                  activity.businessUnitId,
                  activity.businessUnitName,
                );
                return (
                  <ProfileTimelineItem
                    key={activity.id}
                    style={dashboardThemeStyle(themeCode)}
                    last={index === activeActivities.length - 1}
                    date={koDate(activity.saleDate)}
                    badge={
                      <span className="rounded-full bg-[var(--pm-theme-tint-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--pm-theme-accent)]">
                        {activity.businessUnitName}
                      </span>
                    }
                    title={activity.productName}
                    meta={
                      <span className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                        <Clock3 size={13} />
                        {activity.quantity.toLocaleString("ko-KR")}
                        {activity.unitLabel || "건"}
                      </span>
                    }
                  />
                );
              })}
            </ProfileTimeline>
          ) : (
            <EmptyState compact title="표시할 Timeline이 없습니다." />
          )}
        </ProfileSection>
      </ProfileContent>
    </Modal>
  );
}
