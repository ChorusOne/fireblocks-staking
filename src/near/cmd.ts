import { Command } from '@commander-js/extra-typings'
import type { Config, SignerBackend, NearNetworkConfig } from '../types'
import { Signer } from '../signer'
import type { SignerType } from '../enums'
import { readConfig, getNetworkConfig, print } from '../util'
import { newSignerBackend } from '../backend/backend'
import { NearStaker } from './staker'
import type { FinalExecutionOutcome } from '@near-js/types'

export function makeNearCommand (): Command {
  const near = new Command('near')

  near.addCommand(makeTxCommand())

  return near
}

function makeTxCommand (): Command {
  const tx = new Command('tx')
    .description('generate a signed transaction')
    .option('-b, --broadcast', 'broadcast generated transaction', false)
    .option('-j, --journal <value>', 'write TX\'es to the local journal log', 'true')

  tx.command('delegate')
    .description('generate a delegate funds to validator transaction')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in NEAR denom e.g 0.1'
    )
    .action(getDelegateTx)

  tx.command('unbond')
    .description('generate unbond funds to validator transaction')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in denom e.g 0.1'
    )
    .action(getUnbondTx)

  tx.command('withdraw-rewards')
    .description('withdraw rewards earned with given validator')
    .argument(
      '[validatorAddress]',
      'address of the validator from where to claim rewards'
    )
    .action(getWithdrawRewardsTx)

  return tx
}

async function init (
  cmd: Command<[string]> | Command<[string, string]>
): Promise<
  [Config, Signer]
  > {
  const path: string = cmd.parent?.parent?.parent?.getOptionValue('config') as string
  const signerType: string = cmd.parent?.parent?.parent?.getOptionValue(
    'signer'
  ) as string

  const config: Config = await readConfig(path).catch((e) => {
    cmd.error(e, { exitCode: 1, code: 'delegate.config.fs' })
  })

  const signerBackend: SignerBackend = await newSignerBackend(config, signerType as SignerType)
  const signer = new Signer(signerBackend)

  return [config, signer]
}

async function runTx (
  msgType: string,
  options: any,
  cmd: Command<[string]> | Command<[string, string]>,
  arg: string[]
): Promise<Uint8Array> {
  const broadcastEnabled = cmd.parent?.getOptionValue('broadcast') as boolean
  const journalEnabled: boolean = JSON.parse(cmd.parent?.getOptionValue('journal') as string)

  const [config, signerClient] = await init(cmd)

  const nearStaker: NearStaker = new NearStaker(signerClient, config, journalEnabled)
  await nearStaker.init()

  let response: FinalExecutionOutcome | undefined

  print(1, 3, 'prepare unsigned transaction')
  console.log(JSON.stringify({
    delegator: config.delegatorAddress,
    contractId: config.validatorAddress,
    messageType: msgType,
    args: arg,
    broadcast: broadcastEnabled
  }, null, 2))

  try {
    switch (msgType) {
      case 'delegate':
        response = await nearStaker.delegate(
          arg[0], // amount
          broadcastEnabled
        )
        break
      case 'undelegate':
        response = await nearStaker.undelegate(
          arg[0], // amount
          broadcastEnabled
        )
        break
      case 'withdrawRewards':
        response = await nearStaker.withdrawDelegatorReward(
          broadcastEnabled
        )
        break
    }
  } catch (e) {
    cmd.error(e, { exitCode: 1, code: msgType + '.tx.sign' })
  }

  if (response === undefined) {
    throw new Error('tx response is empty')
  }

  print(3, 3, 'inspect transaction outcome')
  console.log(JSON.stringify(response.transaction, null, 2))

  const networkConfig = getNetworkConfig<NearNetworkConfig>(config)
  if (networkConfig.explorerUrl !== undefined) {
    console.log(
      '\nCheck TX status here: ' +
          networkConfig.explorerUrl +
          response.transaction.hash
    )
  }

  return Uint8Array.from([])
}

async function getDelegateTx (
  amount: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('delegate', options, cmd, [amount])
}

async function getUnbondTx (
  amount: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('undelegate', options, cmd, [amount])
}

async function getWithdrawRewardsTx (
  validatorAddress: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('withdrawRewards', options, cmd, [validatorAddress])
}
