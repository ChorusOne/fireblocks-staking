import type { SignerOptions } from '@polkadot/api/submittable/types'
import type { Signer } from '../signer'
import type { ExtrinsicStatus } from '@polkadot/types/interfaces/author'
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
  async delegate (amount: string, broadcast: boolean): Promise<[ExtrinsicStatus, string]> {
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
  async nominate (broadcast: boolean): Promise<[ExtrinsicStatus, string]> {
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
  async undelegate (amount: string, broadcast: boolean): Promise<[ExtrinsicStatus, string]> {
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
  async withdraw (broadcast: boolean): Promise<[ExtrinsicStatus, string]> {
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
  async bondExtra (amount: string, broadcast: boolean): Promise<[ExtrinsicStatus, string]> {
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
  ): Promise<[ExtrinsicStatus, string]> {
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

    const submittableExtrinsic = await result.signAsync(account, options)
    console.log('\nsubmitting signed extrinsic to the blockchain...\n')

    const status = await api.rpc.author.submitAndWatchExtrinsic(submittableExtrinsic)

    // FIXME: in ideal world and based on all the documentation I (mkaczanowski)
    // found. The callback should return a status but it is not being called at
    // all. This makes us oblivious of the status, meaning that we don't know if
    // transaction went through, is in the block or failed.
    //
    // let ret: ISubmittableResult | undefined
    // let errMsg: string = ''
    // const unsub = await result.signAndSend(account, options, (response) => {
    //   ret = response

    //   if (response.dispatchError !== undefined && response.dispatchError.isModule) {
    //     const decoded = api.registry.findMetaError(response.dispatchError.asModule)
    //     const { docs, name, section } = decoded

    //     errMsg = `the transaction is submitted to the blockchain but failed, error: ${section}.${name}: ${docs.join(' ')}`
    //   } else {
    //     if (response.status.isInBlock) {
    //       console.log(`completed at block hash #${response.status.isInBlock}`)
    //     } else if (response.status.isFinalized) {
    //       console.log(`current status: ${response.status.type}`)
    //       unsub()
    //     }
    //   }
    // })

    // unsubscribe
    // unsub()

    await provider.disconnect()

    assert(status !== undefined, "transaction didn't return any result")

    return [status, '']
  }
}
