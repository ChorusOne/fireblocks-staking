import type { Signer as SubstrateSigner, SignerResult } from '@polkadot/api/types'
import type { SignerPayloadRaw } from '@polkadot/types/types'
import { blake2AsHex } from '@polkadot/util-crypto'
import type { Signer } from '../signer'
import type { Config } from '../types'
import type { VaultAccountResponse } from 'fireblocks-sdk'

export class SubstrateFireblocksSigner implements SubstrateSigner {
  private readonly signer: Signer
  private readonly config: Config
  private vault: VaultAccountResponse
  private note: string
  private broadcast: boolean

  constructor (config: Config, signer: Signer) {
    this.signer = signer
    this.config = config
    this.broadcast = false
  }

  async init (): Promise<void> {
    this.vault = await this.signer.getVault(this.config.fireblocks.vaultName)

    const depositAddress = await this.signer.getDepositAddress(this.vault.id, this.config.fireblocks.assetId)
    if (depositAddress !== this.config.delegatorAddress) {
      throw new Error('the deposit address (from fireblocks) does not match the delegator address')
    }
  }

  /**
   * @description signs a raw payload, only the bytes data as supplied
   */
  async signRaw ({ data, type }: SignerPayloadRaw): Promise<SignerResult> {
    data = (data.length > (256 + 1) * 2) ? blake2AsHex(data) : data

    const txInfo = await this.signer.sign(
      this.vault,
      this.config.fireblocks.assetId,
      this.config.delegatorAddress,
      data.substring(2),
      this.note
    )

    if (txInfo.signedMessages === undefined || txInfo.signedMessages?.length === 0) {
      throw new Error("fireblocks didn't return any signed message, but it should")
    }

    if (!this.broadcast) {
      console.log(txInfo.signedMessages[0])
      throw new Error('broadcast is not enabled but the transaction was signed correctly')
    }

    const signature = '0x00' + txInfo.signedMessages[0].signature.fullSig

    // @ts-expect-error from typcast
    return { id: 1, signature }
  }

  setBroadcast (broadcast: boolean): void {
    this.broadcast = broadcast
  }

  setNote (note: string): void {
    this.note = note
  }
}
