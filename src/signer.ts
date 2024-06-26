import {
  PeerType,
  TransactionOperation,
  TransactionStatus,
} from 'fireblocks-sdk'
import type {
  TransactionResponse,
  TransactionArguments,
  VaultAccountResponse,
  PublicKeyInfoForVaultAccountArgs,
  PublicKeyResponse,
  PublicKeyInformation,
  PublicKeyInfoArgs
} from 'fireblocks-sdk'

import { print } from './util'

import type { SignerBackend } from './types'

export class Signer {
  readonly signerBackend: SignerBackend

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
    const { id } = await this.signerBackend.createTransaction(args)

    let txInfo = await this.signerBackend.getTransactionById(id)
    let status = txInfo.status

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

      await new Promise((resolve, _) => setTimeout(resolve, 1000))
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

  async getPublicKey (vault: VaultAccountResponse, assetId: string): Promise<string> {
    const pubKeyArgs: PublicKeyInfoForVaultAccountArgs = {
      assetId,
      vaultAccountId: Number.parseInt(vault.id),
      change: 0,
      addressIndex: 0
    }

    const pubKeyResponse: PublicKeyResponse = await this.signerBackend.getPublicKeyInfoForVaultAccount(pubKeyArgs)

    // TODO: figure out how to check the algorithm based on the assetId
    // const expectedAlgorithm = 'MPC_ECDSA_SECP256K1'
    // if (pubKeyResponse.algorithm !== expectedAlgorithm) {
    //   throw new Error(`expected algorithm is not ${expectedAlgorithm} but ${pubKeyResponse.algorithm}`)
    // }

    return pubKeyResponse.publicKey
  }

  async getPublicKeyInfo (args: PublicKeyInfoArgs): Promise<PublicKeyInformation> {
    return await this.signerBackend.getPublicKeyInfo(args)
  }

  async getDepositAddress (vaultAccountId: string, assetId: string): Promise<string> {
    const response = await this.signerBackend.getDepositAddresses(vaultAccountId, assetId)

    return response[0].address
  }
}
