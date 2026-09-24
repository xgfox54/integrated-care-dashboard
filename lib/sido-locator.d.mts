export interface SidoBoundaryData {
  v: number;
  scale?: number;
  source?: string;
  sido: { n: string; p: number[][][] }[];
}

export interface SidoRegion {
  name: string;
  polygons: number[][][][];
  bbox: { west: number; east: number; south: number; north: number };
  area: number;
}

export function decodeSidoBoundaries(data: SidoBoundaryData): SidoRegion[];

export function locateSido(lat: number, lon: number, regions: SidoRegion[], options?: { maxDistanceKm?: number }): string | null;

