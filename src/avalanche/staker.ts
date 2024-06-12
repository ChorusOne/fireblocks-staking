import type { Signer } from '../signer'
import { print, prompt, journal, getNetworkConfig } from '../util'
import type { Config, AvalancheNetworkConfig } from '../types'
import { sha256 } from '@noble/hashes/sha256'
import { publicKeyConvert } from 'secp256k1'
import type { VaultAccountResponse } from 'fireblocks-sdk'
import type { UnsignedTx, Common } from '@avalabs/avalanchejs'
import { JsonRpcProvider } from 'ethers'
import {
  networkIDs as constants,
  utils,
  pvm,
  evm,
  avm,
  Context,
  secp256k1,
  avaxSerial
} from '@avalabs/avalanchejs'

export class AvalancheStaker {
  private readonly signer: Signer
  private readonly config: Config
  private readonly withJournal: boolean
  private readonly networkConfig: AvalancheNetworkConfig

  private vault: VaultAccountResponse
  private cAddr: string
  private pAddr: string
  private xAddr: string
  private coreEthAddr: string

  constructor (signer: Signer, config: Config, withJournal: boolean) {
    this.signer = signer
    this.config = config
    this.withJournal = withJournal
    this.networkConfig = getNetworkConfig<AvalancheNetworkConfig>(config)
  }

  async init (): Promise<void> {
    // setup public key
    const vault = await this.signer.getVault(this.config.fireblocks.vaultName)
    const pkFromVault = await this.signer.getPublicKey(vault, this.config.fireblocks.assetId)
    const pkUncompressed = Buffer.from(pkFromVault, 'hex')
    // NOTE: avalanchejs publicKeyBytesToAddress expects compressed public key!!! (otherwise you get wrong address)
    const pkCompressed = Buffer.from(publicKeyConvert(pkUncompressed, true))

    // generate C-Chain and P-Chain addresses
    const addrBytes = secp256k1.publicKeyBytesToAddress(pkCompressed)
    const cAddr = '0x' + Buffer.from(secp256k1.publicKeyToEthAddress(pkUncompressed)).toString('hex')
    const pAddr = utils.format('P', 'fuji', addrBytes)
    const xAddr = utils.format('X', 'fuji', addrBytes)
    const coreEthAddr = utils.format('C', 'fuji', addrBytes)

    if (cAddr.toLowerCase() !== this.config.delegatorAddress.toLowerCase()) {
      throw new Error(`the delegator address ${this.config.delegatorAddress} in the config does not match the address from the vault: ${cAddr}`)
    }

    this.vault = vault
    this.cAddr = cAddr
    this.pAddr = pAddr
    this.xAddr = xAddr
    this.coreEthAddr = coreEthAddr
  }

  @journal('delegate')
  async delegate (amount: string, noDays: number): Promise<avaxSerial.SignedTx> {
    if (noDays <= 0) {
      throw new Error('number of days must be greater than 0')
    }

    const pvmApi = new pvm.PVMApi(this.networkConfig.rpcUrl)
    const context = await Context.getContextFromURI(this.networkConfig.rpcUrl)

    const { utxos } = await pvmApi.getUTXOs({ addresses: [this.pAddr] })

    // calculate staking period
    const startTime = await new pvm.PVMApi().getTimestamp()
    const startDate = new Date(startTime.timestamp)
    const start = BigInt(startDate.getTime() / 1000)
    const endTime = new Date(startTime.timestamp)
    endTime.setDate(endTime.getDate() + noDays)
    const end = BigInt(endTime.getTime() / 1000)

    const tx = pvm.newAddPermissionlessDelegatorTx(
      context,
      utxos,
      [utils.bech32ToBytes(this.pAddr)],
      this.config.validatorAddress,
      constants.PrimaryNetworkID.toString(),
      start,
      end,
      BigInt(Number(amount) * this.networkConfig.denomMultiplier), // weight is amont in nAVAX
      [utils.bech32ToBytes(this.pAddr)]
    )

    return await this.sign(tx)
  }

  @journal('importTx')
  async importTx (sourceChain: string, dstChain: string): Promise<avaxSerial.SignedTx> {
    validateSrcAndDstChain(sourceChain, dstChain)

    const context = await Context.getContextFromURI(this.networkConfig.rpcUrl)
    const srcCoreAddr = this.getAddress(sourceChain, true)
    const dstAddr = this.getAddress(dstChain)
    const dstCoreAddr = this.getAddress(dstChain, true)

    switch (dstChain) {
      case 'C': {
        const evmApi = new evm.EVMApi(this.networkConfig.rpcUrl)
        const baseFee = await evmApi.getBaseFee()

        const { utxos } = await evmApi.getUTXOs({
          sourceChain,
          addresses: [dstCoreAddr]
        })

        const tx = evm.newImportTxFromBaseFee(
          context,
          utils.hexToBuffer(dstAddr),
          [utils.bech32ToBytes(dstCoreAddr)],
          utxos,
          getChainIdFromContext(sourceChain, context),
          baseFee / BigInt(this.networkConfig.denomMultiplier)
        )

        return await this.sign(tx)
      }
      case 'P': {
        const pvmApi = new pvm.PVMApi(this.networkConfig.rpcUrl)
        const { utxos } = await pvmApi.getUTXOs({
          sourceChain,
          addresses: [dstAddr]
        })

        const tx = pvm.newImportTx(
          context,
          getChainIdFromContext(sourceChain, context),
          utxos,
          [utils.bech32ToBytes(dstAddr)],
          [utils.bech32ToBytes(srcCoreAddr)]
        )

        return await this.sign(tx)
      }
      default:
        throw new Error('invalid source chain')
    }
  }

  @journal('exportTx')
  async exportTx (sourceChain: string, dstChain: string, amount: string): Promise<avaxSerial.SignedTx> {
    validateSrcAndDstChain(sourceChain, dstChain)

    const context = await Context.getContextFromURI(this.networkConfig.rpcUrl)
    const srcAddr = this.getAddress(sourceChain)
    const dstAddr = this.getAddress(dstChain)
    const dstCoreAddr = this.getAddress(dstChain, true)

    switch (sourceChain) {
      case 'C': {
        const evmApi = new evm.EVMApi(this.networkConfig.rpcUrl)
        const provider = new JsonRpcProvider(this.networkConfig.rpcUrl + '/ext/bc/C/rpc')
        const txCount = await provider.getTransactionCount(srcAddr)
        const baseFee = await evmApi.getBaseFee()
        const dstAddressBytes = utils.bech32ToBytes(dstAddr)

        const tx = evm.newExportTxFromBaseFee(
          context,
          baseFee / BigInt(this.networkConfig.denomMultiplier),
          BigInt(Number(amount) * this.networkConfig.denomMultiplier),
          getChainIdFromContext(dstChain, context),
          utils.hexToBuffer(srcAddr),
          [dstAddressBytes],
          BigInt(txCount)
        )

        return await this.sign(tx)
      }
      case 'P': {
        const pvmApi = new pvm.PVMApi(this.networkConfig.rpcUrl)
        const { utxos } = await pvmApi.getUTXOs({
          addresses: [srcAddr]
        })

        const amnt = BigInt(Number(amount) * this.networkConfig.denomMultiplier)
        const tx = pvm.newExportTx(
          context,
          getChainIdFromContext(dstChain, context),
          [utils.bech32ToBytes(srcAddr)],
          utxos,
          [
            avaxSerial.TransferableOutput.fromNative(context.avaxAssetID, amnt, [
              utils.bech32ToBytes(dstCoreAddr)
            ])
          ]
        )

        return await this.sign(tx)
      }
      default:
        throw new Error('invalid source chain')
    }
  }

  async sign (tx: UnsignedTx): Promise<avaxSerial.SignedTx> {
    const sh = sha256(tx.toBytes())
    const hexMsg = Buffer.from(sh).toString('hex')

    print(1, 3, 'prepare unsigned transaction')
    console.log(JSON.stringify(tx.toJSON(), null, 2))

    const shouldSign = await prompt('Do you want to sign the TX?')
    if (!shouldSign) {
      throw new Error('transaction signing aborted by user')
    }

    const txInfo = await this.signer.sign(this.vault, this.config.fireblocks.assetId, this.config.delegatorAddress, hexMsg, '')

    if (txInfo.signedMessages === undefined || txInfo.signedMessages?.length === 0) {
      throw new Error("fireblocks didn't return any signed message, but it should")
    }
    const signedMsg = txInfo.signedMessages[0]

    // avalanchejs/src/crypto/secp256k1.ts recoverPublicKey expects signature
    // with recovery (v) bit
    const sig = new Uint8Array([
      ...Buffer.from(signedMsg.signature.r ?? '', 'hex'),
      ...Buffer.from(signedMsg.signature.s ?? '', 'hex'),
      signedMsg.signature.v ?? 0
    ])

    tx.addSignature(sig)

    console.log('* transaction signature recieved: ')
    console.log(Buffer.from(sig).toString('hex') + '\n')

    return tx.getSignedTx()
  }

  @journal('txBroadcast')
  async broadcast (tx: avaxSerial.SignedTx, dstChain: string): Promise<Common.IssueTxResponse> {
    switch (dstChain) {
      case 'C': {
        const evmApi = new evm.EVMApi(this.networkConfig.rpcUrl)
        return await evmApi.issueSignedTx(tx)
      }
      case 'P': {
        const pvmApi = new pvm.PVMApi(this.networkConfig.rpcUrl)
        return await pvmApi.issueSignedTx(tx)
      }
      case 'X': {
        const avmApi = new avm.AVMApi(this.networkConfig.rpcUrl)
        return await avmApi.issueSignedTx(tx)
      }
      default:
        throw new Error('invalid source chain')
    }
  }

  getKeyInfo (): any {
    return {
      'vault-name': this.vault.name,
      'c-chain': this.cAddr,
      'p-chain': this.pAddr,
      'x-chain': this.xAddr,
      'c-chain-core': this.coreEthAddr
    }
  }

  getAddress (chain: string, core: boolean = false): string {
    switch (chain) {
      case 'C':
        return core ? this.coreEthAddr : this.cAddr
      case 'P':
        return this.pAddr
      case 'X':
        return this.xAddr
      default:
        throw new Error('invalid chain')
    }
  }
}

function validateSrcAndDstChain (sourceChain: string, dstChain: string): void {
  // TODO: support X-Chain
  if (!(['C', 'P'].includes(sourceChain))) {
    throw new Error('source chain must be either C or P')
  }

  if (!(['C', 'P'].includes(dstChain))) {
    throw new Error('destnation chain must be either C or P')
  }

  if (sourceChain === dstChain) {
    throw new Error('source chain and destination chain must be different')
  }
}

function getChainIdFromContext (sourceChain: string, context: Context.Context): string {
  switch (sourceChain) {
    case 'C':
      return context.cBlockchainID
    case 'P':
      return context.pBlockchainID
    case 'X':
      return context.xBlockchainID
    default:
      throw new Error('invalid source chain')
  }
}
