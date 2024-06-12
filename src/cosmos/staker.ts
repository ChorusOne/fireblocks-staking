import type {
  Account,
  StargateClient,
  DeliverTxResponse
} from '@cosmjs/stargate'
import type {
  StdSignDoc
} from '@cosmjs/amino'
import type { Signer } from '../signer'
import { genSignedTx, genSignedMsg, genSignableTx, genDelegateOrUndelegateMsg, genBeginRedelegateMsg, genWithdrawRewardsMsg } from './tx'
import { prompt, print, journal, getNetworkConfig } from '../util'
import type { Config, CosmosNetworkConfig } from '../types'
import type { EncodeObject } from '@cosmjs/proto-signing'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { rawSecp256k1PubkeyToRawAddress } from '@cosmjs/amino'
import { toBech32, fromBase64 } from '@cosmjs/encoding'
import { newCosmosClient } from './client'
import type { VaultAccountResponse } from 'fireblocks-sdk'

export class CosmosStaker {
  private readonly signer: Signer
  private readonly config: Config
  private readonly networkConfig: CosmosNetworkConfig
  private readonly withJournal: boolean

  private chainID: string
  private cosmosAccount: Account
  private cosmosClient: StargateClient
  private vault: VaultAccountResponse

  constructor (signer: Signer, config: Config, withJournal: boolean) {
    this.signer = signer
    this.config = config
    this.networkConfig = getNetworkConfig<CosmosNetworkConfig>(config)
    this.withJournal = withJournal
  }

  async init (): Promise<void> {
    const cosmosClient = await newCosmosClient(this.networkConfig.rpcUrl)

    const cosmosAccount = await cosmosClient.getAccount(this.config.delegatorAddress)
    if (cosmosAccount == null) {
      throw new Error(
        'failed to query account: ' + this.config.delegatorAddress + ' are you sure the account exists?'
      )
    }

    this.chainID = await cosmosClient.getChainId()
    this.vault = await this.signer.getVault(this.config.fireblocks.vaultName)
    this.cosmosClient = cosmosClient
    this.cosmosAccount = cosmosAccount
  }

  async delegate (amount: string, memo?: string): Promise<Uint8Array> {
    const txMsg = genDelegateOrUndelegateMsg(
      this.config,
      'delegate',
      amount
    )

    return await this.sign(
      this.chainID,
      this.cosmosAccount,
      this.vault,
      txMsg,
      memo
    )
  }

  async undelegate (amount: string, memo?: string): Promise<Uint8Array> {
    const txMsg = genDelegateOrUndelegateMsg(
      this.config,
      'undelegate',
      amount
    )

    return await this.sign(
      this.chainID,
      this.cosmosAccount,
      this.vault,
      txMsg,
      memo
    )
  }

  async redelegate (amount: string, validatorDstAddress: string, memo?: string): Promise<Uint8Array> {
    const txMsg = genBeginRedelegateMsg(
      this.config,
      amount,
      validatorDstAddress
    )

    return await this.sign(
      this.chainID,
      this.cosmosAccount,
      this.vault,
      txMsg,
      memo
    )
  }

  async withdrawDelegatorReward (validatorAddress: string, memo?: string): Promise<Uint8Array> {
    const txMsg = genWithdrawRewardsMsg(this.config, validatorAddress)

    return await this.sign(
      this.chainID,
      this.cosmosAccount,
      this.vault,
      txMsg,
      memo
    )
  }

  @journal('unsignedTx')
  async genSignableTx (chainID: string, cosmosAccount: Account, txMsg: EncodeObject, memo?: string): Promise<StdSignDoc> {
    const signDoc = await genSignableTx(
      this.networkConfig,
      chainID,
      txMsg,
      cosmosAccount.accountNumber,
      cosmosAccount.sequence,
      memo
    )

    print(1, 3, 'prepare unsigned transaction')
    console.log(JSON.stringify(signDoc, null, 2))

    return signDoc
  }

  @journal('signedTx', (data): any => (TxRaw.toJSON(TxRaw.decode(data))))
  async sign (chainID: string, cosmosAccount: Account, vault: VaultAccountResponse, txMsg: EncodeObject, memo?: string): Promise<Uint8Array> {
    const signDoc = await this.genSignableTx(
      chainID,
      cosmosAccount,
      txMsg,
      memo
    )

    const shouldSign = await prompt('Do you want to sign the TX?')
    if (!shouldSign) {
      throw new Error('transaction signing aborted by user')
    }

    const signedMsg = await genSignedMsg(
      this.signer,
      signDoc,
      vault,
      this.config.delegatorAddress,
      this.config.fireblocks.assetId
    )

    const [signedTx, pk] = await genSignedTx(signDoc, signedMsg)

    const addressFromPK = toBech32(
      this.networkConfig.bechPrefix,
      rawSecp256k1PubkeyToRawAddress(fromBase64(pk))
    )
    if (addressFromPK !== this.config.delegatorAddress) {
      throw new Error(
        'address derived from signed message public key is different from the delegator address: ' +
        addressFromPK + ' != ' + this.config.delegatorAddress
      )
    }

    const txBytes = TxRaw.encode(signedTx).finish()

    console.log('* transaction signature recieved: ')
    console.log(TxRaw.toJSON(signedTx))

    return txBytes
  }

  @journal('txBroadcast')
  async broadcast (txBytes: Uint8Array): Promise<DeliverTxResponse> {
    return await this.cosmosClient.broadcastTx(txBytes)
  }
}
