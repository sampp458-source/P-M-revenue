import {
  Clock3,
  MapPin,
  Pencil,
  Phone,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  StatusBadge,
} from "../components/ui";
import { koDate } from "../lib/format";
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
  onOpenOwnerMaster,
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
  onOpenOwnerMaster: () => void;
  onRetry: () => void;
}) {
  if (!dog) return null;
  const activeActivities = activeDogActivities(activities);
  const usage = summarizeDogUsage(activities);
  const dates = dogUsageDateRange(activities);

  return (
    <Modal open title="반려견 프로필" onClose={onClose} extraWide>
      <div className="space-y-7">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={dog.active ? "active" : "inactive"} />
              {dog.breed && (
                <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-semibold text-text-secondary">
                  {dog.breed}
                </span>
              )}
            </div>
            <h3 className="truncate text-3xl font-bold tracking-[-0.04em] text-text-primary sm:text-4xl">
              {dog.name}
            </h3>
            <p className="mt-2 text-sm text-text-secondary">
              보호자 {owner?.name || "미등록"} · 최근 이용{" "}
              {dates.recentDate ? koDate(dates.recentDate) : "없음"}
            </p>
          </div>
          {canEditDog && (
            <Button variant="secondary" onClick={onEditDog}>
              <Pencil size={16} />
              반려견 정보 수정
            </Button>
          )}
        </header>

        <section aria-labelledby="dog-profile-basic-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 id="dog-profile-basic-title" className="text-base font-bold text-text-primary">
              반려견 정보
            </h4>
          </div>
          <dl className="grid gap-x-6 gap-y-4 rounded-2xl border border-border bg-surface-secondary/60 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <ProfileField label="이름" value={dog.name} />
            <ProfileField label="품종" value={detailValue(dog.breed)} />
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
          </dl>
        </section>

        <section aria-labelledby="dog-profile-owner-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h4 id="dog-profile-owner-title" className="text-base font-bold text-text-primary">
              보호자 정보
            </h4>
            {owner && (
              <Button variant="secondary" onClick={onEditOwner}>
                <Pencil size={15} />
                수정
              </Button>
            )}
          </div>
          {owner ? (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <button
                type="button"
                onClick={onOpenOwnerMaster}
                className="group flex items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <UserRound size={19} />
                </span>
                <span>
                  <strong className="block text-base text-text-primary group-hover:text-primary">
                    {owner.name || "이름 미등록"}
                  </strong>
                  <span className="text-xs text-text-muted">보호자 Master 보기</span>
                </span>
              </button>
              <dl className="mt-5 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <ProfileField
                  icon={<Phone size={15} />}
                  label="전화번호"
                  value={detailValue(owner.phone)}
                />
                <ProfileField
                  icon={<MapPin size={15} />}
                  label="주소"
                  value={detailValue(owner.address)}
                />
                <div className="sm:col-span-2">
                  <ProfileField label="메모" value={detailValue(owner.memo)} />
                </div>
              </dl>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-text-secondary">
              연결된 보호자가 없습니다.
            </div>
          )}
        </section>

        <section aria-labelledby="dog-profile-usage-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h4 id="dog-profile-usage-title" className="text-base font-bold text-text-primary">
              이용 정보
            </h4>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
              <span>첫 이용 {dates.firstDate ? koDate(dates.firstDate) : "-"}</span>
              <span>최근 이용 {dates.recentDate ? koDate(dates.recentDate) : "-"}</span>
            </div>
          </div>
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : usage.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            <EmptyState title="아직 이용 기록이 없습니다." />
          )}
        </section>

        <section aria-labelledby="dog-profile-memo-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 id="dog-profile-memo-title" className="text-base font-bold text-text-primary">
              메모
            </h4>
            {canEditDog && (
              <Button variant="ghost" onClick={onEditDog}>
                <Pencil size={15} />
                수정
              </Button>
            )}
          </div>
          <p className="min-h-20 whitespace-pre-wrap rounded-2xl bg-amber-50/70 p-5 text-sm leading-7 text-text-secondary">
            {dog.memo || "등록된 주의사항이나 특이사항이 없습니다."}
          </p>
        </section>

        <section aria-labelledby="dog-profile-timeline-title">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h4 id="dog-profile-timeline-title" className="text-base font-bold text-text-primary">
                Timeline
              </h4>
              <p className="mt-1 text-xs text-text-muted">확인된 이용 기록을 최신순으로 표시합니다.</p>
            </div>
            <span className="text-xs font-semibold text-text-muted">
              총 {activeActivities.length.toLocaleString("ko-KR")}건
            </span>
          </div>
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState title={error} retry={onRetry} />
          ) : activeActivities.length ? (
            <ol className="relative ml-2 border-l border-border">
              {activeActivities.map((activity) => {
                const themeCode = dashboardThemeCode(
                  activity.businessUnitId,
                  activity.businessUnitName,
                );
                return (
                  <li
                    key={activity.id}
                    style={dashboardThemeStyle(themeCode)}
                    className="relative pb-6 pl-6 last:pb-0"
                  >
                    <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-[var(--pm-theme-accent)] ring-4 ring-white" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-text-primary">
                            {koDate(activity.saleDate)}
                          </span>
                          <span className="rounded-full bg-[var(--pm-theme-tint-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--pm-theme-accent)]">
                            {activity.businessUnitName}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-sm text-text-secondary">
                          {activity.productName}
                        </p>
                      </div>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-text-muted">
                        <Clock3 size={13} />
                        {activity.quantity.toLocaleString("ko-KR")}
                        {activity.unitLabel || "건"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState title="표시할 Timeline이 없습니다." />
          )}
        </section>
      </div>
    </Modal>
  );
}

function ProfileField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 break-words text-sm font-medium text-text-primary">
        {value}
      </dd>
    </div>
  );
}
