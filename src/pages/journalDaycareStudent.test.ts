import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  journalDogSearchRelevance,
  rankJournalDogDirectory,
} from "./journalDaycareStudent";
import type { JournalDirectoryDog } from "./journalRepository";

const dog = (
  id: string,
  name: string,
  customerName: string,
  isDaycareStudent: boolean,
  customerId = `customer-${id}`,
): JournalDirectoryDog => ({
  id,
  name,
  customerId,
  customerName,
  customerPhone: `0100000000${id}`,
  breed: null,
  isDaycareStudent,
});

describe("Journal daycare-student search ranking", () => {
  it("puts a daycare student first for duplicate Dog names", () => {
    const ordinary = dog("1", "보리", "하나", false);
    const student = dog("2", "보리", "윤보배", true);
    expect(rankJournalDogDirectory([ordinary, student], "보리")).toEqual([
      student,
      ordinary,
    ]);
  });

  it("preserves exact Dog-name relevance before the daycare secondary rank", () => {
    const exact = dog("1", "보리", "하나", false);
    const fuzzyStudent = dog("2", "보리야", "윤보배", true);
    expect(journalDogSearchRelevance(exact, "보리")).toBeLessThan(
      journalDogSearchRelevance(fuzzyStudent, "보리"),
    );
    expect(rankJournalDogDirectory([fuzzyStudent, exact], "보리")).toEqual([
      exact,
      fuzzyStudent,
    ]);
  });

  it("keeps the flag isolated per Dog for one multi-Dog Customer", () => {
    const student = dog("1", "보리", "김보호", true, "customer-family");
    const ordinary = dog("2", "초코", "김보호", false, "customer-family");
    expect(student.customerId).toBe(ordinary.customerId);
    expect(student.isDaycareStudent).toBe(true);
    expect(ordinary.isDaycareStudent).toBe(false);
  });

  it("searches by guardian and compact phone without excluding ordinary Dogs", () => {
    const ordinary = dog("1", "보리", "윤보배", false);
    const student = dog("2", "몽이", "김보호", true);
    expect(rankJournalDogDirectory([student, ordinary], "윤보배")).toEqual([
      ordinary,
    ]);
    expect(rankJournalDogDirectory([ordinary, student], "01000000002")).toEqual([
      student,
    ]);
  });
});

describe("daycare-student data contract", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/202608310001_journal_daycare_student_v1.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();
  const management = readFileSync(
    new URL("./DogManagement.tsx", import.meta.url),
    "utf8",
  );
  const badge = readFileSync(
    new URL("../components/DaycareStudentBadge.tsx", import.meta.url),
    "utf8",
  );
  const dogPermissions = readFileSync(
    new URL(
      "../../supabase/migrations/202607290003_dog_master_editing_active_users.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();

  it("adds one explicit dog-scoped boolean with default false and no history backfill", () => {
    expect(migration).toContain(
      "add column if not exists is_daycare_student boolean not null default false",
    );
    expect(migration).not.toMatch(/\b(update|insert|delete)\s+public\./);
    expect(migration).not.toContain("public.sales");
    expect(migration).not.toContain("public.journal_entries");
    expect(migration).not.toContain("public.operation_schedules");
  });

  it("preserves existing Dog RLS and audit paths", () => {
    expect(migration).not.toContain("policy");
    expect(migration).not.toContain("row level security");
    expect(management).toContain('.from("dogs").update(values)');
    expect(management).toContain("is_daycare_student: editing.isDaycareStudent");
    expect(dogPermissions).toContain("create policy dogs_update_active_user");
    expect(dogPermissions).toContain("using (public.is_active_user())");
    expect(dogPermissions).toContain("with check (public.is_active_user())");
    expect(dogPermissions).toContain("create trigger dogs_master_audit");
    expect(dogPermissions).not.toContain("service_role");
  });

  it("reuses the Revenue Dashboard daycare theme instead of inventing a color", () => {
    expect(badge).toContain('dashboardThemeStyle("daycare")');
    expect(badge).toContain("var(--pm-theme-tint-2)");
    expect(badge).toContain("var(--pm-theme-accent)");
    expect(badge).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
