import { Command } from '@commander-js/extra-typings'
import type { Config, SignerBackend, AvalancheNetworkConfig } from '../types'
import { Signer } from '../signer'
import type { SignerType } from '../enums'
import { prompt, readConfig, getNetworkConfig, print } from '../util'
import { newSignerBackend } from '../backend/backend'
import { AvalancheStaker } from './staker'
import type { avaxSerial } from '@avalabs/avalanchejs'

export function makeAvalancheCommand (): Command {
  const avalanche = new Command('avalanche')

  avalanche.addCommand(makeTxCommand())
  avalanche.addCommand(makeKeysCommand())

  return avalanche
}

function makeKeysCommand (): Command {
  const keys = new Command('keys')
    .description('signing key operations')

  keys.command('get')
    .description('retrieve key information')
    .action(getKeyInfo)

  return keys
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
    .argument(
      '<days>',
      'number of days to delegate funds for'
    )
    .action(getDelegateTx)

  tx.command('export')
    .description('export funds crosschain e.g C-Chain <-> P-Chain')
    .argument(
      '<source_chain>',
      'chain to transfer from e.g C or P'
    )
    .argument(
      '<destination_chain>',
      'chain to transfer to e.g C or P'
    )
    .argument(
      '<amount>',
      'amount of tokens to transfer Avax denom e.g 0.1'
    )
    .action(getExportTx)

  tx.command('import')
    .description('import funds crosschain e.g C-Chain <-> P-Chain')
    .argument(
      '<source_chain>',
      'chain where the tokens have been exported / sent from e.g C or P'
    )
    .argument(
      '<destination_chain>',
      'chain where the tokens are to be imported to e.g C or P'
    )
    .action(getImportTx)

  return tx
}

async function init (
  cmd: Command<[string]> | Command<[string, string]> | Command<[string, string, string]> | Command<[]>
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
  cmd: Command<[string]> | Command<[string, string]> | Command<[string, string, string]> | Command<[]>,
  arg: string[]
): Promise<void> {
  const broadcastEnabled = cmd.parent?.getOptionValue('broadcast') as boolean
  const journalEnabled: boolean = JSON.parse(cmd.parent?.getOptionValue('journal') as string)

  const [config, signerClient] = await init(cmd)

  const avalancheStaker: AvalancheStaker = new AvalancheStaker(signerClient, config, journalEnabled)
  await avalancheStaker.init()

  print(0, 3, 'inspect input data')
  console.log(JSON.stringify({
    delegator: config.delegatorAddress,
    validatorAddress: config.validatorAddress,
    messageType: msgType,
    args: arg,
    broadcast: broadcastEnabled
  }, null, 2))

  let broadcastChain: string = ''
  let signedTx: avaxSerial.SignedTx | undefined

  try {
    switch (msgType) {
      case 'delegate': {
        broadcastChain = 'P'
        signedTx = await avalancheStaker.delegate(
          arg[0], // amount
          Number(arg[1]) // days
        )
        break
      }
      case 'export': {
        broadcastChain = arg[0]
        signedTx = await avalancheStaker.exportTx(
          arg[0], // sourceChain
          arg[1], // destinationChain
          arg[2] // amount
        )
        break
      }
      case 'import': {
        broadcastChain = arg[1]
        signedTx = await avalancheStaker.importTx(
          arg[0], // sourceChain
          arg[1] // destinationChain
        )
        break
      }
    }
  } catch (e) {
    cmd.error(e, { exitCode: 1, code: msgType + '.tx.sign' })
  }

  if (signedTx === undefined) {
    cmd.error('no signed transaction found', {
      exitCode: 1,
      code: `${msgType}.tx.sign`
    })
  }

  if (broadcastEnabled) {
    const shouldBroadcast = await prompt('Do you want to broadcast TX?')
    if (!shouldBroadcast) {
      cmd.error('transaction signing aborted by user', {
        exitCode: 1,
        code: `${msgType}.abort`
      })
    }

    print(3, 3, 'broadcasting the signed transaction')
    const result = await avalancheStaker.broadcast(signedTx, broadcastChain)

    const networkConfig = getNetworkConfig<AvalancheNetworkConfig>(config)
    if (networkConfig.blockExplorerUrl !== undefined) {
      console.log(
        '\nCheck TX status here: ' +
        networkConfig.blockExplorerUrl + '/' + broadcastChain.toLowerCase() + '/tx/' + result.txID
      )
    }
  }
}

async function getDelegateTx (
  amount: string,
  days: string,
  options: any,
  cmd: Command<[string, string]>
): Promise<void> {
  await runTx('delegate', options, cmd, [amount, days])
}

async function getImportTx (
  sourceChain: string,
  destinationChain: string,
  options: any,
  cmd: Command<[string, string]>
): Promise<void> {
  await runTx('import', options, cmd, [sourceChain, destinationChain])
}

async function getExportTx (
  sourceChain: string,
  destinationChain: string,
  amount: string,
  options: any,
  cmd: Command<[string, string, string]>
): Promise<void> {
  await runTx('export', options, cmd, [sourceChain, destinationChain, amount])
}

async function getKeyInfo (
  options: any,
  cmd: Command<[]>
): Promise<void> {
  const [config, signerClient] = await init(cmd)

  const avalancheStaker: AvalancheStaker = new AvalancheStaker(signerClient, config, false)
  await avalancheStaker.init()

  console.log(JSON.stringify(avalancheStaker.getKeyInfo(), null, 2))
}
