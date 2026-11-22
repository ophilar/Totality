
import * as dgram from 'dgram'

export interface DiscoveredMediaServer {
  id: string
  name: string
  address: string
  endpointAddress?: string
  localAddress?: string
}

const DISCOVERY_PORT = 7359
const DISCOVERY_TIMEOUT = 3000
const BROADCAST_ADDRESSES = ['255.255.255.255', '192.168.255.255', '192.168.1.255', '10.255.255.255']

export function discoverMediaServers(messageText: string, serviceName: string): Promise<DiscoveredMediaServer[]> {
  return new Promise(resolve => {
    const servers: DiscoveredMediaServer[] = []
    const seenIds = new Set<string>()
    let socket: dgram.Socket | null = null

    try {
      socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
      socket.on('message', (msg, rinfo) => {
        try {
          const response = JSON.parse(msg.toString())
          if (response.Id && response.Name && !seenIds.has(response.Id)) {
            seenIds.add(response.Id)
            servers.push({
              id: response.Id,
              name: response.Name,
              address: response.Address || `http://${rinfo.address}:8096`,
              endpointAddress: response.EndpointAddress,
              localAddress: response.LocalAddress,
            })
            console.log(`[${serviceName}Discovery] Found server: ${response.Name} at ${response.Address || rinfo.address}`)
          }
        } catch (error) {
          console.debug(`[${serviceName}Discovery] Invalid response:`, error, msg.toString().substring(0, 100))
        }
      })
      socket.on('error', error => {
        console.error(`[${serviceName}Discovery] Socket error:`, error.message)
      })
      socket.bind(() => {
        try {
          socket!.setBroadcast(true)
          const message = Buffer.from(messageText)
          for (const address of BROADCAST_ADDRESSES) {
            try {
              socket!.send(message, 0, message.length, DISCOVERY_PORT, address)
            } catch (error) {
              console.debug(`[${serviceName}Discovery] Failed to send broadcast to ${address}:`, error)
            }
          }
          console.log(`[${serviceName}Discovery] Broadcast sent, waiting for responses...`)
        } catch (error) {
          console.error(`[${serviceName}Discovery] Failed to send broadcast:`, error)
        }
      })
      setTimeout(() => {
        try {
          socket?.close()
        } catch (error) {
          console.debug(`[${serviceName}Discovery] Failed to close discovery socket:`, error)
        }
        console.log(`[${serviceName}Discovery] Discovery complete, found ${servers.length} server(s)`)
        resolve(servers)
      }, DISCOVERY_TIMEOUT)
    } catch (error) {
      console.error(`[${serviceName}Discovery] Failed to create socket:`, error)
      resolve(servers)
    }
  })
}
