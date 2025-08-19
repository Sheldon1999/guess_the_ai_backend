export function rankFromCorrect(n) {
  if (n >= 5000) return "S++";
  if (n >= 1000) return "S+";
  if (n >= 500)  return "S";
  if (n >= 100)  return "A";
  if (n >= 80)   return "B";
  if (n >= 50)   return "C";
  if (n >= 20)   return "D";
  return "E";
}
export function titleFromStreak(s) {
  if (s >= 200) return "Demon World Ruler";
  if (s >= 120) return "Demon Slayer";
  if (s >= 100) return "Dragon Hunter";
  if (s >= 50)  return "Warrior";
  if (s >= 10)  return "Newbie";
  return "Newbie";
}
