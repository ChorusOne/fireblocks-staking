import { FireblocksSDK } from 'fireblocks-sdk'
import { promises as fsPromises } from 'fs'
import { type Config, type SignerBackend, type FireblocksConfig } from '../types'
import { SignerType } from '../enums'
import { LocalSignerBackend } from './local'

async function newFireblocksSignerBackend (config: FireblocksConfig): Promise<SignerBackend> {
  const apiSecret = await fsPromises.readFile(config.apiSecretKeyPath, 'utf-8')
  const apiKey = await fsPromises.readFile(config.apiKeyPath, 'utf-8')

  return new FireblocksSDK(apiSecret.trim(), apiKey.trim())
}

async function newLocalSignerBackend (config: Config): Promise<SignerBackend> {
  return await LocalSignerBackend.build(
    config.localsigner.mnemonicPath,
    config.fireblocks.vaultName,
    config.network.bechPrefix
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
