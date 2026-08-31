import type { JournalDirectoryDog } from "./journalRepository";

const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/\s+/g, " ")
    .trim();

const compactPhone = (value: string | null | undefined) =>
  (value ?? "").replace(/\D/g, "");

export function journalDogSearchRelevance(
  dog: JournalDirectoryDog,
  query: string,
) {
  const keyword = normalize(query);
  if (!keyword) return 0;
  const dogName = normalize(dog.name);
  const customerName = normalize(dog.customerName);
  const phone = compactPhone(dog.customerPhone);
  const phoneQuery = compactPhone(query);
  const combined = normalize(
    `${dog.name} ${dog.customerName ?? ""} ${dog.customerPhone ?? ""}`,
  );

  if (dogName === keyword) return 0;
  if (dogName.startsWith(keyword)) return 1;
  if (dogName.includes(keyword)) return 2;
  if (customerName === keyword) return 3;
  if (customerName.startsWith(keyword)) return 4;
  if (customerName.includes(keyword)) return 5;
  if (phoneQuery && phone === phoneQuery) return 6;
  if (phoneQuery && phone.includes(phoneQuery)) return 7;
  if (combined.includes(keyword)) return 8;
  return Number.POSITIVE_INFINITY;
}

export function rankJournalDogDirectory(
  dogs: readonly JournalDirectoryDog[],
  query: string,
) {
  return dogs
    .map((dog, index) => ({
      dog,
      index,
      relevance: journalDogSearchRelevance(dog, query),
    }))
    .filter(({ relevance }) => Number.isFinite(relevance))
    .sort(
      (left, right) =>
        left.relevance - right.relevance ||
        Number(right.dog.isDaycareStudent) - Number(left.dog.isDaycareStudent) ||
        left.dog.name.localeCompare(right.dog.name, "ko") ||
        left.index - right.index,
    )
    .map(({ dog }) => dog);
}
