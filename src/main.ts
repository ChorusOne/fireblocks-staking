import { FireblocksSDK, type VaultAccountResponse } from 'fireblocks-sdk'
import { Command } from '@commander-js/extra-typings'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { type EncodeObject } from '@cosmjs/proto-signing'
import { toBech32, fromBase64 } from '@cosmjs/encoding'
import { promises as fsPromises } from 'fs'
import { type Config, type Signer, type FireblocksConfig } from './types'
import { prompt, writeJournal, readConfig, print } from './util'
import { LocalSigner } from './signer/local'
import { genSignedTx, genSignedMsg, genSignableTx, genDelegateOrUndelegateMsg, genBeginRedelegateMsg, genWithdrawRewardsMsg } from './tx'
import {
  SigningStargateClient,
  type StargateClient,
  type Account
} from '@cosmjs/stargate'

import { type StdSignDoc, rawSecp256k1PubkeyToRawAddress } from '@cosmjs/amino'

enum SignerType {
  FIREBLOCKS = 'fireblocks',
  LOCAL = 'local'
}

const program = new Command()

program
  .name('fireblocks-staking')
  .description('CLI to manage funds for fireblocks accounts')
  .option('-c, --config <path>', 'path to configuration file', 'config.json')
  .option(
    '-s, --signer <type>',
    'choose signer with which you want to sign TX. Options: local or fireblocks',
    'fireblocks'
  )
  .version('1.0.0')

program.addCommand(makeTxCommand())

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

async function newFireblocksSigner (config: FireblocksConfig): Promise<Signer> {
  const apiSecret = await fsPromises.readFile(config.apiSecretKeyPath, 'utf-8')
  const apiKey = await fsPromises.readFile(config.apiKeyPath, 'utf-8')

  return new FireblocksSDK(apiSecret.trim(), apiKey.trim())
}

async function newLocalSigner (config: Config): Promise<Signer> {
  return await LocalSigner.build(
    config.localsigner.mnemonicPath,
    config.fireblocks.vaultName,
    config.network.bechPrefix
  )
}

async function newCosmosClient (rpcUrl: string): Promise<StargateClient> {
  return await SigningStargateClient.connect(rpcUrl)
}

async function newSigner (config: Config, signerType: SignerType): Promise<Signer> {
  switch (signerType) {
    case SignerType.FIREBLOCKS:
      return await newFireblocksSigner(config.fireblocks)
    case SignerType.LOCAL:
      return await newLocalSigner(config)
  }

  throw new Error('invalid signer type provided: ' + (signerType as string))
}

async function init (
  cmd: Command<[string]> | Command<[string, string]>
): Promise<
  [Config, string, Account, VaultAccountResponse, StargateClient, Signer]
  > {
  const path: string = cmd.parent?.parent?.getOptionValue('config') as string
  const signerType: string = cmd.parent?.parent?.getOptionValue(
    'signer'
  ) as string

  const config: Config = await readConfig(path).catch((e) => {
    cmd.error(e, { exitCode: 1, code: 'delegate.config.fs' })
  })

  const signer: Signer = await newSigner(config, signerType as SignerType)

  const cosmosClient = await newCosmosClient(config.network.rpcUrl).catch(
    (e) => {
      cmd.error(e, { exitCode: 1, code: 'delegate.cosmos.init' })
    }
  )

  const cosmosAccount = await cosmosClient.getAccount(config.delegatorAddress)
  if (cosmosAccount == null) {
    cmd.error(
      'failed to query account: ' +
                config.delegatorAddress +
                ' are you sure the account exists?',
      { exitCode: 1, code: 'delegate.cosmos.account.found' }
    )
  }

  const chainID: string = await cosmosClient.getChainId()

  const vaultName = config.fireblocks.vaultName
  const vaults = await signer
    .getVaultAccountsWithPageInfo({
      namePrefix: vaultName
    })
    .then((res) => {
      return res.accounts.filter((account) => account.name === vaultName)
    })

  if (vaults.length !== 1) {
    cmd.error(
      'fireblocks vault name not found, expecte exactly 1 result, got: ' +
                vaults.length,
      { exitCode: 1, code: 'delegate.fireblocks.vault.found' }
    )
  }

  return [config, chainID, cosmosAccount, vaults[0], cosmosClient, signer]
}

async function runTx (
  msgType: string,
  options: any,
  cmd: Command<[string]> | Command<[string, string]>,
  arg: string[]
): Promise<[StdSignDoc, Uint8Array]> {
  const broadcastEnabled = cmd.parent?.getOptionValue('broadcast') as boolean
  const memo = cmd.parent?.getOptionValue('memo') as string
  const journalEnabled: boolean = JSON.parse(cmd.parent?.getOptionValue('journal') as string)

  const [config, chainID, cosmosAccount, vault, cosmosClient, signerClient] =
        await init(cmd)

  let txMsg: EncodeObject = { typeUrl: '', value: '' }

  switch (msgType) {
    case 'delegate':
    case 'undelegate':
      txMsg = genDelegateOrUndelegateMsg(
        config,
        msgType,
        arg[0] // amount
      )
      break
    case 'redelegate':
      txMsg = genBeginRedelegateMsg(
        config,
        arg[0], // amount
        arg[1] // validatorDstAddress
      )
      break
    case 'withdrawRewards':
      txMsg = genWithdrawRewardsMsg(config, arg[0] /* validatorAddress */)
  }

  const signDoc = await genSignableTx(
    config,
    chainID,
    txMsg,
    cosmosAccount.accountNumber,
    cosmosAccount.sequence,
    memo
  )

  print(1, 3, 'prepare unsigned transaction')
  console.log(JSON.stringify(signDoc, null, 2))

  await writeJournal({
    type: 'unsignedTx',
    timestamp: Math.floor(Date.now() / 1000),
    data: JSON.stringify(signDoc, null, 2)
  }, journalEnabled)

  const shouldSign = await prompt('Do you want to sign the TX?')
  if (!shouldSign) {
    cmd.error('transaction signing aborted by user', {
      exitCode: 1,
      code: 'delegate.abort'
    })
  }

  const signedMsg = await genSignedMsg(
    signerClient,
    signDoc,
    vault,
    config.delegatorAddress,
    config.fireblocks.assetId
  )

  const [signedTx, pk] = await genSignedTx(signDoc, signedMsg)

  const addressFromPK = toBech32(
    config.network.bechPrefix,
    rawSecp256k1PubkeyToRawAddress(fromBase64(pk))
  )
  if (addressFromPK !== config.delegatorAddress) {
    cmd.error(
      'address derived from signed message public key is different from the delegator address: ' +
                addressFromPK +
                ' != ' +
                config.delegatorAddress,
      {
        exitCode: 1,
        code: 'delegate.address.invalid'
      }
    )
  }

  const txBytes = TxRaw.encode(signedTx).finish()

  console.log('* transaction signature recieved: ')
  console.log(TxRaw.toJSON(signedTx))
  await writeJournal({
    type: 'signedTx',
    timestamp: Math.floor(Date.now() / 1000),
    data: {
      txRaw: TxRaw.toJSON(signedTx),
      txEncoded: txBytes,
      signDoc,
      pk
    }
  }, journalEnabled)

  if (broadcastEnabled) {
    const shouldBroadcast = await prompt('Do you want to broadcast TX?')
    if (!shouldBroadcast) {
      cmd.error('transaction signing aborted by user', {
        exitCode: 1,
        code: 'delegate.abort'
      })
    }

    print(3, 3, 'broadcasting the signed transaction')
    const result = await cosmosClient.broadcastTx(txBytes)
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
    await writeJournal({
      type: 'txBroadcast',
      timestamp: Math.floor(Date.now() / 1000),
      data: JSON.stringify(result, null, 2)
    }, journalEnabled)

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

  return [signDoc, txBytes]
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

(async () => {
  await program.parseAsync()
})().catch(e => {
  console.error(e)
})
