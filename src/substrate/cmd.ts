import { Command } from '@commander-js/extra-typings'
import type { Config, SignerBackend, SubstrateNetworkConfig } from '../types'
import { Signer } from '../signer'
import type { SignerType } from '../enums'
import { readConfig, getNetworkConfig, print, checkNodeVersion } from '../util'
import { newSignerBackend } from '../backend/backend'
import { SubstrateStaker } from './staker'
import type { ExtrinsicStatus } from '@polkadot/types/interfaces/author'

export function makeSubstrateCommand (): Command {
  const substrate = new Command('substrate')

  substrate.addCommand(makeTxCommand())

  return substrate
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
      'amount of tokens to stake expressed in DOT/KSM/etc denom e.g 0.1'
    )
    .action(getDelegateTx)

  tx.command('bond-extra')
    .description('delegate more tokens (use this if you delegated already) to validator')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in DOT/KSM/etc denom e.g 0.1'
    )
    .action(getBondExtraTx)

  tx.command('nominate')
    .description('generate a nominate funds to validator transaction')
    .action(getNominateTx)

  tx.command('unbond')
    .description('generate unbond funds to validator transaction')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in denom e.g 0.1. Zero (0) to unstake all funds.'
    )
    .action(getUnbondTx)

  tx.command('withdraw')
    .description('withdraw all unstaked funds from the validator contract')
    .action(getWithdrawTx)

  return tx
}

async function init (
  cmd: Command<[string]> | Command<[]>
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
  cmd: Command<[string]> | Command<[]>,
  arg: string[]
): Promise<Uint8Array> {
  // https://github.com/polkadot-js/api/issues/5880
  checkNodeVersion('v22.', 'node version v22 is faulty for polkadot api js, please downgrade')

  const broadcastEnabled = cmd.parent?.getOptionValue('broadcast') as boolean
  const journalEnabled: boolean = JSON.parse(cmd.parent?.getOptionValue('journal') as string)

  const [config, signerClient] = await init(cmd)

  const substrateStaker: SubstrateStaker = new SubstrateStaker(signerClient, config, journalEnabled)
  await substrateStaker.init()

  let response: ExtrinsicStatus | undefined
  let errMsg: string = ''

  print(1, 3, 'prepare unsigned transaction')
  console.log(JSON.stringify({
    delegator: config.delegatorAddress,
    validatorAddress: config.validatorAddress,
    messageType: msgType,
    args: arg,
    broadcast: broadcastEnabled
  }, null, 2))

  try {
    switch (msgType) {
      case 'delegate':
        [response, errMsg] = await substrateStaker.delegate(
          arg[0], // amount
          broadcastEnabled
        )
        break
      case 'bondExtra':
        [response, errMsg] = await substrateStaker.bondExtra(
          arg[0], // amount
          broadcastEnabled
        )
        break
      case 'nominate':
        [response, errMsg] = await substrateStaker.nominate(
          broadcastEnabled
        )
        break
      case 'undelegate':
        [response, errMsg] = await substrateStaker.undelegate(
          arg[0], // amount
          broadcastEnabled
        )
        break
      case 'withdraw':
        [response, errMsg] = await substrateStaker.withdraw(
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
  if (response.isInBlock) {
    console.log(`transaction included at blockHash ${response.asInBlock.toString()}`)
  }

  if (response.isFinalized) {
    console.log(`transaction finalized at blockHash ${response.asFinalized.toString()}`)
  }

  if (errMsg !== '') {
    console.log('error: ' + errMsg)
  }

  const networkConfig = getNetworkConfig<SubstrateNetworkConfig>(config)
  if (networkConfig.blockExplorerUrl !== undefined) {
    console.log('* transaction was (most likely) broadcasted to the network')
    console.log("* due to unstable polkadot-js/api, you'll need to find the transaction manually and check it's status")
    console.log(
      '\nLink to block explorer: ' +
          networkConfig.blockExplorerUrl + '/' + config.delegatorAddress
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

async function getBondExtraTx (
  amount: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('bondExtra', options, cmd, [amount])
}

async function getNominateTx (
  options: any,
  cmd: Command<[]>
): Promise<void> {
  await runTx('nominate', options, cmd, [])
}

async function getUnbondTx (
  amount: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('undelegate', options, cmd, [amount])
}

async function getWithdrawTx (
  options: any,
  cmd: Command<[]>
): Promise<void> {
  await runTx('withdraw', options, cmd, [])
}
