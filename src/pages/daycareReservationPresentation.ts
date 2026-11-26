import type { DaycareReservation } from "./daycareOperationsRepository";

export const daycareDogNames = (reservation: DaycareReservation) =>
  (reservation.dogs?.length ? reservation.dogs : [reservation.dog]).map((dog) => dog.name).join(" + ");
