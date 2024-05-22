import type { SignerOptions } from '@polkadot/api/submittable/types'
import type { Signer } from '../signer'
import type { ISubmittableResult } from '@polkadot/types/types'
import { journal, getNetworkConfig } from '../util'
import type { Config, SubstrateNetworkConfig } from '../types'
import { SubstrateFireblocksSigner } from './signer'
import { ApiPromise, WsProvider } from '@polkadot/api'
import { assert } from '@polkadot/util'

export class SubstrateStaker {
  private readonly signer: Signer
  private readonly config: Config
  private readonly withJournal: boolean
  private readonly networkConfig: SubstrateNetworkConfig

  private substrateSigner: SubstrateFireblocksSigner

  constructor (signer: Signer, config: Config, withJournal: boolean) {
    this.signer = signer
    this.config = config
    this.withJournal = withJournal
    this.networkConfig = getNetworkConfig<SubstrateNetworkConfig>(config)
  }

  async init (): Promise<void> {
    this.substrateSigner = new SubstrateFireblocksSigner(this.config, this.signer)
    await this.substrateSigner.init()
  }

  @journal('delegate')
  async delegate (amount: string, broadcast: boolean): Promise<[ISubmittableResult, string]> {
    this.substrateSigner.setNote('delegate' + amount + ' to ' + this.config.delegatorAddress)
    this.substrateSigner.setBroadcast(broadcast)

    return await this.sendTransaction(
      this.config.delegatorAddress,
      { section: 'staking', method: 'bond' },
      0,
      [
        (Number(amount) * this.networkConfig.denomMultiplier).toString(),
        this.networkConfig.rewardDestination
      ]
    )
  }

  // nominate bonded amount to given validators
  @journal('nominate')
  async nominate (broadcast: boolean): Promise<[ISubmittableResult, string]> {
    this.substrateSigner.setNote('nominate bonded amount to ' + this.config.delegatorAddress)
    this.substrateSigner.setBroadcast(broadcast)

    return await this.sendTransaction(
      this.config.delegatorAddress,
      { section: 'staking', method: 'nominate' },
      0,
      [
        this.config.validatorAddress.split(',')
      ]
    )
  }

  @journal('undelegate')
  async undelegate (amount: string, broadcast: boolean): Promise<[ISubmittableResult, string]> {
    this.substrateSigner.setNote('unstake ' + amount + ' from ' + this.config.delegatorAddress)
    this.substrateSigner.setBroadcast(broadcast)

    return await this.sendTransaction(
      this.config.delegatorAddress,
      { section: 'staking', method: 'unbond' },
      0,
      [
        (Number(amount) * this.networkConfig.denomMultiplier).toString()
      ]
    )
  }

  @journal('withdraw')
  async withdraw (broadcast: boolean): Promise<[ISubmittableResult, string]> {
    this.substrateSigner.setNote('withdraw all from ' + this.config.delegatorAddress)
    this.substrateSigner.setBroadcast(broadcast)

    return await this.sendTransaction(
      this.config.delegatorAddress,
      { section: 'staking', method: 'withdrawUnbonded' },
      0,
      []
    )
  }

  @journal('bondExtra')
  async bondExtra (amount: string, broadcast: boolean): Promise<[ISubmittableResult, string]> {
    this.substrateSigner.setNote('bond extra ' + amount + ' to ' + this.config.delegatorAddress)
    this.substrateSigner.setBroadcast(broadcast)

    return await this.sendTransaction(
      this.config.delegatorAddress,
      { section: 'staking', method: 'bondExtra' },
      0,
      [
        (Number(amount) * this.networkConfig.denomMultiplier).toString()
      ]
    )
  }

  async sendTransaction (
    account: string,
    txCall: { section: string, method: string },
    blocks: number | undefined,
    params: any[]
  ): Promise<[ISubmittableResult, string]> {
    const provider = new WsProvider(this.networkConfig.rpcUrl)
    const api = await ApiPromise.create({ provider, noInitWarn: true })

    assert(txCall.section in api.tx && txCall.method in api.tx[txCall.section], `unable to find method ${txCall.section}.${txCall.method}`)

    const options: Partial<SignerOptions> = { signer: this.substrateSigner }

    if (blocks === 0) {
      // forever living extrinsic
      options.era = 0
    } else if (blocks !== undefined) {
      const signedBlock = await api.rpc.chain.getBlock()
      options.blockHash = signedBlock.block.header.hash

      options.era = api.createType('ExtrinsicEra', {
        current: signedBlock.block.header.number,
        period: blocks
      })
    }

    const result = api.tx[txCall.section][txCall.method](...params)
    let ret: ISubmittableResult | undefined
    let errMsg: string = ''

    const unsub = await result.signAndSend(account, options, async (response) => {
      ret = response

      if (response.dispatchError !== undefined && response.dispatchError.isModule) {
        const decoded = api.registry.findMetaError(response.dispatchError.asModule)
        const { docs, name, section } = decoded

        errMsg = `the transaction is submitted to the blockchain but failed, error: ${section}.${name}: ${docs.join(' ')}`
        await provider.disconnect()
      } else {
        if (response.status.isInBlock) {
          await provider.disconnect()
        } else if (response.status.isFinalized) {
          unsub()
        }
      }
    })

    assert(ret !== undefined, "transaction didn't return any result")

    return [ret, errMsg]
  }
}
