import { Graph, Edge } from "./Graph"
import { calculateEdgeCost } from "./CostFunction"
import { PriorityQueue } from "./PriorityQueue"

interface Context {
  battery: number
  cityAQI: number
  mode: "fastest" | "greenest" | "safest"
}

interface NodeState {
  node: string
  cost: number
  path: Edge[]
  lat: number
  lng: number
}

// 🌍 Haversine Distance (in km)
const haversine = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2

  return 2 * R * Math.asin(Math.sqrt(a))
}

export const runAStar = (
  graph: Graph,
  start: string,
  end: string,
  context: Context,
  destinationLat: number,
  destinationLng: number
) => {

  const open = new PriorityQueue<NodeState>()

  const startEdges = graph[start]
  if (!startEdges || startEdges.length === 0) return null

  const startLat = startEdges[0].from_lat
  const startLng = startEdges[0].from_lng

  open.enqueue(
    {
      node: start,
      cost: 0,
      path: [],
      lat: startLat,
      lng: startLng
    },
    0
  )

  const visited = new Set<string>()

  while (!open.isEmpty()) {
    const current = open.dequeue()
    if (!current) break

    if (current.node === end) {
      return current.path
    }

    if (visited.has(current.node)) continue
    visited.add(current.node)

    const neighbors = graph[current.node] || []

    for (const edge of neighbors) {

      if (visited.has(edge.to_node)) continue

      const gCost =
        current.cost +
        calculateEdgeCost(edge, context)

      const hCost = haversine(
        edge.to_lat,
        edge.to_lng,
        destinationLat,
        destinationLng
      )

      open.enqueue(
        {
          node: edge.to_node,
          cost: gCost,
          path: [...current.path, edge],
          lat: edge.to_lat,
          lng: edge.to_lng
        },
        gCost + hCost
      )
    }
  }

  return null
}
