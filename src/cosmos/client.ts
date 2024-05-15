import { FireblocksSDK } from 'fireblocks-sdk'
import { promises as fsPromises } from 'fs'
import { type Config, type SignerBackend, type FireblocksConfig } from '../types'
import { SignerType } from '../enums'
import { LocalSigner } from './signer'
import {
  SigningStargateClient,
  type StargateClient
} from '@cosmjs/stargate'

async function newFireblocksSigner (config: FireblocksConfig): Promise<SignerBackend> {
  const apiSecret = await fsPromises.readFile(config.apiSecretKeyPath, 'utf-8')
  const apiKey = await fsPromises.readFile(config.apiKeyPath, 'utf-8')

  return new FireblocksSDK(apiSecret.trim(), apiKey.trim())
}

async function newLocalSigner (config: Config): Promise<SignerBackend> {
  return await LocalSigner.build(
    config.localsigner.mnemonicPath,
    config.fireblocks.vaultName,
    config.network.bechPrefix
  )
}

export async function newCosmosClient (rpcUrl: string): Promise<StargateClient> {
  return await SigningStargateClient.connect(rpcUrl)
}

export async function newSigner (config: Config, signerType: SignerType): Promise<SignerBackend> {
  switch (signerType) {
    case SignerType.FIREBLOCKS:
      return await newFireblocksSigner(config.fireblocks)
    case SignerType.LOCAL:
      return await newLocalSigner(config)
  }

  throw new Error('invalid signer type provided: ' + (signerType as string))
}
