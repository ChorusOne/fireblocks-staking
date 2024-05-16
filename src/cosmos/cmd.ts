import { Command } from '@commander-js/extra-typings'
import { type Config, type SignerBackend } from '../types'
import { Signer } from '../signer'
import { type SignerType } from '../enums'
import { prompt, readConfig, print } from '../util'
import { newSignerBackend } from '../backend/backend'
import { CosmosStaker } from './staker'

export function makeCosmosCommand (): Command {
  const cosmos = new Command('cosmos')

  cosmos.addCommand(makeTxCommand())

  return cosmos
}

function makeTxCommand (): Command {
  const tx = new Command('tx')
    .description('generate a signed transaction')
    .option('-b, --broadcast', 'broadcast generated transaction', false)
    .option('-m, --memo <memo>', 'a note attached to transaction', '')
    .option('-j, --journal <value>', 'write TX\'es to the local journal log', 'true')

  tx.command('delegate')
    .description('generate a delegate funds to validator transaction')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in denom e.g 10utia'
    )
    .action(getDelegateTx)

  tx.command('unbond')
    .description('generate unbond funds to validator transaction')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in denom e.g 10utia'
    )
    .action(getUnbondTx)

  tx.command('redelegate')
    .description('redelegate funds to another validator')
    .argument(
      '<amount>',
      'amount of tokens to stake expressed in denom e.g 10utia'
    )
    .argument(
      '<validator-dst-address>',
      'validator address to redelegate funds to'
    )
    .action(getRedelegateTx)

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
  const memo = cmd.parent?.getOptionValue('memo') as string
  const journalEnabled: boolean = JSON.parse(cmd.parent?.getOptionValue('journal') as string)

  const [config, signerClient] = await init(cmd)

  const cosmosSigner: CosmosStaker = new CosmosStaker(signerClient, config, journalEnabled)
  await cosmosSigner.init()

  let txBytes: Uint8Array = new Uint8Array()

  try {
    switch (msgType) {
      case 'delegate':
        txBytes = await cosmosSigner.delegate(
          arg[0], // amount
          memo
        )
        break
      case 'undelegate':
        txBytes = await cosmosSigner.undelegate(
          arg[0], // amount
          memo
        )
        break
      case 'redelegate':
        txBytes = await cosmosSigner.redelegate(
          arg[0], // amount
          arg[1], // validatorDstAddress
          memo
        )
        break
      case 'withdrawRewards':
        txBytes = await cosmosSigner.withdrawDelegatorReward(
          arg[0], // validatorAddress
          memo
        )
        break
    }
  } catch (e) {
    cmd.error(e, { exitCode: 1, code: msgType + '.tx.sign' })
  }

  if (broadcastEnabled) {
    const shouldBroadcast = await prompt('Do you want to broadcast TX?')
    if (!shouldBroadcast) {
      cmd.error('transaction signing aborted by user', {
        exitCode: 1,
        code: 'delegate.abort'
      })
    }

    print(3, 3, 'broadcasting the signed transaction')
    const result = await cosmosSigner.broadcast(txBytes)
    console.log(
      JSON.stringify(
        {
          code: result.code,
          hash: result.transactionHash,
          gasUsed: result.gasUsed,
          gasWanted: result.gasWanted
        },
        null,
        2
      )
    )

    if (config.network.blockExplorerUrl !== undefined) {
      console.log(
        '\nCheck TX status here: ' +
                    config.network.blockExplorerUrl +
                    result.transactionHash
      )
    }

    if (result.code !== 0) {
      throw new Error(
        'transaction failed, expected status: 0, got: ' + result.code
      )
    }
  }

  return txBytes
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

async function getRedelegateTx (
  amount: string,
  validatorDstAddress: string,
  options: any,
  cmd: Command<[string, string]>
): Promise<void> {
  await runTx('redelegate', options, cmd, [amount, validatorDstAddress])
}

async function getWithdrawRewardsTx (
  validatorAddress: string,
  options: any,
  cmd: Command<[string]>
): Promise<void> {
  await runTx('withdrawRewards', options, cmd, [validatorAddress])
}
