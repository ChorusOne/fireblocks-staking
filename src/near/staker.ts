import { Connection, providers, Account, DEFAULT_FUNCTION_CALL_GAS } from 'near-api-js'
import type { FinalExecutionOutcome } from '@near-js/types'
import { parseNearAmount } from 'near-api-js/lib/utils/format'
import type { Signer } from '../signer'
import { journal, getNetworkConfig } from '../util'
import { type Config, type NearNetworkConfig } from '../types'
import { NEARFireblocksSigner } from './signer'

// NOTE: This would be the proper way of calling the contract, but it doesn't work
// the call doesn't return repsonse data. This is the issue:
// https://github.com/near/near-api-js/issues/1052
//
// this.contract = new Contract(
//   connection,
//   this.config.validatorAddress,
//   {
//     viewMethods: ['get_account_staked_balance'],
//     changeMethods: ['deposit_and_stake', 'unstake_all', 'withdraw_all'],
//     useLocalViewExecution: false
//   }
// )
//
// const response = await this.contract.deposit_and_stake({
//   signerAccount: this.account,
//   args: {},
//   amount: parseNearAmount('' + amount)
// })

export class NearStaker {
  private readonly signer: Signer
  private readonly config: Config
  private readonly withJournal: boolean
  private readonly networkConfig: NearNetworkConfig

  private account: Account
  private nearSigner: NEARFireblocksSigner

  constructor (signer: Signer, config: Config, withJournal: boolean) {
    this.signer = signer
    this.config = config
    this.withJournal = withJournal
    this.networkConfig = getNetworkConfig<NearNetworkConfig>(config)
  }

  async init (): Promise<void> {
    this.nearSigner = new NEARFireblocksSigner(this.config, this.signer)
    await this.nearSigner.init()

    const pk = await this.nearSigner.getPublicKey()
    const accountId = Buffer.from(pk.data).toString('hex')

    const provider = new providers.JsonRpcProvider({ url: this.networkConfig.nodeUrl })
    const connection = new Connection(this.networkConfig.networkId, provider, this.nearSigner, '')

    this.account = new Account(connection, accountId)

    if (accountId !== this.account.accountId) {
      throw new Error("the account ID doesn't match the public key")
    }
  }

  @journal('delegate')
  async delegate (amount: string, broadcast: boolean): Promise<FinalExecutionOutcome> {
    this.nearSigner.setNote(
      'deposit_and_stake ' + parseNearAmount(amount) + ' to ' +
      this.config.validatorAddress + ' from ' + this.config.delegatorAddress
    )
    this.nearSigner.setBroadcast(broadcast)

    const response = await this.account.functionCall({
      contractId: this.config.validatorAddress,
      methodName: 'deposit_and_stake',
      args: {},
      gas: DEFAULT_FUNCTION_CALL_GAS,
      attachedDeposit: BigInt(amountToYocto(amount))
    })

    return response
  }

  @journal('undelegate')
  async undelegate (amount: string, broadcast: boolean): Promise<FinalExecutionOutcome> {
    this.nearSigner.setNote('unstake ' + parseNearAmount(amount) + ' from ' + this.config.delegatorAddress)
    this.nearSigner.setBroadcast(broadcast)

    const response = await this.account.functionCall({
      contractId: this.config.validatorAddress,
      methodName: 'unstake',
      args: { amount: amountToYocto(amount) },
      gas: DEFAULT_FUNCTION_CALL_GAS
    })

    return response
  }

  @journal('withdraw')
  async withdraw (amount: string, broadcast: boolean): Promise<FinalExecutionOutcome> {
    const amnt = amountToYocto(amount)
    let method = 'withdraw'
    let args: any = { amount: amnt }

    if (BigInt(amnt) === BigInt(0)) {
      method = 'withdraw_all'
      args = {}
    }

    this.nearSigner.setNote(method + ' from ' + this.config.delegatorAddress)
    this.nearSigner.setBroadcast(broadcast)

    const response = await this.account.functionCall({
      contractId: this.config.validatorAddress,
      methodName: method,
      args,
      gas: DEFAULT_FUNCTION_CALL_GAS,
      attachedDeposit: undefined
    })

    return response
  }
}

function amountToYocto (amount: string): string {
  const amnt = parseNearAmount(amount)
  if (amnt === null) {
    throw new Error(`Invalid amount: ${amount}`)
  }

  return amnt
}
