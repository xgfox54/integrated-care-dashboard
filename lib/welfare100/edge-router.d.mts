export interface RouterRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface RouterEdge {
  id: string;
  source: string;
  target: string;
  type: "sequence" | "message" | "loop";
}

export function routeProcessEdges(input: {
  rects: Map<string, RouterRect>;
  edges: RouterEdge[];
  region: RouterRect;
  gutters?: { xs: number[]; ys: number[] };
}): Map<string, number[][]>;

export function simplify(points: number[][]): number[][];

