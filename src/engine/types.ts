export type RoadEdge = {
  to: string;
  distance: number;      // km
  congestion: number;    // 0–1
  aqi: number;           // 0–500
  restricted: boolean;
};

export type Graph = {
  [nodeId: string]: RoadEdge[];
};

export type NodeCoordinates = {
  [nodeId: string]: {
    lat: number;
    lng: number;
  };
};
