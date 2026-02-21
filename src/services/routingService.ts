const ORS_API_KEY = import.meta.env.VITE_ORS_API_KEY as string | undefined;

export type RouteOptions = {
  coordinates: [number, number][];
  profile?: "driving-car" | "driving-hgv";
  avoidHighways?: boolean;
  avoidTolls?: boolean;
};

export type RouteResult = {
  geometry: [number, number][];
  distance: number;
  duration: number;
};

export const fetchRoadRoute = async (
  options: RouteOptions
): Promise<RouteResult | null> => {
  try {
    if (!ORS_API_KEY) {
      return null;
    }

    const response = await fetch(
      `https://api.openrouteservice.org/v2/directions/${options.profile || "driving-car"}/geojson`,
      {
        method: "POST",
        headers: {
          Authorization: ORS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: options.coordinates,
          instructions: false,
          options: {
            avoid_features: [
              options.avoidHighways ? "highways" : null,
              options.avoidTolls ? "tollways" : null,
            ].filter(Boolean),
          },
        }),
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const route = data.features?.[0];

    if (!route?.geometry?.coordinates || !route?.properties?.summary) {
      return null;
    }

    return {
      geometry: route.geometry.coordinates.map(
        (coord: [number, number]) => [coord[1], coord[0]]
      ),
      distance: route.properties.summary.distance,
      duration: route.properties.summary.duration,
    };
  } catch {
    return null;
  }
};
