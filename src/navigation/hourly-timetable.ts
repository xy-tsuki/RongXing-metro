export function hourlyDepartures<T extends { tripId: string; seconds: number }>(rows: T[]) {
  const groups = new Map<number, (T & { minute: string })[]>()
  for (const row of [...rows].sort((a,b)=>a.seconds-b.seconds)) {
    const hour = Math.floor(row.seconds/3600)
    const departures = groups.get(hour) ?? []
    departures.push({...row,minute:String(Math.floor(row.seconds/60)%60).padStart(2,'0')})
    groups.set(hour,departures)
  }
  return [...groups].map(([hour,departures])=>({hour,label:String(hour).padStart(2,'0'),departures}))
}
