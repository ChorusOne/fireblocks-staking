import { sha256 } from 'js-sha256'
import { encode } from 'bs58'
import { Signer as AbstractSigner } from 'near-api-js'
import type { Signature } from 'near-api-js/lib/utils/key_pair'
import { PublicKey } from 'near-api-js/lib/utils/key_pair'
import type { Signer } from '../signer'
import type { Config } from '../types'
import type { VaultAccountResponse } from 'fireblocks-sdk'

export class NEARFireblocksSigner extends AbstractSigner {
  private readonly signer: Signer
  private readonly config: Config
  private vault: VaultAccountResponse
  private publicKey: PublicKey
  private note: string
  private broadcast: boolean

  constructor (config: Config, signer: Signer) {
    super()

    this.signer = signer
    this.config = config
    this.broadcast = false
  }

  async init (): Promise<void> {
    this.vault = await this.signer.getVault(this.config.fireblocks.vaultName)

    const pubkey = await this.signer.getPublicKey(this.vault, this.config.fireblocks.assetId)
    this.publicKey = PublicKey.from(encode(Buffer.from(pubkey, 'hex')))
  }

  /**
   * Creates new key and returns public key.
   * @param accountId accountId to retrieve from.
   * @param networkId The targeted network. (ex. default, betanet, etc…)
   */
  async createKey (_accountId: string, _networkId?: string): Promise<PublicKey> {
    throw new Error('create key is not supported')
  }

  /**
   * Returns public key for given account / network.
   * @param accountId accountId to retrieve from.
   * @param networkId The targeted network. (ex. default, betanet, etc…)
   */
  async getPublicKey (_accountId?: string, _networkId?: string): Promise<PublicKey> {
    return this.publicKey
  }

  /**
   * Signs given message, by first hashing with sha256.
   * @param message message to sign.
   * @param accountId accountId to use for signing.
   * @param networkId The targeted network. (ex. default, betanet, etc…)
   */
  async signMessage (message: Uint8Array, _accountId?: string, _networkId?: string): Promise<Signature> {
    const msgBuffer = Buffer.from(message)
    const msgHash = sha256.create().update(msgBuffer).hex()

    const txInfo = await this.signer.sign(
      this.vault,
      this.config.fireblocks.assetId,
      this.config.delegatorAddress,
      msgHash,
      this.note
    )

    if (txInfo.signedMessages === undefined || txInfo.signedMessages?.length === 0) {
      throw new Error("fireblocks didn't return any signed message, but it should")
    }

    const signedMessage = txInfo.signedMessages[0]

    if (!this.broadcast) {
      console.log(signedMessage)
      throw new Error('broadcast is not enabled but the transaction was signed correctly')
    }

    return {
      signature: Buffer.from(signedMessage.signature.fullSig, 'hex'),
      publicKey: this.publicKey
    }
  }

  setBroadcast (broadcast: boolean): void {
    this.broadcast = broadcast
  }

  setNote (note: string): void {
    this.note = note
  }
}
