import {
  PeerType,
  TransactionOperation,
  type TransactionResponse,
  type TransactionArguments,
  TransactionStatus,
  type VaultAccountResponse
} from 'fireblocks-sdk'
import { print } from '../util'

import { type SignerBackend } from '../types'

export class Signer {
  private readonly rawSigner: SignerBackend

  constructor (rawSigner: SignerBackend) {
    this.rawSigner = rawSigner
  }

  async sign (vault: VaultAccountResponse, assetId: string, delegatorAddress: string, content: string, note: string): Promise<TransactionResponse> {
    const args: TransactionArguments = {
      assetId,
      source: {
        type: PeerType.VAULT_ACCOUNT,
        id: vault.id,
        address: delegatorAddress
      },
      note,
      operation: TransactionOperation.RAW,
      extraParameters: {
        rawMessageData: {
          messages: [
            {
              content
            }
          ]
        }
      }
    }

    // https://developers.fireblocks.com/docs/raw-message-signing
    print(2, 3, 'wait for the TX signature from the remote signer')
    let { status, id } = await this.rawSigner.createTransaction(args)

    let txInfo = await this.rawSigner.getTransactionById(id)
    status = txInfo.status

    const states = [
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.BLOCKED
    ]

    while (!states.some((x) => x === status)) {
      try {
        console.log(`* signer request ID: ${id} with status: ${status}`)
        txInfo = await this.rawSigner.getTransactionById(id)

        status = txInfo.status
      } catch (err) {
        console.error('probing remote signer failed', err)
      }

      await new Promise((resolve, reject) => setTimeout(resolve, 1000))
    }

    const details = txInfo.subStatus === '' ? 'none' : txInfo.subStatus
    console.log(
      `* signer request ID finished with status ${status}; details: ${details}`
    )

    return txInfo
  }
}
