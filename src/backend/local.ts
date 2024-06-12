import { promises as fsPromises } from 'fs'
import { Secp256k1, Bip39, EnglishMnemonic, Slip10, Slip10Curve } from '@cosmjs/crypto'
import { type SignerBackend } from '../types'
import {
  type PagedVaultAccountsRequestFilters,
  type PagedVaultAccountsResponse,
  type TransactionArguments,
  type RequestOptions,
  type CreateTransactionResponse,
  type TransactionResponse,
  type TransferPeerPathResponse,
  type PublicKeyInfoForVaultAccountArgs,
  type PublicKeyResponse,
  type DepositAddressResponse,
  type PublicKeyInformation,
  type PublicKeyInfoArgs,
  TransactionStatus,
  PeerType
} from 'fireblocks-sdk'

import { makeCosmoshubPath } from '@cosmjs/proto-signing'

import {
  type Secp256k1HdWalletOptions
} from '@cosmjs/amino'

export class LocalSignerBackend implements SignerBackend {
  private readonly pubkey: Uint8Array
  private readonly privkey: Uint8Array
  private readonly vaultName: string
  private msg: string

  constructor (privkey: Uint8Array, pubkey: Uint8Array, vaultName: string) {
    this.pubkey = pubkey
    this.privkey = privkey
    this.vaultName = vaultName
  }

  public static async build (
    mnemonicPath: string,
    vaultName: string,
    bechPrefix: string
  ): Promise<LocalSignerBackend> {
    const { privkey, pubkey } = await getPrivPubKey(mnemonicPath, bechPrefix)

    return new LocalSignerBackend(privkey, pubkey, vaultName)
  }

  public async getVaultAccountsWithPageInfo (
    pagedVaultAccountsRequestFilters: PagedVaultAccountsRequestFilters
  ): Promise<PagedVaultAccountsResponse> {
    return await Promise.resolve({
      accounts: [
        {
          id: '1',
          name: this.vaultName
        }
      ]
    })
  }

  public async createTransaction (
    transactionArguments: TransactionArguments,
    requestOptions?: RequestOptions
  ): Promise<CreateTransactionResponse> {
    interface inner {
      rawMessageData: {
        messages: Array<{
          content: string
        }>
      }
    }

    const params: inner | undefined = transactionArguments.extraParameters as inner
    this.msg = params?.rawMessageData.messages[0].content

    return await Promise.resolve({
      id: '1',
      status: TransactionStatus.SUBMITTED
    })
  }

  public async getTransactionById (
    txId: string
  ): Promise<TransactionResponse> {
    const signature = await Secp256k1.createSignature(
      Buffer.from(this.msg, 'hex'),
      this.privkey
    )

    const peerPath: TransferPeerPathResponse = {
      id: '',
      type: PeerType.VAULT_ACCOUNT
    }

    return await Promise.resolve({
      id: txId,
      assetId: '',
      source: peerPath,
      destination: peerPath,
      amount: 0,
      networkFee: 0,
      amountUSD: 0,
      netAmount: 0,
      createdAt: 0,
      lastUpdated: 0,
      status: TransactionStatus.COMPLETED,
      txHash: '',
      signedBy: [],
      createdBy: '',
      rejectedBy: '',
      destinationAddress: '',
      destinationTag: '',
      addressType: '',
      note: '',
      exchangeTxId: '',
      requestedAmount: 0,
      feeCurrency: '',
      subStatus: 'fake substatus',
      signedMessages: [
        {
          content: '',
          algorithm: '',
          derivationPath: [],
          signature: {
            fullSig: '',
            r: Buffer.from(signature.r(32)).toString('hex'),
            s: Buffer.from(signature.s(32)).toString('hex'),
            v: signature.r()[0]
          },
          publicKey: Buffer.from(this.pubkey).toString('hex')
        }
      ]
    })
  }

  public async getPublicKeyInfo (args: PublicKeyInfoArgs): Promise<PublicKeyInformation> {
    throw new Error('method not implemented')
  }

  public async getPublicKeyInfoForVaultAccount (args: PublicKeyInfoForVaultAccountArgs): Promise<PublicKeyResponse> {
    throw new Error('method not implemented')
  }

  public async getDepositAddresses (vaultAccountId: string, assetId: string): Promise<DepositAddressResponse[]> {
    throw new Error('method not implemented')
  }
}

export async function getPrivPubKey (
  mnemonicPath: string,
  bechPrefix: string
): Promise<{ privkey: Uint8Array, pubkey: Uint8Array }> {
  const defaultOptions: Secp256k1HdWalletOptions = {
    bip39Password: '',
    hdPaths: [makeCosmoshubPath(0)],
    prefix: bechPrefix
  }

  const mnemonic = (await fsPromises.readFile(mnemonicPath, 'utf-8')).trim()
  const mnemonicChecked = new EnglishMnemonic(mnemonic)
  const seed = await Bip39.mnemonicToSeed(mnemonicChecked, '')

  const { privkey } = Slip10.derivePath(
    Slip10Curve.Secp256k1,
    seed,
    defaultOptions.hdPaths[0]
  )
  const { pubkey } = await Secp256k1.makeKeypair(privkey)

  return { privkey, pubkey: Secp256k1.compressPubkey(pubkey) }
}
