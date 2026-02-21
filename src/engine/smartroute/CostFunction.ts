import { Edge } from "./Graph"

interface Context {
  battery: number
  cityAQI: number
  mode: "fastest" | "greenest" | "safest"
}

export const calculateEdgeCost = (
  edge: Edge,
  context: Context
): number => {

  const travelTime = edge.distance * (1 + edge.congestion)
  const carbon = edge.distance * 0.2
  const pollutionExposure = edge.aqi

  const batteryPenalty =
    context.battery < 25 ? edge.distance * 3 : 0

  const restrictedPenalty =
    edge.restricted ? 10000 : 0

  if (context.mode === "fastest") {
    return (
      2 * travelTime +
      0.5 * pollutionExposure +
      batteryPenalty +
      restrictedPenalty
    )
  }

  if (context.mode === "greenest") {
    return (
      2 * carbon +
      pollutionExposure +
      batteryPenalty +
      restrictedPenalty
    )
  }

  // safest
  return (
    2 * pollutionExposure +
    travelTime +
    batteryPenalty +
    restrictedPenalty
  )
}
