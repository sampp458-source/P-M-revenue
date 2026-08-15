import dogAHeartLetter from "./characters/journal-dog-a-heart-letter.png";
import dogAWaving from "./characters/journal-dog-a-waving.png";
import dogBPeeking from "./characters/journal-dog-b-peeking.png";
import bestFriendDuo from "./characters/journal-dog-duo-best-friend.png";

export const journalCharacters = {
  dogAWaving,
  dogBPeeking,
  dogAHeartLetter,
  bestFriendDuo,
} as const;

export type JournalCharacterName = keyof typeof journalCharacters;
