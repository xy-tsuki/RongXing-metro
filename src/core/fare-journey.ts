export interface FareLookupQuote {
  fareYuan: number
  mainAreaFareYuan: number
  newDistrictFareYuan: number
}

export interface FareStationLink {
  fromStationId: string
  toStationId: string
}

export interface FareJourneyInput {
  /** Actual paid-area entry, normally the first selected ride leg's fromStationId. */
  originStationId: string
  /** Actual paid-area exit, normally the last selected ride leg's toStationId. */
  destinationStationId: string
  /** Out-of-station transfers in route order; in-station transfers must be omitted. */
  externalTransfers?: readonly FareStationLink[]
  lookup: (fromStationId: string, toStationId: string) => FareLookupQuote | null
}

export interface FareChargeSegment {
  fromStationId: string
  toStationId: string
  fareYuan: number | null
  mainAreaFareYuan: number | null
  newDistrictFareYuan: number | null
}

export interface FareJourneyResult {
  status: 'complete' | 'incomplete' | 'invalid'
  totalFareYuan: number | null
  segments: FareChargeSegment[]
  issues: string[]
}

function invalid(message: string): FareJourneyResult {
  return { status: 'invalid', totalFareYuan: null, segments: [], issues: [message] }
}

/**
 * Calculates one entry/exit fare for each paid-area journey. The endpoints
 * must be the actual paid-area entry/exit, normally the first/last selected
 * ride-leg stations; access/egress walks are outside this calculation.
 * Ordered out-of-station transfers split a journey and their outdoor walking
 * itself has no fare. In-station transfers do not split a fare. The lookup
 * owns all non-same-station fare rules. Do not call for a route with no ride legs.
 */
export function calculateFareJourney(input: FareJourneyInput): FareJourneyResult {
  const { originStationId, destinationStationId } = input
  if (!originStationId || !destinationStationId) return invalid('起点或终点站点 ID 为空')
  for (const link of input.externalTransfers ?? []) {
    if (!link.fromStationId || !link.toStationId || link.fromStationId === link.toStationId) {
      return invalid('站外换乘缺少有效的方向站点')
    }
  }

  const journeyEntry = originStationId
  const journeyExit = destinationStationId
  const boundaries = [...(input.externalTransfers ?? [])]
  const journeySegments: Array<[string, string]> = []
  let currentEntry = journeyEntry
  for (const boundary of boundaries) {
    journeySegments.push([currentEntry, boundary.fromStationId])
    currentEntry = boundary.toStationId
  }
  journeySegments.push([currentEntry, journeyExit])
  const segments: FareChargeSegment[] = []
  const issues: string[] = []

  for (const [fromStationId, toStationId] of journeySegments) {
    let quote: FareLookupQuote | null
    if (fromStationId === toStationId) {
      // User-confirmed minimum for entering and exiting at the same station.
      quote = { fareYuan: 2, mainAreaFareYuan: 2, newDistrictFareYuan: 0 }
    } else {
      quote = input.lookup(fromStationId, toStationId)
    }

    if (!quote || !Number.isFinite(quote.fareYuan) || quote.fareYuan < 0 ||
        !Number.isFinite(quote.mainAreaFareYuan) || quote.mainAreaFareYuan < 0 ||
        !Number.isFinite(quote.newDistrictFareYuan) || quote.newDistrictFareYuan < 0) {
      issues.push(`缺少有效票价：${fromStationId} → ${toStationId}`)
      segments.push({ fromStationId, toStationId, fareYuan: null, mainAreaFareYuan: null, newDistrictFareYuan: null })
    } else {
      segments.push({ fromStationId, toStationId, ...quote })
    }

  }

  const complete = segments.every(segment => segment.fareYuan !== null)
  return {
    status: complete ? 'complete' : 'incomplete',
    totalFareYuan: complete ? segments.reduce((sum, segment) => sum + segment.fareYuan!, 0) : null,
    segments,
    issues
  }
}
