import { FireblocksSDK } from 'fireblocks-sdk'
import { promises as fsPromises } from 'fs'
import type { Config, SignerBackend, FireblocksConfig, CosmosNetworkConfig } from '../types'
import { SignerType } from '../enums'
import { LocalSignerBackend } from './local'
import { getNetworkConfig } from '../util'

async function newFireblocksSignerBackend (config: FireblocksConfig): Promise<SignerBackend> {
  const apiSecret = await fsPromises.readFile(config.apiSecretKeyPath, 'utf-8')
  const apiKey = await fsPromises.readFile(config.apiKeyPath, 'utf-8')

  return new FireblocksSDK(apiSecret.trim(), apiKey.trim())
}

// TODO: local signer works only for cosmos networks now
async function newLocalSignerBackend (config: Config): Promise<SignerBackend> {
  const networkConfig = getNetworkConfig<CosmosNetworkConfig>(config)

  return await LocalSignerBackend.build(
    config.localsigner.mnemonicPath,
    config.fireblocks.vaultName,
    networkConfig.bechPrefix
  )
}

export async function newSignerBackend (config: Config, signerType: SignerType): Promise<SignerBackend> {
  switch (signerType) {
    case SignerType.FIREBLOCKS:
      return await newFireblocksSignerBackend(config.fireblocks)
    case SignerType.LOCAL:
      return await newLocalSignerBackend(config)
  }

  throw new Error('invalid signer type provided: ' + (signerType as string))
}
