const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function shanghaiDateTime(date: Date): { date: string; hour: number; minute: number } {
  const parts = Object.fromEntries(shanghaiDateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function shanghaiDailyDate(date: Date): string {
  return shanghaiDateTime(date).date;
}

export function shanghaiDailyDateForTimestamp(value: string): string | undefined {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? shanghaiDailyDate(date) : undefined;
}
