import { SigningStargateClient } from '@cosmjs/stargate'
import type { StargateClient } from '@cosmjs/stargate'

export async function newCosmosClient (rpcUrl: string): Promise<StargateClient> {
  return await SigningStargateClient.connect(rpcUrl)
}
