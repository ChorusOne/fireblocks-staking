import {
  PeerType,
  TransactionOperation,
  type TransactionResponse,
  type TransactionArguments,
  TransactionStatus,
  type VaultAccountResponse
} from 'fireblocks-sdk'
import { print } from './util'

import { type SignerBackend } from './types'

export class Signer {
  private readonly signerBackend: SignerBackend

  constructor (signerBackend: SignerBackend) {
    this.signerBackend = signerBackend
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
    let { status, id } = await this.signerBackend.createTransaction(args)

    let txInfo = await this.signerBackend.getTransactionById(id)
    status = txInfo.status

    const states = [
      TransactionStatus.COMPLETED,
      TransactionStatus.FAILED,
      TransactionStatus.BLOCKED
    ]

    while (!states.some((x) => x === status)) {
      try {
        console.log(`* signer request ID: ${id} with status: ${status}`)
        txInfo = await this.signerBackend.getTransactionById(id)

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

  async getVault (vaultName: string): Promise<VaultAccountResponse> {
    const vaults = await this.signerBackend
      .getVaultAccountsWithPageInfo({
        namePrefix: vaultName
      })
      .then((res) => {
        return res.accounts.filter((account) => account.name === vaultName)
      })

    if (vaults.length !== 1) {
      throw new Error(
        'fireblocks vault name not found, expecte exactly 1 result, got: ' +
                  vaults.length
      )
    }

    return vaults[0]
  }
}
