export interface Edge {
  id: string
  from_node: string
  to_node: string
  distance: number
  congestion: number
  aqi: number
  restricted: boolean
  from_lat: number
  from_lng: number
  to_lat: number
  to_lng: number
}

export type Graph = Record<string, Edge[]>

export const buildGraph = (edges: Edge[]): Graph => {
  const graph: Graph = {}

  for (const edge of edges) {
    if (!graph[edge.from_node]) {
      graph[edge.from_node] = []
    }
    graph[edge.from_node].push(edge)
  }

  return graph
}
