import { buildGraph, Edge } from "./Graph"
import { runAStar } from "./AStar"

interface Context {
  battery: number
  cityAQI: number
}

export const runSmartRouteRealtime = (
  edges: Edge[],
  start: string,
  end: string,
  context: Context
) => {

  const graph = buildGraph(edges)

  const destinationEdge = edges.find(e => e.to_node === end)
  if (!destinationEdge) return null

  const destLat = destinationEdge.to_lat
  const destLng = destinationEdge.to_lng

  const fastest = runAStar(
    graph,
    start,
    end,
    { ...context, mode: "fastest" },
    destLat,
    destLng
  )

  const greenest = runAStar(
    graph,
    start,
    end,
    { ...context, mode: "greenest" },
    destLat,
    destLng
  )

  const safest = runAStar(
    graph,
    start,
    end,
    { ...context, mode: "safest" },
    destLat,
    destLng
  )

  return {
    fastest,
    greenest,
    safest
  }
}
