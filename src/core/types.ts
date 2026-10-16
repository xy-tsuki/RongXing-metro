export type RouteMode = 'shortest' | 'few-stairs' | 'elevator'
export type Knowledge = 'confirmed' | 'unknown'
export interface Provenance { kind: 'demo' | 'survey' | 'official' | 'user'; source: string; recordedAt: string }
export interface Station { id: string; name: string; concourseNodeIds: string[]; indoorData: 'complete' | 'partial' | 'missing' }
export interface Line { id: string; name: string; color: string }
export interface DoorPosition { id: string; car: number; door: number; longitudinalMetres: number | null; numberingConfirmed?: boolean }
export interface Formation { id: string; cars: number; positions: DoorPosition[]; doorsKnown?: boolean; numberingStatus?: 'unknown' | 'confirmed' }
/** level: 0 = ground, negative = underground floor, positive = above-ground floor. */
export interface Platform { id: string; stationId: string; lineId: string; level: number; doorNodes: Record<string, string>; provenance?: Provenance }
export interface ServiceStop { stationId: string; platformId?: string | null; minutesFromPrevious?: number | null }
export interface Service { id: string; lineId: string; direction: string; formationId: string; stops: ServiceStop[] }
/** Uses the same signed floor numbering as Platform.level; labels may describe mezzanines. */
export interface WalkNode { id: string; stationId: string; level: number; label: string; knowledge: Knowledge; kind: 'concourse' | 'facility' | 'door' | 'corridor'; provenance?: Provenance; platformId?: string }
export interface WalkEdge {
  id: string; from: string; to: string; kind: 'walk' | 'stairs' | 'escalator' | 'lift';
  /** metres = actual walking only; lifts/escalators count approach/exit walking, excluding transported distance. seconds includes device travel. */
  metres: number; seconds: number; stairCount: number; knowledge: Knowledge;
  /** Independent confirmation of wheelchair passage, including level corridors, gates and lift approaches. */
  wheelchair: 'confirmed' | 'blocked' | 'unknown'; bidirectional: boolean; provenance: Provenance
}
export interface MetroDataset {
  schemaVersion: '1.0'; version: string; city: { id: string; name: string }; provenance: Provenance;
  description: string; stations: Station[]; lines: Line[]; formations: Formation[]; platforms: Platform[];
  services: Service[]; walkNodes: WalkNode[]; walkEdges: WalkEdge[];
  metadata?: Record<string, unknown>;
  externalTransfers?: ExternalTransfer[];
  manualRecommendations?: { id: string; stationId: string; serviceId: string; purpose: 'transfer' | 'exit'; targetServiceId?: string; positions: { car: number; door: number }[]; note: string; provenance: Provenance }[]
}
export interface ExternalTransfer { id: string; fromStationId: string; toStationId: string; bidirectional: boolean; walkingMetres: number | null; minutes: number | null; wheelchair: 'confirmed' | 'blocked' | 'unknown'; provenance: Provenance }
export interface WalkPath { nodes: string[]; edges: WalkEdge[]; metres: number; minutes: number; stairCount: number; instructions: string[] }
export interface DoorRecommendation { car: number; door: number; positionId: string }
export interface JourneyLeg {
  serviceId: string; lineId: string; lineName: string; lineColor: string; direction: string;
  fromStationId: string; fromStationName: string; toStationId: string; toStationName: string;
  stopCount: number; rideMinutes: number | null; recommendations: DoorRecommendation[];
  recommendationStatus: 'pending' | 'local' | 'complete'; recommendationBasis: string[];
  arrivalPath?: WalkPath | null; boardingRecommendations?: DoorRecommendation[]; formationCars?: number
}
export interface TransferGuide { stationId: string; stationName: string; fromLineName: string; toLineName: string; path: WalkPath | null; instructions: string[]; kind?: 'in-station' | 'external'; fromStationId?: string; toStationId?: string }
export interface DoorCombination { positions: DoorRecommendation[]; originPath: WalkPath; transferPaths: WalkPath[]; destinationPath: WalkPath }
export interface JourneyRoute {
  id: string; legs: JourneyLeg[]; transfers: TransferGuide[]; originPath: WalkPath | null; destinationPath: WalkPath | null;
  doorCombinations: DoorCombination[]; walkingMetres: number | null; stairCount: number | null; rideMinutes: number | null;
  totalMinutes: number | null; transferCount: number; confidence: 'demo' | 'verified' | 'partial' | 'topology-only'; equalChoicesTruncated: boolean;
  granularity: 'basic' | 'partial' | 'detailed'
  accessTransfers?: TransferGuide[]; egressTransfers?: TransferGuide[]
}
export interface PlanRequest { from: string; to: string; mode: RouteMode }
export interface PlanResult { status: 'ok' | 'unreachable' | 'incomplete' | 'invalid'; routes: JourneyRoute[]; diagnostics: string[] }
