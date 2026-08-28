function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function isOverdue(due: string | null, done: boolean): boolean {
  if (!due || done) return false;
  return new Date(due) < startOfDay(new Date());
}

export function isDueToday(due: string | null, done: boolean): boolean {
  if (!due || done) return false;
  const today = startOfDay(new Date());
  const dueDay = startOfDay(new Date(due));
  return today.getTime() === dueDay.getTime();
}

export function isWithinNextDays(due: string | null, done: boolean, days: number): boolean {
  if (!due || done) return false;
  const today = startOfDay(new Date());
  const dueDay = startOfDay(new Date(due));
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  return dueDay > today && dueDay <= limit;
}

export function formatDue(due: string | null): string {
  if (!due) return "Sem prazo";
  const d = new Date(due);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
