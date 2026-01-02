/**
 * Returns the start and end dates of the current week (Monday to Sunday)
 * in 'YYYY-MM-DD' format. 
 * @returns An object containing startOfWeek and endOfWeek strings.
 */
export function thisWeekBookendsDates(): {
  startOfWeek: string;
  endOfWeek: string;
} {
  // Get today's date
  let now = new Date();

  // Calculate the start of the week (Monday)
  let startOfWeek = new Date(
    now.setDate(now.getDate() - now.getDay() + (now.getDay() == 0 ? -6 : 1))
  );

  // Calculate the end of the week (Sunday)
  let endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 7));

  return {
    startOfWeek: startOfWeek.toISOString().slice(0, 10),
    endOfWeek: endOfWeek.toISOString().slice(0, 10),
  };
}
