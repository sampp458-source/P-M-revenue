import dogAHeartLetter from "./characters/journal-dog-a-heart-letter.png";
import dogAWaving from "./characters/journal-dog-a-waving.png";
import dogBPeeking from "./characters/journal-dog-b-peeking.png";
import bestFriendDuo from "./characters/journal-dog-duo-best-friend.png";
import mannersBookMedal from "./sections/journal-manners-book-medal.png";
import mealBowl from "./sections/journal-meal-bowl.png";
import physicalBallMotion from "./sections/journal-physical-ball-motion.png";

export const journalCharacters = {
  dogAWaving,
  dogBPeeking,
  dogAHeartLetter,
  bestFriendDuo,
} as const;

export type JournalCharacterName = keyof typeof journalCharacters;

export const journalSectionIllustrations = {
  meal: mealBowl,
  manners: mannersBookMedal,
  physical: physicalBallMotion,
} as const;

export type JournalSectionIllustrationName = keyof typeof journalSectionIllustrations;
